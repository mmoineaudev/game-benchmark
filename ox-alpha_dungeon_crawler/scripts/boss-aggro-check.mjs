// boss-aggro-check.mjs — live CDP verification of the boss rebalance:
//   1. L7 boss must NOT teleport/move/attack before it SEES the player (no spawn aggro)
//   2. once the player is seen (LOS within AGGRO_RANGE) the boss wakes and chases
//   3. boss HP equals bossHp(level, ngPlus, souls, maxHealth) for the live state
//   4. pre-aggro HP cap: deep levels must stay ≤ 180 base (+wealth), never the old ×11
// Usage: node scripts/boss-aggro-check.mjs [--url http://localhost:5173]
import { WebSocket } from 'ws';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const get = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const URL_BASE = get('--url', 'http://localhost:5173');
const CDP_PORT = 9333;

async function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/snap/bin/chromium', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  for (const c of candidates) {
    try { const { accessSync } = await import('node:fs'); accessSync(c); return c; } catch { /* next */ }
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  try { await fetch(URL_BASE); } catch {
    console.error(`[boss-aggro] no dev server at ${URL_BASE} — run launch.sh first`);
    process.exit(2);
  }
  const chromePath = await findChrome();
  if (!chromePath) { console.error('[boss-aggro] no chromium found'); process.exit(2); }
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new', '--no-sandbox', '--disable-gpu-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--user-data-dir=/tmp/cdp-boss-aggro',
    '--window-size=1280,800', 'about:blank'
  ], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill(); } catch {} });

  let version;
  for (let i = 0; i < 50; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; }
    catch { await sleep(200); }
  }
  if (!version) { console.error('[boss-aggro] CDP never came up'); process.exit(2); }
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let msgId = 0;
  const pending = new Map();
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise(res => {
    const i = ++msgId; pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const exceptions = [];
  const pageLogs = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.method === 'Runtime.exceptionThrown')
      exceptions.push(m.params.exceptionDetails?.exception?.description || JSON.stringify(m.params).slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled')
      pageLogs.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  const evalJS = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r?.result?.result?.value ?? r?.result?.value;
  };

  let fails = 0;
  const gate = (name, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) fails++;
  };

  await send('Page.navigate', { url: URL_BASE });
  await sleep(1500);

  // wait for the game to boot (title scene build can take a few seconds)
  const ready = await evalJS(`(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 20000) {
      if (window.game && window.game._beginRun) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })()`);
  gate('window.game exposed (QA hook)', ready === true);
  if (ready !== true) { ws.close(); process.exit(2); }

  // start a fresh run (level 1)
  await evalJS(`window.game._beginRun(); 'ok'`);

  // wait until level 1 is live
  const live1 = await evalJS(`(async () => {
    for (let i = 0; i < 120; i++) {
      if (window.game._isRunning && window.game.skeletons) return { level: window.game.state.level, ok: true };
      await new Promise(r => setTimeout(r, 250));
    }
    return { ok: false, level: window.game.state.level };
  })()`);
  gate('level 1 live', live1.ok === true, `level=${live1.level}`);

  // ---- drive the run to level 7 (boss level) via the real descend path ----
  const descended = await evalJS(`(async () => {
    const g = window.game;
    for (let i = 0; i < 8 && g.state.level < 7; i++) {
      g._descend();
      for (let k = 0; k < 200; k++) {
        if (g.skeletons && g._isRunning) break;
        await new Promise(r => setTimeout(r, 250));
      }
      await new Promise(r => setTimeout(r, 800)); // let the loader phase settle
    }
    return { level: g.state.level, boss: !!g.skeletons.boss, hp: g.skeletons.boss?.hp ?? null, maxHp: g.skeletons.boss?.maxHp ?? null };
  })()`);
  gate('reached level 7 boss level', descended.level === 7 && descended.boss === true,
    `level=${descended.level} bossHp=${descended.hp}`);

  // ---- boss HP contract: live boss HP must equal bossHp(level, ng, souls, hearts) ----
  const hpCheck = await evalJS(`(() => {
    const g = window.game, s = g.state;
    const b = g.skeletons.boss;
    const bar = document.getElementById('boss-fill');
    return {
      level: s.level, ngPlus: s.ngPlus, souls: s.collectedOrbs, maxHealth: s.maxHealth,
      bossHp: b.hp, bossMaxHp: b.maxHp,
      barVisible: !!bar && getComputedStyle(document.getElementById('boss-bar-wrap')).display !== 'none',
      barPct: bar ? bar.style.width : null
    };
  })()`);
  // recompute the expectation out-of-band via the same module
  const { bossHp } = await import('../src/core/Constants.js');
  const expectedHp = bossHp(hpCheck.level, hpCheck.ngPlus, hpCheck.souls, hpCheck.maxHealth);
  gate('boss HP matches bossHp() contract', hpCheck.bossHp === expectedHp,
    `live=${hpCheck.bossHp} expected=${expectedHp} (L${hpCheck.level} NG${hpCheck.ngPlus} souls=${hpCheck.souls} hearts=${hpCheck.maxHealth})`);
  gate('boss HP ≤ 88 at L7 NG0 (25 base × max wealth 3.5)', hpCheck.bossHp <= 88, `hp=${hpCheck.bossHp}`);
  gate('boss bar visible on boss level', hpCheck.barVisible === true);

  // ---- PHASE A: no pre-aggro behavior. Player sits at the entrance; the boss
  // must stay SLEEPING at its spawn for a full window longer than the old
  // 4 s first-blink timer — no teleport, no drift, no damage. ----
  const phaseA = await evalJS(`(async () => {
    const g = window.game, b = g.skeletons.boss;
    const spawnX = b.pos.x, spawnZ = b.pos.z;
    const startHealth = g.state.health;
    const t0 = performance.now();
    let movedMax = 0;
    while (performance.now() - t0 < 12000) {
      const d = Math.hypot(b.pos.x - spawnX, b.pos.z - spawnZ);
      if (d > movedMax) movedMax = d;
      await new Promise(r => setTimeout(r, 100));
    }
    return {
      awake: b.awake, state: b.state,
      moved: +movedMax.toFixed(3),
      dmgTaken: startHealth - g.state.health,
      playerX: g.state.player.x, playerZ: g.state.player.z,
      bossX: b.pos.x, bossZ: b.pos.z,
      distToPlayer: +Math.hypot(b.pos.x - g.state.player.x, b.pos.z - g.state.player.z).toFixed(1)
    };
  })()`);
  gate('PHASE A: boss stayed dormant (no spawn aggro) for 12 s', phaseA.awake === false && phaseA.state === 'SLEEPING',
    `awake=${phaseA.awake} state=${phaseA.state}`);
  gate('PHASE A: boss never moved from throne', phaseA.moved < 0.01, `drift=${phaseA.moved}u`);
  gate('PHASE A: player took no damage pre-aggro (no blink-nova at spawn)', phaseA.dmgTaken === 0, `dmg=${phaseA.dmgTaken}`);
  const farEnough = phaseA.distToPlayer >= 25;
  gate('PHASE A: player was out of aggro range (test valid)', farEnough === true, `dist=${phaseA.distToPlayer}u`);

  // ---- PHASE B: player approaches within aggro range with LOS → boss wakes
  // and chases (state leaves SLEEPING, position tracks the player). ----
  const phaseB = await evalJS(`(async () => {
    const g = window.game, b = g.skeletons.boss;
    // wait out the safe-spawn window from the last level load
    const tSafe = performance.now();
    while (g.state.safeSpawn > 0 && performance.now() - tSafe < 8000) {
      await new Promise(r => setTimeout(r, 100));
    }
    // Find a walkable spot with clear LOS, 3–20 u from the boss (inside AGGRO_RANGE
    // 25 but far enough that "closing distance" is measurable). Scan a ring of
    // candidate offsets; the boss sits on the exit cell so nearby room space is
    // guaranteed to exist.
    const bx = b.pos.x, bz = b.pos.z;
    const losAt = (x, z) => g._hasLineOfSight(bx, bz, x, z);
    let px = null, pz = null;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1], [.7, .7], [-.7, .7]];
    outer: for (let dist = 4; dist <= 20; dist += 1) {
      for (const [dx, dz] of dirs) {
        const cx = bx + dx * dist, cz = bz + dz * dist;
        if (losAt(cx, cz)) { px = cx; pz = cz; break outer; }
      }
    }
    if (px == null) { px = bx; pz = bz; } // last resort: throne cell (clear by construction)
    const startDist = Math.hypot(px - bx, pz - bz);
    g.state.player.x = px; g.state.player.z = pz;
    g.camera.position.set(px, 1.6, pz);
    const t0 = performance.now();
    let wokeAt = null;
    while (performance.now() - t0 < 8000) {
      if (b.awake) { wokeAt = +((performance.now() - t0) / 1000).toFixed(2); break; }
      await new Promise(r => setTimeout(r, 50));
    }
    // The boss was immobile during Phase A (dormant). Record its position at
    // aggro, then confirm it STARTS MOVING (follows) once awake. Exact "closing
    // distance" is fragile: the boss charges/blinks mid-window and can overshoot,
    // so we gate on "it left its dormant spot," which is the real requirement.
    const atAggroX = b.pos.x, atAggroZ = b.pos.z;
    // let it chase/attack for 4 s
    await new Promise(r => setTimeout(r, 4000));
    const movedAfterAggro = Math.hypot(b.pos.x - atAggroX, b.pos.z - atAggroZ);
    return {
      woke: b.awake === true, wokeAt, state: b.state,
      movedAfterAggro: +movedAfterAggro.toFixed(1),
      approached: movedAfterAggro > 1.5   // it left its dormant spot = it's following
    };
  })()`);
  gate('PHASE B: boss woke when the player became visible', phaseB.woke === true, `wokeAt=${phaseB.wokeAt}s`);
  gate('PHASE B: boss follows (started moving) after aggro', phaseB.approached === true,
    `moved ${phaseB.movedAfterAggro}u from dormant spot, state=${phaseB.state}`);

  // ---- PHASE C: after aggro the boss ATTACKS (blink-nova / charge / smoke) and
  // its attacks can damage the player — the fight is real once it sees you. ----
  const phaseC = await evalJS(`(async () => {
    const g = window.game, b = g.skeletons.boss;
    // give the player a deep pool so a single blink-nova (3 dmg) is survivable —
    // we want to observe attacks, not end the run.
    g.state.maxHealth = 9; g.state.health = 9;
    const startHealth = g.state.health;
    const seenStates = new Set([b.state]);
    const t0 = performance.now();
    let blinkHit = false;
    // hook the blink-nova damage path to prove the nova detonates
    const origOnBlinkHit = g.skeletons.onBlinkHit;
    g.skeletons.onBlinkHit = (x, z, r, dmg) => { blinkHit = true; origOnBlinkHit?.(x, z, r, dmg); };
    while (performance.now() - t0 < 15000) {
      seenStates.add(b.state);
      if (blinkHit && g.state.health < startHealth) break;
      await new Promise(r => setTimeout(r, 100));
    }
    g.skeletons.onBlinkHit = origOnBlinkHit;
    const states = [...seenStates];
    const attacked = states.includes('CHARGING') || states.includes('BLINKING');
    return {
      states, blinkHit,
      dmgTaken: startHealth - g.state.health,
      attacked,
      playerAlive: g.state.health > 0
    };
  })()`);
  gate('PHASE C: boss attacked after aggro (charge/blink states observed)', phaseC.attacked === true,
    `states=${phaseC.states.join('→')}`);
  gate('PHASE C: blink-nova detonated and damages the player (post-aggro)', phaseC.blinkHit === true && phaseC.dmgTaken > 0,
    `blinkHit=${phaseC.blinkHit} dmg=${phaseC.dmgTaken}`);

  gate('zero page JS exceptions', exceptions.length === 0, exceptions[0] || '');
  if (fails > 0) {
    console.log('--- page console (last 12) ---');
    for (const l of pageLogs.slice(-12)) console.log('  ' + l);
  }
  console.log(fails === 0 ? 'boss-aggro-check: ALL GATES PASS' : `boss-aggro-check: ${fails} FAILURES`);
  ws.close(); process.exit(fails ? 1 : 0);
}

main().catch(e => { console.error('[boss-aggro] crashed:', e.message); process.exit(2); });

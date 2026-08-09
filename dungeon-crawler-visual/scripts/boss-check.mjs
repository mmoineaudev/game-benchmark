// Headless verification: boss levels — ghost boss spawns every 7th level,
// 15x HP, spectral biome, charge + summon AI, portal gating.
// Run: node scripts/boss-check.mjs

// Minimal THREE + document shim (the enemy classes touch textures/canvas)
const THREE = await import('three');
globalThis.document = {
  createElement: (t) => {
    if (t === 'canvas') {
      return {
        width: 64, height: 64,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {}, beginPath() {}, stroke() {}, moveTo() {},
          lineTo() {}, arc() {}, fill() {}, closePath() {}, fillText() {},
        }),
      };
    }
    return { style: {} };
  },
  createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  body: { appendChild() {}, style: {} },
};

const { GhostBoss } = await import('../src/entities/enemies/GhostBoss.js');
const { Burning } = await import('../src/entities/enemies/Burning.js');
const { readFileSync } = await import('node:fs');
const {
  BOSS, BIOMES, biomeForLevel, BURN,
} = await import('../src/core/Constants.js');

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.log(`  FAIL: ${msg}`); } };

console.log('== Boss levels ==');
// Every 7th level is a boss; others use the normal biome sequence
for (const lvl of [7, 14, 21]) ok(biomeForLevel(lvl) === 'SPECTRAL_COURT', `level ${lvl} = spectral boss biome`);
ok(biomeForLevel(1) === 'STONE', 'level 1 is stone (not boss)');
ok(biomeForLevel(6) !== 'SPECTRAL_COURT' && biomeForLevel(8) !== 'SPECTRAL_COURT', 'levels 6/8 are not boss');
ok(BIOMES.SPECTRAL_COURT && BIOMES.SPECTRAL_COURT.label === 'SPECTRAL COURT', 'spectral biome defined');
ok(BOSS.INTERVAL === 7 && BOSS.HP_MULT === 22.5 && BOSS.MAX_MINIONS === 25 && BOSS.CHARGE_DMG === 2,
  'boss constants (interval 7, HP_MULT 22.5, MAX_MINIONS 25, charge dmg 2)');

console.log('== GhostBoss ==');
{
  const scene = { add() {}, remove() {} };
  const boss = new GhostBoss(scene, 4);
  ok(boss.maxHp === 90, `boss HP = 22.5x base (4 -> ${boss.maxHp})`);
  ok(boss.hp === 90 && boss.state !== 'DEAD', 'boss alive at full HP');
  ok(boss.bar && boss.barMat && boss.barMat.opacity === 1, 'boss health bar sprite hovers above');

  // Wealth/hearts stack (user ruling): souls bonus +25%/50 souls stacks with
  // ×1.1 per permanent heart past 3; the combined excess is HALVED:
  //   mult = 1 + ((1+soulsBonus)·1.1^hearts − 1)/2
  const poor = new GhostBoss(scene, 4, 'WRAITH', 49);
  ok(poor.maxHp === 90, `49 souls: no bonus (${poor.maxHp})`);
  const rich = new GhostBoss(scene, 4, 'WRAITH', 100);
  ok(rich.maxHp === 113, `100 souls: +25% stack halved -> ${rich.maxHp} (90 x 1.25)`);
  const loaded = new GhostBoss(scene, 4, 'WRAITH', 300);
  ok(loaded.maxHp === 158, `300 souls: +150% stack halved -> ${loaded.maxHp} (90 x 1.75)`);
  const hearty = new GhostBoss(scene, 4, 'WRAITH', 0, 5);
  ok(hearty.maxHp === 118, `5 hearts: x1.1^5 halved -> ${hearty.maxHp} (90 x 1.3053)`);
  const both = new GhostBoss(scene, 4, 'WRAITH', 100, 5);
  ok(both.maxHp === 154, `100 souls + 5 hearts stack halved -> ${both.maxHp} (90 x 1.7079)`);
  poor.dispose(); rich.dispose(); loaded.dispose(); hearty.dispose(); both.dispose();

  // The boss now gets the mob level term too: SkeletonSystem._spawnBoss must
  // fold +100%/10 levels into baseHp and pass heartsExtra (regression guard —
  // deep-level lords were previously level-agnostic).
  const ssSrc = readFileSync(new URL('../src/entities/SkeletonSystem.js', import.meta.url), 'utf8');
  ok(ssSrc.includes('HP_LEVEL_INTERVAL') && ssSrc.includes('heartsExtra'), 'boss spawn folds level term + heartsExtra');

  // damage path -> onKill on death
  let killed = 0;
  boss.onKill = () => killed++;
  boss.hit(89);
  ok(boss.hp === 1 && killed === 0, 'boss survives 89 dmg (hp 1)');
  ok(boss.hit(1) === true && killed === 1, 'boss dies at 90 dmg, onKill fires');
  ok(boss.state === 'DEAD', 'boss state = DEAD');

  // charge AI: within range, charge cooldown elapses -> CHARGING, then CHASE
  const b2 = new GhostBoss(scene, 4);
  b2._chargeCd = 0;
  const cb = [];
  const coll = [];
  const resolve = () => {};
  const meh = (fn, err) => { try { fn(); } catch (e) { ok(false, `${err}: ${e.message}`); } };
  // player 5 units away -> charge triggers, moves toward player
  b2.onChargeHit = () => cb.push('hit');
  b2.group.position.set(0, 0, 0);
  const player = { x: 5, z: 0 };
  meh(() => b2.update(0.016, 0, player, coll, resolve), 'charge update');
  const chargingAfter = b2.state;
  ok(chargingAfter === 'CHARGING', 'boss enters CHARGING when in range & off cooldown');
  // run the charge ~0.9s -> returns to CHASE
  for (let i = 0; i < Math.ceil(1.2 / 0.016); i++) b2.update(0.016, 0, player, coll, resolve);
  ok(b2.state === 'CHASE', 'boss returns to CHASE after the charge');
  ok(b2.group.position.x > 3, `boss charged toward the player (x=${b2.group.position.x.toFixed(1)})`);
  b2.onSummon = () => {}; // caller-set hook (SkeletonSystem wires it)
  ok(typeof b2.onSummon === 'function', 'boss exposes onSummon hook');

  // Stuck-boss regression: when a wall blocks the straight line (SkeletonSystem
  // passes a grid-pathing stepDir), the boss follows it instead of charging
  // into the geometry and grinding against it forever.
  const b4 = new GhostBoss(scene, 4);
  b4.onSummon = () => {};
  b4.group.position.set(0, 0, 0);
  const p4 = { x: 6, z: 0 };
  b4._chargeCd = 0;
  b4.update(1 / 60, 0, p4, [], resolve, { x: 0, z: 1 }); // blocked: pathing dir +z
  ok(b4.state !== 'CHARGING', 'boss does NOT charge through a blocked path (stuck-boss fix)');
  ok(b4.group.position.z > 0.001,
    `boss drifts along the pathing direction when blocked (z=${b4.group.position.z.toFixed(4)})`);
  b4.dispose();

  boss.dispose(); b2.dispose();
  ok(boss._removed && b2._removed, 'dispose marks both bosses removed');

  // one boss per enemy type (variant)
  const brute = new GhostBoss(scene, 4, 'BRUTE');
  ok(brute.variant === 'BRUTE' && brute.variantLabel === 'ASH TITAN', 'boss variant + label (BRUTE)');
  ok(brute._scale === 1.4, 'BRUTE boss is scaled up');
  brute.dispose();
}

// REGRESSION: safe-spawn path — SkeletonSystem calls update(dt, time) with
// NO player (title screen / spawn protection idle). The boss must idle in
// place, not crash (was: TypeError reading 'x' of undefined at GhostBoss.update).
{
  const scene = { add() {}, remove() {} };
  const b3 = new GhostBoss(scene, 4);
  b3._chargeCd = 0;
  let threw = null;
  try {
    for (let i = 0; i < 60; i++) b3.update(0.016, i * 0.016); // no player arg
  } catch (e) {
    threw = e;
  }
  ok(threw === null, `boss update without player idles (no throw${threw ? ': ' + threw.message : ''})`);
  ok(b3.state !== 'CHARGING' && b3.group.position.x === 0 && b3.group.position.z === 0,
    'boss stays put while safe-spawn is active');
  b3.dispose();
}

console.log('== Boss attacks: teleport-nova + smoke ==');
{
  const scene = { add() {}, remove() {} };
  const resolve = () => {};
  ok(BOSS.BLINK_DMG === 3 && BOSS.BLINK_RADIUS === 3
    && Math.abs(BOSS.BLINK_TELEGRAPH - 1) < 1e-9 && BOSS.SMOKE_DMG === 1,
    'blink (3 hearts @ 3 u, 1 s spark) + smoke (1 heart/s) constants (user rulings)');

  // BLINK AI: off cooldown -> teleports ONTO the player, sparks for the
  // telegraph window, then detonates (onBlinkHit) and returns to CHASE.
  const b5 = new GhostBoss(scene, 4);
  b5.onSummon = () => {};
  b5._blinkCd = 0;
  b5.group.position.set(0, 0, 0);
  const p5 = { x: 8, z: 3 };
  let blinks = 0;
  b5.onBlinkHit = () => blinks++;
  b5.update(1 / 60, 0, p5, [], resolve);
  ok(b5.state === 'BLINKING', 'boss enters BLINKING (teleport-nova) when off cooldown');
  ok(Math.hypot(b5.group.position.x - p5.x, b5.group.position.z - p5.z) < 1e-6,
    'boss teleported ONTO the player');
  // Let the spark telegraph animate a few frames, then check it's live.
  for (let i = 0; i < 3; i++) b5.update(1 / 60, 0, p5, [], resolve);
  ok(b5._ring.visible === true && b5._sparks.length === 12, 'spark telegraph (ring + 12 sparks) is live');
  for (let i = 0; i < Math.ceil(1.1 / (1 / 60)); i++) b5.update(1 / 60, 0, p5, [], resolve);
  ok(b5.state === 'CHASE' && blinks === 1, 'nova detonates after the 1 s spark (onBlinkHit fired)');
  ok(b5._blinkCd > 0, 'blink goes on cooldown after the detonation');
  b5.dispose();

  // SMOKE AI: off cooldown -> cloud thrown, homes to the player, lingers,
  // then fades out and is removed.
  const b6 = new GhostBoss(scene, 4);
  b6.onSummon = () => {};
  b6._smokeCd = 0;
  b6.group.position.set(0, 0, 0);
  const p6 = { x: 6, z: 0 };
  b6.update(1 / 60, 0, p6, [], resolve);
  ok(b6.smokeClouds.length === 1 && b6.smokeClouds[0].phase === 'FLY',
    'smoke cloud thrown toward the player');
  for (let i = 0; i < Math.ceil(1.5 / (1 / 60)); i++) b6.update(1 / 60, 0, p6, [], resolve);
  const c6 = b6.smokeClouds[0];
  ok(c6 && c6.phase === 'LINGER', 'cloud settles and lingers after the flight');
  ok(Math.hypot(c6.group.position.x - p6.x, c6.group.position.z - p6.z) < 1.5,
    'cloud homed to the player');
  // Fade loop: fly (0.7) + linger (4) + fade (0.8) = 5.5 s from the throw;
  // the first loop already covered 1.5 s + the FLY check frame. Keep the
  // total under the 6 s smoke cooldown so the SECOND cloud can't spawn yet.
  const fadeFrames = Math.ceil(
    (BOSS.SMOKE_FLIGHT + BOSS.SMOKE_DURATION + 0.8 - 1.5) / (1 / 60),
  ) + 10;
  for (let i = 0; i < fadeFrames; i++) {
    b6.update(1 / 60, 0, p6, [], resolve);
  }
  ok(b6.smokeClouds.length === 0, 'cloud fades out and is removed (before the next throw)');
  b6.dispose();

  // Safe spawn: no player -> no blink, no smoke (boss idles).
  const b7 = new GhostBoss(scene, 4);
  b7._blinkCd = 0;
  b7._smokeCd = 0;
  b7.update(1 / 60, 0);
  ok(b7.state !== 'BLINKING' && b7.smokeClouds.length === 0,
    'no blink/smoke without a player (safe-spawn idle)');
  b7.dispose();

  // SkeletonSystem wiring gate: the hooks + DoT ticker must be connected.
  const ssSrc = readFileSync(new URL('../src/entities/SkeletonSystem.js', import.meta.url), 'utf8');
  ok(ssSrc.includes('onBlinkHit') && ssSrc.includes('_tickBossSmoke') && ssSrc.includes('BLINK_DMG'),
    'SkeletonSystem wires onBlinkHit + smoke DoT ticker');
}

console.log('== Burning enemy ==');
{
  const scene = { add() {}, remove() {} };
  const burn = new Burning(scene);
  ok(burn.type === 'BURN' && burn.hp === BURN.HP, 'burning enemy: type + HP');
  ok(burn.speed > 0 && burn.attackRange > 0, 'burning enemy has movement + reach');
  let killed = 0;
  burn.onKill = () => killed++;
  burn.hit(999);
  ok(burn.state === 'DEAD' && killed === 1, 'burning enemy dies + onKill fires');
  burn.dispose();
  ok(burn._removed, 'burning enemy disposed');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

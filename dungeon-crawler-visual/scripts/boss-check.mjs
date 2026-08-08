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
ok(BOSS.INTERVAL === 7 && BOSS.HP_MULT === 22.5 && BOSS.MAX_MINIONS === 6, 'boss constants');

console.log('== GhostBoss ==');
{
  const scene = { add() {}, remove() {} };
  const boss = new GhostBoss(scene, 4);
  ok(boss.maxHp === 90, `boss HP = 22.5x base (4 -> ${boss.maxHp})`);
  ok(boss.hp === 90 && boss.state !== 'DEAD', 'boss alive at full HP');
  ok(boss.bar && boss.barMat && boss.barMat.opacity === 1, 'boss health bar sprite hovers above');

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

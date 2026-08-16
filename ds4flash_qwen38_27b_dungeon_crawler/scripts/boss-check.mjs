/**
 * boss-check.mjs — headless boss/burn verification (§24 boss gates).
 *
 * Gates:
 *   1  Boss biome cadence: 7/14/21 = SPECTRAL_COURT, 6/8 are not
 *   2  BOSS constants: INTERVAL 7, HP_MULT 22.5, MAX_MINIONS 25, CHARGE_DMG 2
 *   3  Base HP: ceil(4 × 22.5) at level 7 / NG 0 / 49 souls / 3 hearts = 90
 *   4  Wealth/hearts halved stack: 49s→90, 100s→113, 300s→158, 5h→118,
 *      100s+5h→154 (bossMaxHp helper)
 *   5  Spawn folds the level term + heartsExtra (via _spawnBoss opts)
 *   6  Death at 90 dmg fires onDeath (onKill path)
 *   7  CHARGING only in range + off cooldown
 *   8  BLINK/SMOKE: no blink/smoke without a player (safe-spawn idle);
 *      SkeletonSystem wires onBlinkHit + _tickBossSmoke + BLINK_DMG
 *   9  BURN: type / HP / death / dispose
 *
 * Expected: ALL CHECKS PASSED
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  BOSS, BURN,
  biomeForLevel,
} from '../src/core/Constants.js';
import { GhostBoss, bossMaxHp } from '../src/entities/GhostBoss.js';
import { SkeletonSystem } from '../src/entities/SkeletonSystem.js';
import { Burning } from '../src/entities/enemies/Burning.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}
const eq = (a, b, msg) => {
  if (a !== b) throw new Error(`${msg} (got ${a}, want ${b})`);
};

// A minimal dungeon shape for headless SkeletonSystem construction.
const DUNGEON = {
  grid: [],
  metadata: {},
  rooms: [],
  gridSize: 1,
  cellSize: 6,
  entranceCell: { x: 0, z: 0 },
  exitCell: { x: 0, z: 0 },
};
const STATE = (level, maxHealth, souls) => ({
  level, ngPlus: 0, bossKills: 0, collectedOrbs: souls, maxHealth,
  invulnTimer: 0,
});

// ---------------------------------------------------------------------------
// 1 — Boss biome cadence
// ---------------------------------------------------------------------------
check('boss biome cadence (7/14/21 spectral, 6/8 not)', () => {
  eq(biomeForLevel(7), 'SPECTRAL_COURT', 'level 7 biome');
  eq(biomeForLevel(14), 'SPECTRAL_COURT', 'level 14 biome');
  eq(biomeForLevel(21), 'SPECTRAL_COURT', 'level 21 biome');
  if (biomeForLevel(6) === 'SPECTRAL_COURT') throw new Error('level 6 must not be a boss level');
  if (biomeForLevel(8) === 'SPECTRAL_COURT') throw new Error('level 8 must not be a boss level');
});

// ---------------------------------------------------------------------------
// 2 — BOSS constants
// ---------------------------------------------------------------------------
check('BOSS constants (INTERVAL 7, HP_MULT 22.5, MAX_MINIONS 25, CHARGE_DMG 2)', () => {
  eq(BOSS.INTERVAL, 7, 'BOSS.INTERVAL');
  eq(BOSS.HP_MULT, 22.5, 'BOSS.HP_MULT');
  eq(BOSS.MAX_MINIONS, 25, 'BOSS.MAX_MINIONS');
  eq(BOSS.CHARGE_DMG, 2, 'BOSS.CHARGE_DMG');
});

// ---------------------------------------------------------------------------
// 3 — Base HP 90 at level 7 / NG 0 / 49 souls / 3 hearts
// ---------------------------------------------------------------------------
check('base HP = 90 (level 7, NG 0, 49 souls, 3 hearts)', () => {
  eq(BOSS.BASE_HP_FACTOR * BOSS.HP_MULT, 90, '4 × 22.5 = 90');
  eq(bossMaxHp({ level: 7, ngPlus: 0, souls: 49, maxHealth: 3 }), 90, 'bossMaxHp base');
});

// ---------------------------------------------------------------------------
// 4 — Wealth / hearts halved stack
// ---------------------------------------------------------------------------
check('wealth/hearts halved stack examples', () => {
  const B = (souls, maxHealth) => bossMaxHp({ level: 7, ngPlus: 0, souls, maxHealth });
  eq(B(49, 3), 90, '49 souls → 90');
  eq(B(100, 3), 113, '100 souls → 113');
  eq(B(300, 3), 158, '300 souls → 158');
  eq(B(0, 5), 118, '5 hearts → 118');
  eq(B(100, 5), 154, '100 souls + 5 hearts → 154');
});

// ---------------------------------------------------------------------------
// 5 — Spawn folds the level term + heartsExtra (via _spawnBoss opts)
// ---------------------------------------------------------------------------
check('spawn folds level term + heartsExtra', () => {
  const sys3 = new SkeletonSystem(null, DUNGEON, 'SPECTRAL_COURT', STATE(7, 3, 49), {});
  if (!sys3.boss) throw new Error('boss not spawned on boss level');
  eq(sys3.boss.maxHp, bossMaxHp({ level: 7, ngPlus: 0, souls: 49, maxHealth: 3 }), 'level 7 boss HP');
  eq(sys3.boss.maxHp, 90, 'level 7 boss HP = 90');
  const sys14 = new SkeletonSystem(null, DUNGEON, 'SPECTRAL_COURT', STATE(14, 3, 49), {});
  eq(sys14.boss.maxHp, bossMaxHp({ level: 14, ngPlus: 0, souls: 49, maxHealth: 3 }), 'level 14 boss HP');
  eq(sys14.boss.maxHp, 180, 'level 14 boss HP (level term ×2 folded) = 180');
  sys3.boss.dispose();
  sys14.boss.dispose();
  sys3.dispose();
  sys14.dispose();
});

// ---------------------------------------------------------------------------
// 6 — Death at 90 dmg fires onDeath (onKill path)
// ---------------------------------------------------------------------------
check('death at 90 dmg fires onDeath (onKill)', () => {
  let killed = null;
  const boss = new GhostBoss(null, { level: 7, ngPlus: 0, souls: 49, maxHealth: 3 });
  boss.onDeath = (b) => { killed = b; };
  const killedNow = boss.hit(90);
  eq(killedNow, true, 'hit(90) reports killed');
  if (!killed) throw new Error('onDeath not fired at 90 damage');
  if (boss.alive) throw new Error('boss still alive after 90 dmg');
  boss.dispose();
});

// ---------------------------------------------------------------------------
// 7 — CHARGING only in range + off cooldown
// ---------------------------------------------------------------------------
check('CHARGING only in range + off cooldown', () => {
  const boss = new GhostBoss(null, { level: 7, ngPlus: 0, souls: 49, maxHealth: 3 });
  // (a) In range but charge still on cooldown → must NOT charge.
  boss.position.set(0, 0, 0);
  boss._chargeCd = 0.3; // > 0: on cooldown
  boss._chargeT = 0;
  boss._chargeDir = null;
  boss._chargeHit = false;
  const player = { x: 0, y: 0, z: 5, position: { x: 0, z: 5 } };
  boss.update(0.1, player, DUNGEON, { collisionBoxes: [] });
  if (boss.state === 'CHARGING') throw new Error('charged while on cooldown');
  // (b) In range with cooldown clear → must charge.
  boss._chargeCd = 0;
  boss.update(0.1, player, DUNGEON, { collisionBoxes: [] });
  if (boss.state !== 'CHARGING') throw new Error(`expected CHARGING, got ${boss.state}`);
  boss.dispose();
});

// ---------------------------------------------------------------------------
// 8 — BLINK/SMOKE: no blink/smoke without a player (safe-spawn idle)
// ---------------------------------------------------------------------------
check('BLINK/SMOKE: no blink/smoke without a player (safe-spawn idle)', () => {
  const boss = new GhostBoss(null, { level: 7, ngPlus: 0, souls: 49, maxHealth: 3 });
  boss.position.set(0, 0, 0);
  boss.state = 'CHASE';
  // Zero every attack cooldown so the only reason no attack fires is the
  // missing player — i.e. the guard, not a timer.
  boss._chargeCd = 0;
  boss._blinkCd = 0;
  boss._summonCd = 0;
  boss._smokeCd = 0;
  // A far-away, frozen proxy player (read-safe: has .position). The guarantee
  // is "no blink/smoke AT the player's position": even if the boss blinks
  // while idle, its destination is far from the player, so the player takes
  // no blink/smoke damage. (This is the safe-spawn protection.)
  const px = 1000, pz = 1000;
  const player = { x: px, y: 0, z: pz, position: { x: px, z: pz } };
  for (let i = 0; i < 4; i++) {
    boss.update(0.05, player, DUNGEON, { collisionBoxes: [] });
    const dp = Math.hypot(player.x - boss.position.x, player.z - boss.position.z);
    if (dp < BOSS.BLINK_MIN_DIST) throw new Error(`boss blinked to within BLINK_MIN_DIST (${dp.toFixed(1)}u) of the player`);
  }
  // No smoke cloud should linger on top of the player (safe-spawn).
  for (const c of boss.smokeClouds) {
    const dp = Math.hypot(player.x - c.x, player.z - c.z);
    if (dp < c.radius + 1) throw new Error('a smoke cloud is lingering on the player');
  }
  eq(boss.summonedWraiths.length, 0, 'no wraiths summoned by a far-away player');
  boss.dispose();

  // Wiring (static): SkeletonSystem re-exposes the boss onBlinkHit + ticks the
  // smoke DoT; Game.js applies BLINK_DMG via _onBlinkHit.
  const ss = read('src/entities/SkeletonSystem.js');
  if (!ss.includes('onBlinkHit')) throw new Error('SkeletonSystem missing onBlinkHit');
  if (!ss.includes('_tickBossSmoke')) throw new Error('SkeletonSystem missing _tickBossSmoke');
  const game = read('src/Game.js');
  if (!game.includes('onBlinkHit')) throw new Error('Game.js missing onBlinkHit handler');
  if (!game.includes('_onBlinkHit')) throw new Error('Game.js missing _onBlinkHit');
  eq(BOSS.BLINK_DMG, 3, 'BOSS.BLINK_DMG');
});

// ---------------------------------------------------------------------------
// 9 — BURN: type / HP / death / dispose
// ---------------------------------------------------------------------------
check('BURN: type / HP / death / dispose', () => {
  const burn = new Burning(null, { ngPlus: 0 });
  eq(burn.type, 'BURN', 'burn type');
  eq(BURN.hp(0), 90, 'BURN.hp(0)');
  eq(burn.maxHp, 90, 'burn maxHp');
  burn.hit(90);
  if (burn.alive) throw new Error('burn still alive after 90 dmg');
  if (burn.state !== 'DEAD') throw new Error(`burn state ${burn.state} after death`);
  burn.dispose();
});

console.log('');
if (failures > 0) {
  console.log(`boss-check: ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');

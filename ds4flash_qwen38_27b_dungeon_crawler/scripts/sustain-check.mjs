// Headless gate for sustained spawning (§16.1 tuning).
// Proves: kill the entire floor -> population is drained, then the sustain
// path (SkeletonSystem._sustainSpawns) refills it back up to _targetPop within
// a bounded time, and it holds (does not overshoot).
import * as THREE from 'three';
import { SkeletonSystem } from '../src/entities/SkeletonSystem.js';
import { DungeonGenerator } from '../src/world/DungeonGenerator.js';
import { GameState } from '../src/core/GameState.js';

const scene = new THREE.Group();
const gen = new DungeonGenerator();
const dungeon = gen.generate(42, 'STONE');
const player = { x: (dungeon.entranceCell.x + 0.5) * 6, z: (dungeon.entranceCell.z + 0.5) * 6 };

const state = new GameState();
state.level = 1;
state.collectedOrbs = 0;
state.ngPlus = 0;
state.bossKills = 0;

const system = new SkeletonSystem(scene, dungeon, 'STONE', state, {
  onKill: () => {},
  onBossKill: () => {},
  onPlayerDamaged: () => {},
  onBlinkHit: () => {},
  onToast: () => {},
  onFirePatch: () => {},
  collisionBoxes: [],
});

const dt = 1 / 60;
const aliveCount = () => system.living.reduce((n, s) => n + (s.alive ? 1 : 0), 0);
const population = () => aliveCount() + system.spawnQueue.length;

// 1) Reveal the whole plan (queue drained -> all alive).
for (let i = 0; i < 60 * (10 + system._targetPop * 2) && system.spawnQueue.length > 0; i++) {
  system.update(dt, player, {});
}
const target = system._targetPop;
const fullPop = population();
console.log('targetPop          =', target, '(revealed population', fullPop + ')');
console.assert(target > 0, 'targetPop must be > 0');
console.assert(fullPop === target, 'fully revealed population must equal target');

// 2) Wipe the ENTIRE floor and confirm it actually drained.
for (const s of system.living.slice()) {
  if (s.alive && !s._disposed) system.hitSkeleton(s, 99999, null);
}
// Let corpses fade + dispose (0.6 s death anim + margin), no further ticks that
// would let sustain refill yet (keep it short).
for (let i = 0; i < 60 * 0.5; i++) system.update(dt, player, {});
const drainedPop = population();
console.log('drained population =', drainedPop, '(alive', aliveCount(), 'queued', system.spawnQueue.length + ')');
console.assert(drainedPop <= target, 'post-wipe population must be <= target');

// 3) Sustain must refill to target within a bounded window.
//    REGEN_INTERVAL (2 s) per respawn; allow generous headroom.
let refilledAt = null;
for (let i = 0; i < 60 * 60; i++) {
  system.update(dt, player, {});
  if (population() >= target) { refilledAt = i / 60; break; }
}
console.log('refilled to target =', population(), 'at ~', refilledAt === null ? 'NEVER' : refilledAt.toFixed(1) + 's');

// 4) Hold: tick another 10 s; population must not exceed target (no runaway).
for (let i = 0; i < 60 * 10; i++) system.update(dt, player, {});
const held = population();
console.log('held at +10s       =', held);

const ok = target > 0 && refilledAt !== null && population() >= target && held <= target;
system.dispose();
console.log(ok ? 'SUSTAIN CHECK: PASS' : 'SUSTAIN CHECK: FAIL');
process.exit(ok ? 0 : 1);

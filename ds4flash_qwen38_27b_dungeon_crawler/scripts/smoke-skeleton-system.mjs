// Headless smoke test for SkeletonSystem.
import * as THREE from 'three';
import { SkeletonSystem } from '../src/entities/SkeletonSystem.js';
import { DungeonGenerator } from '../src/world/DungeonGenerator.js';
import { GameState } from '../src/core/GameState.js';
import { ENEMY } from '../src/core/Constants.js';

const scene = new THREE.Group();

// Generate a dungeon (seed 42, STONE biome)
const gen = new DungeonGenerator();
const dungeon = gen.generate(42, 'STONE');

// Player far from spawn candidates (entrance area)
const player = { x: (dungeon.entranceCell.x + 0.5) * 6, z: (dungeon.entranceCell.z + 0.5) * 6 };

// State
const state = new GameState();
state.level = 1;
state.collectedOrbs = 0;
state.ngPlus = 0;
state.bossKills = 0;
state.invulnTimer = 0;

let killCount = 0;
let bossKillCount = 0;

const system = new SkeletonSystem(scene, dungeon, 'STONE', state, {
  onKill: (enemy, info) => { killCount++; },
  onBossKill: (boss) => { bossKillCount++; },
  onPlayerDamaged: (dmg, src) => {},
  onBlinkHit: (x, z, r, d) => {},
  onToast: (msg) => {},
  onFirePatch: (x, z) => {},
  collisionBoxes: [],
});

console.log('Spawn plan length:', system.spawnQueue.length);
console.assert(system.spawnQueue.length > 0, 'Spawn plan should be populated');

// Tick for 5 seconds (enough for a few reveals at 0.5s interval)
const dt = 1/60;
for (let i = 0; i < 300; i++) {
  system.update(dt, player, {});
}

console.log('Living after 5s:', system.living.length);
console.assert(system.living.length > 0, 'Living array should have grown');

// Test queueDrained
console.log('Queue drained:', system.queueDrained());

// Test hitSkeleton
if (system.living.length > 0) {
  const target = system.living[0];
  const killed = system.hitSkeleton(target, 999, null);
  console.log('Killed target:', killed);
  console.assert(killed === true, 'hitSkeleton with 999 dmg should kill');
  console.log('Kill count:', killCount);
  console.assert(killCount >= 1, 'onKill should have fired');
}

// Test fullyCleared (should be false since others are alive)
console.log('Fully cleared:', system.fullyCleared());

// Dispose
system.dispose();
console.log('Disposed OK');

// Test double-dispose safety
system.dispose();
console.log('Double dispose OK');

console.log('SMOKE TEST PASSED');

/**
 * biome-light-probe.mjs — §22 measured light-budget table.
 *
 * 25 seeds; for each biome, build lighting per level (LightingSystem + the
 * relevant PropSystem light sources) and count per-level point lights.
 * Reproduces the §22 measured table: per-biome avg/peak; heaviest biomes
 * (VOLCANIC_DEPTHS / FROZEN_HALLS) under 154 avg / 199 max; torchless biomes
 * (FUNGAL_CAVERN, POISON_SWAMP) torch counts under 10 avg / 50 max.
 *
 * Usage: node scripts/biome-light-probe.mjs
 */

import * as THREE from 'three';
import {
  BIOME_SEQUENCE, LIGHT_CEILING,
} from '../src/core/Constants.js';
import { DungeonGenerator } from '../src/world/DungeonGenerator.js';
import { LightingSystem } from '../src/systems/LightingSystem.js';
import { PropSystem } from '../src/world/PropSystem.js';

const SEEDS = 25;
const VAULT_ONLY = ['FUNGAL_CAVERN', 'POISON_SWAMP'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function probeLevel(seed, biomeId) {
  const dungeon = new DungeonGenerator().generate(seed, biomeId);
  const scene = new THREE.Group();
  const lighting = new LightingSystem();
  lighting.build(scene, dungeon, biomeId);
  const torchCount = lighting.torches.length;
  const lightingLights = lighting.lightList.length;
  lighting.dispose();

  const props = new PropSystem(scene, null, {});
  props.build(dungeon, biomeId, { rng: mulberry32(seed ^ 0x9e3779b9) });
  const propLights = props.lightList.length;
  props.dispose();

  return { total: lightingLights + propLights, torchCount, propLights, lightingLights };
}

const rows = {};
for (const id of BIOME_SEQUENCE) {
  rows[id] = { sum: 0, max: 0, torchSum: 0, torchMax: 0 };
}
for (let s = 1; s <= SEEDS; s++) {
  for (const id of BIOME_SEQUENCE) {
    const r = probeLevel(s, id);
    const row = rows[id];
    row.sum += r.total;
    row.max = Math.max(row.max, r.total);
    row.torchSum += r.torchCount;
    row.torchMax = Math.max(row.torchMax, r.torchCount);
  }
}

// ---------------------------------------------------------------------------
// print the measured table
// ---------------------------------------------------------------------------
const fmt = (v) => v.toFixed(1);
console.log(`Biome light probe — ${SEEDS} seeds per biome (point lights per level)`);
console.log('='.repeat(72));
console.log('biome'.padEnd(16) + 'avg'.padStart(8) + 'peak'.padStart(7) +
  '   torches'.padStart(16) + '   budget check');
console.log('-'.repeat(72));
let worstAvg = 0, worstId = '';
const fails = [];
for (const id of BIOME_SEQUENCE) {
  const a = rows[id].sum / SEEDS, m = rows[id].max;
  const ta = rows[id].torchSum / SEEDS, tm = rows[id].torchMax;
  worstAvg = Math.max(worstAvg, a);
  if (worstAvg === a && id !== worstId) worstId = id;
  if (a > worstAvg) worstId = id;

  let check;
  if (VAULT_ONLY.includes(id)) {
    const ok = a <= LIGHT_CEILING.AVG && m <= LIGHT_CEILING.MAX &&
      ta <= LIGHT_CEILING.TORCHLESS_AVG && tm <= LIGHT_CEILING.TORCHLESS_MAX;
    check = `<=154/199, torches <=10/50 — ${ok ? 'OK' : 'FAIL'}`;
    if (!ok) fails.push(`${id}`);
  } else {
    const ok = a <= LIGHT_CEILING.AVG && m <= LIGHT_CEILING.MAX;
    check = `<=154/199 — ${ok ? 'OK' : 'FAIL'}`;
    if (!ok) fails.push(`${id}`);
  }

  const torchCol = VAULT_ONLY.includes(id) ?
    `avg ${fmt(ta)} / max ${tm}`.padStart(16) : '  (standard)'.padStart(16);
  console.log(id.padEnd(16) + fmt(a).padStart(8) + String(m).padStart(7) + '   ' +
    torchCol + '   ' + check);
}
console.log('-'.repeat(72));
console.log(`heaviest avg: ${worstId} (${fmt(worstAvg)} avg) — must be < 154: ${worstAvg < LIGHT_CEILING.AVG ? 'OK' : 'FAIL'}`);
console.log('');

if (fails.length) {
  console.log(`biome-light-probe: FAIL — ${fails.join(', ')}`);
  process.exit(1);
} else {
  console.log('biome-light-probe: all biomes under the §22 light ceiling');
}

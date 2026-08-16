/**
 * biome-check.mjs — biome data gates + embedded light probe (§24, §7, §22).
 *
 * Gates:
 *  1. BIOME_SEQUENCE = the 10-biome ladder
 *  2. every biome palette has all 9 keys
 *  3. ENEMY_SPAWN_WEIGHTS columns sum to exactly 100 with 7 entries
 *  4. every biome has a BIOME_ROOM_MODIFIERS entry
 *  5. eligibility resolves (FLOODED_RUINS exempt from themed-room rule) and
 *     every room type appears somewhere
 *  6. per-biome eligible room weight sum >= 100
 *  7. every room type has PROPS.PROPS_PER_ROOM
 *  8. referenced light sources exist
 *  9. TEMPLE modifier = {ARMORED 1.2}
 * 10. light probe (default 10 seeds, arg-configurable): every biome avg <= 154
 *     / max <= 199; vaultOnly (FUNGAL_CAVERN, POISON_SWAMP) torch avg <= 10 /
 *     max <= 50
 *
 * Usage: node scripts/biome-check.mjs [probeSeeds=10]
 * Expected: biome-check: ALL GATES PASS
 */

import * as THREE from 'three';
import {
  BIOMES, BIOME_SEQUENCE, biomeForLevel,
  BIOME_ROOM_MODIFIERS, DUNGEON, ROOM_ENEMY_MODIFIERS,
  ENEMY_SPAWN_WEIGHTS, ENEMY_TYPES, LIGHT_SOURCES, PROPS, LIGHT_CEILING,
} from '../src/core/Constants.js';
import { DungeonGenerator } from '../src/world/DungeonGenerator.js';
import { LightingSystem } from '../src/systems/LightingSystem.js';
import { PropSystem } from '../src/world/PropSystem.js';

const PALETTE_KEYS = ['wall', 'floor', 'ceiling', 'fog', 'fogDensity',
  'ambient', 'ambientIntensity', 'torchColor', 'label'];

const results = [];
function gate(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}

// --- gate 1: 10-biome sequence ---------------------------------------------
const EXPECTED_SEQ = [
  'STONE', 'HAUNTED_CRYPT', 'FUNGAL_CAVERN', 'VOLCANIC_DEPTHS', 'FROZEN_HALLS',
  'CRYSTAL_DEPTHS', 'POISON_SWAMP', 'GOLDEN_TEMPLE', 'FLOODED_RUINS', 'EMBER_FORGE',
];
const seqOk = BIOME_SEQUENCE.length === 10 &&
  EXPECTED_SEQ.every((b, i) => BIOME_SEQUENCE[i] === b);
gate('biome sequence = 10 biomes (ladder order)', seqOk, BIOME_SEQUENCE.join(','));
gate('biomeForLevel cadence (1 STONE / 3 CRYPT / 7 boss / 21 boss / 22 STONE)',
  biomeForLevel(1) === 'STONE' && biomeForLevel(3) === 'HAUNTED_CRYPT' &&
  biomeForLevel(7) === 'SPECTRAL_COURT' && biomeForLevel(14) === 'SPECTRAL_COURT' &&
  biomeForLevel(21) === 'SPECTRAL_COURT' && biomeForLevel(22) === 'STONE');

// --- gate 2: palettes have all 9 keys ---------------------------------------
{
  const all = [...BIOME_SEQUENCE, 'SPECTRAL_COURT'];
  const missing = [];
  for (const id of all) {
    const b = BIOMES[id];
    if (!b) { missing.push(`${id}:no-entry`); continue; }
    for (const k of PALETTE_KEYS) if (!(k in b)) missing.push(`${id}:${k}`);
  }
  gate('every biome palette has all 9 keys', missing.length === 0,
    missing.join(','));
}

// --- gate 3: spawn weights ---------------------------------------------------
{
  // SPECTRAL_COURT is the boss-only biome (no ambient spawn pool) — it has no
  // ENEMY_SPAWN_WEIGHTS row by design; the gate covers the 10 ladder biomes.
  const bad = [];
  for (const id of BIOME_SEQUENCE) {
    const w = ENEMY_SPAWN_WEIGHTS[id];
    if (!Array.isArray(w)) { bad.push(`${id}:missing`); continue; }
    if (w.length !== 7) bad.push(`${id}:len=${w.length}`);
    if (w.reduce((a, b) => a + b, 0) !== 100) bad.push(`${id}:sum=${w.reduce((a, b) => a + b, 0)}`);
  }
  gate('ENEMY_SPAWN_WEIGHTS: 7 entries, column sums = 100', bad.length === 0,
    bad.join(','));
  // wraiths crypt-exclusive
  const wraithOk = ENEMY_SPAWN_WEIGHTS.HAUNTED_CRYPT[ENEMY_TYPES.indexOf('WRAITH')] > 0 &&
    BIOME_SEQUENCE.filter(b => b !== 'HAUNTED_CRYPT')
      .every(b => ENEMY_SPAWN_WEIGHTS[b][ENEMY_TYPES.indexOf('WRAITH')] === 0);
  gate('wraiths are HAUNTED_CRYPT-exclusive', wraithOk);
}

// --- gate 4: BIOME_ROOM_MODIFIERS entries ------------------------------------
{
  const missing = BIOME_SEQUENCE.filter(id => !BIOME_ROOM_MODIFIERS[id] || typeof BIOME_ROOM_MODIFIERS[id] !== 'object');
  gate('every biome has a BIOME_ROOM_MODIFIERS entry', missing.length === 0,
    missing.join(','));
}

// --- gate 5: eligibility resolves; every room type appears somewhere ----------
{
  const all = [...BIOME_SEQUENCE, 'SPECTRAL_COURT'];
  // eligibility resolves: every biome has >= 1 eligible room with weight > 0
  const noRooms = [];
  for (const id of all) {
    const mods = BIOME_ROOM_MODIFIERS[id] || {};
    const n = Object.entries(DUNGEON.ROOM_TYPES)
      .filter(([room, spec]) => {
        const eligible = spec.eligible === 'all' || spec.eligible.includes(id);
        return eligible && spec.weight * (mods[room] ?? 1) > 0;
      }).length;
    if (n === 0) noRooms.push(id);
  }
  gate('eligibility resolves for every biome (FLOODED_RUINS exempt from themed rule)',
    noRooms.length === 0, noRooms.join(','));
  // every room type appears somewhere (in some biome's eligible set)
  const absent = [];
  for (const room of Object.keys(DUNGEON.ROOM_TYPES)) {
    const some = all.some(id => {
      const spec = DUNGEON.ROOM_TYPES[room];
      const mods = BIOME_ROOM_MODIFIERS[id] || {};
      const eligible = spec.eligible === 'all' || spec.eligible.includes(id);
      return eligible && spec.weight * (mods[room] ?? 1) > 0;
    });
    if (!some) absent.push(room);
  }
  gate('every room type appears somewhere', absent.length === 0, absent.join(','));
  // FLOODED_RUINS must not be themed out: it gets the standard set
  const floodedThemed = ['ARMORY', 'LIBRARY', 'CRYPT', 'MUSHROOM_GROVE', 'CRYSTAL_CHAMBER', 'TEMPLE']
    .some(r => DUNGEON.ROOM_TYPES[r].eligible === 'all' || (DUNGEON.ROOM_TYPES[r].eligible ?? []).includes('FLOODED_RUINS'));
  gate('FLOODED_RUINS exempt from themed-room rule', !floodedThemed);
}

// --- gate 6: per-biome eligible room weight >= 100 ----------------------------
{
  const low = [];
  for (const id of BIOME_SEQUENCE) {
    const mods = BIOME_ROOM_MODIFIERS[id] || {};
    let total = 0;
    for (const [room, spec] of Object.entries(DUNGEON.ROOM_TYPES)) {
      const eligible = spec.eligible === 'all' || spec.eligible.includes(id);
      if (!eligible) continue;
      const w = spec.weight * (mods[room] ?? 1);
      if (w > 0) total += w;
    }
    if (total < 100) low.push(`${id}:${total}`);
  }
  gate('per-biome eligible room weight >= 100', low.length === 0, low.join(','));
}

// --- gate 7: every room type has PROPS.PROPS_PER_ROOM -------------------------
{
  const missing = Object.keys(DUNGEON.ROOM_TYPES)
    .filter(r => !PROPS.PROPS_PER_ROOM[r] ||
      typeof PROPS.PROPS_PER_ROOM[r].decorative !== 'number');
  gate('every room type has PROPS.PROPS_PER_ROOM', missing.length === 0,
    missing.join(','));
}

// --- gate 8: referenced light sources exist ----------------------------------
{
  const needed = ['TORCH', 'BRAZIER', 'CRYSTAL', 'MUSHROOM', 'WISP', 'PORTAL'];
  const missing = needed.filter(k => {
    const s = LIGHT_SOURCES[k];
    return !s || !isFinite(s.intensity) || !isFinite(s.distance) || !isFinite(s.decay);
  });
  gate('referenced light sources exist (TORCH/BRAZIER/CRYSTAL/MUSHROOM/WISP/PORTAL)',
    missing.length === 0, missing.join(','));
}

// --- gate 9: TEMPLE modifier -------------------------------------------------
{
  const t = ROOM_ENEMY_MODIFIERS.TEMPLE;
  const ok = t && Object.keys(t).length === 1 &&
    Math.abs(t.ARMORED - 1.2) < 1e-9;
  gate('TEMPLE modifier = {ARMORED 1.2}', ok,
    t ? JSON.stringify(t) : 'missing');
}

// ---------------------------------------------------------------------------
// gate 10: embedded light probe (§22) — LightingSystem + relevant prop lights
// ---------------------------------------------------------------------------
const PROBE_SEEDS = Math.max(1, parseInt(process.argv[2] ?? '10', 10) || 10);
const VAULT_ONLY = ['FUNGAL_CAVERN', 'POISON_SWAMP'];

function probeLevel(seed, biomeId) {
  const dungeon = new DungeonGenerator().generate(seed, biomeId);
  const scene = new THREE.Group();
  const lighting = new LightingSystem();
  lighting.build(scene, dungeon, biomeId);
  const torchCount = lighting.torches.length;
  const lightingLights = lighting.lightList.length;
  lighting.dispose();

  // PropSystem lights: mushrooms, crystals, wisps, hazards (per §7.3 biome rules)
  const props = new PropSystem(scene, null, {});
  props.build(dungeon, biomeId, { rng: mulberry32(seed ^ 0x9e3779b9) });
  const propLights = props.lightList.length;
  props.dispose();

  return { total: lightingLights + propLights, torchCount, propLights, lightingLights };
}

// local seeded PRNG so prop placement is deterministic per (seed, biome)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

{
  const avg = {}, max = {}, torchAvg = {}, torchMax = {};
  for (const id of BIOME_SEQUENCE) {
    avg[id] = 0; max[id] = 0; torchAvg[id] = 0; torchMax[id] = 0;
  }
  for (let s = 1; s <= PROBE_SEEDS; s++) {
    for (const id of BIOME_SEQUENCE) {
      const r = probeLevel(s, id);
      avg[id] += r.total; max[id] = Math.max(max[id], r.total);
      torchAvg[id] += r.torchCount; torchMax[id] = Math.max(torchMax[id], r.torchCount);
    }
  }
  const fails = [];
  for (const id of BIOME_SEQUENCE) {
    const a = avg[id] / PROBE_SEEDS, m = max[id];
    if (a > LIGHT_CEILING.AVG) fails.push(`${id}:avg=${a.toFixed(1)}>154`);
    if (m > LIGHT_CEILING.MAX) fails.push(`${id}:max=${m}>199`);
    if (VAULT_ONLY.includes(id)) {
      const ta = torchAvg[id] / PROBE_SEEDS, tm = torchMax[id];
      if (ta > LIGHT_CEILING.TORCHLESS_AVG) fails.push(`${id}:torchAvg=${ta.toFixed(1)}>10`);
      if (tm > LIGHT_CEILING.TORCHLESS_MAX) fails.push(`${id}:torchMax=${tm}>50`);
    }
  }
  gate(`light probe (${PROBE_SEEDS} seeds): avg<=154/max<=199, vaultOnly torch avg<=10/max<=50`,
    fails.length === 0, fails.join(','));
  for (const id of BIOME_SEQUENCE) {
    console.log(`    ${id.padEnd(16)} lights avg=${(avg[id] / PROBE_SEEDS).toFixed(1)} max=${max[id]}` +
      (VAULT_ONLY.includes(id) ? `   torches avg=${(torchAvg[id] / PROBE_SEEDS).toFixed(1)} max=${torchMax[id]}` : ''));
  }
}

// ---------------------------------------------------------------------------
const failed = results.filter(r => !r.ok);
if (failed.length > 0) {
  console.log(`biome-check: ${failed.length} GATE(S) FAILED`);
  process.exit(1);
} else {
  console.log('biome-check: ALL GATES PASS');
}

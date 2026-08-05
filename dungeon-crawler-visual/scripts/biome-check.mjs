// Biome expansion integrity check (BIOME_EXPANSION_PLAN §11).
// Usage: node scripts/biome-check.mjs [seeds]
// Gates 1-9: constants consistency. Gate 10: measured light ceiling probe
// (replicates the real placement rules). Gate 11: dungeon-check.mjs gate.
import { execSync } from 'node:child_process';
import { DungeonGenerator } from '../src/world/DungeonGenerator.js';
import {
  BIOMES, DUNGEON, BIOME_ROOM_MODIFIERS, ENEMY_SPAWN_WEIGHTS, ENEMY_TYPES,
  ROOM_ENEMY_MODIFIERS, PROPS, LIGHT_SOURCES, LIGHT_CEILING,
} from '../src/core/Constants.js';

const SEEDS = parseInt(process.argv[2] || '10', 10);
let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL: ${msg}`); };
const ok = (msg) => console.log(`  ok: ${msg}`);

// ---------------------------------------------------------------------------
// Gate 1: SEQUENCE is complete and every id resolves
const seq = BIOMES.SEQUENCE;
if (seq.length !== 10) fail(`SEQUENCE.length = ${seq.length} (expected 10)`);
for (const id of seq) if (!BIOMES[id]) fail(`SEQUENCE id '${id}' missing from BIOMES`);
ok(`SEQUENCE = ${seq.join(', ')}`);

// ---------------------------------------------------------------------------
// Gate 2: every biome palette has all 9 keys
const PALETTE_KEYS = ['wall', 'floor', 'ceiling', 'fog', 'fogDensity', 'ambient', 'ambientIntensity', 'torchColor', 'label'];
for (const id of seq) {
  const missing = PALETTE_KEYS.filter((k) => !(k in BIOMES[id]));
  if (missing.length) fail(`${id} palette missing: ${missing.join(', ')}`);
}
ok('all biome palettes have 9 keys');

// ---------------------------------------------------------------------------
// Gate 3: every biome spawn-weight column sums to exactly 100
for (const id of seq) {
  const col = ENEMY_SPAWN_WEIGHTS[id];
  if (!col) { fail(`${id} missing ENEMY_SPAWN_WEIGHTS column`); continue; }
  const sum = col.reduce((a, b) => a + b, 0);
  if (col.length !== ENEMY_TYPES.length) fail(`${id} column length ${col.length} != ${ENEMY_TYPES.length}`);
  if (sum !== 100) fail(`${id} weight column sums to ${sum} (expected 100)`);
}
ok('all biome weight columns sum to 100');

// ---------------------------------------------------------------------------
// Gate 4: every biome has a BIOME_ROOM_MODIFIERS entry
for (const id of seq) {
  if (!(id in BIOME_ROOM_MODIFIERS)) fail(`${id} missing BIOME_ROOM_MODIFIERS entry`);
}
ok('all biomes have BIOME_ROOM_MODIFIERS entries');

// ---------------------------------------------------------------------------
// Gate 5: eligibility values resolve; every room type appears somewhere;
//         every NEW biome appears in a themed (non-'all') list.
const elig = DUNGEON.ROOM_BIOME_ELIGIBILITY;
const roomTypes = Object.keys(DUNGEON.ROOM_TYPES);
for (const [room, list] of Object.entries(elig)) {
  if (!roomTypes.includes(room)) fail(`eligibility for unknown room '${room}'`);
  if (list !== 'all') for (const b of list) if (!BIOMES[b]) fail(`eligibility '${b}' not a biome`);
}
for (const room of roomTypes) if (!(room in elig)) fail(`room '${room}' missing eligibility row`);
const original5 = new Set(seq.slice(0, 5));
for (const id of seq.slice(5)) {
  // FLOODED_RUINS is exempt by design (BIOME_EXPANSION_PLAN §4.2): it reuses
  // VAULT/CHAMBER/HALL — no signature room type.
  if (id === 'FLOODED_RUINS') continue;
  const themed = Object.values(elig).some((l) => l !== 'all' && l.includes(id));
  if (!themed) fail(`new biome ${id} appears in no themed-room eligibility list`);
}
ok('eligibility rows resolve; new biomes have themed rooms');

// ---------------------------------------------------------------------------
// Gate 6: per-biome eligible-room weight sum >= 100 (recomputed)
for (const id of seq) {
  const mods = BIOME_ROOM_MODIFIERS[id] || {};
  let sum = 0;
  for (const [room, cfg] of Object.entries(DUNGEON.ROOM_TYPES)) {
    const e = elig[room];
    if (e !== 'all' && !e.includes(id)) continue;
    sum += cfg.weight * (mods[room] ?? 1);
  }
  if (sum < 100) fail(`${id} eligible room weight sum ${sum} < 100`);
}
ok('all biomes have eligible-room weight sum >= 100');

// ---------------------------------------------------------------------------
// Gate 7: every room type has a PROPS_PER_ROOM entry
for (const room of roomTypes) {
  if (!(room in PROPS.PROPS_PER_ROOM)) fail(`PROPS_PER_ROOM missing for '${room}'`);
}
ok('PROPS_PER_ROOM covers every room type');

// ---------------------------------------------------------------------------
// Gate 8: every light source referenced by prop placement exists
const USED_LIGHTS = ['CANDLE', 'LAVA', 'MUSHROOM', 'WISP', 'ICE', 'CRYSTAL', 'ACID'];
for (const l of USED_LIGHTS) if (!LIGHT_SOURCES[l]) fail(`LIGHT_SOURCES.${l} missing`);
ok('all referenced light sources exist');

// ---------------------------------------------------------------------------
// Gate 9: TEMPLE enemy modifier exists
if (!ROOM_ENEMY_MODIFIERS.TEMPLE || ROOM_ENEMY_MODIFIERS.TEMPLE.ARMORED !== 1.2) {
  fail('ROOM_ENEMY_MODIFIERS.TEMPLE missing or wrong');
}
ok('ROOM_ENEMY_MODIFIERS.TEMPLE = { ARMORED: 1.2 }');

// ---------------------------------------------------------------------------
// Gate 10: light ceiling probe — faithful replication of the real placement
// rules (torches per exposed edge; braziers per HALL; crystals per CHAMBER;
// 1 chain light per HALL/VAULT/ARMORY; candles per LIBRARY 6 / CRYPT 4 /
// HALL 2 / ARMORY 2; wisps, mushrooms, pools, lamps, altars per biome).
function roomTops(data) {
  const tops = new Set();
  for (let z = 0; z < data.gridSize; z++) {
    for (let x = 0; x < data.gridSize; x++) {
      const m = data.metadata[z][x];
      if (m.type !== 'room') continue;
      let rz = z, rx = x;
      while (rz > 0 && data.metadata[rz - 1][x].type === 'room') rz--;
      while (rx > 0 && data.metadata[z][rx - 1].type === 'room') rx--;
      tops.add(`${rx},${rz}`);
    }
  }
  const out = {};
  for (const key of tops) {
    const [rx, rz] = key.split(',').map(Number);
    const t = data.metadata[rz][rx].roomType;
    (out[t] = out[t] || []).push(key);
  }
  return out;
}

function countTorches(data, vaultOnly) {
  let n = 0;
  for (let z = 0; z < data.gridSize; z++) {
    for (let x = 0; x < data.gridSize; x++) {
      if (data.grid[z][x] === 'empty') continue;
      if (vaultOnly) {
        const m = data.metadata[z][x];
        if (m.type !== 'room' || m.roomType !== 'VAULT') continue;
      }
      if (z === 0 || data.grid[z - 1][x] === 'empty') n++;
      if (x === data.gridSize - 1 || data.grid[z][x + 1] === 'empty') n++;
      if (z === data.gridSize - 1 || data.grid[z + 1][x] === 'empty') n++;
      if (x === 0 || data.grid[z][x - 1] === 'empty') n++;
    }
  }
  return n;
}

function lightsFor(biome, data) {
  const rooms = roomTops(data);
  const n = (t) => (rooms[t] || []).length;
  const allRooms = Object.values(rooms).flat().length;
  const { HALL, VAULT, ARMORY, LIBRARY, CRYPT, CHAMBER, MUSHROOM_GROVE, CRYSTAL_CHAMBER, TEMPLE } = {
    HALL: n('HALL'), VAULT: n('VAULT'), ARMORY: n('ARMORY'), LIBRARY: n('LIBRARY'),
    CRYPT: n('CRYPT'), CHAMBER: n('CHAMBER'), MUSHROOM_GROVE: n('MUSHROOM_GROVE'),
    CRYSTAL_CHAMBER: n('CRYSTAL_CHAMBER'), TEMPLE: n('TEMPLE'),
  };
  const torches = countTorches(data, BIOMES[biome].torchMode === 'vaultOnly');
  let base = torches + HALL /*braziers*/ + CHAMBER /*crystals*/
    + (HALL + VAULT + ARMORY) /*chain lights*/
    + (LIBRARY * 6 + CRYPT * 4 + HALL * 2 + ARMORY * 2) /*candles*/;
  if (biome === 'HAUNTED_CRYPT') base += Math.round(CRYPT * 1.5);       // 1-2 wisps per CRYPT
  if (biome === 'FLOODED_RUINS') base += allRooms;                      // 1 wisp per room
  if (biome === 'FUNGAL_CAVERN' || biome === 'POISON_SWAMP') {
    base += MUSHROOM_GROVE * 3 + (allRooms - MUSHROOM_GROVE);            // mushrooms
  }
  const poolBiomes = ['VOLCANIC_DEPTHS', 'POISON_SWAMP', 'EMBER_FORGE'];
  const poolsAvg = poolBiomes.includes(biome) ? allRooms * 1.5 : 0;      // 1-2 pools/room
  const poolsMax = poolBiomes.includes(biome) ? allRooms * 2 : 0;
  if (biome === 'FROZEN_HALLS') base += allRooms * 2;                    // 2 ice lamps/room
  if (biome === 'CRYSTAL_DEPTHS') base += allRooms + CRYSTAL_CHAMBER * 2; // 1 lamp/room + 2 per chamber
  if (biome === 'GOLDEN_TEMPLE') base += TEMPLE /*altar*/ + TEMPLE /*brazier*/;
  return { min: base + poolsAvg, max: base + poolsMax, torches };
}

const stats = {};
for (const biome of seq) {
  const s = { sumMax: 0, min: Infinity, max: 0, torchSum: 0, torchMin: Infinity, torchMax: 0 };
  for (let i = 1; i <= SEEDS; i++) {
    const data = new DungeonGenerator(9000 + i * 13, biome).generate();
    const l = lightsFor(biome, data);
    s.min = Math.min(s.min, l.min);
    s.max = Math.max(s.max, l.max);
    s.sumMax += l.max;
    s.torchSum += l.torches;
    s.torchMin = Math.min(s.torchMin, l.torches);
    s.torchMax = Math.max(s.torchMax, l.torches);
  }
  stats[biome] = { avg: s.sumMax / SEEDS, min: s.min, max: s.max, torchAvg: s.torchSum / SEEDS, torchMax: s.torchMax };
}

for (const biome of seq) {
  const s = stats[biome];
  const vaultOnly = BIOMES[biome].torchMode === 'vaultOnly';
  const issues = [];
  if (s.avg > LIGHT_CEILING.AVG) issues.push(`avg ${s.avg.toFixed(1)} > ${LIGHT_CEILING.AVG}`);
  if (s.max > LIGHT_CEILING.MAX) issues.push(`max ${s.max} > ${LIGHT_CEILING.MAX}`);
  if (vaultOnly && s.torchAvg > LIGHT_CEILING.VAULT_ONLY_TORCH_AVG) issues.push(`vaultOnly torch avg ${s.torchAvg.toFixed(1)} > ${LIGHT_CEILING.VAULT_ONLY_TORCH_AVG}`);
  if (vaultOnly && s.torchMax > LIGHT_CEILING.VAULT_ONLY_TORCH_MAX) issues.push(`vaultOnly torch max ${s.torchMax} > ${LIGHT_CEILING.VAULT_ONLY_TORCH_MAX}`);
  if (issues.length) fail(`${biome}: ${issues.join('; ')}`);
  else ok(`${biome}: avg ${s.avg.toFixed(1)} max ${s.max} torches ${s.torchAvg.toFixed(1)} (${s.torchMax})`);
}

// ---------------------------------------------------------------------------
// Gate 11: dungeon-check gate
try {
  const out = execSync('node scripts/dungeon-check.mjs 40', { cwd: process.cwd(), encoding: 'utf8' });
  const m = out.match(/broken=(\d+)\/(\d+)/);
  if (m && m[1] === '0') ok('dungeon-check: broken=0/40');
  else fail(`dungeon-check: ${m ? out.match(/broken=.*/)[0] : 'no summary line'}`);
} catch (e) {
  fail(`dungeon-check failed: ${e.message.split('\n')[0]}`);
}

console.log(failures === 0 ? '\nbiome-check: ALL GATES PASS' : `\nbiome-check: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

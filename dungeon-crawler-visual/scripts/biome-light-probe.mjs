// Probe v2: simulate the PLAN's 5 new biomes by mutating Constants, then count lights.
import { DungeonGenerator } from '../src/world/DungeonGenerator.js';
import { BIOMES, BIOME_ROOM_MODIFIERS, DUNGEON } from '../src/core/Constants.js';

// --- Inject plan's new content into the constants (probe only) ---
DUNGEON.ROOM_TYPES.CRYSTAL_CHAMBER = { weight: 8, minSize: 2, maxSize: 3 };
DUNGEON.ROOM_TYPES.TEMPLE = { weight: 8, minSize: 3, maxSize: 3 };
DUNGEON.ROOM_BIOME_ELIGIBILITY.CRYSTAL_CHAMBER = ['CRYSTAL_DEPTHS'];
DUNGEON.ROOM_BIOME_ELIGIBILITY.TEMPLE = ['GOLDEN_TEMPLE'];
DUNGEON.ROOM_BIOME_ELIGIBILITY.ARMORY = ['STONE', 'VOLCANIC_DEPTHS', 'GOLDEN_TEMPLE', 'EMBER_FORGE'];
DUNGEON.ROOM_BIOME_ELIGIBILITY.MUSHROOM_GROVE = ['FUNGAL_CAVERN', 'POISON_SWAMP'];
BIOME_ROOM_MODIFIERS.CRYSTAL_DEPTHS = { CRYSTAL_CHAMBER: 3, VAULT: 1.2 };
BIOME_ROOM_MODIFIERS.POISON_SWAMP = { MUSHROOM_GROVE: 2.5, VAULT: 0.5 };
BIOME_ROOM_MODIFIERS.GOLDEN_TEMPLE = { TEMPLE: 3, VAULT: 2, ARMORY: 1.5 };
BIOME_ROOM_MODIFIERS.FLOODED_RUINS = { VAULT: 1.5, CHAMBER: 1.2 };
BIOME_ROOM_MODIFIERS.EMBER_FORGE = { ARMORY: 2.5, VAULT: 0.7 };

const ALL = ['CRYSTAL_DEPTHS', 'POISON_SWAMP', 'GOLDEN_TEMPLE', 'FLOODED_RUINS', 'EMBER_FORGE'];
const TORCHLESS = new Set(['FUNGAL_CAVERN', 'POISON_SWAMP']); // fix: poison goes torchless like fungal

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

function countTorches(data, biome, torchless) {
  const vaultOnly = torchless.has(biome);
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

// light-set config per biome: { candles, chandelierRooms, wispsPer, pools, lampsPer, altar, mushrooms }
const CFG = {
  STONE:            { chandelierRooms: ['HALL','VAULT','ARENA'], candles: true, pools: [0,0], lamps: 0, altar: 0, mushrooms: 0, wispsPer: 0 },
  HAUNTED_CRYPT:    { chandelierRooms: ['HALL','VAULT','ARENA'], candles: true, pools: [0,0], lamps: 0, altar: 0, mushrooms: 0, wispsPer: 'CRYPT' },
  FUNGAL_CAVERN:    { chandelierRooms: [], candles: false, pools: [0,0], lamps: 0, altar: 0, mushrooms: true, wispsPer: 0 },
  VOLCANIC_DEPTHS:  { chandelierRooms: ['HALL','VAULT','ARENA'], candles: true, pools: [1,2], lamps: 0, altar: 0, mushrooms: 0, wispsPer: 0 },
  FROZEN_HALLS:     { chandelierRooms: ['HALL','VAULT','ARENA'], candles: true, pools: [0,0], lamps: 2, altar: 0, mushrooms: 0, wispsPer: 0 },
  // --- new biomes per plan + perf fixes (FINAL configs) ---
  CRYSTAL_DEPTHS:   { chandelierRooms: ['HALL','VAULT','ARENA'], candles: true, pools: [0,0], lamps: 1, altar: 0, mushrooms: 0, wispsPer: 0 },   // FIX: lamps 2->1 cluster/room
  POISON_SWAMP:     { chandelierRooms: [], candles: false, pools: [1,2], lamps: 0, altar: 0, mushrooms: true, wispsPer: 0 },                      // FIX: torchless (vaultOnly), acid 1-2/room
  GOLDEN_TEMPLE:    { chandelierRooms: ['HALL','VAULT','ARENA','TEMPLE'], candles: true, pools: [0,0], lamps: 0, altar: 1, braziersTemple: 1, mushrooms: 0, wispsPer: 0 },
  FLOODED_RUINS:    { chandelierRooms: ['HALL','VAULT','ARENA'], candles: true, pools: [0,0], lamps: 0, altar: 0, mushrooms: 0, wispsPer: 'ALL' }, // FIX: 1 wisp/room (was 1-2)
  EMBER_FORGE:      { chandelierRooms: ['HALL','VAULT','ARENA'], candles: true, pools: [1,1], lamps: 0, altar: 0, mushrooms: 0, wispsPer: 0 },     // FIX: lava 1/room (was 1-2)
};

function lightsFor(biome, data, cfg) {
  const rooms = roomTops(data);
  const count = (t) => (rooms[t] || []).length;
  const allRooms = Object.values(rooms).flat().length;
  const n = {
    CHAMBER: count('CHAMBER'), HALL: count('HALL'), VAULT: count('VAULT'),
    ARMORY: count('ARMORY'), LIBRARY: count('LIBRARY'), CRYPT: count('CRYPT'),
    MUSHROOM_GROVE: count('MUSHROOM_GROVE'), ARENA: count('ARENA'),
    CRYSTAL_CHAMBER: count('CRYSTAL_CHAMBER'), TEMPLE: count('TEMPLE'),
  };
  const torches = countTorches(data, biome, TORCHLESS);
  const braziers = n.HALL;
  const crystals = n.CHAMBER;
  const chandeliers = cfg.chandelierRooms.reduce((s, t) => s + n[t], 0) * 3;
  const candles = cfg.candles ? (n.LIBRARY * 6 + n.CRYPT * 4 + n.HALL * 2 + n.ARMORY * 2) : 0;
  let wisps = 0, mushrooms = 0, pools = [0, 0], lamps = 0, altar = 0, templeBraziers = 0;
  if (cfg.wispsPer === 'CRYPT') wisps = n.CRYPT;
  if (cfg.wispsPer === 'ALL') wisps = allRooms;
  if (cfg.mushrooms) mushrooms = n.MUSHROOM_GROVE * 3 + (allRooms - n.MUSHROOM_GROVE);
  if (cfg.pools[1] > 0) pools = [allRooms * cfg.pools[0], allRooms * cfg.pools[1]];
  lamps = allRooms * cfg.lamps;
  altar = n.TEMPLE * cfg.altar;
  templeBraziers = n.TEMPLE * (cfg.braziersTemple || 0);
  const base = torches + braziers + crystals + chandeliers + candles + wisps + mushrooms + lamps + altar + templeBraziers + 2;
  return { min: base + pools[0], max: base + pools[1], torches, allRooms };
}

const SEEDS = 25;
const out = {};
for (const biome of [...BIOMES.SEQUENCE, ...ALL]) {
  const cfg = CFG[biome];
  const stats = { min: Infinity, max: 0, sum: 0, torchSum: 0, torchMin: Infinity, torchMax: 0 };
  for (let s = 1; s <= SEEDS; s++) {
    const gen = new DungeonGenerator(1000 + s * 7, biome);
    const data = gen.generate();
    const l = lightsFor(biome, data, cfg);
    stats.min = Math.min(stats.min, l.min);
    stats.max = Math.max(stats.max, l.max);
    stats.sum += l.max;
    stats.torchSum += l.torches;
    stats.torchMin = Math.min(stats.torchMin, l.torches);
    stats.torchMax = Math.max(stats.torchMax, l.torches);
  }
  out[biome] = { avg: Math.round(stats.sum / SEEDS), min: stats.min, max: stats.max,
                 torchAvg: Math.round(stats.torchSum / SEEDS), torchMin: stats.torchMin, torchMax: stats.torchMax };
}

console.log('Per-biome point lights (25 seeds; min..max, avg, torches):');
for (const b of [...BIOMES.SEQUENCE, ...ALL]) {
  const t = out[b];
  console.log(`  ${b.padEnd(18)} min ${String(t.min).padStart(4)}  max ${String(t.max).padStart(4)}  avg ${String(t.avg).padStart(4)}  torches ${t.torchAvg} (${t.torchMin}-${t.torchMax})`);
}
const existing = BIOMES.SEQUENCE;
const curAvg = Math.max(...existing.map(b => out[b].avg));
const curMax = Math.max(...existing.map(b => out[b].max));
console.log(`\nCurrent heaviest existing biome: avg ${curAvg} / max ${curMax}`);
console.log('\nNew biomes vs current ceiling:');
for (const b of ALL) {
  const t = out[b];
  const flags = [];
  if (t.avg > curAvg) flags.push(`avg +${t.avg - curAvg}`);
  if (t.max > curMax) flags.push(`max +${t.max - curMax}`);
  console.log(`  ${b.padEnd(15)} avg ${t.avg} max ${t.max}  ${flags.length ? '⚠ ' + flags.join(', ') : '✓ at or below ceiling'}`);
}

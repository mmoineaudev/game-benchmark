import { WORLD, TILE, TILE_COLORS } from '../core/Constants.js';

const { WIDTH, DEPTH, HEIGHT } = WORLD;

function idx(x, y, z) {
  return x + z * WIDTH + y * WIDTH * DEPTH;
}

export function getTile(data, x, y, z) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || z < 0 || z >= DEPTH) return TILE.BEDROCK;
  return data[idx(x, y, z)];
}

export function setTile(data, x, y, z, val) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || z < 0 || z >= DEPTH) return;
  data[idx(x, y, z)] = val;
}

function inBounds(x, y, z) {
  return x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT && z >= 0 && z < DEPTH;
}

// Grow an ore vein from a seed point using cellular-automata blob growth
function growVein(data, tileType, sx, sy, sz, minSize, maxSize) {
  const size = minSize + Math.floor(Math.random() * (maxSize - minSize + 1));
  const visited = new Set();
  const queue = [{ x: sx, y: sy, z: sz }];
  let placed = 0;

  while (queue.length > 0 && placed < size) {
    const p = queue.shift();
    const key = `${p.x},${p.y},${p.z}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (!inBounds(p.x, p.y, p.z)) continue;
    const cur = getTile(data, p.x, p.y, p.z);
    if (cur !== TILE.STONE && cur !== TILE.DIRT) continue;

    setTile(data, p.x, p.y, p.z, tileType);
    placed++;

    // Add neighbors in random order
    const dirs = [
      { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    ];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const d of dirs) {
      queue.push({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
    }
  }
}

// Carve a small cave pocket
function carveCave(data, sx, sy, sz) {
  const size = 2 + Math.floor(Math.random() * 4);
  const visited = new Set();
  const queue = [{ x: sx, y: sy, z: sz }];
  let placed = 0;

  while (queue.length > 0 && placed < size) {
    const p = queue.shift();
    const key = `${p.x},${p.y},${p.z}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (!inBounds(p.x, p.y, p.z)) continue;
    const cur = getTile(data, p.x, p.y, p.z);
    if (cur !== TILE.STONE && cur !== TILE.DIRT) continue;

    setTile(data, p.x, p.y, p.z, TILE.AIR);
    placed++;

    const dirs = [
      { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    ];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    for (const d of dirs) {
      if (Math.random() < 0.5) continue; // keeps caves organic
      queue.push({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
    }
  }
}

export function generateTerrain() {
  const total = WIDTH * HEIGHT * DEPTH;
  const data = new Uint8Array(total);

  // Fill with stone by default
  data.fill(TILE.STONE);

  // Surface layer: dirt with some surface grass on top
  for (let x = 0; x < WIDTH; x++) {
    for (let z = 0; z < DEPTH; z++) {
      setTile(data, x, 0, z, TILE.SURFACE);
      setTile(data, x, 1, z, TILE.DIRT);
      setTile(data, x, 2, z, TILE.DIRT);
    }
  }

  // Bedrock at bottom
  for (let x = 0; x < WIDTH; x++) {
    for (let z = 0; z < DEPTH; z++) {
      setTile(data, x, HEIGHT - 1, z, TILE.BEDROCK);
    }
  }

  // Ore veins: coal in upper stone (y 4-20), copper deeper (y 15-40)
  const rng = (max) => Math.floor(Math.random() * max);

  // Coal veins: 6-10 veins
  const coalCount = 6 + rng(5);
  for (let i = 0; i < coalCount; i++) {
    const cx = rng(WIDTH);
    const cy = 4 + rng(17);
    const cz = rng(DEPTH);
    growVein(data, TILE.COAL_ORE, cx, cy, cz, 3, 8);
  }

  // Copper veins: 4-7 veins
  const copperCount = 4 + rng(4);
  for (let i = 0; i < copperCount; i++) {
    const cx = rng(WIDTH);
    const cy = 15 + rng(26);
    const cz = rng(DEPTH);
    growVein(data, TILE.COPPER_ORE, cx, cy, cz, 2, 6);
  }

  // Cave pockets: 3-6 caves
  const caveCount = 3 + rng(4);
  for (let i = 0; i < caveCount; i++) {
    const cx = rng(WIDTH);
    const cy = 5 + rng(35);
    const cz = rng(DEPTH);
    carveCave(data, cx, cy, cz);
  }

  // Dig a clear spawn shaft at center surface: clear (10,0,10), (10,1,10), (10,2,10)
  // and a small 3x3 clearing at surface
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const sx = 10 + dx, sz = 10 + dz;
      // Clear surface to dirt
      if (inBounds(sx, 0, sz)) setTile(data, sx, 0, sz, TILE.DIRT);
    }
  }
  // Clear a 1x1 shaft down to y=3
  setTile(data, 10, 0, 10, TILE.AIR);
  setTile(data, 10, 1, 10, TILE.AIR);
  setTile(data, 10, 2, 10, TILE.AIR);
  setTile(data, 10, 3, 10, TILE.AIR);

  return { data, width: WIDTH, depth: DEPTH, height: HEIGHT };
}

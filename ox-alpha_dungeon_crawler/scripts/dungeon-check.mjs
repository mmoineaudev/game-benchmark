// dungeon-check.mjs — generator integrity (§24 lean v2): BFS walkability, escapes,
// unreachable cells, 4-connectivity. Mirrors WorldBuilder collision (0.3 ×0.6, r=0.35).
import DungeonGeneratorModule from '../src/world/DungeonGenerator.js';
import { BIOME_SEQUENCE, WORLD } from '../src/core/Constants.js';
const DungeonGenerator = DungeonGeneratorModule.default || DungeonGeneratorModule;

const WALL_T = 0.3, COLL_DEPTH = 0.6, R = 0.35;
const seeds = parseInt(process.argv[2] || '40', 10);

function mirrorCollisionBoxes(dungeon) {
  const { grid, gridSize, cellSize } = dungeon;
  const boxes = [];
  const cd = WALL_T * COLL_DEPTH;
  for (let z = 0; z < gridSize; z++) for (let x = 0; x < gridSize; x++) {
    if (grid[z][x] === 'empty') continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      const outOfBounds = nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize;
      if (!outOfBounds && grid[nz][nx] !== 'empty') continue; // interior edge
      // exposed OR boundary edge (mirrors WorldBuilder: boundary walls exist)
      const wx = x * cellSize + dx * cellSize / 2;
      const wz = z * cellSize + dz * cellSize / 2;
      if (dz !== 0) boxes.push({ minX: wx - cellSize / 2, maxX: wx + cellSize / 2, minZ: wz - cd / 2, maxZ: wz + cd / 2 });
      else boxes.push({ minX: wx - cd / 2, maxX: wx + cd / 2, minZ: wz - cellSize / 2, maxZ: wz + cellSize / 2 });
    }
  }
  return boxes;
}

function circleHitsBox(boxes, x, z, r) {
  for (const b of boxes) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

let broken = 0, totalRooms = 0, totalExitDist = 0;

for (let s = 0; s < seeds; s++) {
  const biome = BIOME_SEQUENCE[s % 10];
  const gen = new DungeonGenerator(1000 + s, biome);
  const d = gen.generate();
  totalRooms += d.rooms.length;
  totalExitDist += gen.exitBfsDistance ?? 0;

  // 4-connectivity from entrance over non-empty cells
  const { grid, gridSize } = d;
  const seen = Array.from({ length: gridSize }, () => new Array(gridSize).fill(false));
  const q = [d.entranceCell];
  seen[d.entranceCell.z][d.entranceCell.x] = true;
  let connectedCount = 1;
  while (q.length) {
    const c = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, nz = c.z + dz;
      if (nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize) continue;
      if (grid[nz][nx] === 'empty' || seen[nz][nx]) continue;
      seen[nz][nx] = true; connectedCount++;
      q.push({ x: nx, z: nz });
    }
  }
  let totalCells = 0;
  for (let z = 0; z < gridSize; z++) for (let x = 0; x < gridSize; x++)
    if (grid[z][x] !== 'empty') totalCells++;
  const disconnected = totalCells - connectedCount;

  // BFS from the entrance over walkable samples.
  // Neighbor test requires STRAIGHT-LINE clearance between sample centers
  // (mirrors the sub-stepped mover: no corner-diagonal slips between boxes).
  const cs = WORLD.CELL_SIZE;
  const boxes = mirrorCollisionBoxes(d);
  const keyOf = (x, z) => `${Math.round(x / 0.2)}:${Math.round(z / 0.2)}`;
  const walkable = [];
  for (let z = -cs; z <= gridSize * cs + cs; z += 0.2) {
    for (let x = -cs; x <= gridSize * cs + cs; x += 0.2) {
      if (!circleHitsBox(boxes, x, z, R)) walkable.push({ x, z });
    }
  }
  const set = new Set(walkable.map(w => keyOf(w.x, w.z)));
  function clearPath(x1, z1, x2, z2) {
    const dist = Math.hypot(x2 - x1, z2 - z1);
    const steps = Math.max(1, Math.ceil(dist / 0.05));
    for (let i = 0; i <= steps; i++) {
      if (circleHitsBox(boxes, x1 + (x2 - x1) * i / steps, z1 + (z2 - z1) * i / steps, R)) return false;
    }
    return true;
  }
  const adj = new Map();
  for (const w of walkable) {
    const k = keyOf(w.x, w.z);
    const nbrs = [];
    for (const [ox, oz] of [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) {
      const nx = w.x + ox, nz = w.z + oz;
      if (set.has(keyOf(nx, nz)) && clearPath(w.x, w.z, nx, nz)) nbrs.push(keyOf(nx, nz));
    }
    adj.set(k, nbrs);
  }
  const startKey = keyOf(d.entranceCell.x * cs, d.entranceCell.z * cs);
  let escapes = 0, reachable = new Set();
  if (set.has(startKey)) {
    const q2 = [startKey];
    reachable.add(startKey);
    while (q2.length) {
      const k = q2.shift();
      const [gx, gz] = k.split(':').map(Number);
      const outside = gx < -5 || gz < -5 || gx > (gridSize * cs) / 0.2 + 5 || gz > (gridSize * cs) / 0.2 + 5;
      for (const nk of adj.get(k) || []) if (!reachable.has(nk)) { reachable.add(nk); q2.push(nk); }
    }
    // escape = reachable sample beyond the dungeon bounds (+ 0.9 tolerance).
    // Cell centers sit at multiples of cellSize, cells span ±cellSize/2 →
    // true bounds are [-cs/2, gridSize*cs − cs/2].
    const marginMin = -WORLD.CELL_SIZE / 2 - 0.9;
    const marginMax = gridSize * WORLD.CELL_SIZE - WORLD.CELL_SIZE / 2 + 0.9;
    for (const k of reachable) {
      const [gx, gz] = k.split(':').map(Number);
      const x = gx * 0.2, z = gz * 0.2;
      if (x < marginMin || z < marginMin || x > marginMax || z > marginMax) escapes++;
    }
  }
  const unreachableInside = totalCells - [...reachable].length === 0 ? 0 :
    // count non-empty cells whose center is not reachable
    (() => {
      let n = 0;
      for (let z = 0; z < gridSize; z++) for (let x = 0; x < gridSize; x++) {
        if (grid[z][x] === 'empty') continue;
        if (!reachable.has(keyOf(x * cs, z * cs))) n++;
      }
      return n;
    })();

  if (escapes > 0 || unreachableInside > 0 || disconnected > 0) {
    broken++;
    console.log(`seed ${1000 + s}: BROKEN — escapes=${escapes} unreachableInside=${unreachableInside} disconnected=${disconnected} rooms=${d.rooms.length}`);
  }
}

console.log(`dungeon-check: broken=${broken}/${seeds}, avg rooms=${(totalRooms / seeds).toFixed(1)}, avg exit dist=${(totalExitDist / seeds).toFixed(1)}`);
process.exit(broken > 0 ? 1 : 0);

// Dungeon integrity check: connectivity + collision enclosure across seeds.
// Usage: node scripts/dungeon-check.mjs [seedCount] [step]
// Mirrors WorldBuilder wall geometry and Game collision rules (player radius 0.35).
import { DungeonGenerator } from '../src/world/DungeonGenerator.js';

const WALL_THICKNESS = 0.3;
const RADIUS = 0.35;
const SEED_COUNT = parseInt(process.argv[2] || '40', 10);
const STEP = parseFloat(process.argv[3] || '0.2');

function buildCollisionBoxes(data) {
  const boxes = [];
  const cs = data.cellSize;
  const gs = data.gridSize;
  for (let cz = 0; cz < gs; cz++) {
    for (let cx = 0; cx < gs; cx++) {
      if (data.grid[cz][cx] === 'empty') continue;
      const wx = cx * cs;
      const wz = cz * cs;
      const addWall = (x, z, w, d, ry) => {
        const halfW = w / 2;
        const halfD = d / 2 * 0.6;
        if (ry === 0) boxes.push({ minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD });
        else boxes.push({ minX: x - halfD, maxX: x + halfD, minZ: z - halfW, maxZ: z + halfW });
      };
      if (cz === 0 || data.grid[cz - 1][cx] === 'empty') addWall(wx + cs / 2, wz, cs, WALL_THICKNESS, 0);
      if (cz === gs - 1 || data.grid[cz + 1][cx] === 'empty') addWall(wx + cs / 2, wz + cs, cs, WALL_THICKNESS, 0);
      if (cx === 0 || data.grid[cz][cx - 1] === 'empty') addWall(wx, wz + cs / 2, cs, WALL_THICKNESS, Math.PI / 2);
      if (cx === gs - 1 || data.grid[cz][cx + 1] === 'empty') addWall(wx + cs, wz + cs / 2, cs, WALL_THICKNESS, Math.PI / 2);
    }
  }
  return boxes;
}

function collides(boxes, x, z, r) {
  for (const b of boxes) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function analyze(data) {
  const boxes = buildCollisionBoxes(data);
  const cs = data.cellSize;
  const gs = data.gridSize;
  const key = (x, z) => `${x.toFixed(2)},${z.toFixed(2)}`;

  // Sample walkable points inside the grid + 1-cell margin outside.
  const walkable = new Map();
  for (let x = -cs; x <= gs * cs + cs; x += STEP) {
    for (let z = -cs; z <= gs * cs + cs; z += STEP) {
      if (collides(boxes, x, z, RADIUS)) continue;
      const cx = Math.floor(x / cs);
      const cz = Math.floor(z / cs);
      const inGrid = cx >= 0 && cz >= 0 && cx < gs && cz < gs;
      walkable.set(key(x, z), { x, z, inDungeon: inGrid && data.grid[cz][cx] !== 'empty' });
    }
  }

  // BFS from entrance over walkable samples.
  const start = { x: data.entranceCell.x * cs + cs / 2, z: data.entranceCell.z * cs + cs / 2 };
  const visited = new Set([key(start.x, start.z)]);
  const queue = [start];
  while (queue.length) {
    const p = queue.pop();
    for (const [dx, dz] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = p.x + dx;
      const nz = p.z + dz;
      const k = key(nx, nz);
      if (visited.has(k) || !walkable.has(k)) continue;
      visited.add(k);
      queue.push({ x: nx, z: nz });
    }
  }

  // Escape = reachable but outside non-empty cells; unreachableInside = inside but not reached.
  let escapes = 0;
  let unreachableInside = 0;
  for (const [k, w] of walkable) {
    if (!visited.has(k)) {
      if (w.inDungeon) unreachableInside++;
    } else if (!w.inDungeon) {
      escapes++;
    }
  }

  // Connectivity on the cell grid itself (4-connectivity, same as player movement).
  const cellVisited = new Set([`${data.entranceCell.x},${data.entranceCell.z}`]);
  const cellQueue = [[data.entranceCell.x, data.entranceCell.z]];
  while (cellQueue.length) {
    const [x, z] = cellQueue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= gs || nz >= gs) continue;
      const k = `${nx},${nz}`;
      if (cellVisited.has(k) || data.grid[nz][nx] === 'empty') continue;
      cellVisited.add(k);
      cellQueue.push([nx, nz]);
    }
  }
  let totalCells = 0;
  let disconnected = 0;
  for (let z = 0; z < gs; z++) {
    for (let x = 0; x < gs; x++) {
      if (data.grid[z][x] === 'empty') continue;
      totalCells++;
      if (!cellVisited.has(`${x},${z}`)) disconnected++;
    }
  }

  return { escapes, unreachableInside, disconnected, totalCells, rooms: data.rooms.length };
}

let broken = 0;
let totalRooms = 0;
let totalDist = 0;
console.log('seed | rooms | escapes | unreachable | disconnected | cells | exitDist');
for (let seed = 1; seed <= SEED_COUNT; seed++) {
  const gen = new DungeonGenerator(seed);
  const data = gen.generate();
  const r = analyze(data);
  totalRooms += r.rooms;
  // BFS distance entrance -> exit on the cell grid
  const gs = data.gridSize;
  const dist = Array.from({ length: gs }, () => new Array(gs).fill(-1));
  const q = [[data.entranceCell.x, data.entranceCell.z]];
  dist[data.entranceCell.z][data.entranceCell.x] = 0;
  while (q.length) {
    const [x, z] = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= gs || nz >= gs) continue;
      if (data.grid[nz][nx] === 'empty' || dist[nz][nx] !== -1) continue;
      dist[nz][nx] = dist[z][x] + 1;
      q.push([nx, nz]);
    }
  }
  const exitDist = dist[data.exitCell.z][data.exitCell.x];
  totalDist += exitDist;
  const bad = r.escapes > 0 || r.unreachableInside > 0 || r.disconnected > 0;
  if (bad) broken++;
  console.log(
    `${String(seed).padStart(4)} | ${String(r.rooms).padStart(5)} | ${String(r.escapes).padStart(7)} | ` +
    `${String(r.unreachableInside).padStart(11)} | ${String(r.disconnected).padStart(12)} | ` +
    `${String(r.totalCells).padStart(5)} | ${String(exitDist).padStart(8)}${bad ? '  <<< BROKEN' : ''}`
  );
}
console.log(`\n=== SUMMARY: broken=${broken}/${SEED_COUNT} | avgRooms=${(totalRooms / SEED_COUNT).toFixed(1)} | avgExitDist=${(totalDist / SEED_COUNT).toFixed(1)}`);
if (broken > 0) process.exit(1);

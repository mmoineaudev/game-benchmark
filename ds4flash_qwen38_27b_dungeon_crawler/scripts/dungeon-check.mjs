/**
 * dungeon-check.mjs — headless verification of generated dungeon walkability (§24).
 *
 * For each seed: run DungeonGenerator.generate(seed, 'STONE'); mirror
 * WorldBuilder's collision boxes EXACTLY (wall thickness 0.3 visual, collision
 * depth ×0.6 = 0.18 u effective, player radius 0.35); sample walkable points on
 * a 0.2 u grid over the dungeon plus a 1-cell margin; BFS from the entrance over
 * walkable samples; count:
 *   - escapes          : reachable-but-outside-dungeon (a broken wall)
 *   - unreachableInside: dungeon cells not reachable
 *   - disconnected     : cell-grid 4-connectivity from entrance
 * Any > 0 marks the seed BROKEN. Also reports avg rooms and avg BFS exit dist.
 *
 * Usage: node scripts/dungeon-check.mjs [seedCount=40]
 * Expected: broken=0/40
 */

import { DungeonGenerator } from '../src/world/DungeonGenerator.js';
import { DUNGEON, PLAYER } from '../src/core/Constants.js';

const COUNT = Math.max(1, parseInt(process.argv[2] ?? '40', 10) || 40);

const CELL = DUNGEON.CELL_SIZE;                 // 6 u
const WALL_T = DUNGEON.WALL_THICKNESS;          // 0.3 u visual
const COLL_T = WALL_T * DUNGEON.COLLISION_DEPTH_MULT; // 0.18 u effective
const RADIUS = PLAYER.RADIUS;                   // 0.35
const STEP = 0.2;                               // walkable-sample grid (u)
const MARGIN_CELLS = 1;                         // sample margin around the dungeon

// ---------------------------------------------------------------------------
// Mirror of WorldBuilder collision boxes (§5.4) — same enumeration, same AABBs
// ---------------------------------------------------------------------------
function collisionBoxes(dungeon) {
  const { grid, gridSize, cellSize = CELL } = dungeon;
  const n = gridSize;
  const boxes = [];
  for (let cx = 0; cx < n; cx++) {
    for (let cz = 0; cz < n; cz++) {
      if (grid[cx][cz] === 'empty') continue;
      // West
      if (cx === 0 || grid[cx - 1][cz] === 'empty') {
        const b = cx * cellSize;
        boxes.push({ minX: b - COLL_T / 2, minZ: cz * cellSize, maxX: b + COLL_T / 2, maxZ: (cz + 1) * cellSize });
      }
      // East
      if (cx === n - 1 || grid[cx + 1][cz] === 'empty') {
        const b = (cx + 1) * cellSize;
        boxes.push({ minX: b - COLL_T / 2, minZ: cz * cellSize, maxX: b + COLL_T / 2, maxZ: (cz + 1) * cellSize });
      }
      // North
      if (cz === 0 || grid[cx][cz - 1] === 'empty') {
        const b = cz * cellSize;
        boxes.push({ minX: cx * cellSize, minZ: b - COLL_T / 2, maxX: (cx + 1) * cellSize, maxZ: b + COLL_T / 2 });
      }
      // South
      if (cz === n - 1 || grid[cx][cz + 1] === 'empty') {
        const b = (cz + 1) * cellSize;
        boxes.push({ minX: cx * cellSize, minZ: b - COLL_T / 2, maxX: (cx + 1) * cellSize, maxZ: b + COLL_T / 2 });
      }
    }
  }
  return boxes;
}

/** Circle (x, z, radius) vs any AABB (closest-point test). */
function circleHitsBox(boxes, x, z, radius) {
  for (const b of boxes) {
    const dx = x - (x < b.minX ? b.minX : x > b.maxX ? b.maxX : x);
    const dz = z - (z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z);
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

function checkSeed(seed) {
  const gen = new DungeonGenerator();
  const dungeon = gen.generate(seed, 'STONE');
  const { grid, gridSize, cellSize = CELL, rooms, entranceCell, exitCell } = dungeon;
  const n = gridSize;
  const boxes = collisionBoxes(dungeon);

  // --- cell-grid 4-connectivity from entrance (§24: disconnected) ----------
  const key = (x, z) => x * n + z;
  const entKey = key(entranceCell.x, entranceCell.z);
  const seen = new Set([entKey]);
  const q = [entKey];
  while (q.length) {
    const k = q.shift();
    const x = (k / n) | 0, z = k % n;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      if (grid[nx][nz] === 'empty') continue;
      const nk = key(nx, nz);
      if (seen.has(nk)) continue;
      seen.add(nk);
      q.push(nk);
    }
  }
  let disconnected = 0;
  for (let x = 0; x < n; x++)
    for (let z = 0; z < n; z++)
      if (grid[x][z] !== 'empty' && !seen.has(key(x, z))) disconnected++;

  // --- walkable sample grid: dungeon extent + 1-cell margin, 0.2 u step -----
  const xmin = -MARGIN_CELLS * cellSize;
  const zmin = -MARGIN_CELLS * cellSize;
  const xmax = (n + MARGIN_CELLS) * cellSize;
  const zmax = (n + MARGIN_CELLS) * cellSize;
  const cols = Math.round((xmax - xmin) / STEP);
  const rows = Math.round((zmax - zmin) / STEP);
  const inDungeonAt = (x, z) => {
    const cx = Math.floor(x / cellSize), cz = Math.floor(z / cellSize);
    return cx >= 0 && cz >= 0 && cx < n && cz < n && grid[cx][cz] !== 'empty';
  };

  // "outside the dungeon" = outside the non-empty cells (escaped through a wall).
  // The 1-cell margin ring around the grid is the escape-detection zone.
  const inDungeonContentAt = inDungeonAt;

  // walkable = not blocked by any wall collision box
  const walkable = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const z = zmin + j * STEP;
    for (let i = 0; i < cols; i++) {
      const x = xmin + i * STEP;
      walkable[j * cols + i] = circleHitsBox(boxes, x, z, RADIUS) ? 0 : 1;
    }
  }

  // BFS from the entrance sample over walkable points (4-neighbor)
  const ei = Math.round(((cellSize * entranceCell.x + cellSize / 2) - xmin) / STEP);
  const ej = Math.round(((cellSize * entranceCell.z + cellSize / 2) - zmin) / STEP);
  const startIdx = ej * cols + ei;
  const visited = new Uint8Array(cols * rows);
  const dist = new Map();
  if (!walkable[startIdx]) {
    // entrance itself blocked — every reachable point is an escape; count as broken
    return { rooms: rooms.length, escapes: 1, unreachableInside: 1, disconnected, exitDist: -1 };
  }
  visited[startIdx] = 1;
  dist.set(startIdx, 0);
  const q2 = [startIdx];
  let exitSamples = [];
  while (q2.length) {
    const k = q2.shift();
    const i = k % cols, j = (k / cols) | 0;
    const x = xmin + i * STEP, z = zmin + j * STEP;
    if (inDungeonAt(x, z)) {
      const cx = Math.floor(x / cellSize), cz = Math.floor(z / cellSize);
      if (cx === exitCell.x && cz === exitCell.z) exitSamples.push([k, dist.get(k)]);
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (visited[nk] || !walkable[nk]) continue;
      visited[nk] = 1;
      dist.set(nk, dist.get(k) + 1);
      q2.push(nk);
    }
  }

  // escapes: reachable (visited) samples that fall outside the dungeon grid
  let escapes = 0;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!visited[k]) continue;
      const x = xmin + i * STEP, z = zmin + j * STEP;
      if (!inDungeonContentAt(x, z)) escapes++;
    }

  // unreachableInside: non-empty cells with no reachable sample inside them
  const exitReachable = new Uint8Array(n * n);
  for (const [k, d] of dist) {
    const i = k % cols, j = (k / cols) | 0;
    const x = xmin + i * STEP, z = zmin + j * STEP;
    if (inDungeonAt(x, z)) {
      exitReachable[Math.floor(x / cellSize) * n + Math.floor(z / cellSize)] = 1;
    }
    void d;
  }
  let unreachableInside = 0;
  for (let x = 0; x < n; x++)
    for (let z = 0; z < n; z++)
      if (grid[x][z] !== 'empty' && !exitReachable[key(x, z)]) unreachableInside++;

  // BFS distance (in steps of 0.2 u) from entrance to the exit cell
  let exitDist = -1;
  for (const [k, d] of dist) {
    const i = k % cols, j = (k / cols) | 0;
    const x = xmin + i * STEP, z = zmin + j * STEP;
    if (!inDungeonAt(x, z)) continue;
    if (Math.floor(x / cellSize) === exitCell.x && Math.floor(z / cellSize) === exitCell.z) {
      if (exitDist < 0 || d < exitDist) exitDist = d;
    }
  }

  return { rooms: rooms.length, escapes, unreachableInside, disconnected, exitDist };
}

// ---------------------------------------------------------------------------
let broken = 0;
let sumRooms = 0, sumDist = 0, distCount = 0;
const failures = [];
for (let s = 1; s <= COUNT; s++) {
  const r = checkSeed(s);
  sumRooms += r.rooms;
  if (r.exitDist > 0) { sumDist += r.exitDist; distCount++; }
  const bad = [];
  if (r.escapes > 0) bad.push(`escapes=${r.escapes}`);
  if (r.unreachableInside > 0) bad.push(`unreachableInside=${r.unreachableInside}`);
  if (r.disconnected > 0) bad.push(`disconnected=${r.disconnected}`);
  if (bad.length) {
    broken++;
    failures.push(`seed ${s}: ${bad.join(', ')}`);
  }
}

console.log(`seeds checked: ${COUNT}`);
console.log(`avg rooms: ${(sumRooms / COUNT).toFixed(2)}`);
console.log(`avg BFS exit distance: ${distCount ? (sumDist / distCount / STEP).toFixed(1) + ' u' : 'n/a'}`);
console.log(`broken=${broken}/${COUNT}`);

if (broken > 0) {
  for (const f of failures) console.log('  FAIL ' + f);
  process.exit(1);
}

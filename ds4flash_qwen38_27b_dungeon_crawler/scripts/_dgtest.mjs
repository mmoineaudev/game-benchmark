import { DungeonGenerator } from '../src/world/DungeonGenerator.js';

function bfsReachable(result, from) {
  const { grid, gridSize } = result;
  const key = (x, z) => x * gridSize + z;
  const seen = new Set([key(from.x, from.z)]);
  const q = [from];
  while (q.length) {
    const { x, z } = q.shift();
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize) continue;
      if (grid[nx][nz] === 'empty') continue;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      q.push({ x: nx, z: nz });
    }
  }
  return seen.has(key(result.exitCell.x, result.exitCell.z));
}

let totalRooms = 0, failures = 0;
for (let seed = 1; seed <= 20; seed++) {
  const r = new DungeonGenerator().generate(seed, 'STONE');
  const problems = [];
  if (r.rooms.length < 8 || r.rooms.length > 12) problems.push(`rooms=${r.rooms.length}`);
  if (r.gridSize < 12 || r.gridSize > 16) problems.push(`gridSize=${r.gridSize}`);
  if (r.cellSize !== 6) problems.push(`cellSize=${r.cellSize}`);
  if (r.entranceCell.x === r.exitCell.x && r.entranceCell.z === r.exitCell.z) problems.push('entrance==exit');
  if (!bfsReachable(r, r.entranceCell)) problems.push('exit unreachable');
  totalRooms += r.rooms.length;
  if (problems.length) {
    failures++;
    console.log(`FAIL seed ${seed}: ${problems.join(', ')}`);
  }
}
console.log(`Average room count: ${(totalRooms / 20).toFixed(2)}`);
console.log(failures === 0 ? 'ALL 20 SEEDS PASS' : `${failures} seed(s) failed`);

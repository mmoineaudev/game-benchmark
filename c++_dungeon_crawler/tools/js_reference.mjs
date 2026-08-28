// Dump a dungeon's grid/entrance/exit in a stable text form so the C++
// port can be diffed for bit-identity. Usage: node js_reference.mjs <seed> [biome]
import DungeonGenerator from '../../ox-alpha_dungeon_crawler/src/world/DungeonGenerator.js';

const seed = parseInt(process.argv[2] || '1000', 10);
const biome = process.argv[3] || 'STONE';
const gen = new DungeonGenerator(seed, biome);
const d = gen.generate();
let out = `gridSize=${d.gridSize}\n`;
for (let z = 0; z < d.gridSize; z++) {
  let row = '';
  for (let x = 0; x < d.gridSize; x++) {
    const v = d.grid[z][x];
    row += v === 'empty' ? '.' : v === 'room' ? 'R' : 'c';
  }
  out += row + '\n';
}
out += `rooms=${d.rooms.length}\n`;
out += `entrance=${d.entranceCell.x},${d.entranceCell.z}\n`;
out += `exit=${d.exitCell.x},${d.exitCell.z}\n`;
out += `exitBfsDistance=${gen.exitBfsDistance}\n`;
process.stdout.write(out);

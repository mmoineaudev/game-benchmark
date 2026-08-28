// cpp_dump — emit the same stable dungeon dump as tools/js_reference.mjs.
// Usage: cpp_dump <seed> [biome]
#include <cstdio>
#include <string>

#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"

int main(int argc, char** argv) {
  int seed = argc > 1 ? std::atoi(argv[1]) : 1000;
  std::string biome = argc > 2 ? argv[2] : "STONE";
  dc::DungeonGenerator gen(seed, biome);
  dc::Dungeon d = gen.generate();
  char buf[64];
  std::snprintf(buf, sizeof buf, "gridSize=%d\n", d.gridSize);
  std::fputs(buf, stdout);
  for (int z = 0; z < d.gridSize; z++) {
    for (int x = 0; x < d.gridSize; x++) {
      std::putc(d.grid[z][x] == dc::Cell::kEmpty ? '.' : d.grid[z][x] == dc::Cell::kRoom ? 'R' : 'c', stdout);
    }
    std::putc('\n', stdout);
  }
  std::snprintf(buf, sizeof buf, "rooms=%zu\n", d.rooms.size());
  std::fputs(buf, stdout);
  if (d.entranceCell) {
    std::snprintf(buf, sizeof buf, "entrance=%d,%d\n", d.entranceCell->x, d.entranceCell->z);
    std::fputs(buf, stdout);
  }
  if (d.exitCell) {
    std::snprintf(buf, sizeof buf, "exit=%d,%d\n", d.exitCell->x, d.exitCell->z);
    std::fputs(buf, stdout);
  }
  std::snprintf(buf, sizeof buf, "exitBfsDistance=%d\n", d.exitBfsDistance);
  std::fputs(buf, stdout);
  return 0;
}

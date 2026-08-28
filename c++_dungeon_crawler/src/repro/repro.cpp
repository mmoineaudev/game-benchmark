// dc_repro — headless repro/replay harness (no GPU).
// The sim is single-threaded, fixed-step, and seeded, so a crash is fully
// reproducible from (seed, biome, frames). This stub drives a few generated
// dungeons headlessly; Phase 1 adds the full crash diagnostics layer
// (input+frame trace, signal handler, frame watchdog, ASan/UBSan build).
#include <cstdio>
#include <cstring>

#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/world.hpp"

int main(int argc, char** argv) {
  int seeds = 5;
  for (int i = 1; i < argc; i++) {
    if (!std::strcmp(argv[i], "--seeds")) seeds = std::atoi(argv[++i]);
  }

  for (int s = 0; s < seeds; s++) {
    const std::string biome = dc::kBiomeSequence[s % 10];
    dc::DungeonGenerator gen(1000 + s, biome);
    dc::Dungeon d = gen.generate();
    auto col = dc::buildCollisionBoxes(d);
    std::fprintf(stderr, "[dc_repro] seed %d biome %s: grid %d, rooms %zu, walls %zu, "
                         "entrance (%d,%d), exit (%d,%d)\n",
                 1000 + s, biome.c_str(), d.gridSize, d.rooms.size(), col.boxes.size(),
                 d.entranceCell->x, d.entranceCell->z, d.exitCell->x, d.exitCell->z);
  }
  return 0;
}

// dc/dungeon_gen.hpp — seeded grid dungeon (§5; algorithm order is binding).
// Port of ox-alpha_dungeon_crawler/src/world/DungeonGenerator.js.
// All randomness through Rng (mulberry32) — same seed → same dungeon.
#pragma once
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <vector>

#include "dc/constants.hpp"
#include "dc/rng.hpp"

namespace dc {

enum class Cell : int { kEmpty = 0, kRoom, kCorridor };

struct CellMeta {
  Cell type = Cell::kEmpty;
  std::string roomType; // set when type == kRoom
};

struct Room {
  int cx;
  int cz;
  int w;
  int h;
  std::string type;
};

struct CellRef {
  int x;
  int z;
};

struct Dungeon {
  int gridSize = 0;
  int cellSize = 0;
  std::vector<std::vector<Cell>> grid;
  std::vector<std::vector<CellMeta>> metadata;
  std::vector<Room> rooms;
  std::optional<CellRef> entranceCell;
  std::optional<CellRef> exitCell;
  // Set by the generator (mirrors gen.exitBfsDistance on the JS instance).
  int exitBfsDistance = 0;
  // Room indices, mirroring this.entranceRoom / this.exitRoom.
  int entranceRoomIdx = -1;
  int exitRoomIdx = -1;
};

// Seeded dungeon generator. Deterministic: same (seed, biome, opts) → same Dungeon.
class DungeonGenerator {
public:
  struct Opts {
    int gridSize; // 0 → derived from rnd
    int roomCount; // 0 → DUNGEON.ROOM_COUNT
  };

  DungeonGenerator(int seed, std::string biomeId, Opts opts = Opts{});
  Dungeon generate();

  const std::string& biome() const { return biome_; }
  int seed() const { return seed_; }

private:
  RoomTypeDef const* pickRoomType(); // returns pointer into kRoomTypes (or last-pool)
  bool canPlaceRoom(int cx, int cz, int w, int h) const;
  void placeRooms();
  CellRef roomCenter(const Room& r) const;
  void connectRooms();
  int manhattan(const CellRef& a, const CellRef& b) const;
  void carveCorridor(const Room& a, const Room& b);
  void carveH(int x1, int x2, int z);
  void carveV(int z1, int z2, int x);
  void addDeadEnds();
  void designateEntranceAndExit();

  int seed_;
  std::string biome_;
  int gridSize_;
  int roomTarget_;
  int cellSize_;
  Rng rnd_;

  std::vector<std::vector<Cell>> grid_;
  std::vector<std::vector<CellMeta>> metadata_;
  std::vector<Room> rooms_;
  std::optional<CellRef> entranceCell_;
  std::optional<CellRef> exitCell_;
  int exitBfsDistance_ = 0;
};

} // namespace dc

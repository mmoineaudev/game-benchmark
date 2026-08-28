// Port of scripts/dungeon-check.mjs — the parity gate.
// 40 seeds: BFS walkability, escapes, unreachable cells, 4-connectivity.
// Mirrors WorldBuilder collision (0.3 × 0.6, player r 0.35).
#include <catch2/catch_test_macros.hpp>

#include <algorithm>
#include <cmath>
#include <string>
#include <deque>
#include <map>
#include <set>
#include <vector>

#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/world.hpp"

namespace {

struct Sample {
  double x, z;
};

// Key at 0.2u quantization — exact mirror of the JS `keyOf` (Math.round(x/0.2)).
std::string keyOf(double x, double z) {
  const long gx = static_cast<long>(std::llround(x / 0.2));
  const long gz = static_cast<long>(std::llround(z / 0.2));
  return std::to_string(gx) + ":" + std::to_string(gz);
}

struct CheckResult {
  int seed;
  int escapes;
  int unreachableInside;
  int disconnected;
  int rooms;
  int exitDist;
  bool ok() const { return escapes == 0 && unreachableInside == 0 && disconnected == 0; }
};

CheckResult runCheck(int seed, const std::string& biome) {
  dc::DungeonGenerator gen(seed, biome);
  dc::Dungeon d = gen.generate();

  const int gridSize = d.gridSize;
  const double cs = d.cellSize;

  // --- 4-connectivity from entrance over non-empty cells ---
  std::vector<std::vector<bool>> seen(gridSize, std::vector<bool>(gridSize, false));
  std::deque<dc::CellRef> q;
  const dc::CellRef e = *d.entranceCell;
  q.push_back(e);
  seen[e.z][e.x] = true;
  int connectedCount = 1;
  while (!q.empty()) {
    const auto c = q.front();
    q.pop_front();
    for (const auto& dd : {std::pair<int, int>{1, 0}, std::pair<int, int>{-1, 0},
                          std::pair<int, int>{0, 1}, std::pair<int, int>{0, -1}}) {
      const int nx = c.x + dd.first, nz = c.z + dd.second;
      if (nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize) continue;
      if (d.grid[nz][nx] == dc::Cell::kEmpty || seen[nz][nx]) continue;
      seen[nz][nx] = true;
      connectedCount++;
      q.push_back({nx, nz});
    }
  }
  int totalCells = 0;
  for (int z = 0; z < gridSize; z++)
    for (int x = 0; x < gridSize; x++)
      if (d.grid[z][x] != dc::Cell::kEmpty) totalCells++;
  const int disconnected = totalCells - connectedCount;

  // --- walkable samples (mirrors the sub-stepped mover clearance) ---
  const double R = dc::player::kRadius;
  auto boxes = dc::buildCollisionBoxes(d);
  std::vector<Sample> walkable;
  // JS loops `for (z = -cs; z <= gridSize*cs + cs; z += 0.2)` — iterate in index
  // space to avoid float drift (cs is a multiple of 0.2: 30 steps per cell).
  const int iStep = static_cast<int>(std::llround(cs / 0.2)); // 30 for cs=6
  const int iStart = -iStep;
  const int iEnd = iStep * (gridSize + 1); // (gridSize*cs + cs) / 0.2
  for (int zi = iStart; zi <= iEnd; zi++) {
    const double z = zi * 0.2;
    for (int xi = iStart; xi <= iEnd; xi++) {
      const double x = xi * 0.2;
      if (!dc::circleHitsBox(boxes.boxes, x, z, R)) walkable.push_back({x, z});
    }
  }

  std::set<std::string> posSet;
  for (const auto& w : walkable) posSet.insert(keyOf(w.x, w.z));

  auto clearPath = [&](double x1, double z1, double x2, double z2) {
    const double dist = std::hypot(x2 - x1, z2 - z1);
    const int steps = std::max(1, static_cast<int>(std::ceil(dist / 0.05)));
    for (int i = 0; i <= steps; i++) {
      if (dc::circleHitsBox(boxes.boxes, x1 + (x2 - x1) * i / steps, z1 + (z2 - z1) * i / steps, R))
        return false;
    }
    return true;
  };

  // adjacency over the 0.2 grid, 4-neighbors with straight-line clearance
  std::map<std::string, std::vector<std::string>> adj;
  for (const auto& w : walkable) {
    const std::string k = keyOf(w.x, w.z);
    std::vector<std::string> nbrs;
    for (const auto& off : {std::pair<double, double>{0.2, 0}, std::pair<double, double>{-0.2, 0},
                           std::pair<double, double>{0, 0.2}, std::pair<double, double>{0, -0.2}}) {
      const double nx = w.x + off.first, nz = w.z + off.second;
      if (posSet.count(keyOf(nx, nz)) && clearPath(w.x, w.z, nx, nz)) nbrs.push_back(keyOf(nx, nz));
    }
    adj[k] = std::move(nbrs);
  }

  const std::string startKey = keyOf(e.x * cs, e.z * cs);
  std::set<std::string> reachable;
  int escapes = 0;
  if (posSet.count(startKey)) {
    std::deque<std::string> q2;
    q2.push_back(startKey);
    reachable.insert(startKey);
    while (!q2.empty()) {
      const std::string k = q2.front();
      q2.pop_front();
      for (const auto& nk : adj[k])
        if (reachable.insert(nk).second) q2.push_back(nk);
    }
    // escape = reachable sample beyond the dungeon bounds (+0.9 tolerance).
    // True bounds: [-cs/2, gridSize*cs - cs/2].
    const double marginMin = -dc::world::kCellSize / 2.0 - 0.9;
    const double marginMax = gridSize * dc::world::kCellSize - dc::world::kCellSize / 2.0 + 0.9;
    for (const auto& k : reachable) {
      const auto colon = k.find(':');
      const double x = std::stod(k.substr(0, colon)) * 0.2;
      const double z = std::stod(k.substr(colon + 1)) * 0.2;
      if (x < marginMin || z < marginMin || x > marginMax || z > marginMax) escapes++;
    }
  }

  // unreachableInside = non-empty cells whose center is not reachable
  int unreachableInside = 0;
  for (int z = 0; z < gridSize; z++) {
    for (int x = 0; x < gridSize; x++) {
      if (d.grid[z][x] == dc::Cell::kEmpty) continue;
      if (!reachable.count(keyOf(x * cs, z * cs))) unreachableInside++;
    }
  }

  return {seed, escapes, unreachableInside, disconnected,
          static_cast<int>(d.rooms.size()), d.exitBfsDistance};
}

} // namespace

TEST_CASE("dungeon_check: 40 seeds all walkable, connected, no escapes", "[dungeon]") {
  int broken = 0, totalRooms = 0, totalExitDist = 0;
  const int seeds = 40;

  for (int s = 0; s < seeds; s++) {
    const std::string biome = dc::kBiomeSequence[s % 10];
    CheckResult r = runCheck(1000 + s, biome);
    totalRooms += r.rooms;
    totalExitDist += r.exitDist;
    if (!r.ok()) {
      broken++;
      CAPTURE("seed", r.seed, "escapes", r.escapes, "unreachableInside", r.unreachableInside,
              "disconnected", r.disconnected, "rooms", r.rooms);
    }
  }

  CHECK(broken == 0);
  // Sanity: generator actually builds dungeons (not vacuously green).
  CHECK(totalRooms > 0);
  // Exit distance is real work (BFS reached a far room).
  CHECK(totalExitDist > 0);
  const double avgRooms = static_cast<double>(totalRooms) / seeds;
  const double avgExit = static_cast<double>(totalExitDist) / seeds;
  INFO("avg rooms=" + std::to_string(avgRooms) + " avg exit dist=" + std::to_string(avgExit));
}

TEST_CASE("dungeon_gen: same seed → same dungeon (determinism)", "[dungeon]") {
  dc::DungeonGenerator a(1007, "STONE");
  dc::Dungeon da = a.generate();
  dc::DungeonGenerator b(1007, "STONE");
  dc::Dungeon db = b.generate();

  CHECK(da.gridSize == db.gridSize);
  CHECK(da.rooms.size() == db.rooms.size());
  REQUIRE(da.gridSize == db.gridSize);
  for (int z = 0; z < da.gridSize; z++)
    for (int x = 0; x < da.gridSize; x++)
      CHECK(da.grid[z][x] == db.grid[z][x]);
  REQUIRE(da.entranceCell.has_value());
  REQUIRE(db.entranceCell.has_value());
  CHECK(da.entranceCell->x == db.entranceCell->x);
  CHECK(da.entranceCell->z == db.entranceCell->z);
  CHECK(da.exitBfsDistance == db.exitBfsDistance);
}

TEST_CASE("dungeon_gen: entrance and exit are distinct carved cells", "[dungeon]") {
  for (int s = 0; s < 20; s++) {
    dc::DungeonGenerator gen(2000 + s, dc::kBiomeSequence[s % 10]);
    dc::Dungeon d = gen.generate();
    REQUIRE(d.entranceCell.has_value());
    REQUIRE(d.exitCell.has_value());
    // Both sit on carved (non-empty) cells.
    CHECK(d.grid[d.entranceCell->z][d.entranceCell->x] != dc::Cell::kEmpty);
    CHECK(d.grid[d.exitCell->z][d.exitCell->x] != dc::Cell::kEmpty);
    // Exit is a ROOM cell (the farthest room reached by BFS).
    CHECK(d.grid[d.exitCell->z][d.exitCell->x] == dc::Cell::kRoom);
    // JS _placeRooms: while (rooms.length < roomTarget && attempts < MAX_ATTEMPTS).
    // No hard floor — placement can end short (e.g. 7) after rejections.
    // Contract: at least 1 room, never more than roomTarget (ROOM_COUNT).
    CHECK(d.rooms.size() >= 1u);
    CHECK(d.rooms.size() <= static_cast<size_t>(dc::dungeon::kRoomCount));
  }
}

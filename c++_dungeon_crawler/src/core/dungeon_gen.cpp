#include "dc/dungeon_gen.hpp"

#include "dc/constants.hpp"

#include <algorithm>
#include <cstdint>
#include <deque>
#include <limits>

namespace dc {

DungeonGenerator::DungeonGenerator(int seed, std::string biomeId, Opts opts)
    : seed_(seed),
      biome_(std::move(biomeId)),
      rnd_(static_cast<std::uint32_t>(seed)) {
  if (opts.gridSize > 0) {
    gridSize_ = opts.gridSize;
  } else {
    // JS: DUNGEON.GRID_MIN + Math.floor(this.rnd() * (DUNGEON.GRID_MAX - DUNGEON.GRID_MIN + 1))
    gridSize_ = dungeon::kGridMin +
                static_cast<int>(rnd_.next() * (dungeon::kGridMax - dungeon::kGridMin + 1));
  }
  roomTarget_ = opts.roomCount > 0 ? opts.roomCount : dungeon::kRoomCount;
  cellSize_ = world::kCellSize;
}

Dungeon DungeonGenerator::generate() {
  grid_.assign(gridSize_, std::vector<Cell>(gridSize_, Cell::kEmpty));
  metadata_.assign(gridSize_, std::vector<CellMeta>(gridSize_));
  rooms_.clear();
  entranceCell_.reset();
  exitCell_.reset();
  exitBfsDistance_ = 0;

  placeRooms();
  connectRooms();
  addDeadEnds();
  designateEntranceAndExit();

  Dungeon d;
  d.gridSize = gridSize_;
  d.cellSize = cellSize_;
  d.grid = grid_;
  d.metadata = metadata_;
  d.rooms = rooms_;
  d.entranceCell = entranceCell_;
  d.exitCell = exitCell_;
  d.exitBfsDistance = exitBfsDistance_;
  return d;
}

RoomTypeDef const* DungeonGenerator::pickRoomType() {
  const auto modsIt = kBiomeRoomModifiers.find(biome_);
  const auto* mods = modsIt != kBiomeRoomModifiers.end() ? &modsIt->second : nullptr;

  // pool of (index into kRoomTypes, weight)
  std::vector<std::pair<size_t, double>> pool;
  for (size_t i = 0; i < kRoomTypes.size(); i++) {
    const RoomTypeDef& rt = kRoomTypes[i];
    if (!rt.biomes.empty() &&
        std::find(rt.biomes.begin(), rt.biomes.end(), biome_) == rt.biomes.end()) {
      continue;
    }
    double w = rt.weight;
    if (mods) {
      auto it = mods->find(rt.id);
      if (it != mods->end()) w *= it->second;
    }
    if (w <= 0) continue;
    pool.push_back({i, w});
  }
  double total = 0;
  for (const auto& p : pool) total += p.second;
  double r = rnd_.next() * total;
  for (const auto& p : pool) {
    r -= p.second;
    if (r <= 0) return &kRoomTypes[p.first];
  }
  return &kRoomTypes[pool.back().first];
}

bool DungeonGenerator::canPlaceRoom(int cx, int cz, int w, int h) const {
  if (cx < 1 || cz < 1 || cx + w > gridSize_ - 1 || cz + h > gridSize_ - 1) return false;
  for (int z = cz - dungeon::kMinRoomDist; z < cz + h + dungeon::kMinRoomDist; z++) {
    for (int x = cx - dungeon::kMinRoomDist; x < cx + w + dungeon::kMinRoomDist; x++) {
      if (x < 0 || z < 0 || x >= gridSize_ || z >= gridSize_) continue;
      if (grid_[z][x] != Cell::kEmpty) return false;
    }
  }
  return true;
}

void DungeonGenerator::placeRooms() {
  int attempts = 0;
  while (static_cast<int>(rooms_.size()) < roomTarget_ && attempts++ < dungeon::kMaxAttempts) {
    const RoomTypeDef* rt = pickRoomType();
    const int maxH = rt->hMax != -1 ? rt->hMax : rt->maxSize;
    const int w = std::max(1, rt->minSize +
                     static_cast<int>(rnd_.next() * (rt->maxSize - rt->minSize + 1)));
    int h;
    if (rt->maxSize > 2) {
      h = std::max(1, rt->minSize +
                   static_cast<int>(rnd_.next() * (maxH - rt->minSize + 1)));
    } else if (rt->hMax != -1) {
      h = std::max(1, 1 + static_cast<int>(rnd_.next() * (rt->hMax - rt->minSize + 1)));
    } else {
      h = 1;
    }
    const int cx = 1 + static_cast<int>(rnd_.next() * (gridSize_ - 2));
    const int cz = 1 + static_cast<int>(rnd_.next() * (gridSize_ - 2));
    if (!canPlaceRoom(cx, cz, w, h)) continue;
    for (int z = cz; z < cz + h; z++) {
      for (int x = cx; x < cx + w; x++) {
        grid_[z][x] = Cell::kRoom;
        metadata_[z][x] = CellMeta{Cell::kRoom, rt->id};
      }
    }
    rooms_.push_back(Room{cx, cz, w, h, rt->id});
  }
}

CellRef DungeonGenerator::roomCenter(const Room& r) const {
  return {r.cx + static_cast<int>((r.w - 1) / 2), r.cz + static_cast<int>((r.h - 1) / 2)};
}

int DungeonGenerator::manhattan(const CellRef& a, const CellRef& b) const {
  return std::abs(a.x - b.x) + std::abs(a.z - b.z);
}

void DungeonGenerator::connectRooms() {
  const int n = static_cast<int>(rooms_.size());
  if (n == 0) return;

  std::vector<bool> inTree(n, false);
  std::vector<double> bestDist(n, std::numeric_limits<double>::infinity());
  std::vector<int> bestFrom(n, -1);
  inTree[0] = true;
  const CellRef c0 = roomCenter(rooms_[0]);
  for (int i = 1; i < n; i++) {
    bestDist[i] = manhattan(c0, roomCenter(rooms_[i]));
    bestFrom[i] = 0;
  }
  for (int iter = 1; iter < n; iter++) {
    int minI = -1;
    double minD = std::numeric_limits<double>::infinity();
    for (int i = 0; i < n; i++) {
      if (!inTree[i] && bestDist[i] < minD) {
        minD = bestDist[i];
        minI = i;
      }
    }
    if (minI < 0) break;
    inTree[minI] = true;
    carveCorridor(rooms_[bestFrom[minI]], rooms_[minI]);
    const CellRef cm = roomCenter(rooms_[minI]);
    for (int i = 0; i < n; i++) {
      if (!inTree[i]) {
        const int d = manhattan(cm, roomCenter(rooms_[i]));
        if (d < bestDist[i]) {
          bestDist[i] = d;
          bestFrom[i] = minI;
        }
      }
    }
  }

  // Loop corridors: pairs with distance <= gridSize, up to min(3, floor(n/3)).
  struct Pair { int i; int j; int d; };
  std::vector<Pair> pairs;
  for (int i = 0; i < n; i++) {
    for (int j = i + 1; j < n; j++) {
      const int d = manhattan(roomCenter(rooms_[i]), roomCenter(rooms_[j]));
      if (d > 0 && d <= gridSize_) pairs.push_back({i, j, d});
    }
  }
  // JS Array.sort is STABLE (ES2019+): equal-distance pairs keep their
  // original (i asc, j asc) enumeration order. std::stable_sort mirrors it.
  std::stable_sort(pairs.begin(), pairs.end(), [](const Pair& a, const Pair& b) { return a.d < b.d; });
  const int extra = std::min(3, n / 3);
  for (int k = 0; k < std::min(extra, static_cast<int>(pairs.size())); k++) {
    carveCorridor(rooms_[pairs[k].i], rooms_[pairs[k].j]);
  }
}

void DungeonGenerator::carveCorridor(const Room& a, const Room& b) {
  const CellRef ca = roomCenter(a), cb = roomCenter(b);
  const double roll = rnd_.next();
  if (roll < 0.35) {
    carveH(ca.x, cb.x, ca.z);
    carveV(ca.z, cb.z, cb.x);
  } else if (roll < 0.7) {
    carveV(ca.z, cb.z, ca.x);
    carveH(ca.x, cb.x, cb.z);
  } else {
    // Z: H-V-H through midpoint ±1
    const int midX = static_cast<int>((ca.x + cb.x) / 2) + static_cast<int>(rnd_.next() * 3) - 1;
    carveH(ca.x, midX, ca.z);
    carveV(ca.z, cb.z, midX);
    carveH(midX, cb.x, cb.z);
  }
}

void DungeonGenerator::carveH(int x1, int x2, int z) {
  const int lo = std::min(x1, x2), hi = std::max(x1, x2);
  for (int x = lo; x <= hi; x++) {
    if (x < 0 || x >= gridSize_ || z < 0 || z >= gridSize_) continue;
    if (grid_[z][x] == Cell::kEmpty) {
      grid_[z][x] = Cell::kCorridor;
      metadata_[z][x] = CellMeta{Cell::kCorridor, ""};
    }
  }
}

void DungeonGenerator::carveV(int z1, int z2, int x) {
  const int lo = std::min(z1, z2), hi = std::max(z1, z2);
  for (int z = lo; z <= hi; z++) {
    if (x < 0 || x >= gridSize_ || z < 0 || z >= gridSize_) continue;
    if (grid_[z][x] == Cell::kEmpty) {
      grid_[z][x] = Cell::kCorridor;
      metadata_[z][x] = CellMeta{Cell::kCorridor, ""};
    }
  }
}

void DungeonGenerator::addDeadEnds() {
  const int count = static_cast<int>(rnd_.next() * (dungeon::kDeadEndMax + 1));
  int attempts = 0, made = 0;
  while (made < count && attempts++ < 50) {
    std::vector<CellRef> corridorCells;
    for (int z = 0; z < gridSize_; z++) {
      for (int x = 0; x < gridSize_; x++) {
        if (grid_[z][x] == Cell::kCorridor) corridorCells.push_back({x, z});
      }
    }
    if (corridorCells.empty()) break;
    const CellRef cell = corridorCells[static_cast<size_t>(rnd_.next() * corridorCells.size())];
    const int dirs[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    const int dirIdx = static_cast<int>(rnd_.next() * 4);
    const int dx = dirs[dirIdx][0], dz = dirs[dirIdx][1];
    const int len = 1 + static_cast<int>(rnd_.next() * 2);
    // all target cells must still be empty
    bool ok = true;
    for (int s = 1; s <= len; s++) {
      const int x = cell.x + dx * s, z = cell.z + dz * s;
      if (x < 0 || z < 0 || x >= gridSize_ || z >= gridSize_ || grid_[z][x] != Cell::kEmpty) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (int s = 1; s <= len; s++) {
      const int x = cell.x + dx * s, z = cell.z + dz * s;
      grid_[z][x] = Cell::kCorridor;
      metadata_[z][x] = CellMeta{Cell::kCorridor, ""};
    }
    made++;
  }
}

void DungeonGenerator::designateEntranceAndExit() {
  // Entrance: room with minimum cx+cz; entrance cell = its center cell.
  int entranceIdx = -1;
  for (int i = 0; i < static_cast<int>(rooms_.size()); i++) {
    if (entranceIdx < 0 ||
        rooms_[i].cx + rooms_[i].cz < rooms_[entranceIdx].cx + rooms_[entranceIdx].cz) {
      entranceIdx = i;
    }
  }
  if (entranceIdx < 0) {
    entranceCell_ = CellRef{1, 1};
    exitCell_ = CellRef{1, 1};
    return;
  }
  entranceCell_ = roomCenter(rooms_[entranceIdx]);

  // Exit: BFS over non-empty cells from the entrance; last ROOM cell at max distance.
  std::vector<std::vector<int>> dist(gridSize_, std::vector<int>(gridSize_, -1));
  std::deque<CellRef> q;
  const CellRef e = *entranceCell_;
  q.push_back(e);
  dist[e.z][e.x] = 0;
  CellRef farthest{};
  int farDist = -1;
  bool haveFar = false;
  while (!q.empty()) {
    const CellRef c = q.front();
    q.pop_front();
    const int d = dist[c.z][c.x];
    if (grid_[c.z][c.x] == Cell::kRoom && d > farDist) {
      farDist = d;
      farthest = c;
      haveFar = true;
    }
    const int dirs[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    for (const auto& dd : dirs) {
      const int nx = c.x + dd[0], nz = c.z + dd[1];
      if (nx < 0 || nz < 0 || nx >= gridSize_ || nz >= gridSize_) continue;
      if (grid_[nz][nx] == Cell::kEmpty || dist[nz][nx] >= 0) continue;
      dist[nz][nx] = d + 1;
      q.push_back({nx, nz});
    }
  }
  exitCell_ = haveFar ? farthest : *entranceCell_;
  exitBfsDistance_ = farDist;
}

} // namespace dc

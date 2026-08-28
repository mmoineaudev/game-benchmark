// dc/world.hpp — grid → collision AABBs (port of WorldBuilder.js geometry/collision).
// Wall thickness ×0.6 collision depth, one box per exposed/boundary edge.
#pragma once
#include <vector>

#include "dc/collision.hpp"
#include "dc/dungeon_gen.hpp"

namespace dc {

constexpr double kWallThickness = 0.3;
constexpr double kCollisionDepth = 0.6; // collision boxes use thickness × 0.6

struct WorldCollision {
  std::vector<AABB> boxes; // same order WorldBuilder emits (per cell, 4 dirs)
};

// Build collision AABBs from a dungeon, mirroring WorldBuilder.build().
// Box order matters for parity (matches the JS mirrorCollisionBoxes loop).
inline WorldCollision buildCollisionBoxes(const Dungeon& d) {
  const double cellSize = d.cellSize;
  const double cd = kWallThickness * kCollisionDepth;
  WorldCollision out;
  out.boxes.reserve(d.gridSize * d.gridSize * 4);
  for (int z = 0; z < d.gridSize; z++) {
    for (int x = 0; x < d.gridSize; x++) {
      if (d.grid[z][x] == Cell::kEmpty) continue;
      for (const auto& dd : {std::pair<int, int>{1, 0}, std::pair<int, int>{-1, 0},
                            std::pair<int, int>{0, 1}, std::pair<int, int>{0, -1}}) {
        const int dx = dd.first, dz = dd.second;
        const int nx = x + dx, nz = z + dz;
        const bool outOfBounds = nx < 0 || nz < 0 || nx >= d.gridSize || nz >= d.gridSize;
        if (!outOfBounds && d.grid[nz][nx] != Cell::kEmpty) continue; // interior edge
        const double wx = x * cellSize + dx * cellSize / 2.0;
        const double wz = z * cellSize + dz * cellSize / 2.0;
        if (dz != 0) {
          out.boxes.push_back({wx - cellSize / 2.0, wx + cellSize / 2.0,
                              wz - cd / 2.0, wz + cd / 2.0});
        } else {
          out.boxes.push_back({wx - cd / 2.0, wx + cd / 2.0,
                              wz - cellSize / 2.0, wz + cellSize / 2.0});
        }
      }
    }
  }
  return out;
}

} // namespace dc

// dc/movement.hpp — nav helpers + sub-stepped movers (port of Game.js nav
// helpers + SkeletonSystem._moveToward). Pure, deterministic, GPU-free.
//
// Parity contract:
//   hasLineOfSight  ← Game._hasLineOfSight (ray-march LOS_STEP=0.4, r=0.25)
//   pathStep        ← Game._pathStep (greedy 4-neighbor, skip colliding centers)
//   moveToward      ← SkeletonSystem._moveToward (SUBSTEP=0.08 sub-stepping)
//   movePlayer      ← Game player loop (sprint/buff/substep/resolve)
#pragma once
#include <cmath>
#include <limits>
#include <optional>
#include <vector>

#include "dc/collision.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/constants.hpp"

namespace dc {

// A mutable 2D position (x, z) with a sub-stepped mover. Aliased to Vec2 so
// it composes with resolveCircleCollisions(boxes, pos, radius) directly.
using Mover = Vec2;

// LOS: true if the segment (x1,z1)-(x2,z2) is clear of all collision boxes.
// Mirrors Game._hasLineOfSight: steps = ceil(dist / LOS_STEP); sample
// i = 1..steps-1 (EXCLUSIVE of both endpoints) at radius LOS_RADIUS.
inline bool hasLineOfSight(const std::vector<AABB>& boxes,
                           double x1, double z1, double x2, double z2) {
  const double dx = x2 - x1, dz = z2 - z1;
  const double dist = std::hypot(dx, dz);
  const int steps = static_cast<int>(std::ceil(dist / enemySpawn::kLosStep));
  for (int i = 1; i < steps; i++) {
    const double t = i / static_cast<double>(steps);
    if (circleHitsBox(boxes, x1 + dx * t, z1 + dz * t, enemySpawn::kLosRadius))
      return false;
  }
  return true;
}

// Greedy 4-neighbor step toward (x2,z2) from (x1,z1), in WORLD units.
// Mirrors Game._pathStep: snap start to its cell, examine the 4 neighbors in
// fixed order [+x,-x,+z,-z], skip OOB / 'empty' / colliding centers, pick the
// one whose center is closest to the target. Returns nullopt if no neighbor
// is walkable (the caller then uses the direct vector).
inline std::optional<Mover> pathStep(const Dungeon& dungeon,
                                     const std::vector<AABB>& boxes,
                                     double x1, double z1, double x2, double z2) {
  const double cs = dungeon.cellSize > 0 ? dungeon.cellSize : world::kCellSize;
  const int cx = static_cast<int>(std::lround(x1 / cs));
  const int cz = static_cast<int>(std::lround(z1 / cs));
  const int gs = dungeon.gridSize;
  static const int kDirX[4] = {1, -1, 0, 0};
  static const int kDirZ[4] = {0, 0, 1, -1};
  Mover best;
  bool haveBest = false;
  double bestD = std::numeric_limits<double>::infinity();
  for (int k = 0; k < 4; k++) {
    const int nx = cx + kDirX[k];
    const int nz = cz + kDirZ[k];
    if (nx < 0 || nz < 0 || nx >= gs || nz >= gs) continue;
    if (dungeon.grid[nz][nx] == Cell::kEmpty) continue;
    const double wx = nx * cs, wz = nz * cs;
    if (circleHitsBox(boxes, wx, wz, player::kRadius)) continue;
    const double d = (wx - x2) * (wx - x2) + (wz - z2) * (wz - z2);
    if (d < bestD) { bestD = d; best.x = wx; best.z = wz; haveBest = true; }
  }
  return haveBest ? std::optional<Mover>(best) : std::nullopt;
}

// Sub-stepped straight move toward (tx,tz). Mirrors SkeletonSystem._moveToward:
// step = min(SUBSTEP, remaining) each sub-step, resolve collisions (radius r)
// after each. `speed` is world-units/second; `dt` seconds this frame.
inline double moveToward(Mover& m, double tx, double tz, double speed, double dt,
                         const std::vector<AABB>& boxes, double radius) {
  const double dx = tx - m.x, dz = tz - m.z;
  const double d = std::hypot(dx, dz);
  if (d < 0.05) return 0.0;
  double remaining = std::min(speed * dt, d);
  const double step = enemySpawn::kSubstep;
  while (remaining > 0) {
    const double s = std::min(step, remaining);
    remaining -= s;
    m.x += (dx / d) * s;
    m.z += (dz / d) * s;
    resolveCircleCollisions(boxes, m, radius);
  }
  return d - std::hypot(tx - m.x, tz - m.z);
}

// Player frame move. Mirrors Game.js player loop:
//   speed = BASE_SPEED * (sprinting ? sprintSpeedMult() : 1) * buffMoveMult
//   sub-step by SUBSTEP, resolve each sub-step at PLAYER.RADIUS.
// Inputs are the already-normalized (mx,mz) direction (0,0 if idle).
inline void movePlayer(Mover& m, double mx, double mz, bool sprinting,
                       double sprintMult, int buffEffect, double dt,
                       const std::vector<AABB>& boxes) {
  const bool moving = (mx != 0.0 || mz != 0.0);
  if (!moving) return;
  const double len = std::hypot(mx, mz);
  const double nx = mx / len, nz = mz / len;
  const double buffMoveMult = (buffEffect == 3) ? 1.2 : (buffEffect == 4) ? 1.5 : 1.0;
  const double speed = player::kBaseSpeed *
                       (sprinting ? sprintMult : 1.0) * buffMoveMult;
  double remaining = speed * dt;
  const double step = enemySpawn::kSubstep;
  while (remaining > 0) {
    const double s = std::min(step, remaining);
    remaining -= s;
    m.x += nx * s;
    m.z += nz * s;
    resolveCircleCollisions(boxes, m, player::kRadius);
  }
}

} // namespace dc

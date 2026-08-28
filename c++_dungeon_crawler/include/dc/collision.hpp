// dc/collision.hpp — shared circle-vs-AABB helpers (§6). Port of Collision.js.
// Boxes: {minX, maxX, minZ, maxZ}. Pure, deterministic, no allocation.
#pragma once
#include <cmath>
#include <vector>

namespace dc {

struct AABB {
  double minX, maxX, minZ, maxZ;
};

struct Vec2 {
  double x = 0, z = 0;
};

// True if a circle (x, z, radius) hits any box.
inline bool circleHitsBox(const std::vector<AABB>& boxes, double x, double z, double radius) {
  for (const auto& b : boxes) {
    const double cx = std::max(b.minX, std::min(x, b.maxX));
    const double cz = std::max(b.minZ, std::min(z, b.maxZ));
    const double dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

// Resolve a circle against all boxes, mutating pos (push-out). Port of
// resolveCircleCollisions. Order of boxes matters for parity — keep it.
inline void resolveCircleCollisions(const std::vector<AABB>& boxes, Vec2& pos, double radius) {
  for (const auto& b : boxes) {
    const double cx = std::max(b.minX, std::min(pos.x, b.maxX));
    const double cz = std::max(b.minZ, std::min(pos.z, b.maxZ));
    double dx = pos.x - cx, dz = pos.z - cz;
    const double d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 1e-9) {
      // center inside the box: push out along the smallest penetration axis
      const double px = std::min(pos.x - b.minX, b.maxX - pos.x);
      const double pz = std::min(pos.z - b.minZ, b.maxZ - pos.z);
      if (px < pz) {
        pos.x = (pos.x - b.minX < b.maxX - pos.x) ? b.minX - radius : b.maxX + radius;
      } else {
        pos.z = (pos.z - b.minZ < b.maxZ - pos.z) ? b.minZ - radius : b.maxZ + radius;
      }
      continue;
    }
    const double d = std::sqrt(d2);
    const double push = radius - d;
    pos.x += (dx / d) * push;
    pos.z += (dz / d) * push;
  }
}

} // namespace dc

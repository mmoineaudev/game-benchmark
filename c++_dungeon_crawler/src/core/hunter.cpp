// dc/hunter.cpp — HUNTER buff companion (port of entities/Hunter.js).
#include "dc/hunter.hpp"

#include <algorithm>
#include <cmath>

namespace dc {

void Hunter::update(double dt, const Vec2& playerPos,
                    const std::vector<Enemy*>& enemies,
                    const std::function<bool(const Vec2&, const Vec2&)>& los,
                    const std::function<void(Enemy*)>& onHit, double souls) {
  // follow at FOLLOW_SPEED keeping KEEP_DIST (behind the player)
  const double dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
  const double d = std::hypot(dx, dz);
  if (d > hunter::kKeepDist) {
    const double step = std::min(hunter::kFollowSpeed * dt, d - hunter::kKeepDist);
    pos.x += (dx / d) * step;
    pos.z += (dz / d) * step;
  }

  attackTimer -= dt;
  if (beamFlash > 0) beamFlash -= dt;
  if (beamFlash <= 0) { hasBeam = false; beamTargets.clear(); }

  if (attackTimer <= 0) {
    // Nearest-eligible first, up to kMaxBeamTargets (multi-target volley).
    // Each target must be within ATTACK_RANGE and have clear LOS.
    struct Cand { Enemy* e; double d; };
    std::vector<Cand> cands;
    for (Enemy* e : enemies) {
      if (!e->alive() || e->frozen) continue;
      const double dd = std::hypot(e->pos.x - pos.x, e->pos.z - pos.z);
      if (dd < hunter::kAttackRange && los(pos, e->pos)) cands.push_back({e, dd});
    }
    if (cands.empty()) return;
    std::sort(cands.begin(), cands.end(),
              [](const Cand& a, const Cand& b) { return a.d < b.d; });
    beamTargets.clear();
    hasBeam = true;
    beamFlash = hunter::kBeamFlash;
    for (size_t i = 0; i < cands.size() && i < (size_t)hunter::kMaxBeamTargets; i++) {
      beamTargets.push_back(cands[i].e->pos);
      onHit(cands[i].e);  // app: skelsys.hitEnemy(e, hunter::kBeamDmg, "beam")
    }
    attackTimer = 1.0 / std::min(5.0, std::max(0.25, souls / 100.0));
  }
}

} // namespace dc

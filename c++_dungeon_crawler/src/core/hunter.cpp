// dc/hunter.cpp — Friendly companion: follow + beam at mobs and breakables.
#include "dc/hunter.hpp"

#include <algorithm>
#include <cmath>

namespace dc {

void Hunter::update(double dt, const Vec2& playerPos,
                    const std::vector<Enemy*>& enemies,
                    const std::vector<Breakable*>& breakables,
                    const std::function<bool(const Vec2&, const Vec2&)>& los,
                    const std::function<void(Enemy*)>& onHitEnemy,
                    const std::function<void(Breakable*)>& onHitBreakable,
                    double souls) {
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
    // Collect eligible targets: enemies + breakables, nearest first.
    struct Cand { double d; bool isEnemy; Enemy* enemy = nullptr; Breakable* br = nullptr; };
    std::vector<Cand> cands;

    // Enemies (alive, not frozen, LOS check)
    for (Enemy* e : enemies) {
      if (!e->alive() || e->frozen) continue;
      const double dd = std::hypot(e->pos.x - pos.x, e->pos.z - pos.z);
      if (dd < hunter::kAttackRange && los(pos, e->pos))
        cands.push_back({dd, true, e, nullptr});
    }

    // Breakables (alive, LOS check)
    for (Breakable* br : breakables) {
      if (!br->alive) continue;
      const double dd = std::hypot(br->pos.x - pos.x, br->pos.z - pos.z);
      if (dd < hunter::kAttackRange && los(pos, br->pos))
        cands.push_back({dd, false, nullptr, br});
    }

    if (cands.empty()) return;
    std::sort(cands.begin(), cands.end(),
              [](const Cand& a, const Cand& b) { return a.d < b.d; });
    beamTargets.clear();
    hasBeam = true;
    beamFlash = hunter::kBeamFlash;
    for (size_t i = 0; i < cands.size() && i < (size_t)hunter::kMaxBeamTargets; i++) {
      beamTargets.push_back(cands[i].isEnemy ? cands[i].enemy->pos : cands[i].br->pos);
      if (cands[i].isEnemy && cands[i].enemy)
        onHitEnemy(cands[i].enemy);
      else if (cands[i].br)
        onHitBreakable(cands[i].br);
    }
    attackTimer = 1.0 / std::min(5.0, std::max(0.25, souls / 100.0));
  }
}

} // namespace dc

// dc/hunter.hpp — HUNTER buff companion: follow + LOS-targeted beam (§11).
// Port of entities/Hunter.js (the sim half; the visual cone is the app's job).
// The hunter is summoned while the HUNTER buff (buffEffect == 5) is active,
// follows the player at FOLLOW_SPEED keeping KEEP_DIST, and beams the nearest
// VISIBLE enemy within ATTACK_RANGE. Beam damage is reported via onHit so
// the caller routes it through SkeletonSystem::hitEnemy (drop credit, etc.).
// Pure, deterministic (no RNG), NO GPU.
#pragma once
#include <functional>
#include <vector>

#include "dc/collision.hpp"
#include "dc/constants.hpp"
#include "dc/drop_system.hpp"
#include "dc/skeleton_system.hpp"

namespace dc {

class Hunter {
public:
  Vec2 pos{0, 0};
  // Where the wraith is actually RENDERED (to the player's left, in view).
  // `pos` keeps the classic follow-behind sim; sidePos is the visible anchor.
  Vec2 sidePos{0, 0};
  double attackTimer = 0;
  double beamFlash = 0;   // >0 while a beam is visually flashing (app renders)
  bool active = false;    // false = not summoned (buff not active)
  // Beam targets: up to kMaxBeamTargets, fired together on each volley.
  // beamTarget[0] is the primary (nearest) target. Valid while beamFlash > 0.
  std::vector<Vec2> beamTargets;
  bool hasBeam = false;

  // One fixed-step frame. `enemies` = live mob pointers; `breakables` = alive
  // breakable pointers; `los(a,b)` = world line-of-sight; `onHitEnemy` and
  // `onHitBreakable` are the app's callbacks for applying damage.
  void update(double dt, const Vec2& playerPos, const std::vector<Enemy*>& enemies,
               const std::vector<Breakable*>& breakables,
               const std::function<bool(const Vec2&, const Vec2&)>& los,
               const std::function<void(Enemy*)>& onHitEnemy,
               const std::function<void(Breakable*)>& onHitBreakable, double souls);

  // Reset (level regen / buff expired).
  void reset() { pos = {0, 0}; attackTimer = 0; beamFlash = 0; active = false; hasBeam = false; beamTargets.clear(); }
};

} // namespace dc

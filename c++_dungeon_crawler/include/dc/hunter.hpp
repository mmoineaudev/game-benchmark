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
#include "dc/skeleton_system.hpp"

namespace dc {

class Hunter {
public:
  Vec2 pos{0, 0};
  double attackTimer = 0;
  double beamFlash = 0;   // >0 while a beam is visually flashing (app renders)
  bool active = false;    // false = not summoned (buff not active)

  // One fixed-step frame. `enemies` = the live mob pointers the hunter may
  // target (the app passes skelsys.enemies()); `los(a,b)` is the world
  // line-of-sight test; `onHit(e)` is called with the beam damage applied
  // (app routes to skelsys.hitEnemy(e, hunter::kBeamDmg, "beam")).
  void update(double dt, const Vec2& playerPos, const std::vector<Enemy*>& enemies,
               const std::function<bool(const Vec2&, const Vec2&)>& los,
               const std::function<void(Enemy*)>& onHit, double souls);

  // Reset (buff expired / level regen).
  void reset() { pos = {0, 0}; attackTimer = 0; beamFlash = 0; active = false; }
};

} // namespace dc

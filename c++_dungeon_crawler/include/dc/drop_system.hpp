// dc/drop_system.hpp — props/decor + drop economy (§16.5/§19), headless.
// Port of world/PropSystem.js (breakables/sarcophagi placement) +
// entities/OrbSystem.js (orb visuals, health/buff pickups, auto-collect)
// + Game._breakProp/_tickBreakables/_tickSarcophagi/_onEnemyKilled.
//
// Deterministic via the passed Rng (mulberry32): the JS used unseeded
// Math.random() for prop placement and drop rolls, so this is
// deterministic-by-design (like enemy spawn), NOT bit-parity gated.
// NO GPU — the app renders the cubes/spheres.
#pragma once
#include <functional>
#include <string>
#include <vector>

#include "dc/collision.hpp"
#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/rng.hpp"

namespace dc {

// A breakable barrel/crate (HP 1). Placed 1-3 per non-HALL room (§19).
struct Breakable {
  Vec2 pos{0, 0};
  bool alive = true;
};

// A CRYPT sarcophagus — opens once when the player comes within
// SARCOPHAGUS.TRIGGER (2.5 u). The lid slide is the app's visual.
struct Sarcophagus {
  Vec2 pos{0, 0};
  bool opened = false;
  AABB box{}; // collision box the app merges into world.collision
};

// A drop pickup: kind 0 = health (+HEALTH_RESTORE), 1 = buff (roll on pickup).
struct DropPickup {
  Vec2 pos{0, 0};
  int kind = 0;
  double bob = 0; // JS bob: Math.random()*6, +dt*3, y = 0.5+sin(bob)*0.15
};

// A soul-orb visual (credit is INSTANT; the orb floats ~DROP.VISUAL_LIFE).
struct DropOrbVisual {
  Vec2 pos{0, 0};
  double t = -1; // -1 = idle; >= 0 = seconds since spawn (life 1.0)
};

// A ground hazard pool: kind 0 = lava (VOLCANIC_DEPTHS/EMBER_FORGE),
// 1 = acid (POISON_SWAMP). One 0.8 s tick deals 1 dmg within 1.2 u (i-frames
// respected); never placed within 3 u of the exit marker nor in the exit room.
struct Hazard {
  Vec2 pos{0, 0};
  int kind = 0; // 0 lava, 1 acid
  double radius = 1.0; // visual pool radius (1.0 + rng()*0.6) — damage radius is 1.2
};

class DropSystem {
public:
  DropSystem() {
    orbVisuals_.reserve(drop::kOrbVisualPool);
    for (int i = 0; i < drop::kOrbVisualPool; i++) orbVisuals_.push_back({});
  }

  // Place breakables (1-3 per non-HALL room) + sarcophagi (CRYPT), mirroring
  // PropSystem.build's per-room order. Consumes `rng`. `level` unused (kept
  // for API parity; the JS props.build takes no level).
  void buildLevel(const Dungeon& d, Rng& rng);

  // One frame: auto-collect pickups within PICKUP_RADIUS (1.4 u) + tick orb
  // visuals. Player y-gate (2.2 u) is always true at eye height 1.6 vs 0.5.
  void update(double dt, const Vec2& playerPos);

  // Breakables within STEP_BREAK (0.45 u) of the player break (step-on).
  void tickBreakables(const Vec2& playerPos, double souls, Rng& rng);
  // Sarcophagi within SARCOPHAGUS.TRIGGER (2.5 u) open (once).
  void tickSarcophagi(const Vec2& playerPos);

  // Place ground hazards for a biome: lava (VOLCANIC_DEPTHS/EMBER_FORGE) or
  // acid (POISON_SWAMP), 1-2 per non-exit room, never within 3 u of the exit
  // marker. Returns nullptr if the biome has no hazard kind. Consumes `rng`.
  void buildHazards(const Dungeon& d, const std::string& biomeId, Rng& rng);

  // Hazard damage tick: every 0.8 s, if the player is within 1.2 u of any
  // hazard, deal 1 dmg (i-frames respected by the caller via onPlayerDamaged).
  // Mirrors Game._tickHazards (first hazard hit wins, then break).
  void tickHazards(double dt, const Vec2& playerPos);

  // Drops. `souls` = collectedOrbs (the excess-orb bonus for breakables).
  void spawnOrbs(double x, double z, int n, Rng& rng);
  void spawnHealth(double x, double z, Rng& rng);
  void spawnBuff(double x, double z, Rng& rng);
  // Break a prop: 6% buff (+0.05%/orb above 100) else 20% 1-5 soul orbs.
  void breakProp(Breakable& br, double souls, Rng& rng);

  // Level regen: clear everything (drops nothing).
  void clear();

  // ---- accessors (app rendering + verification) ----
  std::vector<Breakable>& breakables();
  const std::vector<Breakable>& breakables() const;
  std::vector<Sarcophagus>& sarcophagi();
  const std::vector<Sarcophagus>& sarcophagi() const;
  const std::vector<DropPickup>& pickups() const;
  const std::vector<DropOrbVisual>& orbVisuals() const;
  const std::vector<Hazard>& hazards() const;
  std::vector<Hazard>& hazards(); // test placement / app culling
  int livePickupCount() const;

  // ---- callbacks (wired by the app, mirroring Game ↔ OrbSystem/PropSystem) ----
  // One soul orb credited (instant — orbs ARE souls).
  std::function<void()> onOrbCollected;
  // A health pickup was collected (+HEALTH_RESTORE, capped at maxHealth).
  std::function<void()> onHealthCollected;
  // A buff pickup was collected at (x,z) — the app rolls the buff effect.
  std::function<void(const Vec2&)> onBuffCollected;
  // A sarcophagus opened — the app rolls the 30% wraith summon.
  std::function<void(Sarcophagus&)> onSarcophagusOpened;
  // The player stood in a hazard this tick — the app applies damage (i-frames).
  std::function<void(double dmg)> onHazardHit;

private:
  void spawnOrbVisual(double x, double z);
  std::vector<Breakable> breakables_;
  std::vector<Sarcophagus> sarcophagi_;
  std::vector<DropPickup> pickups_;
  std::vector<DropOrbVisual> orbVisuals_;
  std::vector<Hazard> hazards_;
  double hazardAccum_ = 0.0; // 0.8 s tick accumulator
  int nextVisual_ = 0;
};

} // namespace dc

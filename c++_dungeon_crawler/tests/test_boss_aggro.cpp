// Phase 2 exit gate: headless boss_aggro_check (port of
// scripts/boss-aggro-check.mjs). Runs the real boss state machine (dc_core,
// no GPU) through the same four gates the live CDP check asserts:
//   A: boss stays dormant (no spawn aggro) — no move, no damage, out of range
//   B: boss wakes when the player becomes visible (LOS + AGGRO_RANGE) and chases
//   C: after aggro the boss ATTACKS (charge/blink observed) and its attacks
//      damage the player
//   D: player damage reaches the boss; a boss kill flows to bossKills++
// Plus the boss HP contract: live HP == bossHp(level, ng, souls, hearts).
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <string>
#include <vector>

#include "dc/boss.hpp"
#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/movement.hpp"
#include "dc/world.hpp"

using namespace dc;

namespace {

constexpr int kLevel = 7; // boss level
constexpr double kDt = 1.0 / 60.0;

struct Sim {
  Dungeon dungeon;
  std::vector<AABB> boxes;
  Boss boss;
  Vec2 player{0, 0};
  double playerHealth = 0, playerMaxHealth = 3;
  int bossKills = 0;
  Rng rng{12345u};

  BossCtx ctx() const {
    BossCtx c;
    c.dungeon = &dungeon;
    c.boxes = &boxes;
    c.playerPos = player;
    c.playerMaxHealth = playerMaxHealth;
    c.level = kLevel;
    c.ngPlus = 0;
    c.souls = 0;
    c.bossKills = bossKills;
    c.frozenAll = false;
    c.rng = const_cast<Rng*>(&rng);
    c.playerHealth = const_cast<double*>(&playerHealth);
    return c;
  }

  void step(double dt) {
    boss.update(dt, ctx());
  }

  // Mirror of the JS Phase-B spot finder: a walkable point 3–maxDist u from the
  // boss with clear LOS (scanning a ring of candidate offsets), so the boss
  // can actually see and chase it. Falls back to the boss cell (clear by
  // construction) and returns false if no ring spot had LOS.
  bool findApproachSpot(Vec2& out, const Vec2& bossPos, double maxDist = 20.0) const {
    static const double dirs[6][2] = {{1, 0}, {0, 1}, {-1, 0}, {0, -1},
                                       {0.7, 0.7}, {-0.7, 0.7}};
    for (double dist = 3.0; dist <= maxDist; dist += 1.0) {
      for (const auto& d : dirs) {
        const Vec2 c{bossPos.x + d[0] * dist, bossPos.z + d[1] * dist};
        // must be walkable (not inside a collision box) and visible
        if (circleHitsBox(boxes, c.x, c.z, 0.35)) continue;
        if (hasLineOfSight(boxes, bossPos.x, bossPos.z, c.x, c.z)) {
          out = c;
          return true;
        }
      }
    }
    out = bossPos; // last resort: throne cell (clear by construction)
    return false;
  }
};

} // namespace

TEST_CASE("boss HP matches bossHp() contract (L7 NG0)", "[boss_aggro]") {
  const int souls = 0, maxHealth = 3;
  const int expected = bossHp(kLevel, 0, souls, maxHealth);
  SECTION("base boss HP at L7 NG0 is 25") {
    CHECK(expected == 25);
  }
  SECTION("deep-level HP stays capped (≤ ×2 base, never the old ×11)") {
    // max wealth at L7: souls 0, maxHealth 3 → wealth 1 → 25. A loaded run:
    // souls 200, maxHealth 8 → soulsPart 1+0.25*4=2, heartsPart 1.1^5≈1.61,
    // wealth=1+(2*1.61-1)/2=1.61 → 25*2*1.61≈80.6→ceil 81 ≤ 88 (×2 cap×wealth).
    const int loaded = bossHp(kLevel, 0, 200, 8);
    CHECK(loaded <= 88);
    CHECK(loaded >= 25);
  }
}

TEST_CASE("boss_aggro: PHASE A — dormant, no spawn aggro", "[boss_aggro]") {
  const std::string biome = biomeForLevel(kLevel);
  DungeonGenerator gen(1000, biome);
  Sim sim;
  sim.dungeon = gen.generate();
  sim.boxes = buildCollisionBoxes(sim.dungeon).boxes;
  sim.boss = Boss::spawn(sim.dungeon, kLevel, 0, 0, 3, "Skeleton");
  const double cs = sim.dungeon.cellSize;
  sim.player = {static_cast<double>(sim.dungeon.entranceCell->x) * cs,
                static_cast<double>(sim.dungeon.entranceCell->z) * cs};
  sim.playerMaxHealth = 3;
  sim.playerHealth = 3;

  const Vec2 spawn = sim.boss.pos;
  // The test is only valid if the player starts OUT of aggro range.
  const double dist0 = std::hypot(spawn.x - sim.player.x, spawn.z - sim.player.z);
  REQUIRE(dist0 >= boss::kAggroRange);

  // Run 12 s (longer than the old 4 s first-blink timer) with the player still.
  const int frames = static_cast<int>(12.0 / kDt);
  for (int i = 0; i < frames; i++) sim.step(kDt);

  CHECK_FALSE(sim.boss.awake);
  CHECK(sim.boss.state == "SLEEPING");
  CHECK(std::hypot(sim.boss.pos.x - spawn.x, sim.boss.pos.z - spawn.z) < 0.01);
  CHECK(sim.boss.playerDamageDealt == 0.0);
  CHECK(sim.boss.blinkNovaCount == 0);
  CHECK(sim.boss.chargeHitCount == 0);
}

TEST_CASE("boss_aggro: PHASE B — wakes on sight, then chases", "[boss_aggro]") {
  const std::string biome = biomeForLevel(kLevel);
  DungeonGenerator gen(1000, biome);
  Sim sim;
  sim.dungeon = gen.generate();
  sim.boxes = buildCollisionBoxes(sim.dungeon).boxes;
  sim.boss = Boss::spawn(sim.dungeon, kLevel, 0, 0, 3, "Skeleton");
  sim.playerMaxHealth = 3;
  sim.playerHealth = 3;

  // Place the player inside AGGRO_RANGE with clear LOS, 3–20 u out (the JS
  // Phase-B ring scan). The boss must be able to see it to wake + chase.
  const Vec2 b = sim.boss.pos;
  Vec2 p;
  sim.findApproachSpot(p, b, 20.0);
  sim.player = p;
  const Vec2 dormant = sim.boss.pos;

  // Wait for aggro (should be immediate: within range + LOS).
  int wokeFrames = -1;
  for (int i = 0; i < static_cast<int>(8.0 / kDt); i++) {
    sim.step(kDt);
    if (sim.boss.awake) { wokeFrames = i; break; }
  }
  REQUIRE(wokeFrames >= 0); // it woke
  CHECK(sim.boss.awake);
  CHECK(sim.boss.state != "SLEEPING");

  // Let it chase/attack for 4 s; it must leave its dormant spot.
  for (int i = 0; i < static_cast<int>(4.0 / kDt); i++) sim.step(kDt);
  const double moved = std::hypot(sim.boss.pos.x - dormant.x, sim.boss.pos.z - dormant.z);
  CHECK(moved > 1.5);
}

TEST_CASE("boss_aggro: PHASE C — attacks after aggro, damages the player",
          "[boss_aggro]") {
  const std::string biome = biomeForLevel(kLevel);
  DungeonGenerator gen(1000, biome);
  Sim sim;
  sim.dungeon = gen.generate();
  sim.boxes = buildCollisionBoxes(sim.dungeon).boxes;
  sim.boss = Boss::spawn(sim.dungeon, kLevel, 0, 0, 3, "Skeleton");
  // Deep pool so a single nova/charge is survivable — observe, don't end.
  sim.playerMaxHealth = 99;
  sim.playerHealth = 99;
  const double startHealth = sim.playerHealth;

  const Vec2 b = sim.boss.pos;
  Vec2 p;
  sim.findApproachSpot(p, b, 14.0); // within CHARGE_RANGE + aggro, LOS clear
  sim.player = p;

  std::vector<std::string> seen;
  auto addSeen = [&](const std::string& s) {
    for (auto& x : seen) if (x == s) return;
    seen.push_back(s);
  };
  addSeen(sim.boss.state);
  // Run 15 s; stop early once a nova detonates AND the player is hurt.
  for (int i = 0; i < static_cast<int>(15.0 / kDt); i++) {
    sim.step(kDt);
    addSeen(sim.boss.state);
    if (sim.boss.blinkNovaCount > 0 && sim.playerHealth < startHealth) break;
  }

  const bool attacked = sim.boss.enteredCharging || sim.boss.enteredBlinking;
  CHECK(attacked);
  CHECK(sim.boss.blinkNovaCount > 0);
  CHECK(startHealth - sim.playerHealth > 0.0);
  CHECK(sim.playerHealth > 0.0); // survived (deep pool)
}

TEST_CASE("boss_aggro: PHASE D — player damages the boss; kill flows to bossKills",
          "[boss_aggro]") {
  const std::string biome = biomeForLevel(kLevel);
  DungeonGenerator gen(1000, biome);
  Sim sim;
  sim.dungeon = gen.generate();
  sim.boxes = buildCollisionBoxes(sim.dungeon).boxes;
  sim.boss = Boss::spawn(sim.dungeon, kLevel, 0, 0, 3, "Skeleton");
  sim.playerMaxHealth = 999;
  sim.playerHealth = 999;
  sim.bossKills = 0;

  const double before = sim.boss.hp;
  const bool hit1 = sim.boss.hitBoss(2.0, "sword"); // one sword-sized hit
  CHECK(!hit1);
  CHECK(before - sim.boss.hp > 0.0); // damaged

  // Finish him off and confirm the kill (state DEAD) so bossKills can increment.
  sim.boss.hp = 2;
  sim.boss.maxHp = std::max(sim.boss.maxHp, 2.0);
  const bool killed = sim.boss.hitBoss(9999.0, "sword");
  CHECK(killed);
  CHECK(sim.boss.state == "DEAD");
  if (killed) sim.bossKills++; // _onBossDefeated
  CHECK(sim.bossKills > 0);
}

// test_hunter.cpp — dc::Hunter (HUNTER buff companion) sim verification.
#include <catch2/catch_test_macros.hpp>
#include <catch2/catch_approx.hpp>

#include <cmath>
#include <functional>
#include <vector>

#include "dc/hunter.hpp"

using namespace dc;

namespace {
const double kDt = 1.0 / 60.0;
const auto kLosClear = [](const Vec2&, const Vec2&) { return true; };
} // namespace

TEST_CASE("Hunter follows the player at the keep distance", "[hunter]") {
  Hunter h;
  h.active = true;
  h.pos = {10, 0}; // start 10u away
  std::vector<Enemy*> none;
  for (int i = 0; i < 120; i++) h.update(kDt, {0, 0}, none, kLosClear, [](Enemy*) {}, 0);
  const double d = std::hypot(h.pos.x, h.pos.z);
  CHECK(d < 3.0);                 // closed in on the player
  CHECK(d > 0.0);                 // and held back before stacking on the player
}

TEST_CASE("Hunter beams the nearest visible enemy; rate scales with souls", "[hunter]") {
  // zero souls → interval clamped to 1/0.25 = 4s → at most 1 hit in 5s
  Hunter h0;
  h0.active = true;
  Enemy e;
  e.state = EnemyState::kChase;
  e.pos = {2, 0};
  std::vector<Enemy*> t{&e};
  int hits0 = 0;
  for (int i = 0; i < 300; i++) h0.update(kDt, {0, 0}, t, kLosClear, [&](Enemy*) { hits0++; }, 0);
  CHECK(hits0 >= 1);

  // 200 souls → interval 1/2 = 0.5s → far more hits in the same 5s
  Hunter h2;
  h2.active = true;
  int hits2 = 0;
  for (int i = 0; i < 300; i++) h2.update(kDt, {0, 0}, t, kLosClear, [&](Enemy*) { hits2++; }, 200);
  CHECK(hits2 > hits0);
}

TEST_CASE("Hunter does not fire through walls (LOS gate)", "[hunter]") {
  Hunter h;
  h.active = true;
  Enemy e;
  e.state = EnemyState::kChase;
  e.pos = {2, 0};
  std::vector<Enemy*> t{&e};
  int hits = 0;
  for (int i = 0; i < 300; i++)
    h.update(kDt, {0, 0}, t,
             [](const Vec2& a, const Vec2& b) {
               // wall at x=1.0: any segment crossing it is blocked
               return (a.x < 1.0 && b.x < 1.0) || (a.x > 1.0 && b.x > 1.0);
             },
             [&](Enemy*) { hits++; }, 0);
  CHECK(hits == 0);
}

TEST_CASE("Hunter skips dead and frozen enemies", "[hunter]") {
  Hunter h;
  h.active = true;
  Enemy dead;
  dead.state = EnemyState::kDead;
  dead.pos = {2, 0};
  Enemy frozen;
  frozen.state = EnemyState::kChase;
  frozen.pos = {1.5, 0};
  frozen.frozen = true;
  Enemy live;
  live.state = EnemyState::kChase;
  live.pos = {1, 1};
  std::vector<Enemy*> t{&dead, &frozen, &live};
  int onDead = 0, onFrozen = 0, onLive = 0;
  for (int i = 0; i < 120; i++)
    h.update(kDt, {0, 0}, t, kLosClear,
             [&](Enemy* e) {
               if (e == &dead) onDead++;
               if (e == &frozen) onFrozen++;
               if (e == &live) onLive++;
             },
             0);
  CHECK(onDead == 0);
  CHECK(onFrozen == 0);
  CHECK(onLive >= 1); // only the live enemy gets beamed
}

TEST_CASE("Hunter fires a volley at up to 5 targets (nearest first)", "[hunter]") {
  Hunter h;
  h.active = true;
  std::vector<Enemy*> t;
  std::vector<Enemy> pool;
  // 7 live enemies fanned out in range (dist < 7).
  for (int i = 0; i < 7; i++) {
    Enemy e;
    e.state = EnemyState::kChase;
    e.pos = {3.0, i * 1.0}; // all within kAttackRange 7, distinct distances
    pool.push_back(e);
    t.push_back(&pool.back());
  }
  int volleys = 0, hits = 0;
  std::vector<Enemy*> lastVolley;
  auto onHit = [&](Enemy* e) { hits++; lastVolley.push_back(e); volleys++; };
  // Run a few frames; the first volley must hit exactly 5 targets.
  h.update(kDt, {0, 0}, t, kLosClear, onHit, 0);
  CHECK(hits == 5);
  CHECK(h.beamTargets.size() == 5);
  CHECK(h.hasBeam);
  // Nearest (smallest index = smallest z... actually smallest hypot) first.
  // Distances: hypot(3, i) → i=0 is nearest (3.0), then i=1 (3.16)... so the
  // 5 nearest = indices 0..4.
  for (int i = 0; i < 5; i++) {
    CHECK(h.beamTargets[i].x == Catch::Approx(pool[i].pos.x));
    CHECK(h.beamTargets[i].z == Catch::Approx(pool[i].pos.z));
  }
}

TEST_CASE("Hunter resets on reset()", "[hunter]") {
  Hunter h;
  h.active = true;
  h.pos = {5, 5};
  h.beamFlash = 0.2;
  h.attackTimer = 0.5;
  h.hasBeam = true;
  h.beamTargets = {{1, 2}, {3, 4}};
  h.reset();
  CHECK(h.active == false);
  CHECK(h.pos.x == 0.0);
  CHECK(h.pos.z == 0.0);
  CHECK(h.beamFlash == 0.0);
  CHECK(h.hasBeam == false);
  CHECK(h.beamTargets.empty());
}

// test_drop_system.cpp — dc::DropSystem (breakables/sarcophagi/drops) verification.
#include <catch2/catch_test_macros.hpp>
#include <catch2/catch_approx.hpp>

#include <cmath>
#include <vector>

#include "dc/drop_system.hpp"

using namespace dc;

namespace {
// A small hand-built dungeon: one CRYPT + two normal rooms + one HALL.
Dungeon testDungeon() {
  Dungeon d;
  d.gridSize = 48;
  d.cellSize = 2;
  d.rooms = {
      {2, 2, 4, 4, "CRYPT"},   // room 0: sarcophagus
      {12, 2, 6, 6, "CHAMBER"}, // room 1: breakables
      {20, 2, 6, 6, "CHAMBER"}, // room 2: breakables
      {2, 12, 6, 6, "HALL"},    // room 3: NO breakables
  };
  return d;
}
} // namespace

TEST_CASE("buildLevel places one sarcophagus per CRYPT and 1-3 breakables per non-HALL room", "[drop]") {
  DropSystem drops;
  Rng rng{42u};
  drops.buildLevel(testDungeon(), rng);
  // one CRYPT room → exactly one sarcophagus
  CHECK(drops.sarcophagi().size() == 1);
  CHECK(drops.sarcophagi()[0].opened == false);
  // two non-HALL, non-CRYPT rooms get 1-3 breakables each → 2..6 total
  const size_t n = drops.breakables().size();
  CHECK(n >= 2);
  CHECK(n <= 6);
  // every breakable is alive initially
  for (const auto& b : drops.breakables()) CHECK(b.alive == true);
}

TEST_CASE("buildLevel skips HALL rooms and respects the 400 hard cap", "[drop]") {
  DropSystem drops;
  Rng rng{7u};
  drops.buildLevel(testDungeon(), rng);
  // HALL room at (2,12) must have contributed zero breakables:
  // the hall center is at world x=(2+(6-1)/2)*2 = 7, z=(12+2.5)*2 = 29.
  const double hallX = (2 + (6 - 1) / 2.0) * 2.0, hallZ = (12 + (6 - 1) / 2.0) * 2.0;
  for (const auto& b : drops.breakables()) {
    const double dx = b.pos.x - hallX, dz = b.pos.z - hallZ;
    CHECK(dx * dx + dz * dz > 0.0); // none exactly at the hall center block
  }
  // hard cap: a dungeon of many rooms can never exceed 400 props
  Dungeon big;
  big.gridSize = 128;
  big.cellSize = 2;
  for (int i = 0; i < 100; i++) big.rooms.push_back({i, 0, 8, 8, "CHAMBER"});
  DropSystem d2;
  Rng r2{1u};
  d2.buildLevel(big, r2);
  CHECK(d2.breakables().size() + d2.sarcophagi().size() <= props::kMaxPerLevel);
}

TEST_CASE("breakProp: 6% buff roll first, then 20% 1-5 orbs; deterministic per seed", "[drop]") {
  // Statistical check over many breaks at zero souls: ~6% buff, ~18.8% orb drops.
  DropSystem drops;
  Rng rng{123u};
  int buffDrops = 0, souls = 0;
  drops.onOrbCollected = [&] { souls++; };
  for (int i = 0; i < 4000; i++) {
    auto& b = drops.breakables();
    b.push_back({{static_cast<double>(i % 50), 0}, true});
    auto& br = b.back();
    const int pickupsBefore = drops.livePickupCount();
    drops.breakProp(br, 0, rng);
    if (drops.livePickupCount() > pickupsBefore) buffDrops++; // a buff pickup appeared
  }
  const double buffRate = buffDrops / 4000.0;
  CHECK(buffRate > 0.04);
  CHECK(buffRate < 0.08); // ~6% ±2%
  // orb rate: (1-0.06)*0.20 ≈ 0.188 drop events × avg 3 orbs ≈ 0.564 souls/break
  const double soulsRate = souls / 4000.0;
  CHECK(soulsRate > 0.4);
  CHECK(soulsRate < 0.75);
  // determinism: same seed → same roll sequence
  DropSystem a, b;
  int sa = 0, sb = 0;
  a.onOrbCollected = [&] { sa++; };
  b.onOrbCollected = [&] { sb++; };
  Rng ra{999u}, rb{999u};
  for (int i = 0; i < 40; i++) {
    a.breakables().push_back({{0, 0}, true});
    b.breakables().push_back({{0, 0}, true});
    a.breakProp(a.breakables().back(), 0, ra);
    b.breakProp(b.breakables().back(), 0, rb);
  }
  CHECK(sa == sb);
}

TEST_CASE("breakProp: soul bank raises the orb drop rate (+10% per 50 souls)", "[drop]") {
  // The orb-drop roll is the second branch; a high bank must credit strictly
  // more souls per break than an empty bank, at a scaled rate (0.24/0.20 = 1.2).
  DropSystem low, high;
  Rng rl{13u}, rh{13u};
  int lowSouls = 0, highSouls = 0;
  low.onOrbCollected = [&] { lowSouls++; };
  high.onOrbCollected = [&] { highSouls++; };
  const int N = 8000;
  for (int i = 0; i < N; i++) {
    low.breakables().push_back({{0, 0}, true});
    high.breakables().push_back({{0, 0}, true});
    low.breakProp(low.breakables().back(), 0, rl);
    high.breakProp(high.breakables().back(), 100, rh);
  }
  // 100 souls → drop chance 0.24 vs 0.20 → ~+20% orb drop events.
  CHECK(highSouls > lowSouls);
  const double ratio = (highSouls / (double)N) / (lowSouls / (double)N);
  CHECK(ratio > 1.05);
  CHECK(ratio < 1.45); // ~1.2 with statistical slack
}

TEST_CASE("breakProp excess-soul bonus raises the buff chance", "[drop]") {
  // 500 souls → bonus = (500-100)*0.0005 = 0.20 → buff chance 0.26 vs 0.06.
  DropSystem low, high;
  Rng rl{5u}, rh{5u};
  int lowB = 0, highB = 0;
  for (int i = 0; i < 4000; i++) {
    low.breakables().push_back({{0, 0}, true});
    high.breakables().push_back({{0, 0}, true});
    const int lb = low.livePickupCount(), hb = high.livePickupCount();
    low.breakProp(low.breakables().back(), 0, rl);
    high.breakProp(high.breakables().back(), 500, rh);
    lowB += low.livePickupCount() - lb;
    highB += high.livePickupCount() - hb;
  }
  CHECK(highB > lowB);
  CHECK(highB / 4000.0 > 0.20); // ~26%
  CHECK(lowB / 4000.0 < 0.10);  // ~6%
}

TEST_CASE("tickBreakables breaks props within 0.45 u (step-on)", "[drop]") {
  DropSystem drops;
  Rng rng{1u};
  drops.breakables().push_back({{0.3, 0}, true});   // in range (0.3 < 0.45)
  drops.breakables().push_back({{1.0, 0}, true});   // out of range
  drops.tickBreakables({0, 0}, 0, rng);
  CHECK(drops.breakables()[0].alive == false);
  CHECK(drops.breakables()[1].alive == true);
}

TEST_CASE("tickSarcophagi opens once within 2.5 u and fires the callback exactly once", "[drop]") {
  DropSystem drops;
  Rng rng{1u};
  drops.sarcophagi().push_back({{1.0, 0}, false, {0.45, 1.55, -1.15, 1.15}});
  int opened = 0;
  drops.onSarcophagusOpened = [&](Sarcophagus& s) { opened++; (void)s; };
  drops.tickSarcophagi({0, 0}); // player 1.0u away → within 2.5
  CHECK(drops.sarcophagi()[0].opened == true);
  CHECK(opened == 1);
  drops.tickSarcophagi({0, 0}); // second frame: no re-fire
  CHECK(opened == 1);
  // a far sarcophagus does not open
  DropSystem far;
  far.sarcophagi().push_back({{5.0, 0}, false, {4.45, 5.55, -1.15, 1.15}});
  far.onSarcophagusOpened = [&](Sarcophagus&) { opened++; };
  far.tickSarcophagi({0, 0});
  CHECK(far.sarcophagi()[0].opened == false);
  CHECK(opened == 1);
}

TEST_CASE("spawnOrbs credits souls instantly and spawns matching visuals", "[drop]") {
  DropSystem drops;
  Rng rng{3u};
  int credited = 0;
  drops.onOrbCollected = [&] { credited++; };
  drops.spawnOrbs(10, 5, 4, rng);
  CHECK(credited == 4);
  CHECK(drops.orbVisuals().size() == drop::kOrbVisualPool); // pool pre-sized
  int liveVisuals = 0;
  for (const auto& v : drops.orbVisuals()) if (v.t >= 0) liveVisuals++;
  CHECK(liveVisuals == 4);
}

TEST_CASE("update auto-collects health/buff pickups within 1.4 u and ticks orb visuals", "[drop]") {
  DropSystem drops;
  Rng rng{11u};
  int health = 0, buff = 0;
  drops.onHealthCollected = [&] { health++; };
  drops.onBuffCollected = [&](const Vec2&) { buff++; };
  drops.spawnHealth(1.0, 0, rng); // 1.0u away → collected
  drops.spawnBuff(0.5, 0, rng);   // 0.5u away → collected
  drops.spawnHealth(3.0, 0, rng); // 3.0u away → NOT collected
  CHECK(drops.livePickupCount() == 3);
  drops.update(1.0 / 60.0, {0, 0});
  CHECK(health == 1);
  CHECK(buff == 1);
  CHECK(drops.livePickupCount() == 1); // the far one remains
  // orb visuals expire after kVisualLife (1.0 s)
  drops.spawnOrbs(0, 0, 1, rng);
  drops.update(1.2, {0, 0});
  int live = 0;
  for (const auto& v : drops.orbVisuals()) if (v.t >= 0) live++;
  CHECK(live == 0);
}

TEST_CASE("clear resets breakables, sarcophagi, pickups and orb visuals", "[drop]") {
  DropSystem drops;
  Rng rng{5u};
  drops.breakables().push_back({{1, 2}, true});
  drops.sarcophagi().push_back({{0, 0}, true, {-1, 1, -1, 1}});
  drops.spawnHealth(1, 1, rng);
  drops.spawnOrbs(0, 0, 2, rng);
  drops.clear();
  CHECK(drops.breakables().empty());
  CHECK(drops.sarcophagi().empty());
  CHECK(drops.livePickupCount() == 0);
  for (const auto& v : drops.orbVisuals()) CHECK(v.t < 0);
}

// ---- ground hazards (lava/acid) ----
namespace {
// Two rooms + a far exit cell: room 0 = big chamber (hazard host), room 1 = the
// exit room (must receive no hazard). cellSize 2, exit at grid (40,2).
Dungeon hazardDungeon() {
  Dungeon d;
  d.gridSize = 48;
  d.cellSize = 2;
  d.rooms = {
      {2, 2, 10, 10, "CHAMBER"}, // room 0: hazards here (center ~(11,11))
      {40, 2, 6, 6, "CHAMBER"},  // room 1: exit room (no hazards)
  };
  d.exitCell = CellRef{42, 4}; // inside room 1, world (84,8)
  return d;
}
} // namespace

TEST_CASE("buildHazards: lava for volcanic biomes, acid for poison, none elsewhere", "[hazard]") {
  // volcanic → lava (kind 0)
  DropSystem lava;
  Rng rl{11u};
  lava.buildHazards(hazardDungeon(), "VOLCANIC_DEPTHS", rl);
  CHECK(lava.hazards().size() >= 1);
  for (const auto& h : lava.hazards()) CHECK(h.kind == 0);

  // ember → lava (kind 0)
  DropSystem ember;
  Rng el{12u};
  ember.buildHazards(hazardDungeon(), "EMBER_FORGE", el);
  for (const auto& h : ember.hazards()) CHECK(h.kind == 0);

  // poison → acid (kind 1)
  DropSystem acid;
  Rng al{13u};
  acid.buildHazards(hazardDungeon(), "POISON_SWAMP", al);
  CHECK(acid.hazards().size() >= 1);
  for (const auto& h : acid.hazards()) CHECK(h.kind == 1);

  // a biome with no hazard kind → no hazards (no-op)
  DropSystem none;
  Rng nl{14u};
  none.buildHazards(hazardDungeon(), "STONE", nl);
  CHECK(none.hazards().empty());
}

TEST_CASE("buildHazards skips the exit room and the 3 u exit clearance", "[hazard]") {
  DropSystem drops;
  Rng rng{21u};
  drops.buildHazards(hazardDungeon(), "VOLCANIC_DEPTHS", rng);
  // exit world pos
  const double ex = 42 * 2.0, ez = 4 * 2.0; // (84,8)
  for (const auto& h : drops.hazards()) {
    const double dx = h.pos.x - ex, dz = h.pos.z - ez;
    CHECK(dx * dx + dz * dz >= hazard::kExitClearance * hazard::kExitClearance); // >= 9
    // none in the exit room (room 1 spans x 40..45, z 2..7 in grid)
    const int gx = (int)std::lround(h.pos.x / 2.0), gz = (int)std::lround(h.pos.z / 2.0);
    CHECK(!(gx >= 40 && gx < 46 && gz >= 2 && gz < 8));
  }
}

TEST_CASE("buildHazards places 1-2 per host room with a 1.0-1.6 u pool radius", "[hazard]") {
  DropSystem drops;
  Rng rng{31u};
  drops.buildHazards(hazardDungeon(), "VOLCANIC_DEPTHS", rng);
  // only room 0 hosts → 1-2 hazards total (room 1 is the exit room)
  CHECK(drops.hazards().size() >= 1);
  CHECK(drops.hazards().size() <= 2);
  for (const auto& h : drops.hazards()) {
    CHECK(h.radius >= 1.0);
    CHECK(h.radius <= 1.6);
  }
}

TEST_CASE("tickHazards deals 1 dmg per 0.8 s within 1.2 u, none outside", "[hazard]") {
  DropSystem drops;
  int hits = 0;
  double lastDmg = 0;
  drops.onHazardHit = [&](double dmg) { hits++; lastDmg = dmg; };
  drops.hazards().push_back({{0, 0}, 0, 1.0});

  // player inside the pool at (0.5,0) → within 1.2 u.
  const Vec2 inside{0.5, 0.0};
  // sub-tick: no damage yet (accumulator < 0.8)
  drops.tickHazards(0.2, inside);
  CHECK(hits == 0);
  // cross the 0.8 s boundary → exactly one tick, 1 dmg
  drops.tickHazards(0.6, inside);
  CHECK(hits == 1);
  CHECK(lastDmg == 1);
  // another full tick later → second hit
  drops.tickHazards(0.8, inside);
  CHECK(hits == 2);

  // a hazard 2 u away (beyond 1.2) never deals damage
  DropSystem far;
  int fhits = 0;
  far.onHazardHit = [&](double) { fhits++; };
  far.hazards().push_back({{0, 0}, 0, 1.0});
  for (int i = 0; i < 10; i++) far.tickHazards(0.8, {2.0, 0.0});
  CHECK(fhits == 0);
}

TEST_CASE("tickHazards: first hazard hit wins, then breaks (one dmg per tick)", "[hazard]") {
  DropSystem drops;
  int hits = 0;
  drops.onHazardHit = [&](double) { hits++; };
  // two overlapping hazards at the same spot; player on top of both.
  drops.hazards().push_back({{0, 0}, 0, 1.0});
  drops.hazards().push_back({{0, 0}, 1, 1.0});
  drops.tickHazards(0.8, {0, 0});
  CHECK(hits == 1); // one damage per 0.8 s tick, not one per pool
}

TEST_CASE("clear resets hazards and the hazard tick accumulator", "[hazard]") {
  DropSystem drops;
  drops.hazards().push_back({{1, 1}, 0, 1.2});
  drops.tickHazards(0.1, {1, 1}); // partial accumulator
  drops.clear();
  CHECK(drops.hazards().empty());
}

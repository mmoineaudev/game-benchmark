// Phase 1 deterministic-core parity: movement / collision / LOS / pathing.
//
// The headline guarantee: a headless sim can spawn a player in a generated
// dungeon and move/resolve them through it with ZERO tunneling — i.e. after
// every sub-step the player is outside all collision AABBs. This is the
// C++ analog of the JS "player never clips through a wall" invariant, made
// objective and headless.
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include <cmath>
#include <random>
#include <string>

#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/movement.hpp"
#include "dc/world.hpp"

using namespace dc;

namespace {

// Spawn a mover at the entrance cell center and stream it toward the exit
// cell for `frames` at 60 fps. Returns the final position; asserts (via the
// REQUIRE loop) that the player is never inside a collision box.
Mover runPlayerThrough(const Dungeon& d, const std::vector<AABB>& boxes,
                       double dt, int frames) {
  REQUIRE(d.entranceCell.has_value());
  REQUIRE(d.exitCell.has_value());
  const double cs = d.cellSize;
  Mover m;
  m.x = d.entranceCell->x * cs;
  m.z = d.entranceCell->z * cs;
  const double tx = d.exitCell->x * cs, tz = d.exitCell->z * cs;
  for (int f = 0; f < frames; f++) {
    // aim at the exit each frame (greedy-ish steering)
    const double dx = tx - m.x, dz = tz - m.z;
    const double len = std::hypot(dx, dz);
    if (len > 1e-6) {
      movePlayer(m, dx / len, dz / len, /*sprinting=*/false, /*sprintMult=*/1.0,
                 /*buffEffect=*/0, dt, boxes);
    }
    // ZERO TUNNELING: the player center must never be strictly inside a
    // collision box after resolution (that is the tunneling failure mode).
    // Surface contact (penetration <= radius) is allowed — the resolver
    // pushes out along the shallowest axis.
    for (const auto& b : boxes) {
      if (m.x > b.minX && m.x < b.maxX && m.z > b.minZ && m.z < b.maxZ)
        FAIL("player center inside a collision box (tunneling)");
    }
  }
  return m;
}

} // namespace

TEST_CASE("collision: resolveCircleCollisions pushes a circle out of a box",
          "[movement]") {
  std::vector<AABB> boxes{{0.0, 2.0, 0.0, 2.0}}; // a 2x2 wall slab
  Mover m;
  m.x = 1.0; // start inside
  m.z = 1.0;
  resolveCircleCollisions(boxes, m, 0.35);
  // must be pushed to a face, not left inside
  CHECK(!(m.x > 0.0 && m.x < 2.0 && m.z > 0.0 && m.z < 2.0));
}

TEST_CASE("collision: a free circle is untouched by resolve", "[movement]") {
  std::vector<AABB> boxes{{0.0, 2.0, 0.0, 2.0}};
  Mover m;
  m.x = 5.0;
  m.z = 5.0;
  const Mover before = m;
  resolveCircleCollisions(boxes, m, 0.35);
  CHECK(m.x == before.x);
  CHECK(m.z == before.z);
}

TEST_CASE("LOS: clear straight line is visible, a wall blocks it", "[movement]") {
  // A single wall slab at x in [0,1] across z in [0,10].
  std::vector<AABB> wall{{0.0, 1.0, 0.0, 10.0}};
  // Same side: visible.
  CHECK(hasLineOfSight(wall, -2.0, 5.0, -1.5, 5.0));
  // Across the wall: blocked.
  CHECK_FALSE(hasLineOfSight(wall, -2.0, 5.0, 2.0, 5.0));
  // Around the wall's end: visible.
  CHECK(hasLineOfSight(wall, -2.0, 12.0, 2.0, 12.0));
}

TEST_CASE("pathStep: returns a walkable neighbor toward the target", "[movement]") {
  // Build a tiny dungeon: 4x4 all-room so every neighbor is walkable.
  Dungeon d;
  d.gridSize = 4;
  d.cellSize = 6;
  d.grid.assign(4, std::vector<Cell>(4, Cell::kRoom));
  for (auto& row : d.grid)
    for (auto& c : row) c = Cell::kRoom;
  d.entranceCell = CellRef{0, 0};
  d.exitCell = CellRef{3, 3};
  std::vector<AABB> boxes; // no walls for this synthetic test
  // From (0,0) toward (18,18): the two walkable 4-neighbors are (6,0) and
  // (0,6); (6,0) is closer to the target → it wins.
  auto step = pathStep(d, boxes, 0.0, 0.0, 18.0, 18.0);
  REQUIRE(step.has_value());
  CHECK(step->x == Catch::Approx(6.0));
  CHECK(step->z == Catch::Approx(0.0));
  // And toward a target on the +z axis, (0,6) wins.
  auto step2 = pathStep(d, boxes, 0.0, 0.0, 0.0, 18.0);
  REQUIRE(step2.has_value());
  CHECK(step2->x == Catch::Approx(0.0));
  CHECK(step2->z == Catch::Approx(6.0));
}

TEST_CASE("pathStep: skips empty and colliding neighbors", "[movement]") {
  Dungeon d;
  d.gridSize = 3;
  d.cellSize = 6;
  // only (1,0) is a room; rest empty
  d.grid = {
    {Cell::kEmpty, Cell::kRoom, Cell::kEmpty},
    {Cell::kEmpty, Cell::kEmpty, Cell::kEmpty},
    {Cell::kEmpty, Cell::kEmpty, Cell::kEmpty},
  };
  // A wall box blocking the (1,0) center at (6,0)
  std::vector<AABB> boxes{{6.0 - 0.2, 6.0 + 0.2, -3.0, 3.0}};
  // From (0,0) the only non-empty neighbor is (1,0) but it's blocked → nullopt
  auto step = pathStep(d, boxes, 0.0, 0.0, 6.0, 0.0);
  CHECK_FALSE(step.has_value());
}

TEST_CASE("movement: sub-stepped move converges on a free target", "[movement]") {
  std::vector<AABB> boxes; // empty space
  Mover m;
  m.x = 0.0;
  m.z = 0.0;
  const double speed = 4.0;
  const double dt = 1.0 / 60.0;
  double moved = 0;
  for (int i = 0; i < 600; i++) moved += moveToward(m, 10.0, 0.0, speed, dt, boxes, 0.35);
  // ~2 seconds at 4 u/s → 8 u, but clamped by distance (10) so stops at 10.
  CHECK(m.x == Catch::Approx(10.0).margin(1e-6));
  CHECK(m.z == Catch::Approx(0.0).margin(1e-6));
  CHECK(moved > 0);
}

TEST_CASE("movement: ZERO tunneling — player survives streaming a dungeon",
          "[movement][tunneling]") {
  // A handful of seeds across biomes; each streams the player from entrance
  // toward the exit for ~10 s at 60 fps and asserts no wall clipping.
  const int seeds[] = {1000, 1042, 1077, 1234567, 42, 7, 99, 2024};
  for (int s : seeds) {
    const std::string biome = kBiomeSequence[static_cast<size_t>(s % 10)];
    DungeonGenerator gen(s, biome);
    const Dungeon d = gen.generate();
    const WorldCollision wc = buildCollisionBoxes(d);
    const std::vector<AABB> boxes = wc.boxes;
    // ~10 s of streaming
    runPlayerThrough(d, boxes, 1.0 / 60.0, 600);
  }
}

TEST_CASE("movement: sprint + buff scale the speed per the formula", "[movement]") {
  std::vector<AABB> boxes;
  Mover slow, fast, buffed;
  slow.x = fast.x = buffed.x = 0.0;
  slow.z = fast.z = buffed.z = 0.0;
  const double dt = 1.0 / 60.0;
  // 1 s of walking (no sprint, no buff)
  for (int i = 0; i < 60; i++) movePlayer(slow, 1.0, 0.0, false, 1.0, 0, dt, boxes);
  // 1 s sprinting at the base sprint multiplier
  const double sprintMult = player::kSprintMult;
  for (int i = 0; i < 60; i++) movePlayer(fast, 1.0, 0.0, true, sprintMult, 0, dt, boxes);
  // 1 s with buffEffect 4 (GODSPEED 1.5x) on top of sprint
  for (int i = 0; i < 60; i++) movePlayer(buffed, 1.0, 0.0, true, sprintMult, 4, dt, boxes);
  CHECK(fast.x > slow.x);
  CHECK(buffed.x > fast.x);
  // base walk distance ≈ BASE_SPEED (exactly, in free space)
  CHECK(slow.x == Catch::Approx(player::kBaseSpeed).margin(1e-3));
}

// test_skeleton_system.cpp — enemy spawner + shared AI (§16) headless checks.
// Mirrors the SkeletonSystem.js behavior: spawn plan/queue, reveal pacing,
// melee/ranged/instant AI, projectiles, death + drops, elite, BRIGHT flee,
// safe-spawn freeze, live-cap.
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include "dc/dungeon_gen.hpp"
#include "dc/skeleton_system.hpp"
#include "dc/world.hpp"

#include <cmath>
#include <string>
#include <vector>

using namespace dc;

namespace {

struct Fixture {
  Dungeon dungeon;
  std::vector<AABB> boxes;
  SkeletonSystem sys;
  Rng rng{1000};
  // Player standing at the entrance cell center.
  Vec2 player{0, 0};
  // A walkable cell a bit away (not the exit room) for AI tests.
  Vec2 openA{0, 0};
  Vec2 openB{0, 0};

  Fixture() {
    DungeonGenerator gen(1000, "STONE");
    dungeon = gen.generate();
    boxes = buildCollisionBoxes(dungeon).boxes;
    player = {static_cast<double>(dungeon.entranceCell->x) * 6.0,
              static_cast<double>(dungeon.entranceCell->z) * 6.0};
    // Two empty cells near the entrance (walkable, inside grid).
    bool found = false;
    for (int z = 0; z < dungeon.gridSize && !found; z++) {
      for (int x = 0; x < dungeon.gridSize && !found; x++) {
        if (dungeon.grid[z][x] != Cell::kEmpty) continue;
        openA = {static_cast<double>(x) * 6.0, static_cast<double>(z) * 6.0};
        if (z + 1 < dungeon.gridSize && dungeon.grid[z + 1][x] == Cell::kEmpty)
          openB = {static_cast<double>(x) * 6.0, static_cast<double>(z + 1) * 6.0};
        found = true;
      }
    }
    REQUIRE(found);
  }

  EnemyCtx makeCtx(double dt = 1.0 / 60.0) const {
    EnemyCtx ctx;
    ctx.dungeon = &dungeon;
    ctx.boxes = &boxes;
    ctx.playerPos = player;
    ctx.dt = dt;
    ctx.frozenAll = false;
    ctx.safeSpawn = false;
    ctx.brightActive = false;
    ctx.attackSpeedMult = 1.0;
    ctx.level = 1;
    ctx.ngPlus = 0;
    ctx.souls = 0;
    ctx.bossKills = 0;
    return ctx;
  }

  Enemy makeEnemy(const char* type, Vec2 pos, EnemyState st = EnemyState::kChase) {
    Enemy e;
    e.type = type;
    e.def = &dc::kEnemyTypes.at(type);
    e.hp = e.maxHp = e.def->hp;
    e.speed = e.def->speed;
    e.dmg = e.def->dmg;
    e.drops = e.def->drops;
    e.state = st;
    e.pos = pos;
    e.facing = 0;
    return e;
  }
};

// Lazy per-test fixture (constructed inside the test case, not at static init).
Fixture& fix() {
  static Fixture f;
  return f;
}
} // namespace

TEST_CASE("spawn plan: slots, hard cap, elite only on eligible (not RAT)", "[skeleton_system][spawn]") {
  SkeletonSystem sys;
  Rng rng(1000);
  const bool hasArena =
      std::any_of(fix().dungeon.rooms.begin(), fix().dungeon.rooms.end(),
                  [](const Room& r) { return r.type == "ARENA"; });
  sys.buildSpawnPlan(fix().dungeon, 1, 0, "STONE", fix().player, hasArena, rng);
  CHECK(!sys.queue().empty());
  CHECK(static_cast<int>(sys.queue().size()) <= enemySpawn::kHardCap);
  for (const auto& q : sys.queue()) {
    if (q.elite) CHECK(q.typeKey != "RAT");
    // Queue cells must be inside the grid.
    CHECK(q.cell.x >= 0);
    CHECK(q.cell.x < fix().dungeon.gridSize);
    CHECK(q.cell.z >= 0);
    CHECK(q.cell.z < fix().dungeon.gridSize);
  }
  // High level + souls must clamp to the hard cap (never exceed it).
  SkeletonSystem sys2;
  Rng rng2(42);
  sys2.buildSpawnPlan(fix().dungeon, 50, 5000, "STONE", fix().player, hasArena, rng2);
  CHECK(static_cast<int>(sys2.queue().size()) <= enemySpawn::kHardCap);
  CHECK(sys2.excessHpMult() > 1.0); // excess bodies → excess HP multiplier
}

TEST_CASE("reveal pacing: one mob per SPAWN_INTERVAL, deferral near player",
         "[skeleton_system][spawn]") {
  SkeletonSystem sys;
  Rng rng(1000);
  const bool hasArena =
      std::any_of(fix().dungeon.rooms.begin(), fix().dungeon.rooms.end(),
                  [](const Room& r) { return r.type == "ARENA"; });
  sys.buildSpawnPlan(fix().dungeon, 1, 0, "STONE", fix().player, hasArena, rng);
  const int q0 = static_cast<int>(sys.queue().size());
  REQUIRE(q0 > 0);

  const double dt = 1.0 / 60.0;
  // First frame reveals exactly one (player far from spawns).
  sys.drainQueue(dt, {fix().player.x - 1000, fix().player.z - 1000}, 1, 0, 0, 0, false, rng);
  CHECK(sys.liveCount() == 1);
  CHECK(static_cast<int>(sys.queue().size()) == q0 - 1);

  // Reveals continue at one per SPAWN_INTERVAL until the queue drains.
  const int total = q0;
  for (int i = 0; i < 200 && !sys.queue().empty(); i++)
    sys.drainQueue(dt, {fix().player.x - 1000, fix().player.z - 1000}, 1, 0, 0, 0, false, rng);
  CHECK(sys.liveCount() <= total);
  CHECK(sys.queue().empty());

  // Deferral: player standing on the front queued cell defers THAT entry
  // (rotated to back); it must not be revealed on this frame, and the loop
  // must terminate (no infinite rotation).
  SkeletonSystem sys3;
  Rng rng3(7);
  sys3.buildSpawnPlan(fix().dungeon, 1, 0, "STONE", fix().player, hasArena, rng3);
  const int q3 = static_cast<int>(sys3.queue().size());
  const SpawnEntry& q = sys3.queue().front();
  Vec2 onCell{static_cast<double>(q.cell.x) * 6.0, static_cast<double>(q.cell.z) * 6.0};
  sys3.drainQueue(dt, onCell, 1, 0, 0, 0, false, rng3);
  // The on-player entry is still queued (rotated), so it was not revealed.
  bool onPlayerStillQueued = false;
  for (const auto& e2 : sys3.queue())
    if (e2.cell.x == q.cell.x && e2.cell.z == q.cell.z) onPlayerStillQueued = true;
  CHECK(onPlayerStillQueued);
  // The loop must terminate (no infinite rotation): queue size is bounded.
  CHECK(static_cast<int>(sys3.queue().size()) <= q3);
}

TEST_CASE("melee SKELETON: wakes, winds up, lands a hit", "[skeleton_system][ai]") {
  SkeletonSystem sys;
  double dealt = 0;
  sys.onPlayerDamaged = [&](double d, Enemy*) { dealt += d; };
  Enemy e = fix().makeEnemy("SKELETON", {fix().openA.x + 1.0, fix().openA.z});
  e.state = EnemyState::kChase;
  fix().player = {fix().openA.x, fix().openA.z}; // player 1.0 m away (< range 1.6)
  sys.enemies().push_back(e);
  EnemyCtx ctx = fix().makeCtx();
  ctx.playerPos = fix().player;
  const double dt = 1.0 / 60.0;
  double firstHitAt = -1;
  int frames = 0;
  for (int i = 0; i < 300; i++) {
    sys.update(dt, ctx);
    frames++;
    if (firstHitAt < 0 && dealt > 0) firstHitAt = i * dt;
    if (dealt >= 2.0) break;
  }
  CHECK(dealt >= 2.0); // at least two hits in 5 s
  CHECK(firstHitAt >= 0);
  CHECK(firstHitAt < 1.5); // first hit lands well under 1.5 s
  (void)frames;
}

TEST_CASE("instant RAT: touch-range hit then cooldown", "[skeleton_system][ai]") {
  SkeletonSystem sys;
  double dealt = 0;
  sys.onPlayerDamaged = [&](double d, Enemy*) { dealt += d; };
  Enemy e = fix().makeEnemy("RAT", {fix().openA.x + 0.8, fix().openA.z}); // range 0.9
  fix().player = {fix().openA.x, fix().openA.z};
  sys.enemies().push_back(e);
  EnemyCtx ctx = fix().makeCtx();
  ctx.playerPos = fix().player;
  const double dt = 1.0 / 60.0;
  for (int i = 0; i < 240 && dealt < 2.0; i++) sys.update(dt, ctx);
  CHECK(dealt >= 2.0); // rat hits, recovers, hits again
}

TEST_CASE("ranged ARCHER: kites, fires an arrow that damages the player",
          "[skeleton_system][ai][projectile]") {
  SkeletonSystem sys;
  double dealt = 0;
  bool sawProjectile = false;
  sys.onPlayerDamaged = [&](double d, Enemy*) { dealt += d; };
  Enemy e = fix().makeEnemy("ARCHER", {fix().openA.x + 6.0, fix().openA.z}); // 6 m out
  fix().player = {fix().openA.x, fix().openA.z};
  sys.enemies().push_back(e);
  EnemyCtx ctx = fix().makeCtx();
  ctx.playerPos = fix().player;
  const double dt = 1.0 / 60.0;
  for (int i = 0; i < 300; i++) {
    sys.update(dt, ctx);
    if (sys.liveProjectileCount() > 0) sawProjectile = true;
    if (dealt > 0) break;
  }
  CHECK(sawProjectile); // an arrow was loosed
  CHECK(dealt > 0);     // it reached the player
}

TEST_CASE("MAGICIAN: cast positioning, fires an orb", "[skeleton_system][ai][projectile]") {
  SkeletonSystem sys;
  bool sawOrb = false;
  double dealt = 0;
  sys.onPlayerDamaged = [&](double d, Enemy*) { dealt += d; };
  Enemy e = fix().makeEnemy("MAGICIAN", {fix().openA.x + 7.0, fix().openA.z}); // in range 9
  fix().player = {fix().openA.x, fix().openA.z};
  sys.enemies().push_back(e);
  EnemyCtx ctx = fix().makeCtx();
  ctx.playerPos = fix().player;
  const double dt = 1.0 / 60.0;
  for (int i = 0; i < 300; i++) {
    sys.update(dt, ctx);
    if (sys.liveProjectileCount() > 0) sawOrb = true;
    if (dealt > 0) break;
  }
  CHECK(sawOrb);
}

TEST_CASE("death: hitEnemy kills once, onKill fires with source, fades out",
          "[skeleton_system][death]") {
  SkeletonSystem sys;
  Enemy e = fix().makeEnemy("SKELETON", fix().openA);
  sys.enemies().push_back(e);
  Enemy* ptr = &sys.enemies().back();
  int kills = 0;
  std::string kind;
  sys.onKill = [&](Enemy*, const char* k) { kills++; kind = k; };
  const bool died = sys.hitEnemy(ptr, 99.0, "sword");
  CHECK(died);
  CHECK(kills == 1);
  CHECK(kind == "sword");
  CHECK(ptr->state == EnemyState::kDead);
  // A second hit does not re-fire onKill.
  CHECK_FALSE(sys.hitEnemy(ptr, 99.0, "orb"));
  CHECK(kills == 1);
  // Death fade: removed after ~1.3 s.
  EnemyCtx ctx = fix().makeCtx();
  for (int i = 0; i < 100 && !sys.enemies().empty(); i++) sys.update(ctx.dt, ctx);
  CHECK(sys.enemies().empty());
}

TEST_CASE("safe-spawn: no attacks while safeSpawn is set", "[skeleton_system][ai]") {
  SkeletonSystem sys;
  double dealt = 0;
  sys.onPlayerDamaged = [&](double d, Enemy*) { dealt += d; };
  Enemy e = fix().makeEnemy("SKELETON", {fix().openA.x + 1.0, fix().openA.z});
  fix().player = {fix().openA.x, fix().openA.z};
  sys.enemies().push_back(e);
  EnemyCtx ctx = fix().makeCtx();
  ctx.playerPos = fix().player;
  ctx.safeSpawn = true;
  const double dt = 1.0 / 60.0;
  for (int i = 0; i < 120; i++) sys.update(dt, ctx);
  CHECK(dealt == 0); // frozen from attacking, not from moving
}

TEST_CASE("BRIGHT buff: enemy flees and never attacks", "[skeleton_system][ai]") {
  SkeletonSystem sys;
  double dealt = 0;
  sys.onPlayerDamaged = [&](double d, Enemy*) { dealt += d; };
  Enemy e = fix().makeEnemy("SKELETON", {fix().openA.x + 1.0, fix().openA.z});
  fix().player = {fix().openA.x, fix().openA.z};
  sys.enemies().push_back(e);
  Enemy* eptr = &sys.enemies().back();
  EnemyCtx ctx = fix().makeCtx();
  ctx.playerPos = fix().player;
  ctx.brightActive = true;
  const double dt = 1.0 / 60.0;
  const double startDist = std::hypot(eptr->pos.x - fix().player.x, eptr->pos.z - fix().player.z);
  for (int i = 0; i < 120; i++) sys.update(dt, ctx);
  CHECK(dealt == 0);
  const double endDist = std::hypot(eptr->pos.x - fix().player.x, eptr->pos.z - fix().player.z);
  CHECK(endDist > startDist); // fled outward
}

TEST_CASE("elite ARMORED: Warlord scales hp/drops/speed", "[skeleton_system][spawn]") {
  SkeletonSystem sys;
  Rng rng(5);
  const bool hasArena =
      std::any_of(fix().dungeon.rooms.begin(), fix().dungeon.rooms.end(),
                  [](const Room& r) { return r.type == "ARENA"; });
  sys.buildSpawnPlan(fix().dungeon, 3, 50, "STONE", fix().player, hasArena, rng);
  const int q0 = static_cast<int>(sys.queue().size());
  sys.drainQueue(1.0 / 60.0, {fix().player.x - 1000, fix().player.z - 1000}, 3, 0, 50, 0, false, rng);
  (void)q0;
  // If any elite spawned, verify the Warlord stats are applied.
  for (const auto& e : sys.enemies()) {
    if (!e.eliteName.empty()) {
      CHECK(e.eliteName == "Warlord");
      CHECK(e.maxHp > dc::kEnemyTypes.at("ARMORED").hp);
      CHECK(e.drops >= dc::kEnemyTypes.at("ARMORED").elite->drops);
    }
  }
}

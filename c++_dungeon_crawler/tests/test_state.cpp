// Phase 1: GameState save/load schema + Leaderboard parity (ports of
// core/GameState.js + core/Leaderboard.js).
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>

#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <string>

#include "dc/leaderboard.hpp"
#include "dc/state.hpp"

using namespace dc;

TEST_CASE("state: defaults mirror GameState.js constructor", "[state]") {
  GameState s = GameState::fromOpts();
  CHECK(s.collectedOrbs == 0);
  CHECK(s.weaponTier == 0); // weaponTier(0)
  CHECK(s.ngPlus == 0);
  CHECK(s.bossKills == 0);
  CHECK(s.health == 3); // MAX_HEALTH_BASE
  CHECK(s.maxHealth == 3);
  CHECK(s.level == 1);
  CHECK(s.biome == "STONE");
  CHECK(s.buffEffect == 0);
  CHECK(s.sprintTier == 0);
  CHECK(s.effectsEnabled);
  CHECK_FALSE(s.inExitRoom);
  CHECK(s.player.y == Catch::Approx(1.6));
}

TEST_CASE("state: maxHealth self-heals to base + bossKills", "[state]") {
  // bossKills=2 → healedMax = 3 + 2 = 5; a stale maxHealth below that is raised.
  GameState s = GameState::fromOpts(/*collectedOrbs=*/50, /*weaponTier=*/-1,
                                    /*ngPlus=*/0, /*bossKills=*/2,
                                    /*maxHealth=*/3);
  CHECK(s.maxHealth == 5);
  CHECK(s.health == 3); // health stays as given (only maxHealth heals)
  // weaponTier recomputed from the bank when -1 (NG+/load path)
  CHECK(s.weaponTier == 1);
}

TEST_CASE("state: sprint tiers accrue per SPRINT_ACCEL_WINDOW", "[state]") {
  GameState s = GameState::fromOpts();
  // 2.5 s of held sprint + moving → one tier at 1.0 s, still holding at 2.5.
  for (int i = 0; i < 150; i++)
    s.updateSprint(1.0 / 60.0, /*sprinting=*/true, /*moving=*/true,
                   /*safeSpawnActive=*/false);
  CHECK(s.sprintTier == 2); // floor(2.5 / 1.0)
  CHECK(s.sprintSpeedMult() ==
        Catch::Approx(1.55 * (1 + 0.05 * 2))); // 1.55 * 1.10
  // releasing resets the ladder
  s.updateSprint(1.0 / 60.0, /*sprinting=*/false, /*moving=*/true,
                /*safeSpawnActive=*/false);
  CHECK(s.sprintTier == 0);
  CHECK(s.sprintHoldTime == 0.0);
  // safe-spawn freezes the ladder
  s.updateSprint(1.0, /*sprinting=*/true, /*moving=*/true,
                 /*safeSpawnActive=*/true);
  CHECK(s.sprintTier == 0);
}

TEST_CASE("state: buff ticks down and expires exactly once", "[state]") {
  GameState s = GameState::fromOpts();
  s.applyBuff(4, 1.0); // GODSPEED, 1 s
  CHECK(s.buffEffect == 4);
  CHECK(s.buffTime == Catch::Approx(1.0));
  CHECK_FALSE(s.updateBuff(0.9));
  CHECK(s.buffEffect == 4);
  CHECK(s.updateBuff(0.1)); // expires this frame → true
  CHECK(s.buffEffect == 0);
  CHECK_FALSE(s.updateBuff(0.5)); // no buff → false
}

TEST_CASE("state: save → load round-trips the schema, load restarts full",
          "[state]") {
  GameState s = GameState::fromOpts(/*collectedOrbs=*/250, /*weaponTier=*/-1,
                                    /*ngPlus=*/1, /*bossKills=*/2,
                                    /*maxHealth=*/5, /*runTime=*/123.5,
                                    /*level=*/7);
  s.health = 3;
  const GameState::Save save = s.toSave();

  CHECK(save.level == 7);
  CHECK(save.runTime == Catch::Approx(123.5));
  CHECK(save.collectedOrbs == 250);
  CHECK(save.weaponTier == 3); // weaponTier(250): crosses 50/100/200
  CHECK(save.maxHealth == 5);
  CHECK(save.ngPlus == 1);
  CHECK(save.bossKills == 2);
  CHECK(save.health == 3);

  const auto loaded = GameState::fromSave(save);
  REQUIRE(loaded.has_value());
  CHECK(loaded->level == 7);
  CHECK(loaded->collectedOrbs == 250);
  CHECK(loaded->weaponTier == 3);
  CHECK(loaded->maxHealth == 5);
  CHECK(loaded->ngPlus == 1);
  CHECK(loaded->bossKills == 2);
  CHECK(loaded->health == 5); // loading restarts the level fresh & full
}

TEST_CASE("state: load clamps like fromJSON", "[state]") {
  GameState::Save s;
  s.level = 0; // → 1
  s.runTime = 0;
  s.collectedOrbs = -5; // → 0
  s.weaponTier = 99; // → clamped to 5
  s.maxHealth = -1; // → MAX_HEALTH_BASE (3)
  s.ngPlus = -1; // → 0
  s.bossKills = -1; // → 0
  s.health = 0;
  const auto loaded = GameState::fromSave(s);
  REQUIRE(loaded.has_value());
  CHECK(loaded->level == 1);
  CHECK(loaded->collectedOrbs == 0);
  CHECK(loaded->weaponTier == 5);
  CHECK(loaded->maxHealth == 3);
  CHECK(loaded->ngPlus == 0);
  CHECK(loaded->bossKills == 0);
  CHECK(loaded->health == 3);
}

TEST_CASE("leaderboard: ranking NG+ desc → level desc → time asc → orbs desc",
          "[leaderboard]") {
  auto mk = [](int ng, int lvl, double t, int orbs) {
    return ScoreEntry{ng, lvl, t, orbs, 0};
  };
  const ScoreEntry a = mk(1, 5, 100.0, 10);
  const ScoreEntry b = mk(0, 9, 50.0, 100);
  const ScoreEntry c = mk(1, 3, 200.0, 50);
  // a beats c (same NG+, higher level); c beats b (NG+ wins over level)
  CHECK(Leaderboard::compare(a, c) < 0); // a ranks above c
  CHECK(Leaderboard::compare(c, b) < 0); // c ranks above b
  CHECK(Leaderboard::compare(a, b) < 0); // a ranks above b
  // time asc within same NG+/level
  const ScoreEntry d = mk(1, 5, 80.0, 0);
  CHECK(Leaderboard::compare(d, a) < 0); // faster time ranks above
  // orbs desc as the final tie-break
  const ScoreEntry e = mk(1, 5, 100.0, 5);
  CHECK(Leaderboard::compare(a, e) < 0);
}

TEST_CASE("leaderboard: submit trims to top 10 and persists + reloads",
          "[leaderboard]") {
  const std::string path = std::string("/tmp/dc_lb_test_") +
                           std::to_string(::getpid()) + ".json";
  {
    Leaderboard lb(path);
    for (int i = 0; i < 15; i++) {
      // 15 distinct entries; higher level should rank above lower
      ScoreEntry e;
      e.ngPlus = 0;
      e.level = i; // 0..14
      e.time = static_cast<double>(100 - i);
      e.orbs = i * 10;
      e.date = static_cast<std::int64_t>(i);
      lb.submit(e);
    }
    auto top = lb.top();
    CHECK(top.size() == 10);
    // best = highest level (14)
    CHECK(top.front().level == 14);
    // rankOf matches identity (level 14 → time 100-14=86, orbs 14*10=140)
    ScoreEntry q;
    q.ngPlus = 0; q.level = 14; q.time = 86.0; q.orbs = 140; q.date = 14;
    CHECK(lb.rankOf(q) == 1);
  }
  // reload from disk
  {
    Leaderboard lb2(path);
    CHECK(lb2.entries().size() == 10);
    CHECK(lb2.top().front().level == 14);
  }
  std::remove(path.c_str());
}

TEST_CASE("leaderboard: empty store round-trips", "[leaderboard]") {
  const std::string path = std::string("/tmp/dc_lb_empty_") +
                           std::to_string(::getpid()) + ".json";
  Leaderboard lb(path);
  CHECK(lb.entries().empty());
  auto top = lb.top();
  CHECK(top.empty());
  std::remove(path.c_str());
}

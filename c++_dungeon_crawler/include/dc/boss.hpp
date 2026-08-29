// dc/boss.hpp — the Spectral Lord aggro state machine (§17), headless.
// Port of entities/enemies/GhostBoss.js (state) + SkeletonSystem._updateBoss /
// _moveBoss / hitBoss / smoke / summon. Pure, deterministic, NO GPU — driven
// by the headless sim so the Phase 2 `boss_aggro_check` gate runs without a
// browser.
//
// States: SLEEPING → CHASE → CHARGING → CHASE → BLINKING → CHASE … → DEAD.
//   * SLEEPING: dormant on the throne until it SEES the player (LOS within
//     AGGRO_RANGE). No drift/charge/blink/smoke/summons before that.
//   * CHASE: drift toward the player (pathing when a wall blocks); charge when
//     off cooldown, within CHARGE_RANGE, wall-free; blink after cooldown.
//   * CHARGING: dash along a locked direction; one contact hit; returns to CHASE.
//   * BLINKING: frozen telegraph, then a nova (BLINK_RADIUS/BLINK_DMG) at its
//     feet; returns to CHASE.
//   * SMOKE: fires alongside other attacks (doesn't change state).
//
// Damage to the player is applied through the BossCtx.playerHealth pointer
// (mutated in place) and tallied in playerDamageDealt, so the headless check
// can assert "the boss's attacks actually damage the player."
#pragma once
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "dc/collision.hpp"
#include "dc/constants.hpp"
#include "dc/dungeon_gen.hpp"
#include "dc/movement.hpp"
#include "dc/rng.hpp"
#include "dc/world.hpp"

namespace dc {

// A smoke cloud: flies from where it was fired to the player's position at
// fire-time, then lingers and ticks damage while the player is inside.
struct SmokeCloud {
  Vec2 start;
  Vec2 target;
  Vec2 pos;
  double flight = 0;
  double linger = 0;
  double tickAcc = 0;
};

// Per-frame inputs the boss needs (mirrors the JS `ctx`).
struct BossCtx {
  const Dungeon* dungeon = nullptr;
  const std::vector<AABB>* boxes = nullptr;
  Vec2 playerPos{0, 0};
  double playerMaxHealth = 3;
  int level = 7;
  int ngPlus = 0;
  double souls = 0;
  int bossKills = 0;
  bool frozenAll = false;
  Rng* rng = nullptr;          // deterministic minion-summon rolls
  double* playerHealth = nullptr; // mutated by boss damage (may be null)
};

class Boss {
public:
  // Spawn the lord at `cell` (the exit cell) with the level-7 HP contract.
  static Boss spawn(const Dungeon& dungeon, int level, int ngPlus, double souls,
                    int maxHealth, const std::string& variant);

  // One fixed-step frame of _updateBoss.
  void update(double dt, const BossCtx& ctx);

  // Player → boss damage (sword/proc/shot/explosion). Returns true if the
  // boss died this call (so the caller can increment bossKills / descend).
  bool hitBoss(double damage, const char* sourceKind);

  // ---- state ----
  std::string variant;
  std::string label;
  double hp = 0, maxHp = 0;
  std::string state = "SLEEPING";
  bool awake = false;
  Vec2 pos{0, 0};
  double radius = boss::kRadius;
  double chargeCooldown = 0, blinkCooldown = 0, smokeCooldown = 0, summonTimer = 0;
  Vec2 chargeDir{0, 0};
  double chargeT = 0;
  bool chargeHitDone = false;
  double blinkT = 0;
  bool dead = false;
  bool frozen = false;
  double deadTimer = 0;
  double pathTimer = 0;
  std::optional<Vec2> pathStepPos;

  // ---- headless damage/attack tallies (for the aggro-check assertions) ----
  double playerDamageDealt = 0;
  int blinkNovaCount = 0;
  int chargeHitCount = 0;
  int smokeTickCount = 0;
  int minionsSummoned = 0;
  bool enteredCharging = false;
  bool enteredBlinking = false;

  // Boss summon hook: invoked per summon attempt (app wires it to
  // SkeletonSystem::summonMinion so the wraiths are real, projectile-firing
  // enemies). Return true when a wraith was actually spawned (false when
  // capped at MAX_MINIONS); `minionsSummoned` tallies successful spawns.
  // Leave null (headless tests) to tally-only, as in the aggro-check.
  std::function<bool(const CellRef&)> onBossSummon;

private:
  void moveBoss(double dt, double tx, double tz, const BossCtx& ctx, double speed);
  void launchSmoke(const BossCtx& ctx);
  void tickSmoke(double dt, const BossCtx& ctx);
  void summonMinions(const BossCtx& ctx);
  void damagePlayer(double amount, const BossCtx& ctx);

  std::vector<SmokeCloud> smoke_;
};

} // namespace dc

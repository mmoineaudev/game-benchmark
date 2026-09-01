// dc/boss.cpp — the Spectral Lord aggro state machine (§17), headless.
// Line-for-line port of SkeletonSystem._updateBoss / _moveBoss / hitBoss,
// the GhostBoss constructor defaults, and the smoke/summon side effects.
// NOTE: Vec2 is {x, z} (ground plane); there is no y.
#include "dc/boss.hpp"

#include <cmath>
#include <limits>

namespace dc {

Boss Boss::spawn(const Dungeon& dungeon, int level, int ngPlus, double souls,
                 int maxHealth, const std::string& variant) {
  Boss b;
  b.variant = variant;
  // 7 variant flavor labels (Skeleton/Armored/Archer/Brute/Wraith/Rat/
  // Magician → BONE LORD/IRON GHOUL/…). AI is identical across variants.
  b.label = kBossLabels.count(variant) ? kBossLabels.at(variant) : "SPECTRAL LORD";
  const double hp = static_cast<double>(bossHp(level, ngPlus, souls, maxHealth));
  b.hp = hp;
  b.maxHp = hp;
  b.state = "SLEEPING";
  b.awake = false;
  const double cs = dungeon.cellSize > 0 ? dungeon.cellSize : world::kCellSize;
  b.pos = {static_cast<double>(dungeon.exitCell->x) * cs,
           static_cast<double>(dungeon.exitCell->z) * cs};
  b.radius = boss::kRadius;
  b.chargeCooldown = boss::kChargeCooldown * boss::kChargeFirstMult;
  b.blinkCooldown = boss::kBlinkCooldown * boss::kBlinkFirstMult;
  b.smokeCooldown = boss::kSmokeCooldown * boss::kSmokeFirstMult;
  b.summonTimer = boss::kSummonInterval;
  b.chargeT = 0;
  b.chargeHitDone = false;
  b.blinkT = 0;
  b.dead = false;
  b.frozen = false;
  b.deadTimer = 0;
  b.pathTimer = 0;
  b.pathStepPos = std::nullopt;
  return b;
}

void Boss::moveBoss(double dt, double tx, double tz, const BossCtx& ctx,
                    double speed) {
  const double dx = tx - pos.x, dz = tz - pos.z;
  const double d = std::hypot(dx, dz);
  if (d < 0.05) return;
  double remaining = std::min(speed * dt, d);
  const double step = enemySpawn::kSubstep;
  while (remaining > 0) {
    const double s = std::min(step, remaining);
    remaining -= s;
    pos.x += (dx / d) * s;
    pos.z += (dz / d) * s;
    if (ctx.boxes) resolveCircleCollisions(*ctx.boxes, pos, radius);
  }
}

void Boss::damagePlayer(double amount, const BossCtx& ctx) {
  if (ctx.playerHealth) *ctx.playerHealth -= amount;
  playerDamageDealt += amount;
}

void Boss::launchSmoke(const BossCtx& ctx) {
  SmokeCloud c;
  c.start = pos;
  c.target = ctx.playerPos; // target = player position at fire-time
  c.pos = pos;
  c.flight = boss::kSmokeFlight;
  c.linger = boss::kSmokeDuration;
  c.tickAcc = 0;
  smoke_.push_back(std::move(c));
}

void Boss::tickSmoke(double dt, const BossCtx& ctx) {
  for (auto it = smoke_.begin(); it != smoke_.end();) {
    SmokeCloud& c = *it;
    if (c.flight > 0) {
      c.flight -= dt;
      const double k = 1.0 - std::max(0.0, c.flight) / boss::kSmokeFlight;
      c.pos = {c.start.x + (c.target.x - c.start.x) * k,
               c.start.z + (c.target.z - c.start.z) * k};
    } else if (c.linger > 0) {
      c.linger -= dt;
      c.tickAcc += dt;
      const double dx = ctx.playerPos.x - c.pos.x;
      const double dz = ctx.playerPos.z - c.pos.z;
      const bool inside =
          dx * dx + dz * dz < boss::kSmokeRadius * boss::kSmokeRadius;
      if (inside && c.tickAcc >= 1.0) {
        c.tickAcc = 0;
        smokeTickCount++;
        damagePlayer(boss::kSmokeDmg, ctx);
      }
      if (c.linger <= 0) {
        it = smoke_.erase(it);
        continue;
      }
    } else {
      it = smoke_.erase(it);
      continue;
    }
    ++it;
  }
}

void Boss::summonMinions(const BossCtx& ctx) {
  const double heartsExtra =
      std::max(0.0, (ctx.playerMaxHealth > 3 ? ctx.playerMaxHealth : 3.0) - 3.0);
  const int n = static_cast<int>(
      std::floor(3.0 * std::pow(boss::kSummonHeartsMult, heartsExtra)));
  // JS: summon n projectile-firing wraiths at random walkable cells (the
  // _candidateCellsCache), falling back to the boss's own cell. The summon
  // hook (app → SkeletonSystem::summonMinion) spawns the real wraiths;
  // minionsSummoned tallies successful spawns. Headless tests with no hook
  // keep the old tally-only behavior (n tallied, nothing spawned).
  if (onBossSummon) {
    // JS falls back to the boss's own cell (Math.round(pos/6)) when the
    // candidate cache is empty; we re-index the same way per attempt.
    CellRef cell{static_cast<int>(std::lround(pos.x / 6.0)),
                 static_cast<int>(std::lround(pos.z / 6.0))};
    std::vector<CellRef> walk;
    if (ctx.dungeon) {
      const int gs = ctx.dungeon->gridSize;
      walk.reserve(256);
      for (int z = 0; z < gs && z < static_cast<int>(ctx.dungeon->grid.size()); z++)
        for (int x = 0; x < gs && x < static_cast<int>(ctx.dungeon->grid[z].size()); x++)
          if (ctx.dungeon->grid[z][x] != Cell::kEmpty) walk.push_back({x, z});
    }
    for (int i = 0; i < n; i++) {
      if (!walk.empty() && ctx.rng)
        cell = walk[static_cast<size_t>(ctx.rng->nextInt(static_cast<int>(walk.size())))];
      if (onBossSummon(cell)) minionsSummoned++;
    }
  } else {
    minionsSummoned += n; // no hook (headless): tally only, as before
  }
}

bool Boss::hitBoss(double damage, const char* /*sourceKind*/, const Vec2& playerPos) {
  if (dead) return false;
  hp -= damage;
  // Small push-back on boss hit (0.20u away)
  const double dx = pos.x - playerPos.x, dz = pos.z - playerPos.z;
  const double d = std::max(0.01, std::hypot(dx, dz));
  pos.x += (dx / d) * 0.20;
  pos.z += (dz / d) * 0.20;
  if (hp <= 0) {
    hp = 0;
    state = "DEAD";
    dead = true;
    deadTimer = 0;
    return true;
  }
  return false;
}

void Boss::update(double dt, const BossCtx& ctx) {
  if (dead) return;
  if (ctx.frozenAll) return;

  const double distP =
      std::hypot(ctx.playerPos.x - pos.x, ctx.playerPos.z - pos.z);
  const bool seesLOS = (ctx.boxes && ctx.dungeon)
                           ? hasLineOfSight(*ctx.boxes, pos.x, pos.z,
                                             ctx.playerPos.x, ctx.playerPos.z)
                           : true;

  // Aggro: dormant on the throne until the lord SEES the player.
  if (!awake) {
    if (seesLOS && distP < boss::kAggroRange) {
      awake = true;
      state = "CHASE";
    }
    // dormant idle: face the player, no movement
    return;
  }

  chargeCooldown -= dt;
  blinkCooldown -= dt;
  smokeCooldown -= dt;
  summonTimer -= dt;

  if (state == "CHASE") {
    if (distP > boss::kDriftKeep) {
      if (seesLOS) {
        moveBoss(dt, ctx.playerPos.x, ctx.playerPos.z, ctx, boss::kDriftSpeed);
      } else {
        pathTimer -= dt;
        if (pathTimer <= 0 || !pathStepPos) {
          pathTimer = enemySpawn::kPathReeval;
          if (ctx.dungeon && ctx.boxes)
            pathStepPos = dc::pathStep(*ctx.dungeon, *ctx.boxes, pos.x, pos.z,
                                      ctx.playerPos.x, ctx.playerPos.z);
        }
        if (pathStepPos)
          moveBoss(dt, pathStepPos->x, pathStepPos->z, ctx, boss::kDriftSpeed);
      }
    }
    // charge: off cooldown, within CHARGE_RANGE, wall-free path
    if (chargeCooldown <= 0 && distP < boss::kChargeRange && seesLOS) {
      state = "CHARGING";
      enteredCharging = true;
      chargeT = 0;
      chargeHitDone = false;
      const double dx = ctx.playerPos.x - pos.x, dz = ctx.playerPos.z - pos.z;
      const double len = std::hypot(dx, dz);
      chargeDir = {len > 0 ? dx / len : 0, len > 0 ? dz / len : 0};
    }
  } else if (state == "CHARGING") {
    chargeT += dt;
    // dash along the locked direction, sub-stepped + collision-resolved
    const double move = std::min(boss::kChargeSpeed * dt, 1.5);
    const int steps = static_cast<int>(std::ceil(move / enemySpawn::kSubstep));
    for (int s = 0; s < steps; s++) {
      const double sl = move / steps;
      pos.x += chargeDir.x * sl;
      pos.z += chargeDir.z * sl;
      if (ctx.boxes) resolveCircleCollisions(*ctx.boxes, pos, radius);
    }
    const double dNow =
        std::hypot(ctx.playerPos.x - pos.x, ctx.playerPos.z - pos.z);
    if (!chargeHitDone && dNow < boss::kContactRadius) {
      chargeHitCount++;
      damagePlayer(boss::kChargeDmg, ctx);
      chargeHitDone = true; // once per charge
    }
    if (chargeT >= boss::kChargeTime) {
      state = "CHASE";
      chargeCooldown = boss::kChargeCooldown;
    }
  }

  // BLINK (teleport-nova)
  if (blinkCooldown <= 0 && state == "CHASE") {
    blinkCooldown = boss::kBlinkCooldown;
    pos = ctx.playerPos; // teleport ONTO the player through walls
    state = "BLINKING";
    enteredBlinking = true;
    blinkT = 0;
  } else if (state == "BLINKING") {
    blinkT += dt;
    if (blinkT >= boss::kBlinkTelegraph) {
      blinkNovaCount++;
      // nova at the boss's feet: damage the player if within BLINK_RADIUS
      const double dNova =
          std::hypot(ctx.playerPos.x - pos.x, ctx.playerPos.z - pos.z);
      if (dNova < boss::kBlinkRadius) damagePlayer(boss::kBlinkDmg, ctx);
      state = "CHASE";
    }
  }

  // SMOKE: fires alongside any other attack (doesn't change state)
  if (smokeCooldown <= 0 && !dead) {
    smokeCooldown = boss::kSmokeCooldown;
    launchSmoke(ctx);
  }

  // summon every SUMMON_INTERVAL seconds
  if (summonTimer <= 0 && !dead) {
    summonTimer = boss::kSummonInterval;
    summonMinions(ctx);
  }

  tickSmoke(dt, ctx);
}

} // namespace dc

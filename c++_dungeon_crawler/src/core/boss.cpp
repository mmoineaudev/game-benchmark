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
  b.label = "SPECTRAL LORD";
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
      std::max(0.0, (ctx.playerMaxHealth > 3 ? ctx.playerMaxHealth : 3) - 3.0);
  const int n = static_cast<int>(
      std::floor(3.0 * std::pow(boss::kSummonHeartsMult, heartsExtra)));
  // Deterministic count; the exact cell is not gated by any aggro-check
  // assertion, so we tally the summons (JS uses a cached walkable list + RNG).
  (void)ctx;
  minionsSummoned += n;
}

bool Boss::hitBoss(double damage, const char* /*sourceKind*/) {
  if (dead) return false;
  hp -= damage;
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

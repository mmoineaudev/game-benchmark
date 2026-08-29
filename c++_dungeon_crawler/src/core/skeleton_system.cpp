// skeleton_system.cpp — enemy spawner + shared AI (§16). Port of
// SkeletonSystem.js + Skeleton.js (sim half). Deterministic via dc::Rng.
//
// Parity notes:
//   * The JS drives spawn with unseeded Math.random(); the C++ core is
//     deterministic, so all spawn randomness routes through the passed Rng
//     (mulberry32). The 40-seed gate is dungeon generation only — enemy spawn
//     was never bit-parity-checked, so a proper Fisher-Yates shuffle stands in
//     for the JS's non-deterministic sort(() => Math.random()-0.5).
//   * Movement reuses dc::moveToward (SUBSTEP 0.08, resolve 0.35) — the same
//     helper the player uses, so enemy/player collision is identical.
#include "dc/skeleton_system.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace dc {

namespace {

// JS ENEMY_TYPES insertion order (the weighted-pick iteration order).
constexpr int kTypeCount = 7;
const char* kTypeNames[kTypeCount] = {
    "SKELETON", "MAGICIAN", "ARMORED", "ARCHER", "RAT", "BRUTE", "WRAITH"};

inline const EnemyTypeDef* defOf(const char* key) {
  return &kEnemyTypes.at(key);
}

} // namespace

int SkeletonSystem::liveCount() const {
  int n = 0;
  for (const auto& e : enemies_)
    if (e.state != EnemyState::kDead) n++;
  return n;
}

std::vector<Enemy*> SkeletonSystem::nearby(double x, double z, double dist) {
  std::vector<Enemy*> out;
  const double d2 = dist * dist;
  for (auto& e : enemies_) {
    if (e.state == EnemyState::kDead) continue;
    const double dx = e.pos.x - x, dz = e.pos.z - z;
    if (dx * dx + dz * dz <= d2) out.push_back(&e);
  }
  return out;
}

void SkeletonSystem::clear() {
  enemies_.clear();
  queue_.clear();
  for (auto& p : arrows_) p.active = false;
  for (auto& p : orbs_) p.active = false;
  excessHpMult_ = 1;
  revealTimer_ = 0;
}

int SkeletonSystem::liveProjectileCount() const {
  int n = 0;
  for (const auto& p : arrows_) if (p.active) n++;
  for (const auto& p : orbs_) if (p.active) n++;
  return n;
}

std::vector<CellRef> SkeletonSystem::candidateCells(const Dungeon& d) const {
  // BFS from the entrance over non-empty cells (mirror _candidateCells).
  const int gs = d.gridSize;
  std::vector<std::vector<int>> dist(gs, std::vector<int>(gs, -1));
  if (!d.entranceCell) return {};
  struct Q { int x, z; };
  std::vector<Q> q;
  q.push_back({d.entranceCell->x, d.entranceCell->z});
  dist[d.entranceCell->z][d.entranceCell->x] = 0;
  const int kDx[4] = {1, -1, 0, 0};
  const int kDz[4] = {0, 0, 1, -1};
  size_t head = 0;
  while (head < q.size()) {
    const Q c = q[head++];
    for (int k = 0; k < 4; k++) {
      const int nx = c.x + kDx[k], nz = c.z + kDz[k];
      if (nx < 0 || nz < 0 || nx >= gs || nz >= gs) continue;
      if (d.grid[nz][nx] == Cell::kEmpty || dist[nz][nx] >= 0) continue;
      dist[nz][nx] = dist[c.z][c.x] + 1;
      q.push_back({nx, nz});
    }
  }
  // Exclude the exit room's cells; keep BFS distance >= BFS_MIN_FROM_ENTRANCE.
  const Room* exitRoom = d.exitRoomIdx >= 0 ? &d.rooms[d.exitRoomIdx] : nullptr;
  std::vector<CellRef> out;
  for (int z = 0; z < gs; z++) {
    for (int x = 0; x < gs; x++) {
      if (dist[z][x] < enemySpawn::kBfsMinFromEntrance) continue;
      if (exitRoom && x >= exitRoom->cx && x < exitRoom->cx + exitRoom->w &&
          z >= exitRoom->cz && z < exitRoom->cz + exitRoom->h)
        continue;
      out.push_back({x, z});
    }
  }
  return out;
}

std::string SkeletonSystem::pickType(const std::string& biomeId,
                                     const std::string& roomType,
                                     Rng& rng) const {
  static const SpawnWeights& base = [] {
    // (biomeId is looked up per call; this just documents the 7-slot layout.)
    return kEnemySpawnWeights.at("STONE");
  }();
  (void)base;
  const SpawnWeights& w0 = kEnemySpawnWeights.count(biomeId)
                               ? kEnemySpawnWeights.at(biomeId)
                               : kEnemySpawnWeights.at("STONE");
  double w[kTypeCount] = {
      double(w0.skeleton), double(w0.magician), double(w0.armored),
      double(w0.archer), double(w0.rat), double(w0.brute), double(w0.wraith)};
  auto it = kRoomEnemyModifiers.find(roomType);
  if (it != kRoomEnemyModifiers.end()) {
    for (const auto& [k, mod] : it->second) {
      for (int i = 0; i < kTypeCount; i++)
        if (kTypeNames[i] == k) { w[i] *= mod; break; }
    }
  }
  double total = 0;
  for (int i = 0; i < kTypeCount; i++) total += std::max(0.0, w[i]);
  if (total <= 0) return "";
  double r = rng.next() * total;
  for (int i = 0; i < kTypeCount; i++) {
    r -= std::max(0.0, w[i]);
    if (r <= 0 && w[i] > 0) return kTypeNames[i];
  }
  return "SKELETON";
}

void SkeletonSystem::buildSpawnPlan(const Dungeon& d, int level, double souls,
                                    const std::string& biomeId,
                                    const Vec2& playerStart, bool hasArena,
                                    Rng& rng) {
  (void)playerStart; // (used only by the JS for a now-removed pre-defer)
  const double spawnMult = std::min(1.0 + (level + souls) / 10.0,
                                    double(enemySpawn::kSpawnCap));
  int slots = std::min(static_cast<int>(std::round((2.0 + (level - 1)) * spawnMult)),
                       enemySpawn::kMaxAlive);
  if (hasArena) slots += 2;
  const int excess = std::max(0, slots - enemySpawn::kHardCap);
  excessHpMult_ = 1.0 + excess * enemySpawn::kExcessHpPer;
  slots = std::min(slots, enemySpawn::kHardCap);

  std::vector<CellRef> cells = candidateCells(d);
  if (cells.empty()) return;
  // Deterministic Fisher-Yates shuffle (JS used a non-deterministic sort).
  for (int i = static_cast<int>(cells.size()) - 1; i > 0; i--) {
    const int j = rng.nextInt(i + 1);
    std::swap(cells[i], cells[j]);
  }
  bool arenaUsed = false;
  for (int i = 0; i < slots; i++) {
    const CellRef cell = cells[i % cells.size()];
    const std::string& roomType = d.metadata[cell.z][cell.x].roomType;
    const std::string typeKey = pickType(biomeId, roomType, rng);
    if (typeKey.empty()) continue;
    const EnemyTypeDef* def = defOf(typeKey.c_str());
    const bool elite = typeKey != "RAT" && rng.next() < kEliteChance && def->eliteEligible;
    queue_.push_back(SpawnEntry{cell, typeKey, elite,
                                hasArena && !arenaUsed && i == 0});
    if (hasArena && i == 0) arenaUsed = true;
  }
  revealTimer_ = 0;
}

Enemy SkeletonSystem::spawnOne(const SpawnEntry& entry, int level, int ngPlus,
                              double souls, int bossKills, double jitter,
                              Rng& rng) {
  (void)jitter;
  const EnemyTypeDef* def = defOf(entry.typeKey.c_str());
  const double hpMult = enemyHpMultiplier(ngPlus, level, souls) * excessHpMult_;
  int hp = static_cast<int>(std::ceil(def->hp * hpMult));
  int drops = def->drops;
  std::string eliteName;
  double eliteScale = 1.0;
  double speedOverride = -1;
  if (entry.elite || (entry.firstOfArena && def->eliteEligible)) {
    if (def->elite) {
      eliteName = def->elite->name;
      eliteScale = def->elite->scale;
      hp = static_cast<int>(std::ceil(def->elite->hp * hpMult));
      drops = def->elite->drops;
      speedOverride = def->speed * def->elite->speedMult;
    }
  }
  const double speedMult = (1.0 + kSpeedPerLevel * (level - 1)) *
                           (1.0 + kBossKillBuff * bossKills);
  const double speed = speedMult * (speedOverride >= 0 ? speedOverride : def->speed);

  Enemy e;
  e.type = entry.typeKey;
  e.def = def;
  e.hp = e.maxHp = hp;
  e.speed = speed;
  e.dmg = def->dmg;
  e.drops = drops;
  e.eliteName = eliteName;
  e.eliteScale = eliteScale;
  e.baseScale = eliteScale; // (Ogre 1.9, BRUTE handled by def; app-side pop)
  e.state = EnemyState::kWaking;
  e.wakeTimer = 0.8;
  e.floats = (entry.typeKey == "WRAITH");
  const double jx = (rng.next() - 0.5) * 3.0;
  const double jz = (rng.next() - 0.5) * 3.0;
  e.pos = {static_cast<double>(entry.cell.x) * 6.0 + jx,
           static_cast<double>(entry.cell.z) * 6.0 + jz};
  e.facing = 0;
  e.cooldown = 0;
  return e;
}

void SkeletonSystem::drainQueue(double dt, const Vec2& playerPos, int level,
                               int ngPlus, double souls, int bossKills,
                               bool isTitleOrSafe, Rng& rng) {
  (void)isTitleOrSafe; // reveal pacing is the same; freezing is done in update
  revealTimer_ -= dt;
  while (revealTimer_ <= 0 && !queue_.empty()) {
    if (liveCount() >= enemySpawn::kLiveCap) break;
    SpawnEntry entry = queue_.front();
    queue_.erase(queue_.begin());
    const double cellX = entry.cell.x * 6.0;
    const double cellZ = entry.cell.z * 6.0;
    const double dpx = cellX - playerPos.x, dpz = cellZ - playerPos.z;
    if (dpx * dpx + dpz * dpz < enemySpawn::kDeferPlayerDist * enemySpawn::kDeferPlayerDist) {
      queue_.push_back(entry); // rotate to back
      // All queued entries are this same one and it's too close → stop (JS 186).
      bool allSame = true;
      for (const auto& q : queue_)
        if (!(q.cell.x == entry.cell.x && q.cell.z == entry.cell.z &&
              q.typeKey == entry.typeKey && q.elite == entry.elite &&
              q.firstOfArena == entry.firstOfArena)) { allSame = false; break; }
      if (allSame) break;
      continue;
    }
    revealTimer_ += enemySpawn::kSpawnInterval;
    if (entry.typeKey == "RAT") {
      const int n = ratStat::kPackMin +
                    rng.nextInt(ratStat::kPackMax - ratStat::kPackMin + 1);
      int ratsAlive = 0;
      for (const auto& e : enemies_)
        if (e.type == "RAT" && e.state != EnemyState::kDead) ratsAlive++;
      const int allowed = std::max(0, std::min(ratStat::kCap - ratsAlive,
                                                enemySpawn::kMaxAlive - liveCount()));
      for (int k = 0; k < std::min(n, allowed); k++)
        enemies_.push_back(spawnOne(entry, level, ngPlus, souls, bossKills, k * 0.8, rng));
    } else {
      enemies_.push_back(spawnOne(entry, level, ngPlus, souls, bossKills, 0, rng));
    }
  }
}

void SkeletonSystem::tickAttack(Enemy& e, double dt, const EnemyCtx& ctx,
                               const std::function<void()>& landFn) {
  const EnemyCycle cycle = e.def->cycle;
  e.attackT += dt * ctx.attackSpeedMult;
  if (e.attackPhase == 1 && e.attackT >= cycle.windup) {
    e.attackPhase = 2;
    e.attackT = 0;
    e.hitApplied = false;
  } else if (e.attackPhase == 2) {
    if (!e.hitApplied && e.attackT >= cycle.swing * 0.35) {
      landFn();
      e.hitApplied = true;
    }
    if (e.attackT >= cycle.swing) {
      e.attackPhase = 3;
      e.attackT = 0;
    }
  } else if (e.attackPhase == 3 && e.attackT >= cycle.recover) {
    e.state = EnemyState::kChase;
    e.attackPhase = 0;
    e.cooldown = cycle.cooldown;
    e.waveDone = false;
  }
}

void SkeletonSystem::fireRanged(Enemy& e, const EnemyCtx& ctx) {
  const bool arrow = e.def->rangedKind == "arrow";
  auto& pool = arrow ? arrows_ : orbs_;
  Projectile* slot = nullptr;
  for (auto& p : pool)
    if (!p.active) { slot = &p; break; }
  if (!slot) return;
  const double life = arrow ? archerStat::kArrowLife : magicianStat::kOrbLife;
  const double speed = arrow ? archerStat::kArrowSpeed : magicianStat::kOrbSpeed;
  const double rad = std::atan2(ctx.playerPos.x - e.pos.x, ctx.playerPos.z - e.pos.z);
  slot->pos = {e.pos.x, e.pos.z};
  slot->vel = {std::sin(rad) * speed, std::cos(rad) * speed};
  slot->life = life;
  slot->dmg = e.dmg;
  slot->active = true;
}

void SkeletonSystem::updateProjectiles(double dt, const EnemyCtx& ctx) {
  auto tick = [&](std::vector<Projectile>& set) {
    for (auto& p : set) {
      if (!p.active) continue;
      p.life -= dt;
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      const double dx = ctx.playerPos.x - p.pos.x, dz = ctx.playerPos.z - p.pos.z;
      if (dx * dx + dz * dz < player::kRadius * player::kRadius) {
        damagePlayer(p.dmg, nullptr);
        p.active = false;
        continue;
      }
      if (p.life <= 0) p.active = false;
    }
  };
  tick(arrows_);
  tick(orbs_);
}

void SkeletonSystem::damagePlayer(double dmg, Enemy* e) {
  if (onPlayerDamaged) onPlayerDamaged(dmg, e);
}

bool SkeletonSystem::hitEnemy(Enemy* e, double damage, const char* sourceKind) {
  if (!e || e->state == EnemyState::kDead) return false;
  e->hp -= damage;
  e->hitFlash = 0.08;
  if (e->hp <= 0 && e->state != EnemyState::kDead) {
    e->state = EnemyState::kDead;
    e->deadTimer = 0;
    if (onKill) onKill(e, sourceKind);
    return true;
  }
  return false;
}

void SkeletonSystem::breakProjectilesInCone(const std::function<bool(const Vec2&)>& check) {
  auto clear = [&](std::vector<Projectile>& set) {
    for (auto& p : set)
      if (p.active && check(p.pos)) p.active = false;
  };
  clear(arrows_);
  clear(orbs_);
}

void SkeletonSystem::update(double dt, const EnemyCtx& ctx) {
  const Vec2 P = ctx.playerPos;
  for (size_t i = enemies_.size(); i-- > 0;) {
    Enemy& e = enemies_[i];
    if (e.state == EnemyState::kDead) {
      e.deadTimer += dt;
      if (e.deadTimer >= 1.3) { // hold 0.5 s + fade 0.8 s
        enemies_.erase(enemies_.begin() + static_cast<long>(i));
      }
      continue;
    }
    const double distP = std::hypot(P.x - e.pos.x, P.z - e.pos.z);
    e.frozen = distP > enemySpawn::kFrozenDist || ctx.frozenAll;
    if (e.wakeTimer > 0) {
      e.wakeTimer -= dt;
      continue;
    }
    if (e.frozen) continue;
    if (e.cooldown > 0) e.cooldown -= dt;

    const bool seesLOS = e.def->phases ? true
                                        : hasLineOfSight(*ctx.boxes, e.pos.x, e.pos.z, P.x, P.z);
    const bool inRange = distP < e.def->range;

    // BRIGHT: all enemies flee, no attacks.
    if (ctx.brightActive) {
      moveToward(e.pos, e.pos.x + (e.pos.x - P.x), e.pos.z + (e.pos.z - P.z),
                 e.speed, dt, *ctx.boxes, 0.35);
      continue;
    }

    if (e.def->instantAttack) {
      // rat / wraith: straight chase, touch-range hit + cooldown
      if (seesLOS || e.def->phases) {
        moveToward(e.pos, P.x, P.z, e.speed, dt, *ctx.boxes, 0.35);
        e.pathStepPos.reset();
      } else {
        e.pathTimer -= dt;
        if (e.pathTimer <= 0 || !e.pathStepPos) {
          e.pathTimer = enemySpawn::kPathReeval;
          e.pathStepPos = pathStep(*ctx.dungeon, *ctx.boxes, e.pos.x, e.pos.z, P.x, P.z);
        }
        if (e.pathStepPos) moveToward(e.pos, e.pathStepPos->x, e.pathStepPos->z, e.speed, dt, *ctx.boxes, 0.35);
      }
      e.facing = std::atan2(P.x - e.pos.x, P.z - e.pos.z);
      if (inRange && e.cooldown <= 0 && !ctx.safeSpawn) {
        damagePlayer(e.dmg, &e);
        e.cooldown = e.def->attackCooldown;
      }
    } else if (e.def->ranged) {
      // archer kite / magician cast positioning
      const double stopAt = e.def->stopFrac ? e.def->range * e.def->stopFrac
                                             : e.def->kiteStop;
      if (distP > stopAt || !seesLOS) {
        if (seesLOS || e.def->phases) {
          moveToward(e.pos, P.x, P.z, e.speed, dt, *ctx.boxes, 0.35);
          e.pathStepPos.reset();
        } else {
          e.pathTimer -= dt;
          if (e.pathTimer <= 0 || !e.pathStepPos) {
            e.pathTimer = enemySpawn::kPathReeval;
            e.pathStepPos = pathStep(*ctx.dungeon, *ctx.boxes, e.pos.x, e.pos.z, P.x, P.z);
          }
          if (e.pathStepPos) moveToward(e.pos, e.pathStepPos->x, e.pathStepPos->z, e.speed, dt, *ctx.boxes, 0.35);
        }
      } else if (e.def->kiteStop && distP < e.def->retreatUnder) {
        const double frac = e.def->retreatSpeed / e.speed;
        moveToward(e.pos, e.pos.x + (e.pos.x - P.x) * frac, e.pos.z + (e.pos.z - P.z) * frac,
                   e.speed, dt, *ctx.boxes, 0.35);
      }
      e.facing = std::atan2(P.x - e.pos.x, P.z - e.pos.z);
      if (distP <= e.def->range && seesLOS && e.cooldown <= 0 &&
          e.attackPhase == 0 && !ctx.safeSpawn) {
        e.state = EnemyState::kAttack;
        e.attackPhase = 1;
        e.attackT = 0;
      }
      if (e.attackPhase != 0)
        tickAttack(e, dt, ctx, [&] { fireRanged(e, ctx); });
    } else {
      // melee cycle
      if (inRange && e.cooldown <= 0 && e.attackPhase == 0 && !ctx.safeSpawn) {
        e.state = EnemyState::kAttack;
        e.attackPhase = 1; // windup (instant types handled above)
        e.attackT = 0;
      } else if (!inRange) {
        if (seesLOS) {
          moveToward(e.pos, P.x, P.z, e.speed, dt, *ctx.boxes, 0.35);
          e.pathStepPos.reset();
        } else {
          e.pathTimer -= dt;
          if (e.pathTimer <= 0 || !e.pathStepPos) {
            e.pathTimer = enemySpawn::kPathReeval;
            e.pathStepPos = pathStep(*ctx.dungeon, *ctx.boxes, e.pos.x, e.pos.z, P.x, P.z);
          }
          if (e.pathStepPos) moveToward(e.pos, e.pathStepPos->x, e.pathStepPos->z, e.speed, dt, *ctx.boxes, 0.35);
        }
      }
      e.facing = std::atan2(P.x - e.pos.x, P.z - e.pos.z);
      if (e.attackPhase != 0) {
        tickAttack(e, dt, ctx, [&] {
          const double dx = P.x - e.pos.x, dz = P.z - e.pos.z;
          const double d = std::hypot(dx, dz);
          if (d < e.def->range + 0.6) {
            if (e.def->coneRad) {
              const double ang = std::atan2(dx, dz);
              double diff = std::abs(ang - e.facing);
              if (diff > std::numbers::pi) diff = 2 * std::numbers::pi - diff;
              if (diff < e.def->coneRad) damagePlayer(e.dmg, &e);
            } else {
              damagePlayer(e.dmg, &e);
            }
          }
        });
      }
    }
  }
  updateProjectiles(dt, ctx);
}

} // namespace dc

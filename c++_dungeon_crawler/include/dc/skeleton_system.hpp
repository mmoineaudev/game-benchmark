// dc/skeleton_system.hpp — enemy spawner + shared AI driver (§16), headless.
// Port of entities/SkeletonSystem.js + Skeleton.js (the sim half; the visual
// rig/pose is the app's job). One unified Enemy covers all 7 types (SKELETON /
// MAGICIAN / ARMORED / ARCHER / RAT / BRUTE / WRAITH) + BURN, driven by the
// same per-type rules as the JS:
//   * melee: chase (LOS) / greedy path, windup→swing→recover, hit at swing 0.35
//   * ranged: kite (archer) / cast positioning (magician), fire projectile
//   * instant: rat / wraith straight chase + touch-range hit + cooldown
//   * death: hold then fade (1.3 s); onKill fires the first frame hp <= 0
// Spawn: plan (slots × spawnMult, biome weights × room mods, elites) → reveal
// one every SPAWN_INTERVAL, deferring spawns within 30 m of the player.
// Deterministic: all randomness through dc::Rng (mulberry32). NO GPU.
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

namespace dc {

// Enemy AI states (§16.2). Boss has its own; this is the shared mob set.
enum class EnemyState : int { kDormant, kWaking, kChase, kAttack, kDead };

// A live mob (any type). The visual rig/pose is the app's concern; this holds
// everything the sim needs: transform, AI state, attack cycle, HP/drops.
struct Enemy {
  std::string type;            // SKELETON | MAGICIAN | ... (ENEMY_TYPES key)
  const EnemyTypeDef* def = nullptr;
  double hp = 1, maxHp = 1;
  double speed = 0;
  int dmg = 1;
  int drops = 0;
  std::string eliteName;      // empty = not elite
  double eliteScale = 1.0;
  EnemyState state = EnemyState::kWaking;
  Vec2 pos{0, 0};
  double facing = 0;           // radians (for brute cone / attack pose)
  double attackT = 0;
  int attackPhase = 0;        // 0 none, 1 windup, 2 swing, 3 recover
  double cooldown = 0;
  double deadTimer = 0;
  bool frozen = false;
  double hitFlash = 0;
  double pathTimer = 0;
  std::optional<Vec2> pathStepPos;
  double wakeTimer = 0;
  bool floats = false;        // wraith (renders hovering)
  bool isMinion = false;      // summoned (sarcophagus/boss) — MAX_MINIONS cap
  bool isBURN = false;
  bool rangedFiring = false; // summoned wraiths fire projectiles
  double fireAcc = 0;        // BURN ground-fire accumulator
  bool hitApplied = false;
  bool waveDone = false;
  double baseScale = 1.0;    // BRUTE 1.5 / elite scale (for hit-pop, app-side)
  bool alive() const { return state != EnemyState::kDead; }
};

// One queued (not-yet-revealed) spawn.
struct SpawnEntry {
  CellRef cell;
  std::string typeKey;
  bool elite = false;
  bool firstOfArena = false;
};

// A pooled projectile (arrow or orb). Pooled: fixed arrays, no per-shot alloc.
struct Projectile {
  Vec2 pos{0, 0};
  Vec2 vel{0, 0};
  double life = -1;
  int dmg = 1;
  bool active = false;
};

// Per-frame inputs the enemy system needs (mirrors the JS `ctx`).
struct EnemyCtx {
  const Dungeon* dungeon = nullptr;
  const std::vector<AABB>* boxes = nullptr;
  Vec2 playerPos{0, 0};
  double dt = 0;
  bool frozenAll = false;     // title screen / safe-spawn: mobs idle
  bool safeSpawn = false;     // no new attacks while true
  bool brightActive = false;  // BRIGHT buff: ALL enemies flee, no attacks
  double attackSpeedMult = 1.0; // (1 + ATTACK_PER_3_LEVELS*floor((level-1)/3))
  int level = 1;
  int ngPlus = 0;
  double souls = 0;
  int bossKills = 0;
};

// Enemy spawner + shared AI (§16). Deterministic via the passed Rng.
class SkeletonSystem {
public:
  // Pooled arrows/orbs (§13) sized once at construction — no per-shot alloc.
  SkeletonSystem() {
    arrows_.reserve(24);
    for (int i = 0; i < 24; i++) arrows_.push_back(Projectile{});
    orbs_.reserve(16);
    for (int i = 0; i < 16; i++) orbs_.push_back(Projectile{});
  }

  // ---- spawn plan (§16.1) ----
  // Compute slots + a queue of spawn entries (cheap data). Consumes `rng` for
  // the candidate shuffle, elite rolls, and type picks. `souls` = collectedOrbs.
  void buildSpawnPlan(const Dungeon& dungeon, int level, double souls,
                      const std::string& biomeId, const Vec2& playerStart,
                      bool hasArena, Rng& rng);

  // Reveal one mob every SPAWN_INTERVAL (first immediately), deferring spawns
  // within 30 m of the player to the back of the queue. Consumes `rng` for
  // rat-pack size + spawn jitter. `isTitleOrSafe` freezes revealed mobs.
  void drainQueue(double dt, const Vec2& playerPos, int level, int ngPlus,
                  double souls, int bossKills, bool isTitleOrSafe, Rng& rng);

  // ---- AI update ----
  // One fixed-step frame of the shared mob AI (chase/path/attack/death).
  void update(double dt, const EnemyCtx& ctx);

  // Player → mob damage (sword cone / orb direct / explosion / hunter beam).
  // Returns true if the mob died this call (so the caller can do drop-credit).
  bool hitEnemy(Enemy* e, double damage, const char* sourceKind);

  // Break enemy projectiles that land inside a check (sword arc clears arrows).
  void breakProjectilesInCone(const std::function<bool(const Vec2&)>& check);

  // ---- accessors ----
  std::vector<Enemy>& enemies() { return enemies_; }
  const std::vector<Enemy>& enemies() const { return enemies_; }
  const std::vector<SpawnEntry>& queue() const { return queue_; }
  double excessHpMult() const { return excessHpMult_; }
  int liveCount() const;
  // All living mobs (state != DEAD) within `dist` of (x,z) — for the sword
  // cone / orb / explosion hit tests. Order is spawn order.
  std::vector<Enemy*> nearby(double x, double z, double dist);
  // Count of active projectiles (arrows + orbs) — for tests/verification.
  int liveProjectileCount() const;
  // Pools (for rendering; inactive entries have active==false).
  const std::vector<Projectile>& arrows() const { return arrows_; }
  const std::vector<Projectile>& orbs() const { return orbs_; }
  // Clear all (level regen). Drops nothing.
  void clear();
  // Summon a minion wraith at a cell (sarcophagus / boss summon, §16/§17).
  // Capped at live BOSS.MAX_MINIONS; returns the new enemy index or -1.
  int summonMinion(const CellRef& cell, int level, int ngPlus, double souls,
                   int bossKills, Rng& rng);
  // Count of live summoned minions (ranged wraiths) — the MAX_MINIONS cap.
  int liveMinionCount() const;

  // ---- callbacks (Game.js ↔ System) ----
  // onKill: a mob reached 0 hp this frame (source = "sword"/"orb"/"explosion").
  std::function<void(Enemy*, const char*)> onKill;
  // onPlayerDamaged: a mob's attack/projectile hit the player (pre-i-frame).
  std::function<void(double, Enemy*)> onPlayerDamaged;

  // ---- private ----
private:
  Enemy spawnOne(const SpawnEntry& entry, int level, int ngPlus, double souls,
                 int bossKills, double jitter, Rng& rng);
  void tickAttack(Enemy& e, double dt, const EnemyCtx& ctx,
                  const std::function<void()>& landFn);
  void fireRanged(Enemy& e, const EnemyCtx& ctx);
  void updateProjectiles(double dt, const EnemyCtx& ctx);
  void damagePlayer(double dmg, Enemy* e);
  std::vector<CellRef> candidateCells(const Dungeon& dungeon) const;
  std::string pickType(const std::string& biomeId, const std::string& roomType,
                       Rng& rng) const;

  std::vector<Enemy> enemies_;
  std::vector<SpawnEntry> queue_;
  double revealTimer_ = 0;
  double excessHpMult_ = 1;
  // Pooled projectiles (§13): 10 arrows + 12 orbs, zero per-shot allocation.
  std::vector<Projectile> arrows_;
  std::vector<Projectile> orbs_;
};

} // namespace dc

// SkeletonSystem.js — enemy spawn/AI orchestration (§16, §17, §18, §26).
//
// Owns the level's skeleton population:
//   • SPAWN PLAN (§16.1): slots, biome weights × room modifiers, reveal every
//     0.5 s, defer near-player (30 m), rat packs, elite rolls, ARENA bonus.
//   • RUNTIME: reveal queue, per-mob AI update, freeze >40 m, title/safe idle,
//     BRIGHT flee, enemy projectiles (arrow 10 / orb 12 pools), brute
//     shockwaves (pool 4, TTL 0.25 s), LOS ray march + greedy 4-neighbor
//     pathing helpers (§6, shared with the hunter).
//   • BOSS (§17, §25, §26): one GhostBoss at the exit on every 7th level,
//     smoke DoT tick, blink hit, summoned wraiths, defeat rewards.
//   • BURN (§18): rises once the level is fully cleared (non-boss/arena).
//   • Shared helpers: hitSkeleton (sword hits), breakProjectiles (cone).
//
// Headless-safe: every THREE / DOM touch is guarded; the module imports and
// runs under node (no top-level DOM access).

import * as THREE from 'three';
import {
  ENEMY,
  ENEMY_TYPES,
  ENEMY_SPAWN_WEIGHTS,
  ROOM_ENEMY_MODIFIERS,
  SKELETON,
  ARMORED,
  ARCHER,
  RAT,
  BRUTE,
  WRAITH,
  MAGICIAN,
  ELITE,
  BOSS,
  BURN,
  SWORD,
  HIT_STOP,
  DUNGEON,
  enemyHpMultiplier,
} from '../core/Constants.js';
import { circleHitsBox, resolveCircleCollisions } from '../core/Collision.js';
import { Skeleton } from './Skeleton.js';
import { GhostBoss } from './GhostBoss.js';
import { Burning } from './enemies/Burning.js';
// Side-effect: registers all variants into Skeleton._variantClasses so the
// sync Skeleton.forType() factory resolves the concrete classes.
import './enemyTypes.js';

const STEP = ENEMY.STEP_SLIVER;           // 0.08 u sub-step
const RADIUS = ENEMY.RADIUS;              // 0.35 circle
const LOS_STEP = ENEMY.LOS_STEP;          // 0.4 u
const LOS_RADIUS = ENEMY.LOS_RADIUS;      // 0.25
const PATH_REEVAL = ENEMY.PATH_REEVAL_MS / 1000; // 0.3 s
const PROJ_RADIUS = 0.3;                  // enemy projectile hit radius
const SHOCK_TTL = 0.25;                   // brute shockwave TTL (s)
const ARROW_POOL = 10;
const ORB_POOL = 12;
const SHOCK_POOL = 4;

// Base stats per enemy type (from Constants) — used for plan HP scaling.
const BASE_STATS = {
  SKELETON: SKELETON,
  MAGICIAN: MAGICIAN,
  ARMORED: ARMORED,
  ARCHER: ARCHER,
  RAT: RAT,
  BRUTE: BRUTE,
  WRAITH: WRAITH,
};

export class SkeletonSystem {
  /**
   * @param {THREE.Scene|THREE.Group|null} scene scene root (may be null headless)
   * @param {object} dungeon DungeonGenerator output:
   *   { grid, metadata, rooms, gridSize, cellSize, entranceCell, exitCell }
   * @param {string} biomeId
   * @param {import('../core/GameState.js').GameState} state run state
   * @param {object} opts
   *   eventBus        pub/sub (optional)
   *   onKill(enemy, drops)       — skeleton killed: credits orbs/health
   *   onBossKill(boss)           — boss defeated: rewards
   *   onPlayerDamaged(dmg, src)  — melee/projectile damage (respects i-frames)
   *   onBlinkHit(x, z, r, d)     — boss blink nova
   *   onToast(msg)               — toast (e.g. BURN rise)
   *   onFirePatch(x, z)          — shared fire-patch pool (visual only)
   *   collisionBoxes             wall AABBs [{minX,minZ,maxX,maxZ}]
   *   isBossLevel(level)         bool (Game may override; default §17 rule)
   */
  constructor(scene, dungeon, biomeId, state, opts = {}) {
    this.scene = scene || null;
    this.dungeon = dungeon;
    this.biomeId = biomeId;
    this.state = state;
    this.level = state.level;
    this.ngPlus = state.ngPlus;
    this.bossKills = state.bossKills;
    this.souls = state.collectedOrbs;

    this.opts = opts;
    this.eventBus = opts.eventBus || null;
    this.onKill = opts.onKill || null;
    this.onBossKill = opts.onBossKill || null;
    this.onPlayerDamaged = opts.onPlayerDamaged || null;
    this.onBlinkHit = opts.onBlinkHit || null;
    this.onToast = opts.onToast || null;
    this.onFirePatch = opts.onFirePatch || null;
    this.collisionBoxes = opts.collisionBoxes || [];

    this.isBossLevelFn = opts.isBossLevel ||
      ((lvl) => lvl % BOSS.INTERVAL === 0);

    // --- runtime state ---
    this.living = [];            // all non-boss skeletons (alive or dying)
    this.spawnQueue = [];        // planned-but-not-yet-revealed {type, cell, elite}
    this.revealTimer = 0;        // counts up to SPAWN_INTERVAL
    this._revealed = 0;
    this._ratCount = 0;
    this._arenaFirstSpawn = true;
    this._hasArena = false;
    this._planSlots = 0;
    this._speedMult = 1;
    this._attackMult = 1;
    this._disposed = false;
    this._burnSpawned = false;
    this._burnDone = false;

    // Boss
    this.boss = null;
    this.bossKilled = false;

    // BURN
    this.burn = null;

    // Projectile pools
    this._arrowPool = [];
    this._orbPool = [];
    for (let i = 0; i < ARROW_POOL; i++) this._arrowPool.push(this._makeProjectile('arrow'));
    for (let i = 0; i < ORB_POOL; i++) this._orbPool.push(this._makeProjectile('orb'));

    // Brute shockwaves (visual ring pool)
    this._shockwaves = [];
    for (let i = 0; i < SHOCK_POOL; i++) {
      this._shockwaves.push({ active: false, t: 0, x: 0, z: 0, mesh: null, mat: null });
    }

    // Compute scaling for the level (§16.1/§20).
    this._speedMult = ENEMY.speedMult(this.level, this.bossKills);
    this._attackMult = ENEMY.attackMult(this.level, this.bossKills);
    this._hpMult = enemyHpMultiplier(this.ngPlus, this.level, this.souls);

    // Build the spawn plan (non-boss) or spawn the boss (boss level).
    if (this.isBossLevelFn(this.level)) {
      this._spawnBoss();
    } else {
      this._planSlots = this._computeSlots();
      this.buildSpawnPlan();
      // First reveal immediately (§16.1).
      this.revealTimer = ENEMY.SPAWN_INTERVAL;
    }
  }

  // =========================================================================
  // §16.1 — Spawn plan
  // =========================================================================

  /**
   * Compute spawn slots: min(round((2 + (level−1)) × spawnMult), MAX_ALIVE)
   * +2 if an ARENA room is present. spawnMult = min(1 + (level+souls)/10, ×100).
   */
  _computeSlots() {
    const spawnMult = Math.min(1 + (this.level + this.souls) / 10, ENEMY.SPAWN_CAP);
    let slots = Math.min(
      Math.round((2 + (this.level - 1)) * spawnMult),
      ENEMY.MAX_ALIVE
    );
    if (this.dungeon.rooms && this.dungeon.rooms.some((r) => r.type === 'ARENA')) {
      slots += DUNGEON.ARENA_EXTRA_SLOTS;
    }
    return slots;
  }

  /** Candidate cells: non-empty, BFS dist ≥ 6 from entrance, NOT exit room. */
  _candidateCells() {
    const { grid, gridSize, entranceCell, exitCell, metadata } = this.dungeon;
    const n = gridSize;
    const key = (x, z) => x * n + z;
    // BFS from entrance over non-empty cells
    const dist = new Map();
    const queue = [key(entranceCell.x, entranceCell.z)];
    dist.set(key(entranceCell.x, entranceCell.z), 0);
    while (queue.length) {
      const k = queue.shift();
      const x = Math.floor(k / n), z = k % n;
      const d = dist.get(k);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        if (grid[nx][nz] === 'empty') continue;
        const nk = key(nx, nz);
        if (dist.has(nk)) continue;
        dist.set(nk, d + 1);
        queue.push(nk);
      }
    }
    // Exit room footprint (cells)
    const exitRoom = this.dungeon.rooms.find(
      (r) => r.type === 'ARENA' ||
             (r.cx <= exitCell.x && exitCell.x < r.cx + r.w &&
              r.cz <= exitCell.z && exitCell.z < r.cz + r.h)
    );
    const inExitRoom = (x, z) => {
      if (!exitRoom) return false;
      return x >= exitRoom.cx && x < exitRoom.cx + exitRoom.w &&
             z >= exitRoom.cz && z < exitRoom.cz + exitRoom.h;
    };
    const cells = [];
    for (let x = 0; x < n; x++) {
      for (let z = 0; z < n; z++) {
        if (grid[x][z] === 'empty') continue;
        const d = dist.get(key(x, z));
        if (d === undefined || d < ENEMY.CANDIDATE_MIN_BFS_DIST) continue;
        if (inExitRoom(x, z)) continue;
        cells.push({ x, z, d, roomType: (metadata[x][z] || {}).roomType || null });
      }
    }
    return cells;
  }

  /**
   * Build the full spawn plan (cheap data), shuffled, and populate
   * `this.spawnQueue`. First entry is revealed immediately on the next update.
   */
  buildSpawnPlan() {
    const cells = this._candidateCells();
    // Shuffle
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const hasArena = this.dungeon.rooms &&
      this.dungeon.rooms.some((r) => r.type === 'ARENA');
    this._hasArena = hasArena;
    this._arenaFirstSpawn = true;
    this._revealed = 0;
    this.spawnQueue = [];

    const slots = this._planSlots;
    for (let i = 0; i < slots; i++) {
      const cell = cells[i % Math.max(1, cells.length)];
      if (!cell) break;
      const type = this._pickType(cell.roomType);
      // Elite roll: 1-in-10 for eligible types; ARENA first roll guaranteed.
      const eligible = ENEMY.ELITE_TYPES.includes(type);
      let elite = false;
      if (eligible) {
        if (hasArena && this._arenaFirstSpawn) {
          elite = true;
        } else {
          elite = Math.random() < ENEMY.ELITE_CHANCE;
        }
      }
      if (type === 'RAT') {
        // Rat pack: 2–3 rats at one cell, clamped to RAT_CAP & MAX_ALIVE.
        const packSize = Math.min(
          ENEMY.RAT_PACK_MIN + Math.floor(Math.random() * (ENEMY.RAT_PACK_MAX - ENEMY.RAT_PACK_MIN + 1)),
          ENEMY.RAT_CAP - this._ratCount,
          ENEMY.MAX_ALIVE - this.living.length
        );
        const n = Math.max(0, packSize);
        for (let r = 0; r < n; r++) {
          this.spawnQueue.push({ type: 'RAT', cell: { ...cell }, elite: false });
        }
        this._ratCount += n;
      } else {
        this.spawnQueue.push({ type, cell: { ...cell }, elite });
      }
      if (this._arenaFirstSpawn) this._arenaFirstSpawn = false;
    }
    return this.spawnQueue;
  }

  /** Weighted type pick: biome weight × room-enemy modifier. */
  _pickType(roomType) {
    const weights = ENEMY_SPAWN_WEIGHTS[this.biomeId] || ENEMY_SPAWN_WEIGHTS.STONE;
    const mods = (roomType && ROOM_ENEMY_MODIFIERS[roomType]) || {};
    let total = 0;
    const entries = [];
    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const t = ENEMY_TYPES[i];
      let w = weights[i] || 0;
      if (mods[t] !== undefined) w *= mods[t];
      if (w <= 0) continue;
      entries.push([t, w]);
      total += w;
    }
    if (total <= 0) return 'SKELETON';
    let roll = Math.random() * total;
    for (const [t, w] of entries) {
      roll -= w;
      if (roll <= 0) return t;
    }
    return entries[entries.length - 1][0];
  }

  /** Reveal the next queued spawn (creates the Skeleton). */
  _revealNext(player) {
    if (!this.spawnQueue.length) return;
    // Defer: rotate to back if within SPAWN_PLAYER_DIST of the player.
    let entry = this.spawnQueue.shift();
    for (let tries = 0; tries < this.spawnQueue.length + 1; tries++) {
      const cell = entry.cell;
      const wx = (cell.x + 0.5) * this.dungeon.cellSize;
      const wz = (cell.z + 0.5) * this.dungeon.cellSize;
      const dx = wx - player.x, dz = wz - player.z;
      if (dx * dx + dz * dz > ENEMY.SPAWN_PLAYER_DIST * ENEMY.SPAWN_PLAYER_DIST) break;
      // Too close — rotate to back.
      this.spawnQueue.push(entry);
      entry = this.spawnQueue.shift();
      if (!entry) return;
    }
    if (!entry) return;
    const cell = entry.cell;
    const wx = (cell.x + 0.5) * this.dungeon.cellSize;
    const wz = (cell.z + 0.5) * this.dungeon.cellSize;
    this._spawnMob(entry.type, wx, wz, entry.elite);
    this._revealed++;
  }

  /** Create a single skeleton at world (wx, wz) with scaling applied. */
  _spawnMob(type, wx, wz, elite) {
    const base = BASE_STATS[type];
    if (!base) return null;
    const eliteCfg = elite ? ELITE[type] : null;
    const hp = Math.ceil((eliteCfg ? eliteCfg.hp : base.hp) * this._hpMult);
    const s = Skeleton.forType(type, this.scene, {
      position: { x: wx, z: wz },
      elite,
      hp,
      moveSpeedMult: this._speedMult,
      attackSpeedMult: this._attackMult,
      facing: Math.random() * Math.PI * 2,
    });
    s.onAttackHit = (enemy) => this._onEnemyAttackHit(enemy);
    s.onProjectile = (info) => this._fireEnemyProjectile(info);
    s.onDeath = (enemy) => this._onEnemyDeath(enemy);
    if (type === 'BURN') {
      s.onFirePatch = (x, z) => { if (this.onFirePatch) this.onFirePatch(x, z); };
    }
    this.living.push(s);
    return s;
  }

  // =========================================================================
  // §17 — Boss
  // =========================================================================

  _spawnBoss() {
    const { exitCell, cellSize } = this.dungeon;
    const wx = (exitCell.x + 0.5) * cellSize;
    const wz = (exitCell.z + 0.5) * cellSize;
    this.boss = new GhostBoss(this.scene, {
      position: { x: wx, z: wz },
      level: this.level,
      ngPlus: this.ngPlus,
      souls: this.souls,
      maxHealth: this.state.maxHealth,
      bossKills: this.bossKills,
    });
    this.boss.onDeath = (boss) => this._onBossDeath(boss);
    this.boss.onBlinkHit = (x, z, r, d) => {
      if (this.onBlinkHit) this.onBlinkHit(x, z, r, d);
    };
    this.boss.onSummon = (x, z, i) => {
      const w = this._spawnMob('WRAITH', x, z, false);
      if (w) w.onProjectile = (info) => this._fireEnemyProjectile(info);
      return w;
    };
  }

  _onBossDeath(boss) {
    this.bossKilled = true;
    if (this.onBossKill) this.onBossKill(boss);
  }

  /** Boss smoke DoT: 1 heart/s while inside a lingering cloud (§26). */
  _tickBossSmoke(dt, player) {
    if (!this.boss || !this.boss.alive) return;
    // Only when the global invuln window is clear.
    if (this.state.invulnTimer > 0) return;
    let inCloud = false;
    for (const c of this.boss.smokeClouds) {
      if (!c.active || c.phase !== 'linger') continue;
      const dx = player.x - c.x, dz = player.z - c.z;
      if (dx * dx + dz * dz <= c.radius * c.radius) { inCloud = true; break; }
    }
    if (!inCloud) return;
    // 1 heart/s (SMOKE_DMG=1), ticked per-frame.
    this._smokeAcc = (this._smokeAcc || 0) + dt * BOSS.SMOKE_DMG;
    if (this._smokeAcc >= 1) {
      this._smokeAcc -= 1;
      if (this.onPlayerDamaged) this.onPlayerDamaged(1, { source: 'bossSmoke' });
    }
  }

  // =========================================================================
  // §18 — BURN
  // =========================================================================

  /**
   * Spawn BURN at the walkable cell farthest from the player.
   * Non-boss, non-arena level, at most one, only when fully cleared.
   */
  _trySpawnBurn(player) {
    if (this._burnSpawned || this._burnDone) return;
    if (this.isBossLevelFn(this.level)) return;
    if (this._hasArena) return;
    if (!this.fullyCleared()) return;
    this._burnSpawned = true;
    // Find the walkable cell farthest from the player.
    const { grid, gridSize, cellSize } = this.dungeon;
    let best = null, bestD = -1;
    for (let x = 0; x < gridSize; x++) {
      for (let z = 0; z < gridSize; z++) {
        if (grid[x][z] === 'empty') continue;
        const wx = (x + 0.5) * cellSize, wz = (z + 0.5) * cellSize;
        const d = (wx - player.x) ** 2 + (wz - player.z) ** 2;
        if (d > bestD) { bestD = d; best = { x: wx, z: wz }; }
      }
    }
    if (!best) return;
    this.burn = Skeleton.forType('BURN', this.scene, {
      position: best,
      ngPlus: this.ngPlus,
      moveSpeedMult: this._speedMult,
      attackSpeedMult: this._attackMult,
    });
    this.burn.onAttackHit = (enemy) => this._onEnemyAttackHit(enemy);
    this.burn.onDeath = (enemy) => {
      this._onEnemyDeath(enemy);
      this._burnDone = true;
    };
    this.burn.onFirePatch = (x, z) => { if (this.onFirePatch) this.onFirePatch(x, z); };
    this.living.push(this.burn);
    if (this.onToast) this.onToast('The BURN rises — the level is cleared!');
  }

  /** Create a projectile pool entry. */
  _makeProjectile(kind) {
    return {
      active: false,
      kind,           // 'arrow' | 'orb'
      x: 0, z: 0,
      dx: 0, dz: 0,    // direction (unit)
      speed: 0,
      life: 0,
      radius: 0.2,
      damage: 1,
      stopDistance: null,
      traveled: 0,
      source: null,
    };
  }

  // =========================================================================
  // Enemy melee / projectile / death resolution
  // =========================================================================

  /** Enemy melee hit landed (swing progress ≥ 0.35). Respects i-frames. */
  _onEnemyAttackHit(enemy) {
    if (this.state.invulnTimer > 0) return;
    if (this.onPlayerDamaged) {
      this.onPlayerDamaged(enemy.damage, {
        source: enemy,
        x: enemy.position.x,
        z: enemy.position.z,
        facing: enemy.facing,
        coneHalfAngle: enemy.coneHalfAngle || null,
      });
    }
  }

  /** Enemy ranged fire: push a projectile into the correct pool. */
  _fireEnemyProjectile(info) {
    const pool = info.kind === 'arrow' ? this._arrowPool : this._orbPool;
    const free = pool.find((p) => !p.active);
    if (!free) return;
    free.active = true;
    free.kind = info.kind;
    free.x = info.x;
    free.z = info.z;
    free.dx = Math.sin(info.yaw);
    free.dz = Math.cos(info.yaw);
    free.speed = info.speed;
    free.life = info.life;
    free.radius = info.radius;
    free.damage = info.damage;
    free.stopDistance = info.stopDistance || null;
    free.traveled = 0;
    free.source = info.source;
  }

  /** Update enemy projectiles (move + collide with player and walls). */
  _updateProjectiles(dt, player) {
    const update = (pool) => {
      for (const p of pool) {
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) { p.active = false; continue; }
        const step = p.speed * dt;
        p.x += p.dx * step;
        p.z += p.dz * step;
        p.traveled += step;
        // Wall hit
        if (circleHitsBox(this.collisionBoxes, p.x, p.z, p.radius)) {
          p.active = false;
          continue;
        }
        // Stop distance (mage orb)
        if (p.stopDistance && p.traveled >= p.stopDistance) {
          p.active = false;
          continue;
        }
        // Player hit
        const dx = player.x - p.x, dz = player.z - p.z;
        const r = p.radius + PROJ_RADIUS;
        if (dx * dx + dz * dz <= r * r) {
          if (this.state.invulnTimer <= 0 && this.onPlayerDamaged) {
            this.onPlayerDamaged(p.damage, { source: 'projectile', x: p.x, z: p.z });
          }
          p.active = false;
        }
      }
    };
    update(this._arrowPool);
    update(this._orbPool);
  }

  /** Enemy death: credit orbs + 15% health roll + purple burst. */
  _onEnemyDeath(enemy) {
    const drops = enemy.drops ?? 1;
    if (this.onKill) {
      this.onKill(enemy, {
        drops,
        healthChance: Math.random() < ENEMY.HEALTH_DROP_CHANCE,
        x: enemy.position.x,
        z: enemy.position.z,
      });
    }
  }

  // =========================================================================
  // Shared helpers (§6) — LOS ray march + greedy 4-neighbor pathing
  // =========================================================================

  /**
   * Line-of-sight ray march from (ax, az) to (bx, bz) in 0.4 u steps,
   * radius 0.25. Returns false (blocked) on first wall hit.
   * Shared by enemies and hunter.
   */
  static hasLOS(boxes, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const steps = Math.ceil(d / LOS_STEP);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (boxes.length &&
          circleHitsBox(boxes, ax + dx * t, az + dz * t, LOS_RADIUS)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Greedy 4-neighbor path step from (px, pz) toward (tx, tz).
   * Picks the adjacent direction (0.4 u probe) that doesn't hit a wall.
   * Returns {x, z} new position or null if fully blocked.
   * Re-evaluate every 300 ms (caller's responsibility).
   */
  static greedyStep(boxes, px, pz, tx, tz) {
    const dx = tx - px, dz = tz - pz;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // Prefer the axis with the larger error.
    if (Math.abs(dx) >= Math.abs(dz)) dirs.reverse();
    for (const [mx, mz] of dirs) {
      const probeX = px + mx * 0.4, probeZ = pz + mz * 0.4;
      if (boxes.length && circleHitsBox(boxes, probeX, probeZ, RADIUS)) continue;
      return { x: probeX, z: probeZ };
    }
    return null;
  }

  /**
   * Sub-stepped movement helper: move a circle of `radius` from (px,pz)
   * toward (tx,tz) by at most `dist`, resolving collisions each sliver (≤0.08 u).
   * Shared by enemies and hunter. Returns {x, z} final position.
   */
  static subStepMove(boxes, px, pz, tx, tz, dist, radius) {
    if (dist <= 0) return { x: px, z: pz };
    const dx = tx - px, dz = tz - pz;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return { x: px, z: pz };
    const nx = dx / d, nz = dz / d;
    const pos = { x: px, z: pz };
    let remaining = dist;
    while (remaining > 1e-6) {
      const step = Math.min(STEP, remaining);
      pos.x += nx * step;
      pos.z += nz * step;
      if (boxes.length) resolveCircleCollisions(boxes, pos, radius);
      remaining -= step;
    }
    return pos;
  }

  /**
   * Apply damage to a skeleton. Handles death (onKill credits orbs + 15%
   * health + purple burst via OrbSystem), removes from living list.
   * Returns true if this hit killed the enemy.
   */
  hitSkeleton(skeleton, dmg, origin = null) {
    if (skeleton._disposed || !skeleton.alive) return false;
    // Guard: non-finite / non-positive damage must never be applied — subtracting
    // NaN from hp makes hp NaN and `NaN <= 0` is always false, which would make
    // the enemy permanently unkillable (seen in the wild via a bad damageMult arg).
    if (!Number.isFinite(dmg) || dmg <= 0) return false;
    const killed = skeleton.hit(dmg);
    if (killed) {
      // Death is handled via onDeath (already fired by skeleton.hit).
      // Remove from living list.
      const idx = this.living.indexOf(skeleton);
      if (idx !== -1) this.living.splice(idx, 1);
    }
    return killed;
  }

  /**
   * Break (deactivate) all enemy projectiles whose direction falls within
   * `coneHalfAngle` of the sword's facing direction at (x, z).
   * Used by the sword's arc bolt / electric chain.
   */
  breakProjectiles(coneHalfAngle, x, z, facing) {
    const breakPool = (pool) => {
      for (const p of pool) {
        if (!p.active) continue;
        const pdx = x - p.x, pdz = z - p.z;
        const pd = Math.hypot(pdx, pdz) || 1e-6;
        const angle = Math.atan2(pdx, pdz) - facing;
        let diff = Math.abs(angle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff <= coneHalfAngle) {
          p.active = false;
        }
      }
    };
    breakPool(this._arrowPool);
    breakPool(this._orbPool);
  }

  // =========================================================================
  // Query
  // =========================================================================

  /** Spawn queue fully drained? */
  queueDrained() {
    return this.spawnQueue.length === 0;
  }

  /** No living non-boss enemies AND queue drained. */
  fullyCleared() {
    if (!this.queueDrained()) return false;
    return this.living.every((s) => !s.alive);
  }

  // =========================================================================
  // Main update
  // =========================================================================

  /**
   * @param {number} dt delta seconds
   * @param {{x:number,z:number,invulnTimer?:number}} player
   * @param {object} [opts]
   *   opts.frozen  title-hold/safe-spawn: mobs idle
   *   opts.fleeing BRIGHT buff active: all enemies flee
   * @returns {boolean} false once fully disposed
   */
  update(dt, player, opts = {}) {
    if (this._disposed) return false;

    const frozen = !!opts.frozen;
    const fleeing = !!opts.fleeing;

    // --- Reveal queued spawns (§16.1) ---
    if (!frozen && this.spawnQueue.length > 0) {
      this.revealTimer += dt;
      while (this.revealTimer >= ENEMY.SPAWN_INTERVAL && this.spawnQueue.length > 0) {
        this.revealTimer -= ENEMY.SPAWN_INTERVAL;
        this._revealNext(player);
      }
    }

    // --- Update all living skeletons ---
    for (let i = this.living.length - 1; i >= 0; i--) {
      const s = this.living[i];
      if (s._disposed) { this.living.splice(i, 1); continue; }
      if (!s.alive && s.state === 'DEAD') {
        // Dying — let the death animation run; remove when disposed.
        s.update(dt, player, this.collisionBoxes, { frozen: false, fleeing: false });
        continue;
      }
      if (!s.alive) { this.living.splice(i, 1); continue; }
      // Freeze: > FROZEN_DIST from player → idle, no AI.
      const dx = player.x - s.position.x, dz = player.z - s.position.z;
      const distSq = dx * dx + dz * dz;
      const farFrozen = distSq > ENEMY.FROZEN_DIST * ENEMY.FROZEN_DIST;
      s.update(dt, player, this.collisionBoxes, {
        frozen: frozen || farFrozen,
        fleeing,
      });
    }

    // --- Enemy projectiles ---
    this._updateProjectiles(dt, player);

    // --- Boss update (§17) ---
    if (this.boss && this.boss.alive && !frozen) {
      this.boss.update(dt, player, this.dungeon, {
        collisionBoxes: this.collisionBoxes,
        onSummon: (x, z, idx) => {
          const w = this._spawnMob('WRAITH', x, z, false);
          if (w) w.onProjectile = (info) => this._fireEnemyProjectile(info);
          return w;
        },
        onBlinkHit: (x, z, r, d) => {
          if (this.onBlinkHit) this.onBlinkHit(x, z, r, d);
        },
      });
      this._tickBossSmoke(dt, player);
    }
    // Boss corpse: let it fade & dispose.
    if (this.boss && !this.boss.alive) {
      const alive = this.boss.update(dt, player, this.dungeon, {});
      if (!alive) this.boss = null;
    }

    // --- BURN: spawn once the level is fully cleared (§18) ---
    if (!this.isBossLevelFn(this.level) && !this._burnSpawned && !frozen) {
      this._trySpawnBurn(player);
    }

    return true;
  }

  // =========================================================================
  // Dispose
  // =========================================================================

  /** Dispose all skeletons, boss, projectiles, smoke clouds. Guards double. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    for (const s of this.living) {
      if (!s._disposed) s.dispose();
    }
    this.living.length = 0;

    if (this.boss && !this.boss._disposed) this.boss.dispose();
    this.boss = null;

    // Deactivate all projectiles.
    for (const p of this._arrowPool) p.active = false;
    for (const p of this._orbPool) p.active = false;
    // Deactivate all shockwaves.
    for (const s of this._shockwaves) s.active = false;
  }
}

export default SkeletonSystem;

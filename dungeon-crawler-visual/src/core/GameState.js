import { PLAYER, BUFF } from './Constants.js';

export class GameState {
  constructor({ runTime = 0, level = 1, collectedOrbs = 0, ngPlus = 0, bossKills = 0, weaponTier = 0, maxHealth = PLAYER.MAX_HEALTH } = {}) {
    this.player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    // The ONE souls counter (orbs = souls): banked ammo, score, spawn driver
    // AND the weapon-ladder source. No separate "lifetime" notion — spending
    // ammo never downgrades the weapon because the tier locks at the max
    // reached (weaponTier is only ever raised).
    this.collectedOrbs = collectedOrbs;
    this.weaponTier = weaponTier;   // evolution tier (0..5), locked at max reached
    this.ngPlus = ngPlus;   // New Game+ cycle: enemies have +100% HP per cycle
    this.bossKills = bossKills; // permanent: mobs +10% move/attack speed per boss kill
    this.totalOrbs = 0;   // pickups present on the current level
    this.health = maxHealth;
    this.maxHealth = maxHealth; // permanent max (grows with boss hearts)
    this.invulnTimer = 0;
    this.safeSpawn = 0;   // level-start protection: player immobile + invincible
                          // while >0 (counts down), mobs don't track until 0
    this.visitedCells = new Set();
    this.dungeonSeed = Date.now();
    this.effectsEnabled = true;
    this.minimapVisible = true;
    this.pointerLocked = false;
    this.inExitRoom = false;
    this.runTime = runTime;   // total seconds across all levels (never resets mid-run)
    this.level = level;       // 1-based current level
    this.levelTime = 0;       // seconds spent on the current level
    // --- Extended spec ---
    this.biome = 'STONE';     // current biome id (string key of BIOMES)
    this.biomeIndex = 0;      // floor((level-1)/2) % 5
    this.swordCombo = 0;      // 0 | 1 | 2 — current combo step for HUD
    this.hitStop = 0;         // seconds of world-freeze remaining (Game-managed)
    // Sprint acceleration: sprinting (Shift + movement) for
    // SPRINT_ACCEL_WINDOW consecutive seconds grants +SPRINT_ACCEL_STEP
    // sprint speed per tier, cumulative. Resets when sprinting stops.
    this.sprintHoldTime = 0;
    this.sprintTier = 0;
    // Temporary buff (from broken breakables): 0 = none | 1 = BRIGHT |
    // 2 = FIREBALL | 3 = EMPOWERED, lasting BUFF.DURATION seconds.
    this.buffEffect = 0;
    this.buffTime = 0;
  }

  // Apply a buff (1..4) — replaces any active buff. Boss-kill buffs use
  // BUFF.BOSS_DURATION (5 min) and are NOT capped; breakable buffs use
  // BUFF.DURATION and are hard-capped at BUFF.MAX_DURATION (1:30).
  applyBuff(effect, duration = BUFF.DURATION, { cap = true } = {}) {
    this.buffEffect = effect;
    this.buffTime = cap ? Math.min(duration, BUFF.MAX_DURATION) : duration;
  }

  // Tick the buff timer; returns true on the frame the buff expires.
  updateBuff(dt) {
    if (this.buffTime <= 0) return false;
    this.buffTime -= dt;
    if (this.buffTime <= 0) {
      this.buffTime = 0;
      this.buffEffect = 0;
      return true;
    }
    return false;
  }

  get buffActive() {
    return this.buffEffect !== 0 && this.buffTime > 0;
  }

  // Tick the sprint-acceleration clock. `sprinting` = Shift held,
  // `moving` = a movement key is down (acceleration only builds while
  // actually sprinting somewhere).
  updateSprint(dt, sprinting, moving) {
    if (!sprinting || !moving) {
      this.sprintHoldTime = 0;
      this.sprintTier = 0;
      return;
    }
    this.sprintHoldTime += dt;
    const tier = Math.floor(this.sprintHoldTime / PLAYER.SPRINT_ACCEL_WINDOW);
    if (tier > this.sprintTier) this.sprintTier = tier;
  }

  // Current sprint acceleration multiplier: 1 + 5% per completed 1s tier,
  // CAPPED at SPRINT_ACCEL_MAX (×3) so an endless sprint can't break the
  // game (user ruling).
  get sprintSpeedMult() {
    return Math.min(PLAYER.SPRINT_ACCEL_MAX, 1 + PLAYER.SPRINT_ACCEL_STEP * this.sprintTier);
  }

  // Save/load: the run-meta fields that must survive a death-save. Everything
  // else (position, timers, buff, level-internal state) resets on load — the
  // player restarts the CURRENT level from the beginning.
  toJSON() {
    return {
      runTime: this.runTime,
      level: this.level,
      collectedOrbs: this.collectedOrbs,
      ngPlus: this.ngPlus,
      bossKills: this.bossKills,
      weaponTier: this.weaponTier,
      maxHealth: this.maxHealth,
    };
  }

  static fromJSON(data = {}) {
    const s = new GameState({
      runTime: data.runTime || 0,
      level: data.level || 1,
      collectedOrbs: data.collectedOrbs || 0,
      ngPlus: data.ngPlus || 0,
      bossKills: data.bossKills || 0,
      weaponTier: data.weaponTier || 0,
    });
    // Permanent hearts carry; health always starts a (re)loaded level full.
    // Self-heal stale saves: hearts only ever grow (+1 per boss kill, kept on
    // NG+/load), so maxHealth can never be below base + bossKills — old saves
    // made while state.maxHealth was desynced (level-advance bug) get bumped
    // back up instead of silently resetting the player's hearts.
    s.maxHealth = Math.max(
      data.maxHealth || PLAYER.MAX_HEALTH,
      PLAYER.MAX_HEALTH + (data.bossKills || 0),
    );
    s.health = s.maxHealth;
    return s;
  }
}

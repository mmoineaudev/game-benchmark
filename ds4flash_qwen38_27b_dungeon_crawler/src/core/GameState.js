/**
 * GameState.js — serializable run state (§4.5).
 * `collectedOrbs` is THE ONE souls counter: ammo, score, spawn + ladder source.
 * `weaponTier` is locked at the max reached within a run (never downgrades);
 * recomputed from the kept bank on NG+ (§26/§27).
 *
 * `_maxHealth` invariant (§27): maxHealth mirrors permanent hearts
 * (base 3 + 1 per boss kill). fromJSON self-heals stale desynced saves to
 * `base + bossKills`.
 */

import { PLAYER } from './Constants.js';

const BASE_HEALTH = PLAYER.BASE_HEALTH;
const SPRINT_ACCEL_WINDOW = PLAYER.SPRINT_ACCEL_WINDOW; // 1 s per tier
const SPRINT_ACCEL_STEP = PLAYER.SPRINT_ACCEL_STEP;     // +5% per tier
const SPRINT_MULT = PLAYER.SPRINT_MULT;                 // 1.55
const SPRINT_ACCEL_MAX = PLAYER.SPRINT_ACCEL_MAX;       // accel capped at ×3
const BUFF_DURATION = 60;
const BUFF_COUNT = 5; // effects 1..5

export class GameState {
  /**
   * @param {object} [options] — may include maxHealth (permanent hearts).
   */
  constructor(options = {}) {
    this.player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

    // Meta
    this.level = 1;
    this.runTime = 0;          // total run seconds
    this.levelTime = 0;        // seconds into the current level
    this.ngPlus = 0;
    this.bossKills = 0;
    this.kills = 0;              // cumulative mob kills (display stat, not saved)

    // Score / progression
    this.collectedOrbs = 0;    // THE ONE souls counter
    this.weaponTier = 0;       // 0..5, locked at max reached
    this.totalOrbs = 0;        // per-level pickup count (not scored)

    // Health
    this.maxHealth = options.maxHealth ?? BASE_HEALTH;
    this.health = this.maxHealth;

    // Timers / transient
    this.invulnTimer = 0;
    this.safeSpawn = PLAYER.SAFE_SPAWN;
    this.visitedCells = [];
    this.dungeonSeed = 0;
    this.effectsEnabled = true;
    this.minimapVisible = true;   // legacy/unused, kept in schema
    this.pointerLocked = false;
    this.inExitRoom = false;

    // Combat
    this.swordCombo = 0;
    this.hitStop = 0;

    // Sprint (per SPRINT_ACCEL rules)
    this.sprintHoldTime = 0;
    this.sprintTier = 0;

    // Buffs
    this.buffEffect = 0; // 0 = none, 1..5
    this.buffTime = 0;

    // Biome
    this.biome = null;
    this.biomeIndex = 0;
  }

  /**
   * Apply a buff. Replaces the current buff; the roll NEVER repeats the active
   * effect — if the rolled effect equals the active one, roll again among the
   * other 5 (i.e. among effects 1..5 excluding the active one).
   * @param {number} effect 1..5
   * @returns {number} the effect that was actually applied
   */
  applyBuff(effect) {
    let picked = effect;
    while (picked === this.buffEffect && this.buffEffect !== 0) {
      // roll again among the 5, excluding the active one
      let candidate;
      do {
        candidate = 1 + Math.floor(Math.random() * BUFF_COUNT);
      } while (candidate === this.buffEffect);
      picked = candidate;
    }
    this.buffEffect = picked;
    this.buffTime = BUFF_DURATION;
    return picked;
  }

  /** Tick the active buff down; clears it at 0. */
  updateBuff(dt) {
    if (this.buffTime <= 0) return;
    this.buffTime = Math.max(0, this.buffTime - dt);
    if (this.buffTime === 0) this.buffEffect = 0;
  }

  /**
   * Track sprint acceleration. +1 tier per full SPRINT_ACCEL_WINDOW (1 s) of
   * consecutive sprinting; resets to 0 when sprinting stops or during safe
   * spawn.
   * @param {number} dt seconds
   * @param {boolean} moving whether the player is currently sprinting
   */
  updateSprint(dt, moving) {
    if (!moving || this.safeSpawn > 0) {
      this.sprintHoldTime = 0;
      this.sprintTier = 0;
      return;
    }
    this.sprintHoldTime += dt;
    this.sprintTier = Math.floor(this.sprintHoldTime / SPRINT_ACCEL_WINDOW);
  }

  /**
   * Sprint speed multiplier: 1.55 × (1 + 0.05·tier), the accel component capped
   * at ×3; returns 1 when not sprinting.
   */
  sprintSpeedMult() {
    if (this.sprintTier <= 0 || this.safeSpawn > 0) return 1;
    const accel = Math.min(1 + SPRINT_ACCEL_STEP * this.sprintTier, SPRINT_ACCEL_MAX);
    return SPRINT_MULT * accel;
  }

  toJSON() {
    return this.serialize();
  }

  /**
   * F3 (C3): full serializable run snapshot for save/load (§26). Persists the
   * fields the Game loop actually reads (activeBuff/activeBuffTimer are the
   * live buff fields; buffEffect/buffTime are the unused legacy pair).
   */
  serialize() {
    return {
      level: this.level,
      runTime: this.runTime,
      levelTime: this.levelTime,
      ngPlus: this.ngPlus,
      bossKills: this.bossKills,
      kills: this.kills ?? 0,
      collectedOrbs: this.collectedOrbs,
      weaponTier: this.weaponTier,
      totalOrbs: this.totalOrbs ?? 0,
      maxHealth: this.maxHealth,
      health: this.health,
      activeBuff: this.activeBuff ?? null,
      activeBuffTimer: this.activeBuffTimer ?? 0,
      biome: this.biome,
      biomeIndex: this.biomeIndex,
      player: { ...this.player },
    };
  }

  /** Restore run state from a serialize() snapshot (in-place). */
  deserialize(data) {
    if (!data || typeof data !== 'object') return;
    this.level = data.level ?? 1;
    this.runTime = data.runTime ?? 0;
    this.levelTime = data.levelTime ?? 0;
    this.ngPlus = data.ngPlus ?? 0;
    this.bossKills = data.bossKills ?? 0;
    this.kills = data.kills ?? 0;
    this.collectedOrbs = data.collectedOrbs ?? 0;
    this.weaponTier = data.weaponTier ?? 0;
    this.totalOrbs = data.totalOrbs ?? 0;
    this.maxHealth = data.maxHealth ?? BASE_HEALTH;
    this.health = data.health ?? this.maxHealth;
    this.activeBuff = data.activeBuff ?? null;
    this.activeBuffTimer = data.activeBuffTimer ?? 0;
    this.biome = data.biome ?? null;
    this.biomeIndex = data.biomeIndex ?? 0;
    if (data.player) {
      this.player = { ...this.player, ...data.player };
    }
    // Self-heal: maxHealth mirrors permanent hearts (base + boss kills).
    if (this.maxHealth < BASE_HEALTH + this.bossKills) {
      this.maxHealth = BASE_HEALTH + this.bossKills;
    }
    if (this.health > this.maxHealth) this.health = this.maxHealth;
  }

  static fromJSON(data) {
    const s = new GameState({ maxHealth: data.maxHealth });
    s.level = data.level ?? 1;
    s.runTime = data.runTime ?? 0;
    s.collectedOrbs = data.collectedOrbs ?? 0;
    s.weaponTier = data.weaponTier ?? 0;
    s.ngPlus = data.ngPlus ?? 0;
    s.bossKills = data.bossKills ?? 0;
    s.biome = data.biome ?? null;
    s.biomeIndex = data.biomeIndex ?? 0;
    s.maxHealth = data.maxHealth ?? BASE_HEALTH;
    s.health = data.health ?? s.maxHealth;
    if (data.player) {
      s.player = { ...s.player, ...data.player };
    }
    // Self-heal stale saves: maxHealth must mirror permanent hearts.
    if (s.maxHealth < BASE_HEALTH + s.bossKills) {
      s.maxHealth = BASE_HEALTH + s.bossKills;
    }
    if (s.health > s.maxHealth) s.health = s.maxHealth;
    return s;
  }
}

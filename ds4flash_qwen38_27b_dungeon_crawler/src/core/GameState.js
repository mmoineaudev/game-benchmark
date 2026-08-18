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

    // Biome
    this.biome = null;
    this.biomeIndex = 0;
  }

  toJSON() {
    return this.serialize();
  }

  /**
   * F3 (C3): full serializable run snapshot for save/load (§26).
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

  /** Restore run state from a serialize() snapshot (new instance). */
  static fromJSON(data) {
    const s = new GameState({ maxHealth: data && data.maxHealth });
    s.deserialize(data);
    return s;
  }
}

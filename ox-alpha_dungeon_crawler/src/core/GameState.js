// GameState.js — serializable run state (§4.5)
import { PLAYER, weaponTier } from './Constants.js';

export default class GameState {
  constructor(opts = {}) {
    this.player = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
    this.collectedOrbs = opts.collectedOrbs ?? 0;   // THE ONE souls counter
    // weaponTier recomputed from the bank when constructed for NG+ / load
    this.weaponTier = opts.weaponTier ?? weaponTier(this.collectedOrbs);
    this.ngPlus = opts.ngPlus ?? 0;
    this.bossKills = opts.bossKills ?? 0;
    this.totalOrbs = 0;
    this.health = opts.maxHealth ?? PLAYER.MAX_HEALTH_BASE;
    // permanent hearts self-heal to base + bossKills if stale/desynced
    const healedMax = PLAYER.MAX_HEALTH_BASE + (opts.bossKills ?? 0);
    this.maxHealth = Math.max(opts.maxHealth ?? 0, healedMax);
    this.invulnTimer = 0;
    this.safeSpawn = 0;
    this.visitedCells = null;
    this.dungeonSeed = 0;
    this.effectsEnabled = true;
    this.minimapVisible = false;   // legacy/unused
    this.pointerLocked = false;
    this.inExitRoom = false;
    this.runTime = opts.runTime ?? 0;
    this.level = opts.level ?? 1;
    this.levelTime = 0;
    this.biome = 'STONE';
    this.biomeIndex = 0;
    this.swordCombo = 0;
    this.hitStop = 0;
    this.sprintHoldTime = 0;
    this.sprintTier = 0;
    this.buffEffect = 0;   // 0..5
    this.buffTime = 0;
  }

  static BUFF_NAMES = [null, 'BRIGHT', 'FIREBALL', 'EMPOWERED', 'GODSPEED', 'HUNTER'];

  applyBuff(effect, time) {
    // never the same buff twice in a row — caller enforces via rollBuff
    this.buffEffect = effect;
    this.buffTime = time;
  }

  updateBuff(dt) {
    if (this.buffEffect > 0) {
      this.buffTime -= dt;
      if (this.buffTime <= 0) { this.buffEffect = 0; this.buffTime = 0; return true; }
    }
    return false;
  }

  updateSprint(dt, sprinting, moving, safeSpawnActive) {
    if (!sprinting || !moving || safeSpawnActive) {
      this.sprintHoldTime = 0;
      this.sprintTier = 0;
      return;
    }
    this.sprintHoldTime += dt;
    while (this.sprintHoldTime >= PLAYER.SPRINT_ACCEL_WINDOW) {
      this.sprintHoldTime -= PLAYER.SPRINT_ACCEL_WINDOW;
      const next = 1 + (this.sprintMult() - 1 + PLAYER.SPRINT_ACCEL_STEP) / PLAYER.SPRINT_MULT;
      // tier accumulates multiplicatively on the base; cap total ×3
      this.sprintTier += 1;
    }
  }

  sprintSpeedMult() {
    let m = PLAYER.SPRINT_MULT * (1 + PLAYER.SPRINT_ACCEL_STEP * this.sprintTier);
    return Math.min(m, PLAYER.SPRINT_ACCEL_MAX);
  }

  // kept for HUD readout: the accel component only
  get sprintMult() { return 1 + PLAYER.SPRINT_ACCEL_STEP * this.sprintTier; }

  toJSON() {
    return {
      level: this.level,
      runTime: this.runTime,
      collectedOrbs: this.collectedOrbs,
      weaponTier: this.weaponTier,
      maxHealth: this.maxHealth,
      ngPlus: this.ngPlus,
      bossKills: this.bossKills,
      health: this.health
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') return null;
    const s = new GameState({
      level: json.level | 0 || 1,
      runTime: +json.runTime || 0,
      collectedOrbs: Math.max(0, json.collectedOrbs | 0),
      weaponTier: Math.max(0, Math.min(5, json.weaponTier | 0)),
      maxHealth: Math.max(PLAYER.MAX_HEALTH_BASE, json.maxHealth | 0),
      ngPlus: Math.max(0, json.ngPlus | 0),
      bossKills: Math.max(0, json.bossKills | 0)
    });
    s.health = s.maxHealth; // loading restarts the level fresh & full
    return s;
  }
}

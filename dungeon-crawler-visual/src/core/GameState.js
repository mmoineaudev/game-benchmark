import { PLAYER } from './Constants.js';

export class GameState {
  constructor({ runTime = 0, level = 1, collectedOrbs = 0 } = {}) {
    this.player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.collectedOrbs = collectedOrbs; // cumulative ammo/score (persists across levels)
    this.totalOrbs = 0;   // pickups present on the current level
    this.health = PLAYER.MAX_HEALTH;
    this.invulnTimer = 0;
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

  // Current sprint speed multiplier: 1 + 5% per completed 5s tier.
  get sprintSpeedMult() {
    return 1 + PLAYER.SPRINT_ACCEL_STEP * this.sprintTier;
  }
}

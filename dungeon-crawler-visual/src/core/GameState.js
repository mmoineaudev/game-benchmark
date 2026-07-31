export class GameState {
  constructor({ runTime = 0, level = 1 } = {}) {
    this.player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.collectedOrbs = 0;
    this.totalOrbs = 0;
    this.visitedCells = new Set();
    this.dungeonSeed = Date.now();
    this.effectsEnabled = true;
    this.minimapVisible = true;
    this.pointerLocked = false;
    this.inExitRoom = false;
    this.runTime = runTime;   // total seconds across all levels (never resets mid-run)
    this.level = level;       // 1-based current level
    this.levelTime = 0;       // seconds spent on the current level
  }
}

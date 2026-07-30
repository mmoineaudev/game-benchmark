export class GameState {
  constructor() {
    this.player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.collectedOrbs = 0;
    this.totalOrbs = 0;
    this.visitedCells = new Set();
    this.dungeonSeed = Date.now();
    this.effectsEnabled = true;
    this.minimapVisible = true;
    this.pointerLocked = false;
    this.inExitRoom = false;
  }
}

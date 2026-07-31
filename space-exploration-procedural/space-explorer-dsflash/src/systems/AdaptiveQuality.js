import { Constants } from '../core/Constants.js';

// Adaptive quality (spec v2.0 §7.2.5): rolling 60-frame FPS average.
// AQ1 (resolution ×0.85) when avg < 45 for 2 s; AQ2 (×0.7 + no CA/grain +
// eco lights) when < 30; recovers when > 55 for 3 s.
export class AdaptiveQuality {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this._frames = 0;
    this._acc = 0;
    this._fps = 60;
    this._lowTimer = 0;
    this._recoverTimer = 0;
    this._baseDpr = Math.min(window.devicePixelRatio || 1, Constants.DPR_MAX);
  }

  /** Feed one frame's dt (seconds). */
  update(dt) {
    const AQ = Constants.ADAPTIVE_QUALITY;
    if (dt > 0 && dt < 0.5) {
      this._acc += 1 / dt;
      this._frames++;
      if (this._frames >= AQ.sampleFrames) {
        this._fps = this._acc / this._frames;
        this._frames = 0;
        this._acc = 0;
      }
    }
    if (this._frames === 0) this._evaluate();
    return this.level;
  }

  _evaluate() {
    const AQ = Constants.ADAPTIVE_QUALITY;
    if (this._fps < AQ.hardFps) {
      this._lowTimer += 1; // ~1 sample per evaluate
      this._recoverTimer = 0;
      if (this._lowTimer >= AQ.dropHold && this.level < 2) this._setLevel(2);
    } else if (this._fps < AQ.dropFps) {
      this._lowTimer += 1;
      this._recoverTimer = 0;
      if (this._lowTimer >= AQ.dropHold && this.level < 1) this._setLevel(1);
    } else if (this._fps > AQ.recoverFps) {
      this._recoverTimer += 1;
      this._lowTimer = 0;
      if (this._recoverTimer >= AQ.recoverHold && this.level > 0) this._setLevel(this.level - 1);
    } else {
      this._lowTimer = 0;
      this._recoverTimer = 0;
    }
  }

  _setLevel(level) {
    this.level = level;
    const AQ = Constants.ADAPTIVE_QUALITY;
    const scale = level === 0 ? 1 : level === 1 ? AQ.scale1 : AQ.scale2;
    this.game.renderer.setPixelRatio(this._baseDpr * scale);
    // AQ2: drop CA + grain, eco lights
    if (this.game.post) {
      const dropFx = level >= 2;
      this.game.post.caPass.enabled = !dropFx;
      this.game.post.grainPass.enabled = !dropFx;
    }
    if (this.game.lightManager && level >= 2) {
      this.game.lightManager.setProfile('eco');
    } else if (this.game.lightManager && gameStateProfile() === 'auto') {
      this.game.lightManager.setProfile('auto');
    }
    this.game.state_adaptiveLevel = level;
  }

  getFps() { return this._fps; }
}

function gameStateProfile() {
  // read from the GameState singleton via the game instance's state reference
  return typeof window !== 'undefined' && window.__VOID_DRIFT__ ? window.__VOID_DRIFT__.state.lightProfile : 'auto';
}

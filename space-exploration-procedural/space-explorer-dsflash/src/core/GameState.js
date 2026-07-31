// Centralized state: player, combat, game (spec §2 architecture principle 3).
import { Constants } from './Constants.js';

class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.gameState = 'playing'; // 'playing' | 'paused' | 'dying' | 'dead'
    this.score = 0;
    this.distance = 0;          // cumulative odometer (monotonic)
    this.highScore = this._loadHighScore();
    this.biomeName = 'OPEN_SPACE';
    this.player = {
      health: Constants.MAX_HEALTH,
      maxHealth: Constants.MAX_HEALTH,
    };
    this.combat = {
      firedThisFrame: false,
      hitMarker: false,
    };
    this.deathReason = null;
    this.deathTime = 0;
    this.lastBiomeIndex = 0;
  }

  get alive() {
    return this.gameState === 'playing' || this.gameState === 'paused';
  }

  takeDamage(amount, source) {
    if (!this.alive || this._invulnerable) return false;
    this.player.health = Math.max(0, this.player.health - amount);
    this._invulnTimer = Constants.DAMAGE_INVULNERABILITY;
    if (this.player.health <= 0) {
      this.deathReason = source || 'collision';
      return 'dead';
    }
    return this.player.health;
  }

  get invulnerable() {
    return this._invulnTimer > 0;
  }

  tickInvulnerability(dt) {
    if (this._invulnTimer > 0) this._invulnTimer -= dt;
  }

  addScore(delta, reason) {
    if (!this.alive) return;
    this.score += delta;
    return this.score;
  }

  addDistance(delta) {
    if (!this.alive) return;
    this.distance += delta;
    return this.distance;
  }

  saveHighScore() {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try {
        localStorage.setItem(Constants.HIGH_SCORE_KEY, String(this.highScore));
      } catch { /* private mode */ }
      return true;
    }
    return false;
  }

  _loadHighScore() {
    try {
      return parseInt(localStorage.getItem(Constants.HIGH_SCORE_KEY) || '0', 10) || 0;
    } catch {
      return 0;
    }
  }
}

export const gameState = new GameState();

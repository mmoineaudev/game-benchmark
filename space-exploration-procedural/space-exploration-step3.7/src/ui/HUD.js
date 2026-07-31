// ============================================================
// HUD — Score, distance, health overlay
// ============================================================
import GameState from '../core/GameState.js';
import Constants from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

class HUD {
  constructor() {
    this._healthFill = document.getElementById('health-fill');
    this._warningOverlay = document.getElementById('warning-overlay');
    this._scoreEl = document.getElementById('score-display');
    this._distanceEl = document.getElementById('distance-display');
    this._gameOver = document.getElementById('game-over');
    this._goScore = document.getElementById('go-score');
    this._goDistance = document.getElementById('go-distance');
    this._goHigh = document.getElementById('go-highscore');
  }

  init() {
    EventBus.on('game:tick', () => {
      this.updateHealthBar();
      this.updateScore();
      this.updateDistance();
      this.checkWarning();
    });

    EventBus.on('game:restart', () => {
      this.updateHealthBar();
      this.updateScore();
      this.updateDistance();
      this._warningOverlay?.classList.remove('active');
    });

    this.updateHealthBar();
    this.updateScore();
    this.updateDistance();
  }

  updateHealthBar() {
    if (!this._healthFill) return;
    const pct = Math.max(0, (GameState.health / Constants.HEALTH.MAX) * 100);
    this._healthFill.style.width = pct + '%';
    if (pct > 60) {
      this._healthFill.style.background = 'linear-gradient(90deg, #22cc66, #44ee88)';
    } else if (pct > 30) {
      this._healthFill.style.background = 'linear-gradient(90deg, #cccc22, #eeee44)';
    } else {
      this._healthFill.style.background = 'linear-gradient(90deg, #cc2222, #ee4444)';
    }
  }

  updateScore() {
    if (this._scoreEl) {
      this._scoreEl.textContent = `SCORE: ${GameState.score.toLocaleString()}`;
    }
  }

  updateDistance() {
    if (this._distanceEl) {
      this._distanceEl.textContent = `DISTANCE: ${Math.floor(GameState.distance).toLocaleString()} units`;
    }
  }

  checkWarning() {
    if (!this._warningOverlay) return;
    if (GameState.health <= Constants.HEALTH.WARNING_THRESHOLD && GameState.isAlive) {
      if (!this._warningOverlay.classList.contains('active')) {
        this._warningOverlay.classList.add('active');
      }
    } else {
      this._warningOverlay.classList.remove('active');
    }
  }

  damageFlash() {
    if (this._healthFill) {
      this._healthFill.style.filter = 'brightness(2) saturate(0.5)';
      setTimeout(() => {
        if (this._healthFill) this._healthFill.style.filter = '';
      }, 100);
    }
  }

  screenFlash(color = '#ff0000', duration = 100) {
    const flash = document.createElement('div');
    flash.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: ${color}; opacity: 0.25; pointer-events: none; z-index: 20; transition: opacity ${duration}ms ease-out;`;
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), duration);
    });
  }

  showGameOver(score, highScore) {
    if (!this._gameOver) return;
    this._gameOver.classList.add('active');
    this._goScore.textContent = `Score: ${score.toLocaleString()}`;
    this._goDistance.textContent = `Distance: ${Math.floor(GameState.distance).toLocaleString()} units`;
    this._goHigh.textContent = `High Score: ${highScore.toLocaleString()}`;
  }

  hideGameOver() {
    if (this._gameOver) this._gameOver.classList.remove('active');
  }
}

export default HUD;

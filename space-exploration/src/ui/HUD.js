// ============================================================
// HUD — Score, distance, health overlay
// ============================================================
import GameState from '../core/GameState.js';
import Constants from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

class HUD {
  constructor() {
    this._healthBar = document.getElementById('health-bar');
    this._warningOverlay = document.getElementById('warning-overlay');
    this._scoreEl = document.getElementById('score-display');
    this._distanceEl = document.getElementById('distance-display');
  }

  init() {
    // Listen for state changes
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
      this._warningOverlay.classList.remove('active');
    });

    this.updateHealthBar();
    this.updateScore();
    this.updateDistance();
  }

  updateHealthBar() {
    if (!this._healthBar) return;

    const health = GameState.health;
    const maxHealth = Constants.HEALTH.MAX;
    const pct = Math.max(0, (health / maxHealth) * 100);

    this._healthBar.style.width = pct + '%';

    // Color transitions: green → yellow → red
    if (pct > 60) {
      this._healthBar.style.background = 'linear-gradient(90deg, #22cc66, #44ee88)';
    } else if (pct > 30) {
      this._healthBar.style.background = 'linear-gradient(90deg, #cccc22, #eeee44)';
    } else {
      this._healthBar.style.background = 'linear-gradient(90deg, #cc2222, #ee4444)';
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
    if (GameState.health <= Constants.HEALTH.WARNING_THRESHOLD && GameState.isAlive) {
      if (!this._warningOverlay.classList.contains('active')) {
        this._warningOverlay.classList.add('active');
        EventBus.emit('audio:warning', {});
      }
    } else {
      this._warningOverlay.classList.remove('active');
    }
  }

  damageFlash() {
    // Brief red flash on health bar
    if (this._healthBar) {
      this._healthBar.style.filter = 'brightness(2) saturate(0.5)';
      setTimeout(() => {
        if (this._healthBar) {
          this._healthBar.style.filter = '';
        }
      }, 100);
    }
  }

  screenFlash(color = '#ff0000', duration = 100) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: ${color}; opacity: 0.3; pointer-events: none; z-index: 20;
      transition: opacity ${duration}ms ease-out;
    `;
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), duration);
    });
  }
}

export default HUD;

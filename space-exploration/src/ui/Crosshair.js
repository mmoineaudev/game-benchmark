// ============================================================
// Crosshair — Reticle for targeting
// ============================================================
import EventBus from '../core/EventBus.js';

class Crosshair {
  constructor() {
    this._crosshair = document.getElementById('crosshair');
    this._lastFireTime = 0;
  }

  init() {
    // Listen for fire events to add visual feedback
    EventBus.on('weapon:fire', () => {
      this._onFire();
    });

    // Listen for game over
    EventBus.on('game:gameover', () => {
      if (this._crosshair) {
        this._crosshair.style.opacity = '0.2';
      }
    });

    EventBus.on('game:restart', () => {
      if (this._crosshair) {
        this._crosshair.style.opacity = '1';
      }
    });
  }

  _onFire() {
    if (!this._crosshair) return;
    
    // Brief scale pulse on fire
    this._crosshair.style.transform = 'translate(-50%, -50%) scale(1.3)';
    this._crosshair.style.opacity = '0.8';
    setTimeout(() => {
      if (this._crosshair) {
        this._crosshair.style.transform = 'translate(-50%, -50%) scale(1)';
        this._crosshair.style.opacity = '1';
      }
    }, 80);
  }
}

export default Crosshair;

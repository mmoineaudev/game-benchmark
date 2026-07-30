// =============================================================================
// DeathScreen — DOM overlay when player dies.
// =============================================================================

import { getEventBus, Events } from '../core/EventBus.js';
import { Logger } from '../core/Logger.js';

export class DeathScreen {
  constructor(container) {
    this._container = container;
    this._bus = getEventBus();
    this._el = null;
  }

  show(cause, depth, oresMined, metaCreditsEarned) {
    if (this._el) this.hide();

    const el = document.createElement('div');
    el.id = 'death-screen';
    el.innerHTML = `
      <style>
        #death-screen {
          position: absolute; inset: 0;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: rgba(10,0,0,0.85);
          font-family: 'Courier New', monospace; color: #ddd;
          z-index: 100; pointer-events: auto;
        }
        #death-screen h2 {
          font-size: 32px; color: #e04040; margin-bottom: 16px; letter-spacing: 4px;
        }
        #death-screen .stat { font-size: 14px; margin: 4px 0; opacity: 0.9; }
        #death-screen .stat span { color: #ccc; font-weight: bold; }
        #death-screen .btn {
          margin-top: 24px; padding: 10px 32px;
          background: #c04040; color: #fff; border: none;
          font-family: inherit; font-size: 16px; cursor: pointer;
          border-radius: 4px; text-transform: uppercase; letter-spacing: 2px;
        }
        #death-screen .btn:hover { background: #d05050; }
      </style>
      <h2>${cause.toUpperCase()}</h2>
      <div class="stat">Depth reached: <span>${depth}m</span></div>
      <div class="stat">Ores mined: <span>${oresMined}</span></div>
      <div class="stat">Credits lost: <span>all cargo</span></div>
      <button class="btn" id="death-return-btn">Return to Hub</button>
    `;
    this._container.appendChild(el);
    this._el = el;

    const btn = el.querySelector('#death-return-btn');
    btn.addEventListener('click', () => {
      Logger.info('DeathScreen', 'return to hub clicked');
      this._bus.emit(Events.GAME_RESTART);
      this.hide();
    });

    Logger.info('DeathScreen', `shown: ${cause} at ${depth}m`);
  }

  hide() {
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }

  dispose() {
    this.hide();
    Logger.info('DeathScreen', 'disposed');
  }
}

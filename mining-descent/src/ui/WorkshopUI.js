// =============================================================================
// WorkshopUI — DOM overlay for the hub upgrade panel.
// =============================================================================

import { META } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';

export class WorkshopUI {
  constructor(container, metaProgression) {
    this._container = container;
    this._meta = metaProgression;
    this._bus = getEventBus();
    this._state = getGameState();
    this._el = null;
    this._unsubs = [];
  }

  init() {
    // Listen for meta updates to refresh
    this._unsubs.push(this._bus.on(Events.META_UPDATED, () => this._render()));

    Logger.info('WorkshopUI', 'initialized');
  }

  show() {
    if (this._el) this.hide();

    const el = document.createElement('div');
    el.id = 'workshop-ui';
    el.innerHTML = `
      <style>
        #workshop-ui {
          position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%);
          background: rgba(10,10,20,0.9); border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px; padding: 16px 20px;
          font-family: 'Courier New', monospace; color: #ccc;
          z-index: 50; pointer-events: auto; min-width: 280px;
        }
        #workshop-ui h3 { margin: 0 0 12px; font-size: 16px; color: #e8a030; letter-spacing: 2px; }
        #workshop-ui .credits { font-size: 12px; margin-bottom: 12px; color: #aaa; }
        #workshop-ui .upgrade { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-top: 1px solid rgba(255,255,255,0.1); }
        #workshop-ui .upgrade-name { font-size: 13px; }
        #workshop-ui .upgrade-level { font-size: 11px; color: #888; }
        #workshop-ui .upgrade-btn {
          padding: 4px 12px; background: #e8a030; color: #000; border: none;
          font-family: inherit; font-size: 12px; cursor: pointer; border-radius: 3px;
          text-transform: uppercase; font-weight: bold;
        }
        #workshop-ui .upgrade-btn:disabled { background: #444; color: #666; cursor: not-allowed; }
        #workshop-ui .upgrade-btn:hover:not(:disabled) { background: #f0b040; }
        #workshop-ui .close-btn {
          margin-top: 12px; width: 100%; padding: 6px;
          background: transparent; border: 1px solid rgba(255,255,255,0.3);
          color: #aaa; font-family: inherit; font-size: 12px; cursor: pointer;
          border-radius: 3px;
        }
      </style>
      <h3>WORKSHOP</h3>
      <div class="credits" id="ws-credits">Credits: ${this._state.meta.currency}</div>
      <div id="ws-upgrades"></div>
      <button class="close-btn" id="ws-close">CLOSE</button>
    `;
    this._container.appendChild(el);
    this._el = el;

    this._renderUpgrades();

    el.querySelector('#ws-close').addEventListener('click', () => this.hide());

    Logger.debug('WorkshopUI', 'shown');
  }

  _renderUpgrades() {
    const container = this._el?.querySelector('#ws-upgrades');
    const creditsEl = this._el?.querySelector('#ws-credits');
    if (!container) return;

    if (creditsEl) creditsEl.textContent = `Credits: ${this._state.meta.currency}`;

    const infos = this._meta.getAllUpgradeInfos();
    container.innerHTML = '';

    for (const [key, info] of Object.entries(infos)) {
      const div = document.createElement('div');
      div.className = 'upgrade';
      div.innerHTML = `
        <div>
          <div class="upgrade-name">${info.name}</div>
          <div class="upgrade-level">Level ${info.currentLevel}/${info.maxLevel}</div>
        </div>
        <button class="upgrade-btn" data-key="${key}"
          ${!info.canAfford ? 'disabled' : ''}>
          ${info.atMax ? 'MAX' : `${info.cost} cr`}
        </button>
      `;
      const btn = div.querySelector('.upgrade-btn');
      btn.addEventListener('click', () => {
        if (this._meta.purchase(key)) {
          this._render();
        }
      });
      container.appendChild(div);
    }
  }

  _render() {
    this._renderUpgrades();
  }

  hide() {
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
  }

  dispose() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    this.hide();
    Logger.info('WorkshopUI', 'disposed');
  }
}

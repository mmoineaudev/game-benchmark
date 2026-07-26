import { state } from '../core/GameState.js';
import { ORE } from '../core/Constants.js';
import { bus } from '../core/EventBus.js';
import { EVENTS } from '../core/Constants.js';

// DOM-based HUD
export class HUD {
  constructor() {
    this._hudEl = document.getElementById('hud');
    this._depthEl = document.getElementById('depth-display');
    this._oreEl = document.getElementById('ore-counter');
    this._msgEl = document.getElementById('message');
    this._msgTimeout = null;

    this._build();
    this._bindEvents();
  }

  _build() {
    this._hudEl.innerHTML = `
      <div class="bar-container">
        <span style="color:#f90;width:40px;">Fuel</span>
        <div class="bar-bg"><div class="bar-fill fuel" id="fuel-bar" style="width:100%"></div></div>
        <span id="fuel-text" style="width:40px;font-size:12px;">50</span>
      </div>
      <div class="bar-container">
        <span style="color:#09f;width:40px;">O₂</span>
        <div class="bar-bg"><div class="bar-fill oxygen" id="oxygen-bar" style="width:100%"></div></div>
        <span id="oxygen-text" style="width:40px;font-size:12px;">120</span>
      </div>
      <div class="bar-container">
        <span style="color:#0f0;width:40px;">Hull</span>
        <div class="bar-bg"><div class="bar-fill hull" id="hull-bar" style="width:100%"></div></div>
        <span id="hull-text" style="width:40px;font-size:12px;">100</span>
      </div>
    `;
  }

  _bindEvents() {
    bus.on(EVENTS.RESOURCE_CHANGED, () => this._update());
    bus.on(EVENTS.DEPTH_CHANGED, () => this._updateDepth());
    bus.on(EVENTS.ORE_COLLECTED, () => this._updateOres());
  }

  _update() {
    const fuelPct = Math.max(0, (state.fuel / state.maxFuel) * 100);
    const oxyPct = Math.max(0, (state.oxygen / state.maxOxygen) * 100);
    const hullPct = Math.max(0, (state.hull / state.maxHull) * 100);

    document.getElementById('fuel-bar').style.width = fuelPct + '%';
    document.getElementById('fuel-text').textContent = Math.floor(state.fuel);
    document.getElementById('oxygen-bar').style.width = oxyPct + '%';
    document.getElementById('oxygen-text').textContent = Math.floor(state.oxygen);
    document.getElementById('hull-bar').style.width = hullPct + '%';
    document.getElementById('hull-text').textContent = Math.floor(state.hull);
  }

  _updateDepth() {
    this._depthEl.textContent = `${state.depth}m`;
  }

  _updateOres() {
    let html = '';
    for (const [key, count] of Object.entries(state.oreInventory)) {
      const def = ORE[key];
      if (def && count > 0) {
        html += `<span class="ore-item" style="color:${def.color};">${def.name}: ${count}</span>`;
      }
    }
    if (!html) html = '<span style="color:#555;">No ore</span>';
    html += ` <span style="color:#888;margin-left:8px;">[${this._usedSlots()}/${state.cargoMax}]</span>`;
    this._oreEl.innerHTML = html;
  }

  _usedSlots() {
    let sum = 0;
    for (const v of Object.values(state.oreInventory)) sum += v;
    return sum;
  }

  showMessage(text, duration = 2) {
    if (this._msgTimeout) clearTimeout(this._msgTimeout);
    this._msgEl.textContent = text;
    this._msgEl.classList.add('show');
    this._msgTimeout = setTimeout(() => {
      this._msgEl.classList.remove('show');
    }, duration * 1000);
  }

  update() {
    this._update();
    this._updateDepth();
    this._updateOres();
  }
}

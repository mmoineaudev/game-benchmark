// =============================================================================
// HUD — DOM overlay: fuel bar, O2 bar, ore counter, depth meter.
// =============================================================================

import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';

export class HUD {
  constructor(container) {
    this._container = container;
    this._bus = getEventBus();
    this._state = getGameState();
    this._el = null;
    this._unsubs = [];
  }

  init() {
    const el = document.createElement('div');
    el.id = 'hud';
    el.innerHTML = `
      <style>
        #hud {
          position: absolute; bottom: 16px; left: 50%;
          transform: translateX(-50%);
          display: flex; gap: 16px; align-items: flex-end;
          font-family: 'Courier New', monospace; color: #ddd;
          text-shadow: 0 0 6px rgba(0,0,0,0.8);
          pointer-events: none;
        }
        #hud .bar-group { display: flex; flex-direction: column; align-items: center; gap: 4px; }
        #hud .bar-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.8; }
        #hud .bar-outer { width: 80px; height: 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); border-radius: 2px; overflow: hidden; }
        #hud .bar-inner { height: 100%; transition: width 0.3s ease; }
        #hud .bar-value { font-size: 11px; margin-top: 2px; }
        #hud .hud-separator { width: 1px; height: 40px; background: rgba(255,255,255,0.15); }
        #hud .stat-group { text-align: center; min-width: 50px; }
        #hud .stat-label { font-size: 10px; opacity: 0.7; text-transform: uppercase; letter-spacing: 1px; }
        #hud .stat-value { font-size: 18px; font-weight: bold; }
        #fuel-bar { background: #e8a030; }
        #o2-bar { background: #30a0d0; }
        #hull-bar { background: #d03030; }
        #hud.danger #fuel-bar, #hud.danger #o2-bar, #hud.danger #hull-bar { animation: blink 0.5s infinite; }
        @keyframes blink { 50% { opacity: 0.4; } }
      </style>
      <div class="bar-group">
        <div class="bar-label">Fuel</div>
        <div class="bar-outer"><div class="bar-inner" id="fuel-bar" style="width:100%"></div></div>
        <div class="bar-value" id="fuel-val">50/50</div>
      </div>
      <div class="bar-group">
        <div class="bar-label">O₂</div>
        <div class="bar-outer"><div class="bar-inner" id="o2-bar" style="width:100%"></div></div>
        <div class="bar-value" id="o2-val">120/120</div>
      </div>
      <div class="bar-group">
        <div class="bar-label">Hull</div>
        <div class="bar-outer"><div class="bar-inner" id="hull-bar" style="width:100%"></div></div>
        <div class="bar-value" id="hull-val">100/100</div>
      </div>
      <div class="hud-separator"></div>
      <div class="stat-group">
        <div class="stat-label">Depth</div>
        <div class="stat-value" id="depth-val">0m</div>
      </div>
      <div class="stat-group">
        <div class="stat-label">Ore</div>
        <div class="stat-value" id="ore-val">0</div>
      </div>
      <div class="hud-separator"></div>
      <div class="stat-group" style="min-width:160px">
        <div class="stat-label" style="font-size:9px">ARROWS: Move</div>
        <div class="stat-label" style="font-size:9px;color:#e8a030">HOLD DOWN: Dig</div>
        <div class="stat-label" style="font-size:9px;color:#aaa">MOUSE DRAG: Rotate view</div>
        <div class="stat-label" style="font-size:9px;color:#aaa">A/E: Orbit | ZQSD: Pan</div>
      </div>
    `;
    this._container.appendChild(el);
    this._el = el;

    // Subscribe to events
    this._unsubs.push(this._bus.on(Events.FUEL_CHANGED, this._updateFuel.bind(this)));
    this._unsubs.push(this._bus.on(Events.OXYGEN_CHANGED, this._updateO2.bind(this)));
    this._unsubs.push(this._bus.on(Events.HULL_CHANGED, this._updateHull.bind(this)));
    this._unsubs.push(this._bus.on(Events.DEPTH_CHANGED, this._updateDepth.bind(this)));
    this._unsubs.push(this._bus.on(Events.INVENTORY_CHANGED, this._updateOre.bind(this)));

    // Initial values
    this._updateFuel({ fuel: this._state.fuel, maxFuel: this._state.maxFuel });
    this._updateO2({ oxygen: this._state.oxygen, maxOxygen: this._state.maxOxygen });
    this._updateHull({ hull: this._state.hull, maxHull: this._state.maxHull });
    this._updateDepth({ depth: 0 });
    this._updateOre({ inventory: this._state.inventory });

    Logger.info('HUD', 'initialized');
  }

  _updateFuel({ fuel, maxFuel }) {
    const pct = Math.round((fuel / maxFuel) * 100);
    const fb = this._el.querySelector('#fuel-bar');
    const fv = this._el.querySelector('#fuel-val');
    if (fb) fb.style.width = pct + '%';
    if (fv) fv.textContent = `${Math.round(fuel)}/${maxFuel}`;
    this._checkDanger();
  }

  _updateO2({ oxygen, maxOxygen }) {
    const pct = Math.round((oxygen / maxOxygen) * 100);
    const ob = this._el.querySelector('#o2-bar');
    const ov = this._el.querySelector('#o2-val');
    if (ob) ob.style.width = pct + '%';
    if (ov) ov.textContent = `${Math.round(oxygen)}/${maxOxygen}`;
    this._checkDanger();
  }

  _updateHull({ hull, maxHull }) {
    const pct = Math.round((hull / maxHull) * 100);
    const hb = this._el.querySelector('#hull-bar');
    const hv = this._el.querySelector('#hull-val');
    if (hb) hb.style.width = pct + '%';
    if (hv) hv.textContent = `${Math.round(hull)}/${maxHull}`;
    this._checkDanger();
  }

  _updateDepth({ depth }) {
    const el = this._el.querySelector('#depth-val');
    if (el) el.textContent = depth + 'm';
  }

  _updateOre({ inventory }) {
    const total = Object.values(inventory || {}).reduce((a, b) => a + b, 0);
    const el = this._el.querySelector('#ore-val');
    if (el) el.textContent = total;
  }

  _checkDanger() {
    const s = this._state;
    const danger = (s.fuel < s.maxFuel * 0.15) || (s.oxygen < s.maxOxygen * 0.15) || (this._state.hull < this._state.maxHull * 0.15);
    if (this._el) this._el.classList.toggle('danger', danger);
  }

  /** Show/hide the HUD (hide in hub, show in descent). */
  setVisible(v) {
    if (this._el) this._el.style.display = v ? 'flex' : 'none';
  }

  dispose() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    Logger.info('HUD', 'disposed');
  }
}

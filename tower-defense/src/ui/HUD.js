import { BUDGET, TOWER_DEFS } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

export default class HUD {
  constructor(state) {
    this.state = state;
    this._selectedIdx = -1;
    this._buttons = [];

    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `<div class="hud-row"><span id="hud-money">$${BUDGET.startMoney}</span><span id="hud-wave">Wave 0</span><span id="hud-lives">Lives ${BUDGET.lives}</span></div><div class="tower-list"></div>`;
    document.getElementById('hud').appendChild(this.el);
    const list = this.el.querySelector('.tower-list');

    TOWER_DEFS.forEach((t, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'tower-choice';
      const btn = document.createElement('button');
      btn.className = 'tower-btn';
      btn.innerHTML = `<span class="tower-num">${i+1}</span><span class="tower-name">${t.name}</span><span class="tower-cost">$${t.cost}</span>`;
      btn.onclick = () => this._toggleTower(i);
      const label = document.createElement('div');
      label.className = 'tower-label';
      label.textContent = t.desc || '';
      wrap.appendChild(btn);
      wrap.appendChild(label);
      list.appendChild(wrap);
      this._buttons.push({ btn, wrap, idx: i });
    });

    const waveBtn = document.createElement('button');
    waveBtn.className = 'wave-btn';
    waveBtn.textContent = '▶ Start Wave';
    waveBtn.onclick = () => EventBus.emit('ui:startWave');
    list.appendChild(waveBtn);

    const newMapBtn = document.createElement('button');
    newMapBtn.className = 'newmap-btn';
    newMapBtn.textContent = '↻ New Map';
    newMapBtn.onclick = () => EventBus.emit('ui:regenerateMap');
    list.appendChild(newMapBtn);

    // Speed controls
    const speedRow = document.createElement('div');
    speedRow.className = 'speed-row';
    const speeds = [1, 2, 5, 10];
    speeds.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'speed-btn';
      btn.textContent = s === 1 ? '▶' : '▶▶'.repeat(Math.log2(s));
      btn.title = `${s}x speed`;
      btn.onclick = () => {
        this._speedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        EventBus.emit('ui:setSpeed', s);
      };
      if (s === 1) btn.classList.add('active');
      speedRow.appendChild(btn);
    });
    this._speedButtons = Array.from(speedRow.children);
    list.appendChild(speedRow);

    // Listen for external deselect
    EventBus.on('ui:deselectTower', () => this._deselect());
  }

  _toggleTower(idx) {
    if (this._selectedIdx === idx) {
      this._deselect();
      EventBus.emit('ui:deselectTower');
      return;
    }
    this._deselect();
    this._selectedIdx = idx;
    const b = this._buttons.find(x => x.idx === idx);
    if (b) { b.btn.classList.add('selected'); b.wrap.classList.add('selected'); }
    EventBus.emit('ui:selectTower', idx);
  }

  _deselect() {
    this._selectedIdx = -1;
    this._buttons.forEach(b => { b.btn.classList.remove('selected'); b.wrap.classList.remove('selected'); });
  }

  update(state, game) {
    document.getElementById('hud-money').textContent = `$${state.money}`;
    document.getElementById('hud-wave').textContent = `Wave ${state.wave}`;
    document.getElementById('hud-lives').textContent = `Lives ${state.lives}`;
    this._buttons.forEach(({ btn, idx }) => {
      btn.disabled = state.money < TOWER_DEFS[idx].cost;
      btn.title = state.money < TOWER_DEFS[idx].cost ? 'Not enough money' : `Place ${TOWER_DEFS[idx].name}`;
    });
  }

  reset() { this.el.remove(); }
}
import { state } from '../core/GameState.js';
import { UPGRADES } from '../core/Constants.js';

export class WorkshopUI {
  constructor(onDescend) {
    this._el = document.getElementById('workshop');
    this._listEl = document.getElementById('upgrade-list');
    this._balanceEl = document.getElementById('ore-balance');
    this._onDescend = onDescend;

    document.getElementById('btn-descend').addEventListener('click', () => this._onDescend());
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyD' && this._el.classList.contains('show')) {
        this._onDescend();
      }
    });

    this._render();
  }

  show() {
    this._render();
    this._el.classList.add('show');
  }

  hide() {
    this._el.classList.remove('show');
  }

  _render() {
    const ore = state.getMetaOre();
    this._balanceEl.textContent = `Ore: ${ore}`;

    let html = '';
    for (const def of UPGRADES) {
      const level = state.getUpgradeLevel(def.id);
      const maxed = level >= def.levels;
      const cost = state.getUpgradeCost(def.id);
      const canBuy = !maxed && ore >= cost;

      html += `<div class="upgrade-item ${maxed ? 'owned' : ''}" data-id="${def.id}">
        <div>
          <strong>${def.name}</strong> <span style="color:#888;">Lv.${level}/${def.levels}</span><br/>
          <span style="font-size:12px;color:#666;">${def.desc} (+${def.perLevel}${def.id === 'headlights' ? ' tiles' : ''})</span>
        </div>
        <div style="text-align:right;">
          ${maxed ? '<span style="color:#0a0;">MAX</span>' :
            `<span style="color:${canBuy ? '#f90' : '#666'};">${cost} ore</span>`}
        </div>
      </div>`;
    }
    this._listEl.innerHTML = html;

    // Click handlers
    this._listEl.querySelectorAll('.upgrade-item').forEach(el => {
      if (el.classList.contains('owned')) return;
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (state.purchaseUpgrade(id)) {
          this._render();
        }
      });
    });
  }
}

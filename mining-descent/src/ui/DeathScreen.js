import { state } from '../core/GameState.js';

export class DeathScreen {
  constructor(onHub) {
    this._el = document.getElementById('deathsreen');
    this._statsEl = document.getElementById('death-stats');
    this._onHub = onHub;

    document.getElementById('btn-hub').addEventListener('click', () => this._onHub());
  }

  show() {
    const ores = Object.entries(state.oreInventory)
      .filter(([_, v]) => v > 0)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || 'none';

    this._statsEl.innerHTML = `
      Depth: ${state.depth}m<br/>
      Enemies killed: ${state.enemiesKilled}<br/>
      Ores carried: ${ores}
    `;

    this._el.classList.add('show');
  }

  hide() {
    this._el.classList.remove('show');
  }
}

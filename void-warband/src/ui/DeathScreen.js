/**
 * DeathScreen.js — full-screen death overlay (SPEC §5 extraction rule, §7).
 *
 * Hidden by default. show(runStats) renders 'SHIP DESTROYED' plus the run
 * stats: sector reached, kills, scrap lost (forfeited unbanked), and the
 * count of cargo items lost. 'RESTART (R)' button triggers the same restart
 * path via the `onRestart` callback (KeyR is already handled by Game.js).
 */
import { SECTORS } from '../core/Constants.js';
import { GameState } from '../core/GameState.js';

class _DeathScreen {
  constructor() {
    /** @type {Function|null} called when the RESTART button is clicked. */
    this.onRestart = null;

    this._root = document.createElement('div');
    this._root.id = 'vw-death';
    this._root.style.display = 'none';

    _injectStyles();

    const title = document.createElement('div');
    title.className = 'vw-death-title';
    title.textContent = 'SHIP DESTROYED';

    this._sectorEl = document.createElement('div');
    this._sectorEl.className = 'vw-death-stat';
    this._killsEl = document.createElement('div');
    this._killsEl.className = 'vw-death-stat';
    this._scrapEl = document.createElement('div');
    this._scrapEl.className = 'vw-death-stat';
    this._cargoEl = document.createElement('div');
    this._cargoEl.className = 'vw-death-stat';

    const btn = document.createElement('button');
    btn.className = 'vw-death-restart';
    btn.textContent = 'RESTART (R)';
    btn.addEventListener('click', () => {
      if (typeof this.onRestart === 'function') this.onRestart();
    });

    this._root.append(title, this._sectorEl, this._killsEl, this._scrapEl,
      this._cargoEl, btn);
    document.body.appendChild(this._root);
  }

  /**
   * Show the death screen with a run's stats.
   * @param {object} runStats run object: {sector, kills, scrap, cargo}.
   */
  show(runStats) {
    const run = runStats || {};
    const sector = SECTORS[(run.sector ?? 1) - 1] ?? SECTORS[0];

    let cargoLost = 0;
    for (const [id, count] of Object.entries(run.cargo ?? {})) {
      cargoLost += id === 'scrap' ? 1 : count;
    }

    this._sectorEl.textContent = `SECTOR REACHED  ${sector.name} (S${run.sector ?? 1})`;
    this._killsEl.textContent = `KILLS  ${run.kills ?? 0}`;
    this._scrapEl.textContent = `WALLET (SAVED)  ${GameState.meta.scrap ?? 0}`;
    this._cargoEl.textContent = `CARGO LOST  ${cargoLost} item${cargoLost === 1 ? '' : 's'}`;

    this._root.style.display = 'block';
  }

  /** Hide the overlay. */
  hide() {
    this._root.style.display = 'none';
  }
}

/** Death screen CSS (injected once, id-scoped). */
function _injectStyles() {
  if (document.getElementById('vw-death-style')) return;
  const s = document.createElement('style');
  s.id = 'vw-death-style';
  s.textContent = `
  #vw-death { position: fixed; inset: 0; z-index: 800; display: none;
    background: rgba(10, 2, 2, .82);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e2e8f0; user-select: none;
    align-items: center; justify-content: center; text-align: center; }
  #vw-death .vw-death-title { font-size: 34px; letter-spacing: .2em;
    color: #ef4444; margin-bottom: 18px; }
  #vw-death .vw-death-stat { font-size: 14px; line-height: 1.7; }
  #vw-death .vw-death-restart { margin-top: 22px; font-family: inherit;
    font-size: 15px; letter-spacing: .15em;
    background: rgba(239,68,68,.12); color: #ef4444;
    border: 1px solid rgba(239,68,68,.5); border-radius: 6px;
    padding: 10px 32px; cursor: pointer; }
  `;
  document.head.appendChild(s);
}

export { _DeathScreen as DeathScreen };
export default _DeathScreen;

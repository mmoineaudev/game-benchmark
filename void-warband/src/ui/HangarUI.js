/**
 * HangarUI.js — full-screen hangar overlay (SPEC §7, phase HANGAR).
 *
 * Hidden by default. show() renders a dark monospace panel listing the 5
 * UPGRADES rows (name, level x/max, cost, buy button), the banked scrap
 * balance, and a LAUNCH button. buy(id) → gameState.applyUpgrade(id) →
 * refresh. The LAUNCH button invokes the `onLaunch` callback property.
 */
import { UPGRADES } from '../core/Constants.js';

class _HangarUI {
  /**
   * @param {object} gameState GameState singleton (scrap / upgrades).
   */
  constructor(gameState) {
    this.gameState = gameState;
    /** @type {Function|null} called when LAUNCH is pressed. */
    this.onLaunch = null;

    this._root = document.createElement('div');
    this._root.id = 'vw-hangar';
    this._root.style.display = 'none';

    _injectStyles();

    const title = document.createElement('div');
    title.className = 'vw-hangar-title';
    title.textContent = 'HANGAR';

    this._scrapEl = document.createElement('div');
    this._scrapEl.className = 'vw-hangar-scrap';

    this._rowsEl = document.createElement('div');
    this._rowsEl.className = 'vw-hangar-rows';

    const launch = document.createElement('button');
    launch.className = 'vw-hangar-launch';
    launch.textContent = 'LAUNCH';
    launch.addEventListener('click', () => {
      if (typeof this.onLaunch === 'function') this.onLaunch();
    });
    this._launchEl = launch;

    this._root.append(title, this._scrapEl, this._rowsEl, launch);
    document.body.appendChild(this._root);
  }

  /**
   * Cost of the next level of an upgrade, or null when maxed.
   * @param {object} u upgrade def.
   * @param {number} level current level.
   */
  _nextCost(u, level) {
    if (level >= u.max) return null;
    return u.costBase + u.costStep * level;
  }

  /**
   * Build/refresh one upgrade row's DOM in place (id-keyed).
   * @param {object} u upgrade def.
   * @param {HTMLElement} rowEl
   */
  _refreshRow(u, rowEl) {
    const level = this.gameState.upgradeLevel(u.id);
    const cost = this._nextCost(u, level);
    const maxed = cost === null;
    const scrap = this.gameState.meta.scrap;
    const affordable = !maxed && scrap >= cost;

    rowEl.querySelector('.vw-hangar-row-name').textContent = u.name;
    rowEl.querySelector('.vw-hangar-row-level').textContent =
      `${level} / ${u.max}`;
    const costEl = rowEl.querySelector('.vw-hangar-row-cost');
    costEl.textContent = maxed ? 'MAX' : `${cost} scrap`;
    const btn = rowEl.querySelector('.vw-hangar-buy');
    btn.textContent = maxed ? '—' : 'BUY';
    btn.disabled = maxed || !affordable;
  }

  /**
   * Show + refresh the hangar overlay (full list of 5 upgrades, scrap,
   * LAUNCH).
   */
  show() {
    this._root.style.display = 'block';
    this._rowsEl.innerHTML = '';
    for (const u of UPGRADES) {
      const row = document.createElement('div');
      row.className = 'vw-hangar-row';

      const name = document.createElement('div');
      name.className = 'vw-hangar-row-name';
      const level = document.createElement('div');
      level.className = 'vw-hangar-row-level';
      const cost = document.createElement('div');
      cost.className = 'vw-hangar-row-cost';
      const btn = document.createElement('button');
      btn.className = 'vw-hangar-buy';
      btn.addEventListener('click', () => {
        if (this.buy(u.id)) this.refresh();
      });

      row.append(name, level, cost, btn);
      this._rowsEl.appendChild(row);
      this._refreshRow(u, row);
    }
    this._scrapEl.textContent = `SCRAP ${this.gameState.meta.scrap}`;
  }

  /**
   * Refresh numbers in place (after a buy).
   */
  refresh() {
    const rows = Array.from(this._rowsEl.children);
    for (let i = 0; i < rows.length; i++) {
      this._refreshRow(UPGRADES[i], rows[i]);
    }
    this._scrapEl.textContent = `SCRAP ${this.gameState.meta.scrap}`;
  }

  /**
   * Buy an upgrade.
   * @param {string} id upgrade id.
   * @returns {boolean} whether the purchase succeeded.
   */
  buy(id) {
    return this.gameState.applyUpgrade(id);
  }

  /** Hide the overlay. */
  hide() {
    this._root.style.display = 'none';
  }
}

/** Hangar CSS (injected once, id-scoped). */
function _injectStyles() {
  if (document.getElementById('vw-hangar-style')) return;
  const s = document.createElement('style');
  s.id = 'vw-hangar-style';
  s.textContent = `
  #vw-hangar { position: fixed; inset: 0; z-index: 900; display: none;
    background: rgba(4, 6, 12, .92);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e2e8f0; user-select: none;
    align-items: center; justify-content: center; }
  #vw-hangar .vw-hangar-title { font-size: 28px; letter-spacing: .2em;
    text-align: center; margin-bottom: 18px; }
  #vw-hangar .vw-hangar-scrap { text-align: center; font-size: 14px;
    margin-bottom: 14px; opacity: .9; }
  #vw-hangar .vw-hangar-rows { width: 420px; display: flex;
    flex-direction: column; gap: 8px; }
  #vw-hangar .vw-hangar-row { display: grid;
    grid-template-columns: 1fr 72px 96px 64px; gap: 10px; align-items: center;
    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
    border-radius: 6px; padding: 8px 12px; }
  #vw-hangar .vw-hangar-row-name { font-size: 13px; }
  #vw-hangar .vw-hangar-row-level { font-size: 12px; text-align: right;
    opacity: .85; }
  #vw-hangar .vw-hangar-row-cost { font-size: 12px; text-align: right;
    opacity: .85; }
  #vw-hangar .vw-hangar-buy { font-family: inherit; font-size: 12px;
    background: rgba(74,222,128,.12); color: #4ade80;
    border: 1px solid rgba(74,222,128,.4); border-radius: 4px;
    padding: 4px 0; cursor: pointer; }
  #vw-hangar .vw-hangar-buy:disabled { opacity: .4; cursor: default;
    color: #94a3b8; border-color: rgba(148,163,184,.3);
    background: rgba(255,255,255,.04); }
  #vw-hangar .vw-hangar-launch { margin-top: 18px; font-family: inherit;
    font-size: 16px; letter-spacing: .15em;
    background: rgba(56,189,248,.14); color: #38bdf8;
    border: 1px solid rgba(56,189,248,.5); border-radius: 6px;
    padding: 10px 42px; cursor: pointer; }
  `;
  document.head.appendChild(s);
}

export { _HangarUI as HangarUI };
export default _HangarUI;

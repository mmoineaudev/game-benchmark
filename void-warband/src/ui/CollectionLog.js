/**
 * CollectionLog.js — Tab-toggled discovery overlay (SPEC §6, P10).
 *
 * Full-screen translucent panel listing all 22 ITEMS: discovered entries
 * show name + tier color, undiscovered show "???" dimmed. Footer shows
 * "DISCOVERED X / 22". Toggle on KeyTab (keydown, preventDefault so the
 * browser focus ring never takes it); data re-reads meta.discovered each
 * open. Closed by default; closes again on the same key.
 */
import { ITEMS, TIERS } from '../core/Constants.js';
import { GameState } from '../core/GameState.js';

class _CollectionLog {
  constructor() {
    /** @type {boolean} overlay visibility. */
    this.visible = false;
    this._rowsBuilt = false;

    _injectStyles();
    const root = document.createElement('div');
    root.id = 'vw-collection';
    root.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'vw-col-title';
    title.textContent = 'COLLECTION LOG';
    this._countEl = document.createElement('div');
    this._countEl.className = 'vw-col-count';
    const list = document.createElement('div');
    list.className = 'vw-col-list';
    this._listEl = list;
    const hint = document.createElement('div');
    hint.className = 'vw-col-hint';
    hint.textContent = 'TAB to close';
    root.append(title, this._countEl, list, hint);
    document.body.appendChild(root);
    this._root = root;

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Tab') return;
      e.preventDefault();
      this.toggle();
    });
  }

  /** Toggle visibility; refreshes data on open. */
  toggle() {
    this.visible = !this.visible;
    if (this.visible) this.refresh();
    this._root.style.display = this.visible ? 'block' : 'none';
  }

  /** Rebuild rows (only data states change; rows built once, updated in place). */
  refresh() {
    const discovered = new Set(GameState.meta.discovered);
    this._countEl.textContent =
      `DISCOVERED ${discovered.size} / ${ITEMS.length}`;
    if (!this._rowsBuilt) {
      for (const item of ITEMS) {
        const row = document.createElement('div');
        row.className = 'vw-col-row';
        row.dataset.id = item.id;
        row.style.borderColor = TIERS[item.tier];
        const name = document.createElement('span');
        name.className = 'vw-col-name';
        const tier = document.createElement('span');
        tier.className = 'vw-col-tier';
        tier.textContent = item.tier.toUpperCase();
        tier.style.color = TIERS[item.tier];
        row.append(name, tier);
        this._listEl.appendChild(row);
      }
      this._rowsBuilt = true;
    }
    for (const row of this._listEl.children) {
      const item = ITEMS.find((i) => i.id === row.dataset.id);
      const found = discovered.has(row.dataset.id);
      const nameEl = row.querySelector('.vw-col-name');
      nameEl.textContent = found ? item.name : '???';
      row.style.opacity = found ? '1' : '0.35';
    }
  }
}

/** Collection log CSS (injected once, id-scoped). */
function _injectStyles() {
  if (document.getElementById('vw-col-style')) return;
  const s = document.createElement('style');
  s.id = 'vw-col-style';
  s.textContent = `
  #vw-collection { position: fixed; inset: 0; z-index: 850; display: none;
    background: rgba(4, 6, 12, .9); overflow-y: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e2e8f0; user-select: none; padding: 40px 0 60px; }
  #vw-collection .vw-col-title { font-size: 24px; letter-spacing: .2em;
    text-align: center; margin-bottom: 8px; }
  #vw-collection .vw-col-count { font-size: 13px; text-align: center;
    color: #38bdf8; margin-bottom: 20px; }
  #vw-collection .vw-col-list { width: 480px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 6px; }
  #vw-collection .vw-col-row { display: flex; justify-content: space-between;
    border-left: 3px solid; background: rgba(255,255,255,.04);
    border-radius: 4px; padding: 7px 12px; font-size: 13px; }
  #vw-collection .vw-col-tier { font-size: 10px; letter-spacing: .12em; }
  #vw-collection .vw-col-hint { text-align: center; font-size: 11px;
    opacity: .6; margin-top: 18px; }
  `;
  document.head.appendChild(s);
}

export { _CollectionLog as CollectionLog };
export default _CollectionLog;

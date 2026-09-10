/**
 * TradeUI.js — STATION SHOP (user feedback: the station menu is a shop).
 * Two tabs:
 *   CARGO — your collected items: INSTALL (strong buff, ≤3 modules),
 *           UNINSTALL, SELL (tier value × sell-bonus buffs).
 *   SHOP  — the full 22-item catalog: BUY at the tier price with scrap;
 *           the module lands in cargo (install it from the CARGO tab).
 * Every item shows its buffs: carried passive value + installed strong value.
 * Opened by H near a station; pauses the sim (main.js toggles Game.paused).
 */
import { ITEMS, TIERS, TRADE, ITEM_BUFFS, SHIPS } from '../core/Constants.js';
import { GameState } from '../core/GameState.js';
import { EventBus } from '../core/EventBus.js';

class _TradeUI {
  constructor() {
    this.visible = false;
    this._tab = 'cargo';
    this._root = document.createElement('div');
    this._root.id = 'vw-trade';
    this._root.style.display = 'none';

    _injectStyles();

    const panel = document.createElement('div');
    panel.className = 'vw-trade-panel';
    const title = document.createElement('div');
    title.className = 'vw-trade-title';
    title.textContent = 'STATION — SHOP & OUTFITTING';

    // Tabs.
    const tabs = document.createElement('div');
    tabs.className = 'vw-trade-tabs';
    this._tabCargo = document.createElement('button');
    this._tabCargo.textContent = 'CARGO';
    this._tabCargo.addEventListener('click', () => { this._tab = 'cargo'; this.refresh(); });
    this._tabShop = document.createElement('button');
    this._tabShop.textContent = 'SHOP';
    this._tabShop.addEventListener('click', () => { this._tab = 'shop'; this.refresh(); });
    this._tabShips = document.createElement('button');
    this._tabShips.textContent = 'SHIPS';
    this._tabShips.addEventListener('click', () => { this._tab = 'ships'; this.refresh(); });
    tabs.append(this._tabCargo, this._tabShop, this._tabShips);

    this._info = document.createElement('div');
    this._info.className = 'vw-trade-info';
    this._installedEl = document.createElement('div');
    this._installedEl.className = 'vw-trade-installed';
    this._listEl = document.createElement('div');
    this._listEl.className = 'vw-trade-list';
    const hint = document.createElement('div');
    hint.className = 'vw-trade-hint';
    hint.textContent = 'H / Escape to close and resume';
    panel.append(title, tabs, this._info, this._installedEl, this._listEl, hint);
    this._root.appendChild(panel);
    document.body.appendChild(this._root);
  }

  /** Open the menu (refreshes from run state). */
  show() {
    this.visible = true;
    this._tab = 'cargo';
    this.refresh();
    this._root.style.display = 'block';
  }

  /** Close the menu. */
  hide() {
    this.visible = false;
    this._root.style.display = 'none';
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  /** Rebuild the panel from meta.inventory / run.installed / meta.scrap. */
  refresh() {
    const run = GameState.run;
    if (!run) return;
    const wallet = GameState.meta.scrap;
    const inv = GameState.meta.inventory;
    this._tabCargo.classList.toggle('vw-trade-tab-on', this._tab === 'cargo');
    this._tabShop.classList.toggle('vw-trade-tab-on', this._tab === 'shop');
    this._tabShips.classList.toggle('vw-trade-tab-on', this._tab === 'ships');
    this._info.textContent = `WALLET ${wallet} scrap (persistent)`;

    // Installed modules strip (always visible).
    this._installedEl.innerHTML = '';
    const instLabel = document.createElement('span');
    instLabel.className = 'vw-trade-installed-label';
    instLabel.textContent =
      `MODULES ${run.installed.length}/${TRADE.installMax}:`;
    this._installedEl.appendChild(instLabel);
    if (run.installed.length === 0) {
      const none = document.createElement('span');
      none.className = 'vw-trade-installed-none';
      none.textContent = ' none — install from CARGO';
      this._installedEl.appendChild(none);
    }
    for (const id of run.installed) {
      const itemDef = ITEMS.find((i) => i.id === id);
      if (!itemDef) continue;
      const chip = document.createElement('span');
      chip.className = 'vw-trade-installed-chip';
      chip.style.borderColor = TIERS[itemDef.tier];
      chip.textContent = itemDef.name;
      const x = document.createElement('button');
      x.textContent = '×';
      x.title = 'Uninstall';
      x.addEventListener('click', () => { GameState.uninstallItem(id); this.refresh(); });
      chip.appendChild(x);
      this._installedEl.appendChild(chip);
    }

    this._listEl.innerHTML = '';
    if (this._tab === 'cargo') this._buildCargoRows(inv);
    else if (this._tab === 'shop') this._buildShopRows(wallet);
    else this._buildShipRows(run);
  }

  /** SHIPS tab: 3 purchasable ships with BUY / SWITCH. */
  _buildShipRows(run) {
    const owned = GameState.meta.ownedShips;
    const current = GameState.currentShip().id;
    const wallet = GameState.meta.scrap;
    for (const ship of SHIPS) {
      const isOwned = owned.includes(ship.id);
      const isActive = current === ship.id;
      const row = document.createElement('div');
      row.className = 'vw-trade-row';
      row.style.borderColor = `#${ship.color.toString(16).padStart(6, '0')}`;
      const name = document.createElement('div');
      name.className = 'vw-trade-name';
      name.style.color = `#${ship.color.toString(16).padStart(6, '0')}`;
      name.textContent = ship.name + (isActive ? '  ● ACTIVE' : isOwned ? '  (owned)' : '');
      const sub = document.createElement('div');
      sub.className = 'vw-trade-sub';
      sub.textContent = ship.desc;
      const actions = document.createElement('div');
      actions.className = 'vw-trade-actions';
      if (!isOwned) {
        const b = this._btn(`BUY ${ship.price}`, () => {
          GameState.buyShip(ship.id);
          EventBus.emit('ship:switched', { id: ship.id });
          this.refresh();
        });
        b.disabled = run.scrap < ship.price;
        actions.appendChild(b);
      } else if (!isActive) {
        actions.appendChild(this._btn('SWITCH', () => {
          GameState.switchShip(ship.id);
          // Apply the new ship's visuals + charge pool immediately (user
          // feedback: "ships do not change" — stats swapped but the hull
          // only re-skinned on restart).
          EventBus.emit('ship:switched', { id: ship.id });
          this.refresh();
        }));
      }
      row.append(name, sub, actions);
      this._listEl.appendChild(row);
    }
  }

  /** INVENTORY tab (was CARGO): everything banked, with INSTALL/SELL. */
  _buildCargoRows(inv) {
    const run = GameState.run;
    const ids = Object.keys(inv).filter((id) => (inv[id] ?? 0) > 0);
    if (ids.length === 0) {
      this._appendEmpty('Inventory empty — loot auto-sells into your wallet; buy modules in the SHOP tab and install here.');
      return;
    }
    for (const id of ids) {
      const itemDef = ITEMS.find((i) => i.id === id);
      if (!itemDef) continue;
      const buff = ITEM_BUFFS[id];
      const installed = run && run.installed.includes(id);
      const sellPrice = Math.round(
        (TRADE.sellValue[itemDef.tier] ?? 5) * (1 + GameState.sellBonusPct() / 100));
      const row = this._makeRow(itemDef, `${itemDef.name} ×${inv[id]}`);
      this._addBuffText(row, buff, installed);
      const actions = row.querySelector('.vw-trade-actions');
      if (!installed && run && run.installed.length < TRADE.installMax) {
        actions.appendChild(this._btn('INSTALL', () => {
          GameState.installItem(id); this.refresh();
        }));
      }
      actions.appendChild(this._btn(`SELL +${sellPrice}`, () => {
        const gained = GameState.sellItem(id);
        if (gained > 0) this.refresh();
      }));
      this._listEl.appendChild(row);
    }
  }

  /** SHOP tab: full catalog with BUY (wallet scrap). */
  _buildShopRows(wallet) {
    for (const itemDef of ITEMS) {
      if (itemDef.id === 'scrap') continue; // currency, not buyable
      const price = TRADE.buyPrice[itemDef.tier] ?? 50;
      const affordable = wallet >= price;
      const row = this._makeRow(itemDef, itemDef.name);
      this._addBuffText(row, ITEM_BUFFS[itemDef.id], false);
      const actions = row.querySelector('.vw-trade-actions');
      const b = this._btn(`BUY ${price}`, () => {
        GameState.buyItem(itemDef.id); this.refresh();
      });
      b.disabled = !affordable;
      actions.appendChild(b);
      this._listEl.appendChild(row);
    }
  }

  /** One list row: name + tier color + buff subline + actions slot. */
  _makeRow(itemDef, nameText) {
    const row = document.createElement('div');
    row.className = 'vw-trade-row';
    row.style.borderColor = TIERS[itemDef.tier];
    const name = document.createElement('div');
    name.className = 'vw-trade-name';
    name.textContent = nameText;
    name.style.color = TIERS[itemDef.tier];
    const actions = document.createElement('div');
    actions.className = 'vw-trade-actions';
    row.append(name, actions);
    return row;
  }

  /** Buff subline: "carry: +X · installed: +Y". */
  _addBuffText(row, buff, installed) {
    if (!buff) return;
    const sub = document.createElement('div');
    sub.className = 'vw-trade-sub';
    const carry = _buffText(buff, false);
    const inst = _buffText(buff, true);
    const parts = [];
    if (carry) parts.push(`carry: ${carry}`);
    if (inst) parts.push(`installed: ${inst}`);
    sub.textContent = parts.join('  ·  ') || 'no buff';
    if (installed) sub.textContent += '  — INSTALLED';
    row.appendChild(sub);
  }

  _btn(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  _appendEmpty(text) {
    const empty = document.createElement('div');
    empty.className = 'vw-trade-empty';
    empty.textContent = text;
    this._listEl.appendChild(empty);
  }
}

/** Human-readable buff text for one item. */
function _buffText(buff, installed) {
  if (!buff) return '';
  const v = (k) => (installed ? buff[k + 'Installed'] : buff[k]);
  const parts = [];
  const rate = v('weaponRate');
  if (rate) parts.push(`+${rate} shots/s`);
  const dmg = v('weaponDamage');
  if (dmg) parts.push(`+${dmg} dmg`);
  const speed = v('maxSpeed');
  if (speed) parts.push(`+${speed} speed`);
  const hull = v('hull');
  if (hull) parts.push(`+${hull} hull`);
  const shield = v('shield');
  if (shield) parts.push(`+${shield} shield`);
  const regen = v('shieldRegen');
  if (regen) parts.push(`+${regen} regen/s`);
  const pickup = v('pickupRadius');
  if (pickup) parts.push(`+${pickup} pickup`);
  const sell = v('sellBonus');
  if (sell) parts.push(`+${sell}% sell`);
  return parts.join(', ');
}

/** Cargo slots used (scrap stacks as 1, each other item = count). */
function _slotsUsed(run) {
  let used = 0;
  for (const [id, count] of Object.entries(run.cargo)) {
    if (id === 'scrap') used += 1;
    else used += count;
  }
  return used;
}

function _injectStyles() {
  if (document.getElementById('vw-trade-style')) return;
  const s = document.createElement('style');
  s.id = 'vw-trade-style';
  s.textContent = `
  #vw-trade { position: fixed; inset: 0; z-index: 820; display: none;
    background: rgba(4, 6, 12, .88);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e2e8f0; user-select: none; }
  #vw-trade .vw-trade-panel { width: 620px; max-width: 94vw; margin: 6vh auto;
    background: rgba(10, 15, 30, .96); border: 1px solid rgba(56,189,248,.35);
    border-radius: 8px; padding: 18px 24px 20px; }
  #vw-trade .vw-trade-title { font-size: 17px; letter-spacing: .16em;
    color: #38bdf8; margin-bottom: 10px; }
  #vw-trade .vw-trade-tabs { display: flex; gap: 8px; margin-bottom: 10px; }
  #vw-trade .vw-trade-tabs button { font: inherit; font-size: 12px;
    letter-spacing: .12em; padding: 4px 18px; cursor: pointer; border-radius: 4px;
    border: 1px solid rgba(148,163,184,.4); background: transparent; color: #94a3b8; }
  #vw-trade .vw-trade-tab-on { border-color: rgba(56,189,248,.8) !important;
    color: #38bdf8 !important; background: rgba(56,189,248,.08) !important; }
  #vw-trade .vw-trade-info { font-size: 12.5px; color: #fbbf24; margin-bottom: 8px; }
  #vw-trade .vw-trade-installed { font-size: 12px; margin-bottom: 10px;
    color: #94a3b8; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  #vw-trade .vw-trade-installed-none { opacity: .6; }
  #vw-trade .vw-trade-installed-chip { border: 1px solid; border-radius: 4px;
    padding: 1px 8px; color: #e2e8f0; }
  #vw-trade .vw-trade-installed-chip button { font: inherit; font-size: 11px;
    margin-left: 6px; cursor: pointer; background: none; color: #f87171;
    border: none; padding: 0; }
  #vw-trade .vw-trade-list { display: flex; flex-direction: column; gap: 7px;
    max-height: 56vh; overflow-y: auto; }
  #vw-trade .vw-trade-row { border-left: 3px solid;
    background: rgba(255,255,255,.04); border-radius: 4px; padding: 7px 12px; }
  #vw-trade .vw-trade-name { font-size: 13px; font-weight: 700; }
  #vw-trade .vw-trade-sub { font-size: 10.5px; margin-top: 2px; color: #94a3b8; }
  #vw-trade .vw-trade-actions { margin-top: 5px; display: flex; gap: 8px; }
  #vw-trade .vw-trade-actions button { font: inherit; font-size: 11px;
    letter-spacing: .08em; padding: 2px 10px; border-radius: 4px; cursor: pointer;
    border: 1px solid rgba(74,222,128,.7); color: #4ade80;
    background: rgba(74,222,128,.08); }
  #vw-trade .vw-trade-actions button:disabled { opacity: .35; cursor: default; }
  #vw-trade .vw-trade-empty { font-size: 12.5px; opacity: .65; padding: 12px 0; }
  #vw-trade .vw-trade-hint { margin-top: 12px; font-size: 11.5px; opacity: .7;
    text-align: center; }
  `;
  document.head.appendChild(s);
}

export { _TradeUI as TradeUI };
export default _TradeUI;

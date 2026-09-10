/**
 * GameState.js — singleton run + meta state.
 * Run state resets cleanly each flight; meta state persists via Save.js.
 * Stat math uses only Constants + upgrade levels (no magic numbers here).
 */
import { PLAYER, UPGRADES, TRADE, ITEM_BUFFS, ITEMS, SHIPS } from './Constants.js';
import { loadMeta, saveMeta, defaultMeta } from './Save.js';

/** Game state machine states (SPEC §9). */
export const GamePhase = {
  HANGAR: 'HANGAR',
  FLIGHT: 'FLIGHT',
  DEATH: 'DEATH',
};

class _GameState {
  constructor() {
    /** @type {object} meta state, loaded from localStorage. */
    this.meta = loadMeta();
    /** @type {string} current phase. */
    this.phase = GamePhase.HANGAR;
    /** @type {object|null} run state, null outside FLIGHT. */
    this.run = null;
    this.resetRun();
  }

  /**
   * Reset run state to a clean flight (called on start and on `KeyR` restart).
   */
  resetRun() {
    this.run = {
      hull: this.maxHull(),
      shield: this.maxShield(),
      /** @type {{x: number, y: number, z: number}} */
      position: { x: 0, y: 0, z: 0 },
      /** @type {{x: number, y: number, z: number}} */
      velocity: { x: 0, y: 0, z: 0 },
      /** Throttle 0–1. */
      throttle: 0,
      /** @type {Record<string, number>} itemId → count (unbanked). */
      cargo: {},
      cargoMax: this.cargoMaxSlots(),
      /** Unbanked scrap carried. */
      scrap: 0,
      /** Items installed at stations this run (ids, ≤ TRADE.installMax). */
      installed: [],
      /** Current sector index (1–6). */
      sector: 1,
      /** Distance along the ladder, u. */
      distance: 0,
      /** Kills this run. */
      kills: 0,
      /** Alive flag. */
      alive: true,
      /** Seconds since last hit taken (shield regen delay). */
      timeSinceHit: 0,
    };
  }

  /**
   * Full reset: clean run state, keep meta. Called on any restart path.
   */
  reset() {
    this.resetRun();
  }

  // -- Derived stats (base + upgrades, linear, capped) --------------------

  /** @param {string} id */
  upgradeLevel(id) {
    return this.meta.upgrades[id] ?? 0;
  }

  /** Current ship def (from SHIPS; default = the Explorer once owned, or
   *  the stock ship — SHIPS[0] acts as the starter ship for multipliers). */
  currentShip() {
    const id = this.meta.ship;
    return SHIPS.find((s) => s.id === id) ?? SHIPS[0];
  }

  /**
   * Effective value for an upgrade-backed stat, INCLUDING the current
   * ship's multipliers (damage / shield / maxSpeed).
   */
  _statValue(stat) {
    let value = stat === 'weaponDamage' ? PLAYER.weapon.damage : PLAYER[stat];
    for (const u of UPGRADES) {
      if (u.stat === stat) value += u.effect * this.upgradeLevel(u.id);
    }
    // Ship multipliers (user feedback: 3 purchasable ships).
    const ship = this.currentShip();
    if (stat === 'weaponDamage') value *= ship.damageMult;
    else if (stat === 'shield') value *= ship.shieldMult;
    else if (stat === 'maxSpeed') value *= ship.speedMult;
    // Item buffs (user feedback: all 22 items buff the ship). CARRIED
    // inventory gives the passive value; INSTALLED modules (station, ≤3)
    // give the strong installed value. Sources read the PERSISTENT
    // inventory (auto-sell world) — not run cargo.
    if (this.run) {
      for (const [id, count] of Object.entries(this.meta.inventory)) {
        if (count <= 0) continue;
        const buff = ITEM_BUFFS[id];
        if (buff && buff[stat]) value += buff[stat] * Math.min(count, 5);
      }
      for (const id of this.run.installed) {
        const buff = ITEM_BUFFS[id];
        if (buff && buff[stat + 'Installed']) value += buff[stat + 'Installed'];
      }
    }
    return value;
  }

  /**
   * Weapon fire rate (shots/s) including installed + carried item buffs.
   * @returns {number}
   */
  weaponRate() {
    let value = PLAYER.weapon.rate;
    if (this.run) {
      for (const [id, count] of Object.entries(this.meta.inventory)) {
        if (count <= 0) continue;
        const buff = ITEM_BUFFS[id];
        if (buff && buff.weaponRate) value += buff.weaponRate * Math.min(count, 5);
      }
      for (const id of this.run.installed) {
        const buff = ITEM_BUFFS[id];
        if (buff && buff.weaponRateInstalled) value += buff.weaponRateInstalled;
      }
    }
    return value;
  }

  /**
   * Extra pickup/magnet radius from magnet-coil-style items (carried passive
   * + installed strong). @returns {number} bonus, u.
   */
  pickupRadiusBonus() {
    let bonus = 0;
    if (this.run) {
      for (const [id, count] of Object.entries(this.meta.inventory)) {
        if (count <= 0) continue;
        const buff = ITEM_BUFFS[id];
        if (buff && buff.pickupRadius) bonus += buff.pickupRadius * Math.min(count, 5);
      }
      for (const id of this.run.installed) {
        const buff = ITEM_BUFFS[id];
        if (buff && buff.pickupRadiusInstalled) bonus += buff.pickupRadiusInstalled;
      }
    }
    return bonus;
  }

  /**
   * Extra shield regen from coolant-style items. @returns {number} points/s.
   */
  shieldRegenBonus() {
    let bonus = 0;
    if (this.run) {
      for (const [id, count] of Object.entries(this.meta.inventory)) {
        if (count <= 0) continue;
        const buff = ITEM_BUFFS[id];
        if (buff && buff.shieldRegen) bonus += buff.shieldRegen * Math.min(count, 5);
      }
      for (const id of this.run.installed) {
        const buff = ITEM_BUFFS[id];
        if (buff && buff.shieldRegenInstalled) bonus += buff.shieldRegenInstalled;
      }
    }
    return bonus;
  }

  /**
   * % sell-value bonus from trade-chip-style items (carried passive +
   * installed strong). @returns {number} percent.
   */
  sellBonusPct() {
    let pct = 0;
    if (this.run) {
      for (const [id, count] of Object.entries(this.meta.inventory)) {
        if (count <= 0) continue;
        const buff = ITEM_BUFFS[id];
        if (buff && buff.sellBonus) pct += buff.sellBonus * Math.min(count, 5);
      }
      for (const id of this.run.installed) {
        const buff = ITEM_BUFFS[id];
        if (buff && buff.sellBonusInstalled) pct += buff.sellBonusInstalled;
      }
    }
    return pct;
  }

  /** Max hull HP including upgrades. */
  maxHull() {
    return this._statValue('hull');
  }

  /** Max shield including upgrades. */
  maxShield() {
    return this._statValue('shield');
  }

  /** Weapon damage including upgrades. */
  weaponDamage() {
    return this._statValue('weaponDamage');
  }

  /** Cargo slots including upgrades. */
  cargoMaxSlots() {
    return this._statValue('cargoMax');
  }

  /** Max speed including upgrades. */
  maxSpeed() {
    return this._statValue('maxSpeed');
  }

  // -- Station trading (ONE persistent wallet + persistent inventory) -------
  // User feedback: money must persist and be the single currency for all
  // buying; equipping works from the banked inventory (the station auto-
  // banks your run cargo on docking, so the inventory is the real store).

  /**
   * Install a module: consumes 1 unit from the PERSISTENT inventory into
   * the run's installed list (strong buff until run end/uninstall).
   * @param {string} id item id (must have an ITEM_BUFFS entry).
   * @returns {boolean} success.
   */
  installItem(id) {
    const run = this.run;
    if (!run) return false;
    if (!ITEM_BUFFS[id]) return false;
    if (run.installed.includes(id)) return false;
    if (run.installed.length >= TRADE.installMax) return false;
    if ((this.meta.inventory[id] ?? 0) <= 0) return false;
    this.meta.inventory[id] -= 1;
    run.installed.push(id);
    saveMeta(this.meta);
    return true;
  }

  /**
   * Uninstall: frees the module slot; fitted hardware is discarded.
   * @param {string} id
   */
  uninstallItem(id) {
    const run = this.run;
    if (!run) return;
    const i = run.installed.indexOf(id);
    if (i !== -1) run.installed.splice(i, 1);
  }

  /**
   * Sell one unit FROM THE PERSISTENT INVENTORY: converts to wallet scrap
   * at the tier value × sell-bonus buffs.
   * @param {string} id
   * @returns {number} scrap gained (0 on failure).
   */
  sellItem(id) {
    if ((this.meta.inventory[id] ?? 0) <= 0) return 0;
    const itemDef = ITEMS.find((i) => i.id === id);
    if (!itemDef) return 0;
    this.meta.inventory[id] -= 1;
    const base = TRADE.sellValue[itemDef.tier] ?? 5;
    const gained = Math.round(base * (1 + this.sellBonusPct() / 100));
    this.meta.scrap += gained;
    saveMeta(this.meta);
    return gained;
  }

  /**
   * BUY at the station shop: spend WALLET scrap on a fresh module; it lands
   * in the persistent inventory (install it from there).
   * @param {string} id
   * @returns {boolean} success.
   */
  buyItem(id) {
    const itemDef = ITEMS.find((i) => i.id === id);
    if (!itemDef) return false;
    const price = TRADE.buyPrice[itemDef.tier] ?? 50;
    if (this.meta.scrap < price) return false;
    this.meta.scrap -= price;
    this.meta.inventory[id] = (this.meta.inventory[id] ?? 0) + 1;
    // Buying counts as discovery for the collection log.
    if (!this.meta.discovered.includes(id)) {
      this.meta.discovered.push(id);
    }
    saveMeta(this.meta);
    return true;
  }

  /**
   * Shop buy price for an item (fixed per tier).
   * @param {string} id
   * @returns {number}
   */
  buyPrice(id) {
    const itemDef = ITEMS.find((i) => i.id === id);
    return itemDef ? (TRADE.buyPrice[itemDef.tier] ?? 50) : Infinity;
  }

  /**
   * BUY a ship at the station shop (user feedback): permanent purchase.
   * @param {string} id SHIPS id.
   * @returns {boolean} success.
   */
  buyShip(id) {
    const ship = SHIPS.find((s) => s.id === id);
    if (!ship) return false;
    if (this.meta.ownedShips.includes(id)) return false;
    if (this.meta.scrap < ship.price) return false;
    this.meta.scrap -= ship.price;
    this.meta.ownedShips.push(id);
    this.meta.ship = id; // auto-switch to the new purchase
    saveMeta(this.meta);
    return true;
  }

  /**
   * SWITCH the active ship (free at any station, owned ships only).
   * @param {string} id SHIPS id.
   * @returns {boolean} success.
   */
  switchShip(id) {
    if (!this.meta.ownedShips.includes(id)) return false;
    this.meta.ship = id;
    saveMeta(this.meta);
    // Re-apply max pools so the new shield/hull caps are respected.
    if (this.run) {
      this.run.shield = Math.min(this.run.shield, this.maxShield());
      this.run.hull = Math.min(this.run.hull, this.maxHull());
    }
    return true;
  }

  // -- Meta ----------------------------------------------------------------

  /**
   * Apply a hangar upgrade (buy). Deducts scrap; false if unaffordable/maxed.
   * @param {string} id upgrade id
   * @returns {boolean}
   */
  applyUpgrade(id) {
    const u = UPGRADES.find((x) => x.id === id);
    if (!u) return false;
    const level = this.upgradeLevel(id);
    if (level >= u.max) return false;
    const cost = u.costBase + u.costStep * level;
    if (this.meta.scrap < cost) return false;
    this.meta.scrap -= cost;
    this.meta.upgrades[id] = level + 1;
    saveMeta(this.meta);
    return true;
  }

  /**
   * Bank unbanked run scrap into meta (stations / hangar).
   * @param {number} amount
   */
  bankScrap(amount) {
    const n = Math.max(0, Math.floor(amount));
    this.meta.scrap += n;
    if (this.run) this.run.scrap = Math.max(0, this.run.scrap - n);
    saveMeta(this.meta);
  }

  /**
   * Bank run cargo into meta inventory (death forfeits anything left).
   */
  bankCargo() {
    if (!this.run) return;
    for (const [id, count] of Object.entries(this.run.cargo)) {
      if (count > 0) this.meta.inventory[id] = (this.meta.inventory[id] ?? 0) + count;
    }
    this.run.cargo = {};
    saveMeta(this.meta);
  }

  /**
   * End run: persist stats; if alive, bank cargo + scrap into meta.
   */
  endRun() {
    const run = this.run;
    if (!run) return;
    run.alive = false;
    this.meta.kills += run.kills;
    this.meta.runs += 1;
    this.meta.bestDistance = Math.max(this.meta.bestDistance, run.distance);
    if (this.phase === GamePhase.DEATH) {
      // Death: unbanked cargo is forfeited (SPEC §5 extraction rule).
      run.cargo = {};
      run.scrap = 0;
    } else {
      this.bankCargo();
      this.bankScrap(run.scrap);
    }
    saveMeta(this.meta);
  }

  /** Wipe all meta (fresh start) and reset run. */
  wipeMeta() {
    this.meta = defaultMeta();
    saveMeta(this.meta);
    this.resetRun();
  }
}

/** Singleton game state. */
export const GameState = new _GameState();

export default GameState;

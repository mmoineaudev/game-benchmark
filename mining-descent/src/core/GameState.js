// Singleton per-run game state
import { RESOURCE, UPGRADES } from './Constants.js';

class GameState {
  constructor() {
    this.reset();
    this._meta = this._loadMeta();
  }

  reset() {
    this.fuel = RESOURCE.FUEL_INITIAL + this._tankBonus('fuel_tank');
    this.oxygen = RESOURCE.OXYGEN_INITIAL + this._tankBonus('oxygen_tank');
    this.hull = RESOURCE.HULL_INITIAL;
    this.maxFuel = RESOURCE.FUEL_INITIAL + this._tankBonus('fuel_tank');
    this.maxOxygen = RESOURCE.OXYGEN_INITIAL + this._tankBonus('oxygen_tank');
    this.maxHull = RESOURCE.HULL_INITIAL;
    this.oreInventory = {};
    this.depth = 0;
    this.pos = { x: 10, z: 10, y: 0 };
    this.enemiesKilled = 0;
    this.tilesDiscovered = new Set();
    this.cargoMax = 20 + this._tankBonus('cargo_hold');
    this.headlightRange = 12 + this._tankBonus('headlights');
    this.isClimbing = false;
    this.isDead = false;
    this.atSurface = true;
  }

  _tankBonus(id) {
    const upg = this._meta.upgrades[id];
    if (!upg) return 0;
    const def = UPGRADES.find(u => u.id === id);
    return def ? upg.level * def.perLevel : 0;
  }

  _loadMeta() {
    try {
      const raw = localStorage.getItem('miningDescent_meta');
      if (raw) return JSON.parse(raw);
    } catch (_) { /* ignore */ }
    return { ore: 0, upgrades: {}, runs: 0 };
  }

  saveMeta() {
    try {
      localStorage.setItem('miningDescent_meta', JSON.stringify(this._meta));
    } catch (_) { /* ignore */ }
  }

  getMetaOre() { return this._meta.ore; }

  addMetaOre(amount) {
    this._meta.ore += amount;
    this.saveMeta();
  }

  getUpgradeLevel(id) {
    const u = this._meta.upgrades[id];
    return u ? u.level : 0;
  }

  getUpgradeCost(id) {
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return Infinity;
    const level = this.getUpgradeLevel(id);
    if (level >= def.levels) return Infinity;
    return def.costs[level];
  }

  purchaseUpgrade(id) {
    const cost = this.getUpgradeCost(id);
    if (cost === Infinity || this._meta.ore < cost) return false;
    this._meta.ore -= cost;
    if (!this._meta.upgrades[id]) this._meta.upgrades[id] = { level: 0 };
    this._meta.upgrades[id].level++;
    this.saveMeta();
    return true;
  }

  getTotalRuns() { return this._meta.runs; }
  incrementRuns() { this._meta.runs++; this.saveMeta(); }
}

export const state = new GameState();

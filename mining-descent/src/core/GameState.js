// =============================================================================
// GameState — singleton holding all per-run state + meta-progression state.
// =============================================================================

import { RESOURCES, WORLD_WIDTH, WORLD_DEPTH, WORLD_HEIGHT, CAVE_ENTRANCE, META } from './Constants.js';
import { Logger } from './Logger.js';

const L = (tag, msg, d) => Logger.debug(tag, msg, d);

class GameStateClass {
  constructor() {
    this.reset();
    this._metaLoad();
  }

  // ---- Per-run state ----
  reset() {
    L('State', 'reset()');
    // Resources
    this.fuel = RESOURCES.FUEL_START;
    this.maxFuel = RESOURCES.FUEL_START;
    this.oxygen = RESOURCES.OXYGEN_START;
    this.maxOxygen = RESOURCES.OXYGEN_START;
    this.hull = RESOURCES.HULL_START;
    this.maxHull = RESOURCES.HULL_START;

    // Position (grid coords: gy=0 is surface)
    this.tileX = CAVE_ENTRANCE.x;
    this.tileY = 0; // at surface entrance
    this.tileZ = CAVE_ENTRANCE.z;

    // Inventory: { oreType: count }
    this.inventory = { coal: 0, copper: 0 };
    this.cargoUsed = 0;
    this.cargoMax = 20;

    // Game phase
    this.phase = 'hub'; // 'hub' | 'descent' | 'return' | 'death'
    this.isAlive = true;
    this.isMoving = false;
    this.isDigging = false;
    this.isClimbing = false;

    // Run stats
    this.depthReached = 0; // max gy reached this run
    this.oresMinedThisRun = { coal: 0, copper: 0 };
    this.enemiesKilledThisRun = 0;

    // Discovered tiles for minimap — Uint8Array, 0=hidden, 1=revealed
    const total = WORLD_WIDTH * WORLD_DEPTH * WORLD_HEIGHT;
    this.discovered = new Uint8Array(total);

    // Terrain data is on TerrainGenerator, not here.
  }

  // ---- Derived ----
  get depth() { return this.tileY; }
  get oresCarried() { return this.cargoUsed; }

  // ---- Meta-progression (persistent) ----
  _metaLoad() {
    try {
      const raw = localStorage.getItem(META.STORAGE_KEY);
      this.meta = raw ? JSON.parse(raw) : this._metaDefault();
      L('State', 'meta loaded', this.meta);
    } catch (e) {
      Logger.warn('State', 'meta load failed, using defaults', e.message);
      this.meta = this._metaDefault();
    }
  }

  _metaDefault() {
    return {
      currency: 0,
      upgrades: { fuelTank: 0 },
      runCount: 0,
      deepestDepth: 0,
      totalOres: 0,
    };
  }

  _metaSave() {
    try {
      localStorage.setItem(META.STORAGE_KEY, JSON.stringify(this.meta));
      L('State', 'meta saved', this.meta);
    } catch (e) {
      Logger.error('State', 'meta save failed', e.message);
    }
  }

  /** Apply purchased upgrade effects to current-run stats. Called on descent begin. */
  applyUpgrades() {
    const fuelLevel = this.meta.upgrades.fuelTank || 0;
    this.maxFuel = RESOURCES.FUEL_START + (fuelLevel * 25);
    this.fuel = this.maxFuel;
    L('State', 'upgrades applied', { maxFuel: this.maxFuel });
  }

  addCurrency(amount) {
    this.meta.currency += amount;
    this._metaSave();
  }

  spendCurrency(amount) {
    if (this.meta.currency < amount) return false;
    this.meta.currency -= amount;
    this._metaSave();
    return true;
  }

  purchaseUpgrade(name) {
    const def = META.UPGRADES[name];
    if (!def) return false;
    const current = this.meta.upgrades[name] || 0;
    if (current >= def.maxLevel) return false;
    if (!this.spendCurrency(def.cost)) return false;
    this.meta.upgrades[name] = current + 1;
    this._metaSave();
    return true;
  }

  recordRun(depth, ores, survived) {
    this.meta.runCount++;
    this.meta.deepestDepth = Math.max(this.meta.deepestDepth, depth);
    this.meta.totalOres += ores;
    this._metaSave();
  }
}

let _instance = null;
export function getGameState() {
  if (!_instance) _instance = new GameStateClass();
  return _instance;
}

// For clean restart — fully reinitialize the singleton
export function resetGameState() {
  _instance = new GameStateClass();
  return _instance;
}

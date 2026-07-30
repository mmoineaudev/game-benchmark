// =============================================================================
// MetaProgression — localStorage persistence, upgrade purchasing, run history.
// =============================================================================

import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { META } from '../core/Constants.js';
import { Logger } from '../core/Logger.js';

export class MetaProgression {
  constructor() {
    this._bus = getEventBus();
    this._state = getGameState();
  }

  init() {
    Logger.info('Meta', `loaded: ${this._state.meta.currency} credits, ${this._state.meta.runCount} runs`);
  }

  /** Can player afford this upgrade? */
  canAfford(upgradeName) {
    const def = META.UPGRADES[upgradeName];
    if (!def) return false;
    const current = this._state.meta.upgrades[upgradeName] || 0;
    return current < def.maxLevel && this._state.meta.currency >= def.cost;
  }

  /** Purchase an upgrade. Returns true on success. */
  purchase(upgradeName) {
    if (!this.canAfford(upgradeName)) return false;
    const success = this._state.purchaseUpgrade(upgradeName);
    if (success) {
      const level = this._state.meta.upgrades[upgradeName];
      Logger.info('Meta', `purchased ${upgradeName} level ${level}`);
      this._bus.emit(Events.UPGRADE_PURCHASED, { upgrade: upgradeName, level });
      this._bus.emit(Events.META_UPDATED, { meta: { ...this._state.meta } });
    }
    return success;
  }

  /** Get formatted upgrade info for UI. */
  getUpgradeInfo(upgradeName) {
    const def = META.UPGRADES[upgradeName];
    if (!def) return null;
    const current = this._state.meta.upgrades[upgradeName] || 0;
    return {
      name: def.name,
      cost: def.cost,
      currentLevel: current,
      maxLevel: def.maxLevel,
      canAfford: this.canAfford(upgradeName),
      atMax: current >= def.maxLevel,
    };
  }

  /** Get all upgrade infos. */
  getAllUpgradeInfos() {
    const result = {};
    for (const key of Object.keys(META.UPGRADES)) {
      result[key] = this.getUpgradeInfo(key);
    }
    return result;
  }

  dispose() {
    Logger.info('Meta', 'disposed');
  }
}

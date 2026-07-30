// =============================================================================
// OreManager — handles ore mining, inventory management, cargo limit.
// =============================================================================

import { TILE, ORE_DEFS, RESOURCES } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';

function getOreKey(tileType) {
  if (tileType === TILE.COAL_ORE) return 'coal';
  if (tileType === TILE.COPPER_ORE) return 'copper';
  return null;
}

export class OreManager {
  constructor() {
    this._bus = getEventBus();
    this._state = getGameState();
  }

  /**
   * Mine an ore tile. Returns the ore type key if successful, null otherwise.
   */
  mineOre(tileType) {
    const key = getOreKey(tileType);
    if (!key) return null;

    const s = this._state;
    if (s.cargoUsed >= s.cargoMax) {
      Logger.warn('OreMgr', 'cargo full!');
      return null; // cargo full
    }

    s.inventory[key] = (s.inventory[key] || 0) + 1;
    s.oresMinedThisRun[key] = (s.oresMinedThisRun[key] || 0) + 1;
    s.cargoUsed++;

    // Burn coal automatically? No — player can burn from UI later. For MVP, just add.
    // (Could add auto-burn for coal in future.)

    Logger.debug('OreMgr', `mined 1 ${key} (total: ${s.inventory[key]}, cargo: ${s.cargoUsed}/${s.cargoMax})`);
    this._bus.emit(Events.ORE_MINED, { type: key, count: 1 });
    this._bus.emit(Events.INVENTORY_CHANGED, { inventory: { ...s.inventory } });
    this._bus.emit(Events.ORE_DEPOSIT_DEPLETED);

    return key;
  }

  /** Get total ore value (for meta-currency conversion on return). */
  getTotalValue() {
    let total = 0;
    const s = this._state;
    for (const [key, count] of Object.entries(s.inventory)) {
      const def = ORE_DEFS[key];
      if (def) total += count * def.value;
    }
    return total;
  }

  /** Get ore count across all types. */
  getOreCount() {
    let total = 0;
    for (const count of Object.values(this._state.inventory)) {
      total += count;
    }
    return total;
  }

  dispose() {
    Logger.info('OreMgr', 'disposed');
  }
}

// =============================================================================
// EventBus — singleton pub/sub. Uses domain:action naming convention.
// =============================================================================

export const Events = {
  // Game flow
  GAME_START: 'game:start',
  DESCENT_BEGIN: 'game:descent_begin',
  RETURN_TO_SURFACE: 'game:return_to_surface',
  PLAYER_DIED: 'game:player_died',
  GAME_RESTART: 'game:restart',

  // Player
  PLAYER_MOVED: 'player:moved',
  PLAYER_DIG: 'player:dig',
  PLAYER_CLIMB: 'player:climb',
  PLAYER_FALL: 'player:fall',
  PLAYER_DAMAGED: 'player:damaged',

  // Resources
  FUEL_CHANGED: 'resource:fuel_changed',
  OXYGEN_CHANGED: 'resource:oxygen_changed',
  HULL_CHANGED: 'resource:hull_changed',
  FUEL_DEPLETED: 'resource:fuel_depleted',
  OXYGEN_DEPLETED: 'resource:oxygen_depleted',
  HULL_DEPLETED: 'resource:hull_depleted',

  // Ore / inventory
  ORE_MINED: 'ore:mined',
  INVENTORY_CHANGED: 'ore:inventory_changed',
  ORE_DEPOSIT_DEPLETED: 'ore:deposit_depleted',

  // Terrain
  TILE_REMOVED: 'terrain:tile_removed',
  TERRAIN_READY: 'terrain:ready',

  // Enemies
  ENEMY_SPAWNED: 'enemy:spawned',
  ENEMY_KILLED: 'enemy:killed',
  ENEMY_DAMAGE_PLAYER: 'enemy:damage_player',

  // Meta
  META_UPDATED: 'meta:updated',
  UPGRADE_PURCHASED: 'meta:upgrade_purchased',

  // UI
  DEPTH_CHANGED: 'ui:depth_changed',

  // System
  CLEANUP: 'sys:cleanup',
};

export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return () => this.off(event, fn); // returns unsubscribe fn
  }

  off(event, fn) {
    const arr = this._listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  }

  emit(event, data = {}) {
    const arr = this._listeners.get(event);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      arr[i](data);
    }
  }

  removeAll() {
    this._listeners.clear();
  }
}

// Singleton
let _instance = null;
export function getEventBus() {
  if (!_instance) _instance = new EventBus();
  return _instance;
}
export function resetEventBus() {
  if (_instance) _instance.removeAll();
  _instance = null;
}

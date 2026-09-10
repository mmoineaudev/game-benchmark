/**
 * EventBus.js — singleton pub/sub bus.
 * Cross-module comms use `domain:action` event names (SPEC §9).
 */

/** Event name constants — `domain:action`. */
export const EVENTS = {
  // Run lifecycle (Game.js state machine: HANGAR → FLIGHT → DEATH)
  RUN_START: 'run:start',
  RUN_END: 'run:end',
  DEATH: 'player:death',
  RESTART: 'game:restart',

  // Player
  PLAYER_HIT: 'player:hit',
  PLAYER_SHIELD_DOWN: 'player:shieldDown',
  PLAYER_BANK: 'player:bank',
  PLAYER_UPGRADE: 'player:upgrade',

  // Combat
  PROJECTILE_FIRE: 'combat:fire',
  ENEMY_HIT: 'enemy:hit',
  ENEMY_KILL: 'enemy:kill',
  ENEMY_SPAWN: 'enemy:spawn',
  ENEMY_DEACTIVATE: 'enemy:deactivate',

  // World / chunks
  CHUNK_LOAD: 'chunk:load',
  CHUNK_UNLOAD: 'chunk:unload',
  SECTOR_CHANGE: 'sector:change',
  STATION_ENTER: 'station:enter',
  STATION_EXIT: 'station:exit',

  // Loot / cargo
  ITEM_PICKUP: 'loot:pickup',
  ITEM_DISCOVER: 'loot:discover',
  CARGO_FULL: 'cargo:full',
  CARGO_BANK: 'cargo:bank',
  SCRAP_GAIN: 'scrap:gain',

  // UI
  HUD_DAMAGE: 'ui:damageNumber',
  HUD_SHAKE: 'ui:screenShake',
  TOAST: 'ui:toast',

  // Performance
  PERF_FRAME: 'perf:frame',
};

class _EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
  }

  /**
   * Subscribe a handler to an event.
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} unsubscribe
   */
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /** Subscribe exactly once (until cleared). */
  once(event, handler) {
    const wrap = (...args) => {
      this.off(event, wrap);
      handler(...args);
    };
    return this.on(event, wrap);
  }

  /**
   * Remove a handler.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const set = this._handlers.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this._handlers.delete(event);
  }

  /**
   * Emit an event synchronously to all handlers.
   * @param {string} event
   * @param {...*} args
   */
  emit(event, ...args) {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const handler of set) handler(...args);
  }

  /** Remove all handlers (restart cleanup, SPEC §11). */
  clear() {
    this._handlers.clear();
  }
}

/** Singleton bus. */
export const EventBus = new _EventBus();

export default EventBus;

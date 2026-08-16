/**
 * EventBus.js — tiny pub/sub (§4.4).
 * Events used: `level:start {level, biome}`, `biome:change {biome, biomeIndex}`,
 * `sword:hit {step, enemiesHit, damage}`, `prop:opened`, `prop:broken`.
 */

export class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /** Subscribe. */
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
  }

  /** Unsubscribe. */
  off(event, cb) {
    const cbs = this._listeners.get(event);
    if (cbs) cbs.delete(cb);
  }

  /** Emit to all subscribers of `event`. */
  emit(event, payload) {
    const cbs = this._listeners.get(event);
    if (cbs) {
      for (const cb of [...cbs]) cb(payload);
    }
  }
}

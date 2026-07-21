// VOID DRIFT — EventBus.js
// Dependency-free singleton pub/sub.

class EventBusClass {
  constructor() {
    this._listeners = new Map();
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) set.delete(fn);
  }

  emit(event, data) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      try { fn(data); } catch (err) { console.error(`[EventBus] listener error on '${event}':`, err); }
    }
  }

  clear() {
    this._listeners.clear();
  }
}

export const EventBus = new EventBusClass();

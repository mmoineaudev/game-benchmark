// ============================================================
// EventBus — Singleton pub/sub with domain:action events
// ============================================================

class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * @param {string} event - "domain:action" format
   * @param {Function} callback
   * @returns {Function} unsubscribe
   */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);

    return () => this.off(event, callback);
  }

  /**
   * Subscribe once — callback fires only the first time.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe
   */
  once(event, callback) {
    const unsub = this.on(event, (...args) => {
      unsub();
      callback(...args);
    });
    return unsub;
  }

  /**
   * Unsubscribe a specific callback.
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    const set = this._listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this._listeners.delete(event);
      }
    }
  }

  /**
   * Emit an event with optional data.
   * @param {string} event
   * @param {*} [data]
   */
  emit(event, data) {
    const set = this._listeners.get(event);
    if (set) {
      // Copy to avoid mutation during iteration
      for (const callback of new Set(set)) {
        try {
          callback(data);
        } catch (e) {
          console.error(`EventBus error on "${event}":`, e);
        }
      }
    }
  }

  /**
   * Remove all listeners for an event.
   * @param {string} [event] - if omitted, remove all
   */
  clear(event) {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
  }

  /**
   * Get all registered event names.
   * @returns {string[]}
   */
  get events() {
    return Array.from(this._listeners.keys());
  }
}

// Singleton instance
export default new EventBus();

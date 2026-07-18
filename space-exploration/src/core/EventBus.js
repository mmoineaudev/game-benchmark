// ============================================================
// EventBus — Simple pub/sub event system
// ============================================================
class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} eventName 
   * @param {Function} callback 
   * @returns {Function} unsubscribe function
   */
  on(eventName, callback) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, []);
    }
    const listeners = this._listeners.get(eventName);
    listeners.push(callback);

    // Return unsubscribe function
    return () => {
      const idx = listeners.indexOf(callback);
      if (idx >= 0) {
        listeners.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe once to an event
   */
  once(eventName, callback) {
    const unsub = this.on(eventName, (...args) => {
      unsub();
      callback(...args);
    });
    return unsub;
  }

  /**
   * Emit an event with optional data
   */
  emit(eventName, data) {
    if (!this._listeners.has(eventName)) return;
    
    const listeners = this._listeners.get(eventName);
    for (let i = listeners.length - 1; i >= 0; i--) {
      try {
        listeners[i](data);
      } catch (e) {
        console.error(`[EventBus] Error in listener for '${eventName}':`, e);
      }
    }
  }

  /**
   * Remove all listeners for an event
   */
  off(eventName) {
    this._listeners.delete(eventName);
  }

  /**
   * Clear all events and listeners
   */
  clear() {
    this._listeners.clear();
  }
}

export default new EventBus();
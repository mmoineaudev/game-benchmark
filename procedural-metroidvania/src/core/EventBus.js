// Singleton pub/sub — domain:action event format
const listeners = new Map();

export const EventBus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => this.off(event, fn);
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn);
  },
  emit(event, payload) {
    listeners.get(event)?.forEach((fn) => {
      try { fn(payload); } catch (e) {
        console.error(`[EventBus] Error in listener for "${event}":`, e);
      }
    });
  },
  /** Clear ALL listeners — call on restart */
  clear() {
    listeners.clear();
  },
};

export default EventBus;

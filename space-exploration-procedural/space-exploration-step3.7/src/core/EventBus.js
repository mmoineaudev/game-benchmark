// ============================================================
// EventBus — Simple pub/sub event system + Event Catalog
// ============================================================

export const Events = {
  // Game flow
  GAME_STARTED:       'game:started',
  GAME_PAUSED:        'game:paused',
  GAME_OVER:          'game:over',
  GAME_RESTART:       'game:restart',

  // Player
  PLAYER_THRUST:      'player:thrust',
  PLAYER_THRUST_END:  'player:thrust_end',
  PLAYER_ROLL_LEFT:   'player:roll_left',
  PLAYER_ROLL_RIGHT:  'player:roll_right',
  PLAYER_DAMAGED:     'player:damaged',
  PLAYER_DIED:        'player:died',
  PLAYER_HEALTH_CHANGED: 'player:health_changed',

  // Weapon
  WEAPON_FIRED:       'weapon:fired',
  WEAPON_HIT:         'weapon:hit',
  WEAPON_DESPAWNED:   'weapon:despawned',

  // Environment
  ASTEROID_DESTROYED: 'environment:asteroid_destroyed',
  DEBRIS_DESTROYED:   'environment:debris_destroyed',
  CHUNK_SPAWNED:      'environment:chunk_spawned',
  CHUNK_CLEANED:      'environment:chunk_cleaned',

  // Score
  SCORE_CHANGED:      'score:changed',
  HIGH_SCORE_SAVED:   'score:high_score_saved',

  // Audio
  AUDIO_PLAY:         'audio:play',
  AUDIO_STOP:         'audio:stop',
  AUDIO_MUTE:         'audio:mute',

  // Visual
  SCREEN_SHAKE:       'visual:shake',
  SCREEN_FLASH:       'visual:flash',
  WARNING_PULSE:      'visual:warning_pulse',
};

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

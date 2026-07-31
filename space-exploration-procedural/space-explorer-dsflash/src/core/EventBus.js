// Singleton pub/sub with domain:action events (spec §11).

export const Events = {
  // Game flow
  GAME_STARTED:       'game:started',
  GAME_PAUSED:        'game:paused',
  GAME_RESUMED:       'game:resumed',
  GAME_OVER:          'game:over',
  GAME_RESTART:       'game:restart',

  // Player
  PLAYER_THRUST:      'player:thrust',
  PLAYER_THRUST_END:  'player:thrustEnd',
  PLAYER_DAMAGED:     'player:damaged',
  PLAYER_DIED:        'player:died',
  PLAYER_HEALTH_CHANGED: 'player:healthChanged',

  // Weapon
  WEAPON_FIRED:       'weapon:fired',
  WEAPON_HIT:         'weapon:hit',
  WEAPON_DESPAWNED:   'weapon:despawned',

  // Environment
  ASTEROID_DESTROYED: 'environment:asteroidDestroyed',
  DEBRIS_DESTROYED:   'environment:debrisDestroyed',
  COMET_DESTROYED:    'environment:cometDestroyed',
  OBJECT_CONSUMED:    'environment:objectConsumed',
  BLACK_HOLE_SPAWNED: 'environment:blackHoleSpawned',
  BLACK_HOLE_COLLAPSED: 'environment:blackHoleCollapsed',
  DEAD_STAR_SPAWNED:  'environment:deadStarSpawned',
  STATION_SPAWNED:    'environment:stationSpawned',
  CHUNK_SPAWNED:      'environment:chunkSpawned',
  CHUNK_CLEANED:      'environment:chunkCleaned',
  BIOME_CHANGED:      'environment:biomeChanged',

  // Score
  SCORE_CHANGED:      'score:changed',
  HIGH_SCORE_SAVED:   'score:highScoreSaved',

  // Audio
  AUDIO_PLAY:         'audio:play',
  AUDIO_STOP:         'audio:stop',
  AUDIO_MUTED:        'audio:muted',

  // Visual
  SCREEN_SHAKE:       'visual:shake',
  SCREEN_FLASH:       'visual:flash',
  WARNING_PULSE:      'visual:warningPulse',
};

class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  /** Subscribe. Returns an unsubscribe function (restart-safe cleanup). */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    const set = this._listeners.get(event);
    if (set) set.delete(fn);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] handler error for ${event}:`, err);
      }
    }
  }

  /** Remove every listener — used on shutdown/restart. */
  clear() {
    this._listeners.clear();
  }
}

export const eventBus = new EventBus();

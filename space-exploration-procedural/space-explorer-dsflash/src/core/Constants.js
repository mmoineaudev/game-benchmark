// All magic numbers, colors, timings, configs — zero hardcoded values in logic.
export const Constants = {
  GAME_NAME: 'Void Drift',
  VERSION: '1.0.0',

  // Ship
  MAX_SHIP_SPEED: 80,
  SHIP_ACCELERATION: 40,
  SHIP_DRAG: 0.98,          // per-frame multiplier for lateral drift decay (60 fps basis)
  SHIP_ROLL_SPEED: 3.0,
  MOUSE_LOOK_SPEED: 0.0025, // rad per pixel, yaw & pitch
  KEYBOARD_PITCH_SPEED: 1.5, // rad/s for Z (dive) / S (climb)
  THROTTLE_SCROLL_SENSITIVITY: 0.0005, // throttle change per scroll deltaY unit
  PITCH_LIMIT: 1.2,         // rad, prevents gimbal flip
  SHIP_SPAWN: { x: 0, y: 2, z: 0 },

  // Headlight (powerful — reveals asteroids ahead)
  HEADLIGHT: { intensity: 4.0, range: 70, angle: 0.65, penumbra: 0.5, color: 0xffffff },

  // Electromagnetic shield (right-click)
  SHIELD: {
    radius: 5.5,
    energyMax: 100,
    drainPerSec: 25,
    regenPerSec: 15,
    deflectPower: 25,
  },

  // Camera
  CAMERA_DISTANCE: 12,
  CAMERA_HEIGHT: 5,
  CAMERA_FOV_REST: 75,
  CAMERA_FOV_MAX: 95,
  CAMERA_DAMPING: 5.0,      // smoothed: lerp factor per second

  // Weapon
  FIRE_RATE: 8,
  PROJECTILE_SPEED: 200,
  PROJECTILE_LIFETIME: 3.0,
  PROJECTILE_RANGE: 200,
  PROJECTILE_DAMAGE: 25,
  LASER_POOL: 32,

  // Health
  MAX_HEALTH: 100,
  COLLISION_THRESHOLD_LARGE: 2.0,
  COLLISION_DAMAGE_LARGE: 20,
  COLLISION_DAMAGE_SMALL: 5,
  WARNING_HEALTH_THRESHOLD: 30,
  DAMAGE_INVULNERABILITY: 0.75,
  ASTEROID_HP: { large: 100, medium: 50, small: 25 },
  ASTEROID_DRIFT_MIN: 1,
  ASTEROID_DRIFT_MAX: 4,

  // Comets
  COMET_MIN_SCALE: 3,
  COMET_MAX_SCALE: 6,
  COMET_SPEED_MIN: 15,
  COMET_SPEED_MAX: 30,
  COMET_HP: 150,
  COMET_DAMAGE: 25,
  COMET_SCORE: 100,
  COMET_TUMBLE_SPEED: 0.3,
  COMET_TRAIL_POOL: 800,
  COMET_SMOKE_POOL: 300,
  COMET_CURVE_AMPLITUDE: 10,
  COMET_CURVE_WAVELENGTH: 150,
  COMET_MIN_DIST_FROM_SHIP: 150,
  COMET_TRAIL_LIFETIME: 4.0,
  COMET_SMOKE_LIFETIME: 6.0,

  // Black holes
  BLACK_HOLE_RADIUS: 8,
  BLACK_HOLE_GRAVITY_RADIUS: 450,    // tripled (was 150)
  BLACK_HOLE_GRAVITY_STRENGTH: 7500, // tripled (was 2500)
  BLACK_HOLE_SHIP_PULL_FACTOR: 0.5,
  BLACK_HOLE_MAX_PULL: 120,
  BLACK_HOLE_WARNING_RANGE: 40,
  BLACK_HOLE_DISK_SPEED: 0.5,
  BLACK_HOLE_MIN_DISTANCE: 3000,

  // Dead stars
  DEAD_STAR_RADIUS_MIN: 25,
  DEAD_STAR_RADIUS_MAX: 45,
  DEAD_STAR_GLOW_SCALE: 6,
  DEAD_STAR_LIGHT_INTENSITY: 3.0,
  DEAD_STAR_LIGHT_RANGE: 600,
  DEAD_STAR_LIGHT_COLOR: 0xff3322,
  DEAD_STAR_WARNING_RANGE: 60,
  DEAD_STAR_MIN_SPACING: 1500,
  DEAD_STAR_MIN_DIST_FROM_SHIP: 400,
  DEAD_STAR_EMBER_POOL: 100,

  // Wormhole tunnel
  WORMHOLE_TUNNEL_RADIUS: 40,
  WORMHOLE_WALL_THICKNESS: 25,
  WORMHOLE_BLUR_MAX_INTENSITY: 0.85,
  WORMHOLE_BLUR_FADE: 0.5,

  // Space stations
  STATION_MIN_SCALE: 12,
  STATION_MAX_SCALE: 20,
  STATION_MIN_DIST_FROM_SHIP: 300,

  // Screen shake
  SHAKE_DAMAGE_INTENSITY: 0.5,
  SHAKE_DAMAGE_DURATION: 0.3,
  SHAKE_EXPLOSION_INTENSITY: 0.8,
  SHAKE_EXPLOSION_DURATION: 0.5,
  SHAKE_DECAY_RATE: 4.0,

  // World / chunks
  CHUNK_SIZE: 200,
  CHUNKS_RADIUS: 2,         // chunks kept around ship (Chebyshev distance, 5x5 grid)
  CHUNKS_CLEANUP_RADIUS: 2.6,
  CHUNKS_VERTICAL_RADIUS: 1, // 3 vertical layers: below, current, above
  CONTENT_Y_BAND: 90,        // ±u within each chunk's Y layer
  DENSITY_REDUCTION: 0.75,   // per-layer density (3 layers → total ≈ 2.25× old, per user)
  SHIP_FORWARD_AXIS: 'z',

  // Biomes (distance in units traveled, odometer)
  BIOMES: {
    OPEN_SPACE:       { range: [0, 1000],    asteroidDensity: 10, nebulaCount: 2, cometDensity: 3, blackHoleDensity: 0, deadStarDensity: 1, stationDensity: 0, color: [0.1, 0.15, 0.3] },
    ASTEROID_BELT:    { range: [1000, 3000], asteroidDensity: 40, nebulaCount: 3, cometDensity: 6, blackHoleDensity: 0, deadStarDensity: 2, stationDensity: 2, color: [0.4, 0.2, 0.1] },
    NEBULA_CORRIDOR:  { range: [3000, 5000], asteroidDensity: 20, nebulaCount: 6, cometDensity: 8, blackHoleDensity: 4, deadStarDensity: 3, stationDensity: 3, color: [0.3, 0.15, 0.4] },
    WORMHOLE:         { range: [5000, 7000], asteroidDensity: 60, nebulaCount: 8, cometDensity: 10, blackHoleDensity: 8, deadStarDensity: 4, stationDensity: 4, color: [0.2, 0.1, 0.5] },
  },
  POST_7000_MULTIPLIER: 1.5,

  // Starfield
  STAR_LAYERS: {
    far:  { count: 5000, size: 0.5, parallaxSpeed: 0.1, color: [0.8, 0.85, 1.0], twinkle: 0.0 },
    mid:  { count: 2000, size: 1.0, parallaxSpeed: 0.3, color: [1.0, 0.95, 0.8], twinkle: 0.3 },
    near: { count: 500,  size: 2.0, parallaxSpeed: 0.8, color: [1.0, 0.9, 0.7], twinkle: 1.0 },
  },
  BRIGHT_STAR_COUNT: 30,
  STARFIELD_WRAP: 1200,     // stars wrap in a box of ±this around ship

  // Post-processing
  BLOOM: { strength: 1.5, radius: 0.4, threshold: 0.15 },
  VIGNETTE: { darkness: 0.5, offset: 0.2 },
  FILM_GRAIN: { intensity: 0.03 },
  CHROMATIC_ABERRATION_MAX: 0.003,

  // Fog
  FOG_COLOR: 0x000011,
  FOG_DENSITY: 0.008,

  // Particles
  PARTICLE_POOLS: {
    exhaust:    { maxParticles: 200, lifetime: 0.8, size: 0.3 },
    laserSpark: { maxParticles: 50,  lifetime: 0.3, size: 0.15 },
    explosion:  { maxParticles: 80,  lifetime: 1.2, size: 0.4 },
    cometDust:  { maxParticles: 800, lifetime: 4.0, size: 0.8 },
    cometSmoke: { maxParticles: 300, lifetime: 6.0, size: 2.0 },
    ember:      { maxParticles: 100, lifetime: 2.0, size: 0.3 },
  },

  // Scoring
  SCORE_ASTEROID_BASE: 10,
  SCORE_DEBRIS: 1,
  SCORE_DISTANCE_DIVISOR: 10,
  DEBRIS_DENSITY_FACTOR: 0.4,

  // Misc gameplay
  DEATH_SCREEN_DELAY: 1.0,
  HIGH_SCORE_KEY: 'void_drift_highscore',
  MAX_DELTA: 0.1,

  // Performance targets
  MAX_DRAW_CALLS: 50,
  MAX_TRIANGLES: 200000,
  MAX_INSTANCED_OBJECTS: 2000,
  DPR_MAX: 2,
  TARGET_FPS: 60,
  MIN_ACCEPTABLE_FPS: 30,
  MAX_ACTIVE_LIGHTS: 8,
};

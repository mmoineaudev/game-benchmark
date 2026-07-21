// ============================================================
// Constants — all magic numbers, colors, timings, configs
// ============================================================

export const SCENE = {
  BACKGROUND_COLOR: 0x111827,
  FOG_COLOR: 0x111827,
  FOG_DENSITY: 0.0018,
  MAX_FOV: 95,
  MIN_FOV: 75,
};

export const CAMERA = {
  START_FOV: 75,
  FOLLOW_DISTANCE: 12,
  FOLLOW_HEIGHT: 6,
  DAMPING_SPEED: 2.5,
  FOV_LERP_SPEED: 3,
  MIN_FOV: 60,
  MAX_FOV: 110,
  ZOOM_MIN: 1,
  ZOOM_MAX: 3,
  ZOOM_STEP: 0.25,
  LOOK_OFFSET_Y: -2.5,
  LOOK_OFFSET_Z: -14,
};

export const SHIP = {
  MAX_SPEED: 50,
  ACCELERATION: 38,
  DECELERATION: 25,
  ROTATION_SPEED: 2.2,
  ROLL_SPEED: 2.2,
  DRAG: 0.97,
  MESH_COLOR: 0x7799bb,
  MESH_EMISSIVE: 0x112233,
  ACCENT_COLOR: 0x4466ff,
  ENGINE_COLOR: 0x44aaff,
  ENGINE_GLOW_COLOR: 0xaaddff,
  WINGTIP_RED: 0xff3300,
  WINGTIP_GREEN: 0x00ff66,
};

export const INPUT = {
  FORWARD: 'ShiftLeft',
  BACKWARD: 'Space',
  FIRE: 'KeyF',
  RESTART: 'KeyR',
};

export const WEAPON = {
  FIRE_RATE: 8,
  PROJECTILE_SPEED: 120,
  PROJECTILE_RANGE: 200,
  PROJECTILE_LIFETIME: 3,
  LASER_COLOR: 0x00ffaa,
  LASER_LENGTH: 2,
  LASER_RADIUS: 0.04,
  IMPACT_FLASH_DURATION: 0.1,
};

export const PARTICLE = {
  STAR_FAR_COUNT: 1800,
  STAR_MID_COUNT: 700,
  STAR_NEAR_COUNT: 150,
  STAR_BRIGHT_COUNT: 40,
  EXHAUST_POOL: 120,
  EXPLOSION_MIN: 20,
  EXPLOSION_MAX: 40,
  SPARK_COUNT: 8,
  DEBRIS_FRAGMENT_COUNT: 4,
};

export const POST_PROCESSING = {
  BLOOM_STRENGTH: 1.0,
  BLOOM_RADIUS: 0.4,
  BLOOM_THRESHOLD: 0.35,
  VIGNETTE_DARKNESS: 0.6,
  VIGNETTE_OFFSET: 0.22,
  FILM_GRAIN_INTENSITY: 0.025,
};

export const BIOME = {
  ZONES: [
    { start: 0, end: 1000, name: 'Open Space' },
    { start: 1000, end: 3000, name: 'Asteroid Belt' },
    { start: 3000, end: 5000, name: 'Nebula Corridor' },
    { start: 5000, end: 7000, name: 'Wormhole Tunnel' },
  ],
};

export const CHUNK = {
  WIDTH: 240,
  HEIGHT: 240,
  LENGTH: 240,
  SPAWN_AHEAD: 1,
  CLEANUP_BEHIND: 1,
};

export const SCORE = {
  ASTEROID_LARGE: 30,
  ASTEROID_MEDIUM: 20,
  ASTEROID_SMALL: 10,
  DEBRIS: 1,
  DISTANCE_PER_UNIT: 0.1,
};

export const HEALTH = {
  MAX: 100,
  COLLISION_DAMAGE: 10,
  WARNING_THRESHOLD: 30,
};

export const AUDIO = {
  ENGINE_FREQ_MIN: 55,
  ENGINE_FREQ_MAX: 180,
  LASER_FREQ_START: 800,
  LASER_FREQ_END: 200,
  EXPLOSION_DECAY: 0.5,
  COLLISION_DECAY: 0.3,
  WARNING_FREQ: 800,
  WARNING_BEIPS: 3,
  WARNING_INTERVAL: 0.3,
};

export default {
  SCENE, CAMERA, SHIP, INPUT, WEAPON, PARTICLE,
  POST_PROCESSING, BIOME, CHUNK, SCORE, HEALTH, AUDIO,
};

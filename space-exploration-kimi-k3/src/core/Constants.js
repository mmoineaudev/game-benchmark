// ============================================================================
// VOID DRIFT — Constants.js
// Single source of truth for every tunable. No magic numbers elsewhere.
// ============================================================================

export const SCENE = {
  BACKGROUND_COLOR: 0x111827,
  FOG_COLOR: 0x111827,
  FOG_DENSITY: 0.0018,
};

// --- Input (event.code, physical positions — AZERTY/QWERTY safe) -------------
// Left-hand diamond: Z(QWERTY W) top, S bottom, Q(QWERTY A) left, D right.
// Vertical: A(QWERTY Q) down, E up.
export const INPUT = {
  FORWARD: 'KeyZ',
  BACKWARD: 'KeyS',
  STRAFE_LEFT: 'KeyQ',
  STRAFE_RIGHT: 'KeyD',
  DOWN: 'KeyA',
  UP: 'KeyE',
  FIRE: 'Space',
  RESTART: 'KeyR',
  MUTE: 'KeyM',
  MOUSE_SENSITIVITY: 3.5,
  PITCH_CLAMP: Math.PI / 2.2,       // ~±81°
  IDLE_SELF_LEVEL_DELAY: 3.0,       // seconds
  SELF_LEVEL_RATE: 2.0,
};

// Legend rendered on the pause screen — generated from this list.
export const CONTROLS_LEGEND = [
  ['MOUSE', 'steer (click to capture)'],
  ['Z / S', 'thrust / reverse  (W / S on QWERTY)'],
  ['Q / D', 'strafe left / right  (A / D on QWERTY)'],
  ['A / E', 'descend / ascend  (Q / E on QWERTY)'],
  ['SPACE / LEFT CLICK', 'fire lasers'],
  ['MOUSE WHEEL', 'camera zoom'],
  ['M', 'mute'],
  ['R', 'restart (after ship lost)'],
];

// --- Ship --------------------------------------------------------------------
export const SHIP = {
  MAX_SPEED: 45,
  ACCELERATION: 38,
  DECELERATION: 30,
  REVERSE_RATIO: 0.3,               // reverse capped at 0.3 × MAX_SPEED
  STRAFE_SPEED_RATIO: 0.6,          // lateral/vertical thrust vs MAX_SPEED
  LATERAL_DRAG: 0.97,               // per-frame damping of strafe/vertical
  ROTATION_SPEED: 2.6,
  COLLISION_RADIUS: 1.2,
  BANK_RATE: 0.9,                   // cosmetic roll from yaw/strafe
  MAX_BANK: 0.5,

  BODY_COLOR: 0xbb2233,
  TRIM_COLOR: 0x1a1c22,
  GLASS_COLOR: 0x66ddff,
  ENGINE_COLOR: 0x44aaff,
  TAIL_COLOR: 0xff2233,
  ACCENT_COLOR: 0x4488ff,

  HEADLIGHT_INTENSITY: 0.8,
  HEADLIGHT_DISTANCE: 22,
  ACCENT_INTENSITY: 1.0,
  ACCENT_DISTANCE: 10,
  WINGTIP_EMISSIVE: 3,
};

// --- Camera ------------------------------------------------------------------
export const CAMERA = {
  MIN_FOV: 60,
  MAX_FOV: 110,
  FOLLOW_HEIGHT: 6,
  FOLLOW_DISTANCE: 12,
  LOOK_OFFSET_Y: -2.5,
  LOOK_OFFSET_Z: -14,
  DAMPING_SPEED: 4.5,
  ZOOM_MIN: 1,
  ZOOM_MAX: 3,
  ZOOM_STEP: 0.25,
  SHAKE_DECAY: 0.001,               // Math.pow(SHAKE_DECAY, dt) per frame
};

// --- Weapon ------------------------------------------------------------------
export const WEAPON = {
  PROJECTILE_SPEED: 120,
  PROJECTILE_LIFETIME: 3.0,
  PROJECTILE_RANGE: 200,
  PROJECTILE_RADIUS: 0.3,
  FIRE_RATE: 8,                     // shots per second
  LASER_COLOR: 0x00ffaa,
  LASER_EMISSIVE: 2.2,
  RECOIL: 0.6,
  SPAWN_FORWARD: 2.2,
  SPAWN_UP: 0.3,
};

// --- Health / damage ---------------------------------------------------------
export const HEALTH = {
  MAX: 100,
  WARNING_THRESHOLD: 30,
  COLLISION_DAMAGE: 10,
};

// --- Scoring -----------------------------------------------------------------
export const SCORE = {
  ASTEROID_LARGE: 30,               // size > 2
  ASTEROID_MEDIUM: 20,              // size > 0.8
  ASTEROID_SMALL: 10,
  DEBRIS: 1,
  CRYSTAL: 50,
  RUIN: 20,
  NPC: 15,
  DISTANCE_RATE: 0.1,
};

// --- Biomes ------------------------------------------------------------------
export const BIOME = {
  ZONES: [
    { name: 'Open Space',      min: 0,    max: 1000, nebulaCount: 1, asteroidDensity: 0.35, debrisCount: 8,
      nebulaColors: [0x2244aa, 0x3355cc, 0x1133aa], wormhole: false },
    { name: 'Asteroid Belt',   min: 1000, max: 3000, nebulaCount: 1, asteroidDensity: 0.8,  debrisCount: 8,
      nebulaColors: [0xaa6633, 0x885522, 0xcc7744], wormhole: false },
    { name: 'Nebula Corridor', min: 3000, max: 5000, nebulaCount: 3, asteroidDensity: 0.2,  debrisCount: 10,
      nebulaColors: [0x8833cc, 0x22ccdd, 0x6622aa], wormhole: false },
    { name: 'Wormhole Tunnel', min: 5000, max: 7000, nebulaCount: 2, asteroidDensity: 0.05, debrisCount: 4,
      nebulaColors: [0xaa22cc, 0x22ffdd, 0x7711aa], wormhole: true },
  ],
  CYCLE_LENGTH: 7000,
  INTENSITY_DIVISOR: 5000,
  INTENSITY_MAX: 2.75,
};

// --- Chunks ------------------------------------------------------------------
export const CHUNK = {
  SIZE: 240,
  SPAWN_AHEAD: 1,
  CLEANUP_BEHIND: 1,
  LOW_ALTITUDE_SPAWN_BIAS_Y: 10,
  ORIGIN_SAFETY_RADIUS: 25,
  ORIGIN_SAFETY_DISTANCE: 10,
  ASTEROID_COUNT_BASE: 1,
  ASTEROID_COUNT_VAR: 8,
  DEBRIS_BASE: 30,
  DEBRIS_VAR: 40,
  CRYSTALS_MIN: 1,
  CRYSTALS_VAR: 3,
  RUINS_MIN: 1,
  RUINS_VAR: 2,
};

// --- Level entities ----------------------------------------------------------
export const PLANET = {
  GRID_SIZE: 4800,
  VIEW_DISTANCE: 18750,
  SPAWN_CHANCE: 0.38,
  MIN_RADIUS: 60,
  MAX_RADIUS: 320,
  ATMOSPHERE_RATIO: 1.12,
  ATMOSPHERE_MIN_RADIUS: 12,
  ATMOSPHERE_OPACITY: 0.07,
};

export const NPC = {
  MAX_COUNT: 28,
  GRID_SIZE: 2400,
  VIEW_DISTANCE: 11250,
  SPAWN_CHANCE: 0.4,
  SPEED: 16,
  TRAIL_POOL: 256,
  TRAIL_CADENCE: 0.05,
  TRAIL_DECAY: 0.9,
  COLLISION_RADIUS: 2.0,
};

export const SHOOTING_STAR = {
  CHECK_INTERVAL: 3.5,
  SPAWN_CHANCE: 0.35,
  MIN_POINTS: 12,
  MAX_POINTS: 32,
  MIN_SPEED: 40,
  MAX_SPEED: 90,
  MIN_LIFE: 1.2,
  MAX_LIFE: 2.6,
  MIN_OPACITY: 0.35,
  MAX_OPACITY: 0.85,
};

export const STARFIELD = {
  COUNT: 4200,
  BRIGHT_COUNT: 350,
  RADIUS: 900,
  PARALLAX: 0.05,
};

// --- Audio -------------------------------------------------------------------
export const AUDIO = {
  MASTER_GAIN: 0.3,
  ENGINE_FREQ_MIN: 55,
  ENGINE_FREQ_MAX: 180,
  ENGINE_GAIN_MIN: 0.11,
  ENGINE_GAIN_MAX: 0.27,
  LASER_FREQ_START: 800,
  LASER_FREQ_END: 200,
  EXPLOSION_DURATION: 0.5,
  COLLISION_DURATION: 0.4,
  WARNING_FREQ: 800,
  WARNING_BEEPS: 3,
  WARNING_BEEP_DURATION: 0.2,
  WARNING_BEEP_GAP: 0.3,
  WARNING_COOLDOWN: 1.5,
};

// --- Post-processing ----------------------------------------------------------
export const POST = {
  BLOOM_MIN: 0.7,
  BLOOM_MAX: 1.35,
  BLOOM_RADIUS: 0.55,
  BLOOM_THRESHOLD: 0.35,
  CHROMATIC_MAX_OFFSET: 0.012,
  VIGNETTE_DARKNESS: 0.6,
  VIGNETTE_OFFSET: 0.22,
  GRAIN_INTENSITY: 0.025,
  LOW_END_CORES: 4,
};

// --- Particles ----------------------------------------------------------------
export const PARTICLES = {
  EXHAUST_POOL: 220,
  EXHAUST_LIFE_MIN: 0.3,
  EXHAUST_LIFE_MAX: 0.7,
  EXHAUST_DAMPING: 0.95,
  EXPLOSION_COUNT: 90,
  EXPLOSION_LIFE: 0.9,
};

// --- Persistence ---------------------------------------------------------------
export const STORAGE = {
  HIGH_SCORE: 'space_exploration_highscore',
  MUTED: 'void_drift_muted',
};

// --- Lighting rig ---------------------------------------------------------------
export const LIGHTING = {
  AMBIENT_COLOR: 0x161e33,
  AMBIENT_INTENSITY: 0.85,
  SUN_COLOR: 0xddeeff,
  SUN_INTENSITY: 1.1,
  FILL_COLOR: 0x5577aa,
  FILL_INTENSITY: 0.6,
  RIM_COLOR: 0x335577,
  RIM_INTENSITY: 0.4,
  HEMI_SKY: 0x334466,
  HEMI_GROUND: 0x0a0a0a,
  HEMI_INTENSITY: 0.35,
};

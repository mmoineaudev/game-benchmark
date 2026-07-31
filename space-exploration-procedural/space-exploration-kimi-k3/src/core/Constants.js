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
// Gyroscopic: Arrow keys = pitch/yaw/roll.
// Throttles: Shift accelerate, Space brake.
// Weapons: F fire. Mute M. Restart R. Zoom mouse wheel.
export const INPUT = {
  FORWARD: 'ShiftLeft',
  BACKWARD: 'Space',
  FIRE: 'KeyF',
  RESTART: 'KeyR',
  MUTE: 'KeyM',
  ARROW_UP: 'ArrowUp',
  ARROW_DOWN: 'ArrowDown',
  ARROW_LEFT: 'ArrowLeft',
  ARROW_RIGHT: 'ArrowRight',
  MOUSE_SENSITIVITY: 3.5,
  PITCH_CLAMP: Math.PI / 2.2,       // ~±81°
  IDLE_SELF_LEVEL_DELAY: 3.0,       // seconds
  SELF_LEVEL_RATE: 2.0,
  KEYBOARD_ROLL_RATE: 1.6,
  KEYBOARD_PITCH_YAW_RATE: 2.2,
};

// Legend rendered on the pause screen — generated from this list.
export const CONTROLS_LEGEND = [
  ['ARROWS', 'gyroscopic pitch/yaw/roll'],
  ['SHIFT', 'accelerate'],
  ['SPACE', 'brake / reverse'],
  ['F / LEFT CLICK', 'fire lasers'],
  ['MOUSE (pointer lock)', 'gyroscopic yaw/pitch alternative'],
  ['MOUSE WHEEL', 'camera zoom'],
  ['M', 'mute'],
  ['R', 'restart (after ship lost)'],
];

// --- Ship --------------------------------------------------------------------
export const SHIP = {
  MAX_SPEED: 1400,
  ACCELERATION: 700,
  DECELERATION: 600,
  REVERSE_RATIO: 0.3,               // reverse capped at 0.3 × MAX_SPEED
  STRAFE_SPEED_RATIO: 0.6,          // lateral/vertical thrust vs MAX_SPEED
  LATERAL_DRAG: 0.97,               // per-frame damping of strafe/vertical
  ROTATION_SPEED: 2.6,
  COLLISION_RADIUS: 1.2,
  BANK_RATE: 0.9,                   // cosmetic roll from yaw/strafe
  MAX_BANK: 0.5,
  HEADLIGHT_INTENSITY: 1.4,
  HEADLIGHT_DISTANCE: 80,
  ACCENT_COLOR: 0x4488ff,
  ACCENT_INTENSITY: 0.9,
  ACCENT_DISTANCE: 35,
  ENGINE_COLOR: 0x44aaff,
  WINGTIP_EMISSIVE: 2.0,

  PRESETS: [
    { id: 'interceptor', label: 'INTERCEPTOR', shape: 'interceptor', body: 0xbb2233, trim: 0x1a1c22, glass: 0x66ddff, engine: 0x44aaff, tail: 0xff2233, accent: 0x4488ff, scale: 1.0, engineColor: 0x44aaff, headlightIntensity: 1.4, headlightDistance: 80, accentIntensity: 0.9, accentDistance: 35, accentColor: 0x4488ff, wingtipEmissive: 2.0 },
    { id: 'claymore',    label: 'CLAYMORE',    shape: 'claymore',    body: 0xdd8833, trim: 0x221a12, glass: 0xffccaa, engine: 0xffaa44, tail: 0xff4411, accent: 0xffdd44, scale: 1.25, engineColor: 0xffaa44, headlightIntensity: 1.6, headlightDistance: 95, accentIntensity: 1.1, accentDistance: 42, accentColor: 0xffdd44, wingtipEmissive: 2.4 },
    { id: 'vanguard',    label: 'VANGUARD',    shape: 'vanguard',    body: 0x3388cc, trim: 0x0e1420, glass: 0xaaffff, engine: 0x22ccff, tail: 0x0088ff, accent: 0x66eeff, scale: 1.15, engineColor: 0x22ccff, headlightIntensity: 1.5, headlightDistance: 100, accentIntensity: 1.0, accentDistance: 40, accentColor: 0x66eeff, wingtipEmissive: 2.2 },
    { id: 'sprinter',    label: 'SPRINTER',    shape: 'sprinter',    body: 0x88cc22, trim: 0x141a0e, glass: 0xddffaa, engine: 0x66ff22, tail: 0x33aa00, accent: 0xaaff44, scale: 0.88, engineColor: 0x66ff22, headlightIntensity: 1.25, headlightDistance: 65, accentIntensity: 0.8, accentDistance: 28, accentColor: 0xaaff44, wingtipEmissive: 2.0 },
  ],
};

// --- Camera ------------------------------------------------------------------
export const CAMERA = {
  MIN_FOV: 66,
  MAX_FOV: 95,
  FOLLOW_HEIGHT: 6,
  FOLLOW_DISTANCE: 14,
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
  PROJECTILE_SPEED: 180,
  PROJECTILE_LIFETIME: 3.5,
  PROJECTILE_RANGE: 280,
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
  ARTIFACT: 50,
  RUIN: 20,
  NPC: 15,
  DISTANCE_RATE: 0.1,
};

// --- Boost pickup ------------------------------------------------------------
export const BOOST = {
  DURATION: 5,
  MULTIPLIER: 10,
};

// --- Biomes ------------------------------------------------------------------
export const BIOME = {
  ZONES: [
    { name: 'Open Space',      min: 0,    max: 2400, asteroidDensity: 0.30, debrisCount: 1,
      nebulaColors: [0x2244aa, 0x3355cc, 0x1133aa],
      entities: ['asteroid','debris'] },
    { name: 'Drift Belt',      min: 2400, max: 7000, asteroidDensity: 2.50, debrisCount: 1,
      nebulaColors: [0xaa6633, 0x885522, 0xcc7744],
      entities: ['asteroid','asteroid','asteroid','asteroid','asteroid','debris'] },
    { name: 'Veil Nebula',     min: 7000, max: 10800, asteroidDensity: 0.28, debrisCount: 1,
      nebulaColors: [0x8833cc, 0x22ccdd, 0x6622aa],
      entities: ['cloud','asteroid'] },
    { name: 'Glass Rift',      min: 10800, max: 13800, asteroidDensity: 0.10, debrisCount: 0,
      nebulaColors: [0x22cc77, 0x66ffaa, 0x116644],
      entities: ['cloud'] },
    { name: 'Rust Expanse',    min: 13800, max: 17400, asteroidDensity: 0.55, debrisCount: 1,
      nebulaColors: [0xccaa66, 0x997744, 0x553311],
      entities: ['ruin','asteroid'] },
    { name: 'The Fold',        min: 17400, max: 22000, asteroidDensity: 0.18, debrisCount: 0,
      nebulaColors: [0xaa22cc, 0x22ffdd, 0x7711aa], wormhole: true,
      entities: ['asteroid'] },
  ],
  CYCLE_LENGTH: 24000,
  INTENSITY_DIVISOR: 12000,
  INTENSITY_MAX: 2.2,
};

// --- Planets ------------------------------------------------------------------
export const PLANET = {
  GRID_SIZE: 4800,
  VIEW_DISTANCE: 14000,
  SPAWN_CHANCE: 0.18,
  MIN_RADIUS: 80,
  MAX_RADIUS: 520,
  MAX_MEGA_RADIUS: 880,
  ATMOSPHERE_RATIO: 1.18,
  ATMOSPHERE_MIN_RADIUS: 18,
  ATMOSPHERE_OPACITY: 0.09,
};

// --- Chunks ------------------------------------------------------------------
export const CHUNK = {
  SIZE: 960,
  SPAWN_AHEAD: 3,
  CLEANUP_BEHIND: 2,
  ORIGIN_SAFETY_RADIUS: 30,
  ASTEROID_COUNT_BASE: 0,
  ASTEROID_COUNT_VAR: 2,
  KEEP_OUT_RADIUS: 280,
};

// --- Level entities ----------------------------------------------------------
export const NPC = {
  MAX_COUNT: 80,
  GRID_SIZE: 1200,
  VIEW_DISTANCE: 20000,
  SPAWN_CHANCE: 0.38,               // deterministic per-cell
  WANDER_SPAWN_CHANCE: 0.70,        // per-second random encounter near ship path
  SPEED: 24,
  TRAIL_POOL: 180,
  TRAIL_CADENCE: 0.06,
  TRAIL_DECAY: 0.88,
  COLLISION_RADIUS: 2.0,
};

export const SHOOTING_STAR = {
  CHECK_INTERVAL: 1.0,
  SPAWN_CHANCE: 0.35,
  MIN_POINTS: 8,
  MAX_POINTS: 22,
  MIN_SPEED: 40,
  MAX_SPEED: 90,
  MIN_LIFE: 1.2,
  MAX_LIFE: 2.6,
  MIN_OPACITY: 0.35,
  MAX_OPACITY: 0.85,
  VARIANTS: {
    'Open Space':      { color: 0xcceeff, speedMin: 40, speedMax: 90, lifeMin: 1.2, lifeMax: 2.6, opacityMin: 0.35, opacityMax: 0.85, pointsMin: 10, pointsMax: 24 },
    'Asteroid Belt':   { color: 0xffccaa, speedMin: 70, speedMax: 130, lifeMin: 0.8, lifeMax: 1.6, opacityMin: 0.45, opacityMax: 0.95, pointsMin: 12, pointsMax: 28 },
    'Nebula Corridor': { color: 0xcc99ff, speedMin: 28, speedMax: 65, lifeMin: 1.6, lifeMax: 3.2, opacityMin: 0.3, opacityMax: 0.75, pointsMin: 14, pointsMax: 32 },
    'Crystal Rift':    { color: 0x88ffdd, speedMin: 32, speedMax: 72, lifeMin: 1.8, lifeMax: 3.6, opacityMin: 0.3, opacityMax: 0.8, pointsMin: 16, pointsMax: 36 },
    'Ruin Field':      { color: 0xffbb77, speedMin: 50, speedMax: 100, lifeMin: 1.0, lifeMax: 2.0, opacityMin: 0.4, opacityMax: 0.9, pointsMin: 12, pointsMax: 26 },
    'Wormhole Tunnel': { color: 0xff88ff, speedMin: 90, speedMax: 160, lifeMin: 0.6, lifeMax: 1.4, opacityMin: 0.5, opacityMax: 1.0, pointsMin: 14, pointsMax: 30 },
  },
};

export const STARFIELD = {
  COUNT: 4200,
  BRIGHT_COUNT: 350,
  RADIUS: 900,
  PARALLAX: 0.05,
};

// ----------------------------------------------------------------------------
// Wormholes
// ----------------------------------------------------------------------------
export const WORMHOLE = {
  TELEPORT_RADIUS: 55,
  TELEPORT_COOLDOWN: 2.5,
  MIN_SPAWN_DIST: 2500,
  MAX_SPAWN_DIST: 18000,
  VIEW_DISTANCE: 20000,
  SPAWN_CHANCE: 0.06,
  PULL: 0,
  PULL_RADIUS: 0,
};

// ----------------------------------------------------------------------------
// Black holes
// ----------------------------------------------------------------------------
export const BLACK_HOLE = Object.freeze({
  MAX_ACTIVE: 4,
  PULL: 14,
  VIEW_DISTANCE: 34000,
  SPAWN_MIN: 2500,
  SPAWN_MAX: 28000,
  ACTIVE_BONUS_MULTIPLIER: 3.4,
});

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
  BLOOM_MAX: 1.45,
  BLOOM_RADIUS: 0.45,
  BLOOM_THRESHOLD: 0.45,
  CHROMATIC_MAX_OFFSET: 0.014,
  VIGNETTE_DARKNESS: 0.55,
  VIGNETTE_OFFSET: 0.22,
  GRAIN_INTENSITY: 0.022,
  LOW_END_CORES: 4,
};

// --- Particles ----------------------------------------------------------------
export const PARTICLES = {
  EXHAUST_POOL: 80,
  EXHAUST_LIFE_MIN: 0.3,
  EXHAUST_LIFE_MAX: 0.7,
  EXHAUST_DAMPING: 0.95,
  EXPLOSION_COUNT: 30,
  EXPLOSION_LIFE: 0.9,
};

// --- Persistence --------------------------------------------------------------
export const STORAGE = {
  HIGH_SCORE: 'space_exploration_highscore',
  MUTED: 'void_drift_muted',
};

// --- Lighting rig ---------------------------------------------------------------
export const LIGHTING = {
  AMBIENT_COLOR: 0x161e33,
  AMBIENT_INTENSITY: 0.95,
  SUN_COLOR: 0xddeeff,
  SUN_INTENSITY: 1.6,
  FILL_COLOR: 0x5577aa,
  FILL_INTENSITY: 0.85,
  RIM_COLOR: 0x335577,
  RIM_INTENSITY: 0.6,
  HEMI_SKY: 0x334466,
  HEMI_GROUND: 0x0a0a0a,
  HEMI_INTENSITY: 0.4,
};

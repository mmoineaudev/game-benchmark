// ═══════════════════════════════════════════════════════════════════════════
// Procedural Metroidvania — all magic numbers, balance values, timings
// ═══════════════════════════════════════════════════════════════════════════

// ── Debug ───────────────────────────────────────────────────────────────────
export const DEBUG = {
  LOG_LEVEL: 2,        // 0=none, 1=errors, 2=info, 3=verbose
  SHOW_COLLISION: false,
  GOD_MODE: false,
  SHOW_FPS: true,
};

// ── Scene / Camera ──────────────────────────────────────────────────────────
export const SCENE = {
  BG_COLOR: 0x0d1025,
  FOG_COLOR: 0x0d1025,
  FOG_NEAR: 10,
  FOG_FAR: 60,
};

export const CAMERA = {
  DEADZONE_X: 1.5,
  DEADZONE_Y: 1.0,
  LERP_SPEED: 8,
  BASE_ZOOM: 16,
  NEAR: 0.1,
  FAR: 200,
};

// ── Physics / Collision ─────────────────────────────────────────────────────
export const PHYSICS = {
  GRAVITY: 45,
  MAX_FALL_SPEED: 30,
  DT_MAX: 0.05,        // clamp delta to prevent spiral of death
};

// ── Player ──────────────────────────────────────────────────────────────────
export const PLAYER = {
  WIDTH: 0.7,
  HEIGHT: 1.2,
  MASS: 1,

  WALK_ACCEL: 50,
  WALK_MAX: 8,
  WALK_FRICTION: 12,

  JUMP_VELOCITY: 13,
  JUMP_HOLD_GRAVITY: 15,   // reduced gravity while holding jump
  JUMP_CUT_MULT: 0.45,     // velocity multiplier when releasing jump early

  DOUBLE_JUMP_VEL: 11,     // slightly weaker than first jump

  DASH_SPEED: 18,
  DASH_DURATION: 0.15,
  DASH_COOLDOWN: 0.8,

  WALL_SLIDE_MAX: 6,
  WALL_JUMP_H: 8,          // horizontal push away from wall
  WALL_JUMP_V: 12,         // vertical boost

  COYOTE_FRAMES: 4,        // ~66ms at 60fps
  JUMP_BUFFER_FRAMES: 6,   // ~100ms at 60fps

  HIT_INVINCIBILITY: 1.2,  // seconds after taking damage
  KNOCKBACK_FORCE: 6,
  KNOCKBACK_TIME: 0.2,

  HP: 5,
  ATTACK_RANGE: 1.0,
  ATTACK_DAMAGE: 1,
  ATTACK_COOLDOWN: 0.35,
  ATTACK_WIDTH: 0.6,
};

// ── Rooms ───────────────────────────────────────────────────────────────────
export const ROOM = {
  WIDTH: 22,    // tiles wide (world units)
  HEIGHT: 16,   // tiles tall
  TILE: 1,      // 1 unit = 1 tile

  TRANSITION_DURATION: 0.3,
};

// ── Enemies ─────────────────────────────────────────────────────────────────
export const ENEMY = {
  DRONE: {
    hp: 2,
    speed: 2.5,
    damage: 1,
    scale: 0.5,
    patrolPause: 1.5,   // seconds paused at patrol endpoints
    detectRange: 6,
  },
};

// ── Boss ─────────────────────────────────────────────────────────────────────────
export const BOSS = {
  HP: 8,
  SCALE: 1.4,
  SPEED: 3.5,
  DAMAGE: 1,
  CHARGE_SPEED: 10,
  CHARGE_TELEGRAPH: 0.4,  // seconds of warning before charge
  CHARGE_COOLDOWN: 1.8,
  JUMP_DAMAGE: 1,
  JUMP_TELEGRAPH: 0.3,
  JUMP_COOLDOWN: 2.2,
  PHASE2_THRESHOLD: 0.5,  // HP fraction to trigger phase 2
  PHASE2_SPEED_MULT: 1.4,
  HIT_INVINCIBILITY: 0.3,
};

// ── Abilities ───────────────────────────────────────────────────────────────
export const ABILITY = {
  NAMES: {
    doubleJump: 'Double Jump',
    dash: 'Dash',
    missile: 'Missile',
    wallJump: 'Wall Jump',
    grapple: 'Grapple',
  },
  PICKUP_GLOW_SPEED: 3,
  PICKUP_BOB_SPEED: 2,
  PICKUP_BOB_AMPLITUDE: 0.15,
};

// ── Visual / Post-Processing ────────────────────────────────────────────────
export const VISUAL = {
  BLOOM_STRENGTH: 0.35,
  BLOOM_RADIUS: 0.4,
  BLOOM_THRESHOLD: 0.6,

  PARALLAX_LAYERS: 4,
  PARALLAX_SPEED: [0.1, 0.25, 0.45, 0.7],

  PLAYER_GLOW_INTENSITY: 0.6,
  PLAYER_GLOW_RANGE: 4,
  PLAYER_GLOW_COLOR: 0x88ccff,

  AMBIENT_INTENSITY: 0.25,
  AMBIENT_COLOR: 0x223344,

  HIT_FLASH_DURATION: 0.2,
  DEATH_DISSOLVE_TIME: 0.35,
  SPAWN_EFFECT_TIME: 0.4,

  DUST_PARTICLE_COUNT: 30,
  DUST_SPEED: 0.3,
};

// ── Colors ──────────────────────────────────────────────────────────────────
export const COLORS = {
  PLAYER: 0x4488ff,
  PLAYER_EMISSIVE: 0x2266cc,
  ENEMY: 0xff5555,
  ENEMY_RIM: 0xff8888,
  BOSS: 0xff2222,
  BOSS_RIM: 0xff6644,
  BOSS_PHASE2: 0xff00ff,
  PLATFORM: 0x334466,
  PLATFORM_LIGHT: 0x556688,
  WALL: 0x1a2a3a,
  DOOR: 0x2266aa,
  DOOR_LOCKED: 0x663333,
  ABILITY_PICKUP: 0xffcc00,
  ABILITY_GLOW: 0xffaa00,
  CRACKED_WALL: 0x553322,
  HEALTH_PICKUP: 0x44ff44,
  BG_LAYER_0: 0x0d0d1a,
  BG_LAYER_1: 0x111122,
  BG_LAYER_2: 0x151528,
  BG_LAYER_3: 0x1a1a2e,
  HUD_HEALTH_FULL: 0xff4444,
  HUD_HEALTH_EMPTY: 0x331111,
  HUD_TEXT: '#ccddee',
  DAMAGE_NUMBER: '#ff4444',
  MINIMAP_BG: 'rgba(0,0,0,0.6)',
  MINIMAP_ROOM: 'rgba(60,100,160,0.5)',
  MINIMAP_CURRENT: 'rgba(100,160,255,0.8)',
};

// ── Key bindings (event.code) ───────────────────────────────────────────────
export const KEYS = {
  LEFT: 'KeyQ',
  RIGHT: 'KeyD',
  JUMP: 'KeyZ',
  JUMP_ALT: 'Space',
  DASH: 'ShiftLeft',
  ATTACK: 'KeyF',
  MAP: 'KeyM',
  RESTART: 'KeyR',
  PAUSE: 'Escape',
};

// ── Layers (Z-depth in 3D space, gameplay is z=0) ──────────────────────────
export const LAYERS = {
  GAMEPLAY: 0,
  PLAYER: 0,
  ENEMIES: 0,
  DOORS: 0,
  PLATFORMS: -0.5,
  FG_DETAIL: 1.5,
  BG_NEAR: -3,
  BG_MID: -6,
  BG_FAR: -10,
  BG_SKY: -16,
  PICKUPS: 0,
};

// ── Logging helper ──────────────────────────────────────────────────────────
const LOG_PREFIXES = {};
export function LOG(domain, ...args) {
  if (DEBUG.LOG_LEVEL < 2) return;
  if (args[0] && typeof args[0] === 'string' && args[0].startsWith('[VERBOSE') && DEBUG.LOG_LEVEL < 3) return;
  const pfx = LOG_PREFIXES[domain] || (LOG_PREFIXES[domain] = `[${domain}]`);
  console.log(pfx, ...args);
}

export function LOG_ERR(domain, ...args) {
  if (DEBUG.LOG_LEVEL < 1) return;
  const pfx = LOG_PREFIXES[domain] || (LOG_PREFIXES[domain] = `[${domain}]`);
  console.error(pfx, ...args);
}

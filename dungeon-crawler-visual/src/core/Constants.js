// All magic numbers from the dungeon crawler spec
export const WORLD = {
  GRID_MIN: 12,
  GRID_MAX: 16,
  CELL_SIZE: 6,
  CORRIDOR_WIDTH: 1,
  WALL_HEIGHT: 4,
  PLAYER_EYE_HEIGHT: 1.7,
};

export const PLAYER = {
  SPEED: 4,
  SPRINT_MULTIPLIER: 1.55,
  MAX_HEALTH: 3,
  INVULN_TIME: 0.8,
  MOUSE_SENSITIVITY: 0.002,
  PITCH_CLAMP: Math.PI / 2 - 0.1, // ±85°
};

export const CAMERA = {
  FOV: 75,
  SPRINT_FOV_BOOST: 8,
  NEAR: 0.1,
  FAR: 50,
};

export const LIGHTING = {
  AMBIENT_COLOR: 0x111122,
  AMBIENT_INTENSITY: 0.2,
  TORCH_COLOR: 0xff9944,
  TORCH_INTENSITY: 3.5,
  TORCH_DISTANCE: 16,
  TORCH_DECAY: 1.6,
  TORCH_SHADOW_COUNT: 8,
  TORCH_SHADOW_MAP: 256,
  TORCH_SHADOW_NEAR: 0.5,
  TORCH_SHADOW_FAR: 12,
  FOG_COLOR: 0x0a0a15,
  FOG_DENSITY: 0.015,
  FLAME_COLOR: 0xff8830,
  BRACKET_COLOR: 0x5a4a3a,
  BRAZIER_COLOR: 0xff7733,
  BRAZIER_INTENSITY: 2.2,
  BRAZIER_DISTANCE: 9,
  BRAZIER_DECAY: 1.6,
  CRYSTAL_COLOR: 0x44ddff,
  CRYSTAL_INTENSITY: 1.4,
  CRYSTAL_DISTANCE: 7,
  CRYSTAL_DECAY: 1.5,
  CRYSTAL_COLORS: [0x44ddff, 0xbb66ff, 0x66ffcc], // per-crystal hue
};

export const MATERIALS = {
  WALL_COLOR: 0x3a3a4a,
  WALL_ROUGHNESS: 0.85,
  WALL_METALNESS: 0.1,
  FLOOR_COLOR: 0x2a2a35,
  FLOOR_ROUGHNESS: 0.9,
  FLOOR_METALNESS: 0.0,
  CEILING_COLOR: 0x1a1a25,
  CEILING_ROUGHNESS: 0.95,
  ARCH_COLOR: 0x4a4a5a,
};

export const DUNGEON = {
  ROOM_TYPES: {
    CHAMBER: { weight: 40, minSize: 2, maxSize: 3 },
    HALL: { weight: 35, minSize: 1, maxSize: 2 },
    VAULT: { weight: 25, minSize: 3, maxSize: 4 },
  },
  MIN_ROOMS: 8,
  MAX_ROOMS: 12,
  MIN_ROOM_DISTANCE: 1,
  TORCH_SPACING: 8,
  ARCH_PROBABILITY: 0.3,
  CRACK_PROBABILITY: 0.15,
  DEAD_END_MAX: 4,
};

export const RENDERER = {
  ANTIALIAS: true,
  TONE_MAPPING: 'ACESFilmicToneMapping', // set via renderer.toneMapping
  EXPOSURE: 1.0,
  MAX_PIXEL_RATIO: 2,
  BACKGROUND_COLOR: 0x0a0a15,
};

export const SMOKE = {
  POOL_SIZE: 180,
  RATE: 1.2,            // puffs/sec per emitter
  RISE_SPEED: 0.5,
  TURBULENCE: 0.6,
  LIFETIME: 3.2,
  BASE_SIZE: 0.55,
  BASE_ALPHA: 0.16,
  VISIBLE_RADIUS: 18,   // smoke fades out beyond this distance from player
};

export const SKELETON = {
  HP: 2,
  WAKE_RADIUS: 9,        // distance at which a dormant skeleton activates
  CHASE_SPEED: 2.6,
  ATTACK_RANGE: 1.6,
  ATTACK_DAMAGE: 1,
  ATTACK_WINDUP: 0.35,   // telegraph
  ATTACK_SWING: 0.25,
  ATTACK_RECOVER: 0.4,
  ATTACK_COOLDOWN: 1.2,  // pause between attack cycles
  MIN_SPAWN_DIST: 6,     // cells from entrance before skeletons may spawn
  BASE_COUNT: 2,
  COUNT_PER_LEVEL: 1,
  MAX_COUNT: 8,
  EYE_GLOW: 0xff3322,
  BONE_COLOR: 0xcfc6b0,
};

export const ORB_WEAPON = {
  SPEED: 2 * PLAYER.SPEED * PLAYER.SPRINT_MULTIPLIER, // 12.4 u/s — 2× sprint
  LIFETIME: 2.5,          // seconds before fizzle (~31 units max range)
  DAMAGE: 1,
  RADIUS: 0.35,           // projectile collision radius
};

export const TIMED_RUN = {
  LEVEL_TIME_LIMIT: 180, // seconds per level — tunable; avg exit is ~22 cells ≈ 20-30s at sprint, so 3min leaves room to explore/collect orbs
};

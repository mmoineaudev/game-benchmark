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

// --- Extended spec: biomes -------------------------------------------------
export const BIOMES = {
  SEQUENCE: ['STONE', 'HAUNTED_CRYPT', 'FUNGAL_CAVERN', 'VOLCANIC_DEPTHS', 'FROZEN_HALLS'],
  LEVELS_PER_BIOME: 2,
  STONE: {
    wall: 0x3a3a4a, floor: 0x2a2a35, ceiling: 0x1a1a25,
    fog: 0x0a0a15, fogDensity: 0.015,
    ambient: 0x111122, ambientIntensity: 0.2,
    torchColor: 0xff9944, label: 'STONE DUNGEON',
  },
  HAUNTED_CRYPT: {
    wall: 0x2e2e3e, floor: 0x20202c, ceiling: 0x14141c,
    fog: 0x060610, fogDensity: 0.016,
    ambient: 0x10101e, ambientIntensity: 0.22,
    torchColor: 0x88ddff, label: 'HAUNTED CRYPT',
  },
  FUNGAL_CAVERN: {
    wall: 0x2a3a2e, floor: 0x1e2a22, ceiling: 0x141e18,
    fog: 0x0a140e, fogDensity: 0.014,
    ambient: 0x0c1a10, ambientIntensity: 0.25,
    torchColor: 0x44ff88, label: 'FUNGAL CAVERN',
  },
  VOLCANIC_DEPTHS: {
    wall: 0x3a2420, floor: 0x2a1814, ceiling: 0x1e100e,
    fog: 0x1a0a06, fogDensity: 0.018,
    ambient: 0x2a0e06, ambientIntensity: 0.25,
    torchColor: 0xff5522, label: 'VOLCANIC DEPTHS',
  },
  FROZEN_HALLS: {
    wall: 0x3a4654, floor: 0x28303c, ceiling: 0x1a2028,
    fog: 0x0c1220, fogDensity: 0.013,
    ambient: 0x16203a, ambientIntensity: 0.28,
    torchColor: 0x66ccff, label: 'FROZEN HALLS',
  },
};

// Biome id for a given level (cyclic, 2 levels per biome)
export function biomeForLevel(level) {
  return BIOMES.SEQUENCE[Math.floor((level - 1) / BIOMES.LEVELS_PER_BIOME) % BIOMES.SEQUENCE.length];
}

// Room-type weight modifiers per biome (multiplier on base DUNGEON.ROOM_TYPES weight)
export const BIOME_ROOM_MODIFIERS = {
  STONE: {},
  HAUNTED_CRYPT: { CRYPT: 3, LIBRARY: 1.5, ARMORY: 0.5 },
  FUNGAL_CAVERN: { MUSHROOM_GROVE: 3, VAULT: 0.7 },
  VOLCANIC_DEPTHS: { ARMORY: 2, CHAMBER: 0.8 },
  FROZEN_HALLS: { VAULT: 1.5, CHAMBER: 1.2, MUSHROOM_GROVE: 0 },
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
  EYE_GLOW: 0xff4433,
  BONE_COLOR: 0xcfc6b0,
};

export const SWORD = {
  DAMAGE: 2,             // one-shots skeletons (HP 2)
  RANGE: 2.2,            // melee reach
  ARC: Math.PI / 3,      // ±60° hit cone in front of the player
  WINDUP: 0.12,          // telegraph
  SWING: 0.18,           // active hit window
  RECOVER: 0.2,
  COOLDOWN: 0.45,        // between swings
};

export const ORB_WEAPON = {
  SPEED: 2 * PLAYER.SPEED * PLAYER.SPRINT_MULTIPLIER, // 12.4 u/s — 2× sprint
  LIFETIME: 2.5,          // seconds before fizzle (~31 units max range)
  DAMAGE: 1,
  RADIUS: 0.35,           // projectile collision radius
};

export const MAGICIAN = {
  CHANCE: 0.1,           // 1 skeleton out of 10
  CAST_RANGE: 9,         // fires from a distance instead of melee range
  ORB_SPEED: ORB_WEAPON.SPEED / 2, // half the player's orb speed
  ORB_LIFETIME: 4,
  ORB_RADIUS: 0.3,
  ORB_DAMAGE: 1,
  FIRE_INTERVAL: 2.2,    // min seconds between casts (attack cycle + cooldown)
};

export const DROP = {
  RADIUS: 1.4,           // auto-collect distance for dropped orbs
  Y: 0.8,
};

export const TIMED_RUN = {
  LEVEL_TIME_LIMIT: 180, // seconds per level — tunable; avg exit is ~22 cells ≈ 20-30s at sprint, so 3min leaves room to explore/collect orbs
};

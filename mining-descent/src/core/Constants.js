// =============================================================================
// Constants — every magic number, balance value, color, and config lives here.
// =============================================================================

// --- World ---
export const WORLD_WIDTH = 40;
export const WORLD_DEPTH = 40;   // horizontal z-axis
export const WORLD_HEIGHT = 50;  // vertical depth (0=surface, 49=deepest)
export const WORLD_MAX_Y = WORLD_HEIGHT - 1;

// --- Grid tile types ---
export const TILE = {
  AIR: 0,
  SURFACE: 1,
  ROCK: 2,
  COAL_ORE: 3,
  COPPER_ORE: 4,
};

// --- Tile colors (hex, used as instanceColor) ---
export const TILE_COLOR = {
  [TILE.SURFACE]: 0x5a8a3c,      // grass green
  [TILE.ROCK]: 0x6b7a8d,         // gray-blue rock
  [TILE.COAL_ORE]: 0x3a2a1a,     // dark brown
  [TILE.COPPER_ORE]: 0xd4842a,   // warm orange
};

// --- Ore definitions ---
export const ORE_DEFS = {
  coal: { tile: TILE.COAL_ORE, name: 'Coal', value: 5, depthMin: 1, depthMax: 25, veinSizeMin: 4, veinSizeMax: 8, veinCount: 12, glowColor: 0x8b6914 },
  copper: { tile: TILE.COPPER_ORE, name: 'Copper', value: 5, depthMin: 20, depthMax: 49, veinSizeMin: 3, veinSizeMax: 7, veinCount: 10, glowColor: 0xd4842a },
};

// --- Resource config ---
export const RESOURCES = {
  FUEL_START: 50,
  FUEL_DIG_COST: 1,
  OXYGEN_START: 120,       // seconds worth
  OXYGEN_DRAIN_IDLE: 0.5,  // per second (sitting)
  OXYGEN_DRAIN_MOVING: 1.0,
  OXYGEN_DRAIN_CLIMBING: 2.0,
  HULL_START: 100,
};

// --- Vehicle ---
export const VEHICLE = {
  MOVE_SPEED: 8,           // tiles per second for lerp
  DIG_DURATION: 0.3,       // seconds
  CLIMB_DURATION: 0.5,
};

// --- Camera ---
export const CAMERA = {
  ANGLE: Math.PI / 3.8,         // ~47 degrees
  DISTANCE: 30,
  HEIGHT_OFFSET: 24,
  LERP_SPEED: 4,
  ZOOM_MIN: 10,
  ZOOM_MAX: 60,
};

// --- Cave entrance ---
export const CAVE_ENTRANCE = { x: Math.floor(WORLD_WIDTH / 2), z: Math.floor(WORLD_DEPTH / 2) };

// --- Enemy ---
export const ENEMIES = {
  stone_mite: {
    name: 'Stone Mite',
    hp: 1,
    damage: 5,
    speed: 2.5,          // tiles/sec
    aggroRange: 10,      // tiles
    biome: [TILE.ROCK],
    color: 0x884422,
  },
};

// --- Meta-progression ---
export const META = {
  STORAGE_KEY: 'mining_descent_meta',
  UPGRADES: {
    fuelTank: { name: 'Fuel Tank +25', cost: 50, maxLevel: 3, effect: (level) => level * 25 },
  },
};

// --- Colors ---
export const COLORS = {
  SKY_TOP: 0x1a1a2e,
  SKY_BOTTOM: 0x16213e,
  FOG_SURFACE: 0x87CEEB,
  FOG_DEEP: 0x0a0a14,
  GRASS: 0x4a7a2e,
  PLAYER: 0xddcc44,
};

// --- Ore glow ---
export const GLOW = {
  PULSE_SPEED: 2.5,     // radians/sec
  MIN_INTENSITY: 0.15,
  MAX_INTENSITY: 0.55,
};

// --- Particle ---
export const DUST = {
  COUNT: 8,
  LIFETIME: 0.6,
  SPREAD: 0.3,
  SIZE: 0.08,
};

// --- Fog ---
export const FOG = {
  NEAR: 8,
  FAR: 18,
};

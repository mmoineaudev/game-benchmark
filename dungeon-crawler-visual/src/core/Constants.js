// All magic numbers from the dungeon crawler spec
export const WORLD = {
  GRID_MIN: 8,
  GRID_MAX: 12,
  CELL_SIZE: 6,
  CORRIDOR_WIDTH: 1,
  WALL_HEIGHT: 4,
  PLAYER_EYE_HEIGHT: 1.7,
};

export const PLAYER = {
  SPEED: 4,
  MOUSE_SENSITIVITY: 0.002,
  PITCH_CLAMP: Math.PI / 2 - 0.1, // ±85°
};

export const CAMERA = {
  FOV: 75,
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
  MIN_ROOM_DISTANCE: 2,
  TORCH_SPACING: 8,
  ARCH_PROBABILITY: 0.3,
  CRACK_PROBABILITY: 0.15,
  DEAD_END_MAX: 2,
};

export const RENDERER = {
  ANTIALIAS: true,
  TONE_MAPPING: 'ACESFilmicToneMapping', // set via renderer.toneMapping
  EXPOSURE: 1.0,
  MAX_PIXEL_RATIO: 2,
  BACKGROUND_COLOR: 0x0a0a15,
};

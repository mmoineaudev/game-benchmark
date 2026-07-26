// ALL magic numbers, balance values, and configuration
export const WORLD = {
  WIDTH: 20,
  DEPTH: 20,
  HEIGHT: 50,
  TILE_SIZE: 1,
};

export const TILE = {
  AIR: 0,
  DIRT: 1,
  STONE: 2,
  COAL_ORE: 3,
  COPPER_ORE: 4,
  BEDROCK: 5,
  SURFACE: 6,
  CAVE: 7,
};

export const TILE_COLORS = {
  [TILE.DIRT]: 0x8B5E3C,
  [TILE.STONE]: 0x6B6B7B,
  [TILE.COAL_ORE]: 0x2A2A2A,
  [TILE.COPPER_ORE]: 0xCC6633,
  [TILE.BEDROCK]: 0x333344,
  [TILE.SURFACE]: 0x4A7A3A,
  [TILE.CAVE]: 0x1A1A2A,
};

export const TILE_NAMES = {
  [TILE.AIR]: 'air',
  [TILE.DIRT]: 'dirt',
  [TILE.STONE]: 'stone',
  [TILE.COAL_ORE]: 'coal',
  [TILE.COPPER_ORE]: 'copper',
  [TILE.BEDROCK]: 'bedrock',
  [TILE.SURFACE]: 'surface',
  [TILE.CAVE]: 'cave',
};

export const RESOURCE = {
  FUEL_INITIAL: 50,
  OXYGEN_INITIAL: 120,
  HULL_INITIAL: 100,
  FUEL_DIG_COST: 1,
  OXYGEN_IDLE_RATE: 0.3,
  OXYGEN_MOVE_RATE: 0.6,
  OXYGEN_CLIMB_RATE: 1.2,
  OXYGEN_TICK: 1.0,
  FUEL_TICK: 1.0,
};

export const VEHICLE = {
  MOVE_SPEED: 4.0,
  CLIMB_SPEED: 2.0,
  DIG_TIME: 0.3,
  HEADLIGHT_RANGE: 12,
  HEADLIGHT_ANGLE: 0.6,
  CARGO_MAX: 20,
};

export const ORE = {
  coal: { name: 'Coal', color: '#2a2a2a', value: 1, glowColor: null },
  copper: { name: 'Copper', color: '#cc6633', value: 5, glowColor: 0xff8844 },
};

export const UPGRADES = [
  { id: 'fuel_tank', name: 'Fuel Tank', desc: '+25 fuel capacity', levels: 3,
    costs: [30, 80, 180], perLevel: 25 },
  { id: 'oxygen_tank', name: 'Oxygen Tank', desc: '+60 oxygen capacity', levels: 3,
    costs: [40, 100, 220], perLevel: 60 },
  { id: 'cargo_hold', name: 'Cargo Hold', desc: '+5 ore slots', levels: 3,
    costs: [50, 120, 250], perLevel: 5 },
  { id: 'headlights', name: 'Headlights', desc: '+3 tiles range', levels: 3,
    costs: [60, 140, 300], perLevel: 3 },
];

export const ENEMY = {
  STONE_MITE: { name: 'Stone Mite', hp: 1, damage: 5, speed: 2.5, score: 1,
    color: 0x886644, rimColor: 0xccaa88, shape: 'sphere_legs' },
};

export const BIOME = {
  TOP_SOIL: { name: 'Topsoil', depthRange: [0, 3], color: 0x8B5E3C },
  ROCK: { name: 'Rock Layer', depthRange: [3, 50], color: 0x6B6B7B },
};

export const EVENTS = {
  DIG_TILE: 'dig:tile',
  ORE_COLLECTED: 'ore:collected',
  RESOURCE_CHANGED: 'resource:changed',
  DEPTH_CHANGED: 'depth:changed',
  PLAYER_HURT: 'player:hurt',
  PLAYER_DIED: 'player:died',
  ENEMY_KILLED: 'enemy:killed',
  GAME_DESCEND: 'game:descend',
  GAME_HUB: 'game:hub',
  GAME_RESTART: 'game:restart',
  UPGRADE_PURCHASED: 'upgrade:purchased',
};

export const STATES = {
  HUB: 'hub',
  DESCENDING: 'descending',
  DEATH: 'death',
};

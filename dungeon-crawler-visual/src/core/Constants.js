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
  SPRINT_ACCEL_WINDOW: 5,  // seconds of continuous sprinting per acceleration tier
  SPRINT_ACCEL_STEP: 0.05, // +5% sprint speed per tier, cumulative; resets when sprinting stops
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
  // Player headlight: attached to the camera, keeps close surroundings visible.
  PLAYER_LIGHT_COLOR: 0xffdd99,
  PLAYER_LIGHT_INTENSITY: 2.6,
  PLAYER_LIGHT_DISTANCE: 9,
  PLAYER_LIGHT_DECAY: 1.6,
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
    // --- Extended spec: new room types ---
    ARMORY: { weight: 10, minSize: 3, maxSize: 3 },
    LIBRARY: { weight: 10, minSize: 3, maxSize: 3 },
    CRYPT: { weight: 10, minSize: 2, maxSize: 3 },
    MUSHROOM_GROVE: { weight: 8, minSize: 2, maxSize: 3 },
    ARENA: { weight: 6, minSize: 4, maxSize: 4 },
  },
  // Room-type eligibility: which biomes may generate a given room type
  ROOM_BIOME_ELIGIBILITY: {
    CHAMBER: 'all',
    HALL: 'all',
    VAULT: 'all',
    ARMORY: ['STONE', 'VOLCANIC_DEPTHS'],
    LIBRARY: ['STONE', 'HAUNTED_CRYPT'],
    CRYPT: ['HAUNTED_CRYPT'],
    MUSHROOM_GROVE: ['FUNGAL_CAVERN'],
    ARENA: 'all',
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
  // Boss arena: a haunted court lit by cold spectral flames.
  SPECTRAL_COURT: {
    wall: 0x2c3448, floor: 0x1c2434, ceiling: 0x10141e,
    fog: 0x0a1024, fogDensity: 0.012,
    ambient: 0x14204a, ambientIntensity: 0.3,
    torchColor: 0x66e0ff, label: 'SPECTRAL COURT',
  },
};

// Boss levels: every BOSS.INTERVAL-th level is a single-boss arena.
export const BOSS = {
  INTERVAL: 7,          // levels 7, 14, 21, ... are boss levels
  HP_MULT: 15,          // boss HP = 15x a base enemy's HP
  CHARGE_SPEED: 14,     // dash speed during the charge
  CHARGE_TIME: 0.9,     // seconds the charge lasts
  CHARGE_COOLDOWN: 3.2, // seconds between charges
  CHARGE_DMG: 1,        // damage on charge contact
  SUMMON_COOLDOWN: 6,   // seconds between wraith summons
  SUMMON_COUNT: 3,      // wraiths per summon
  MAX_MINIONS: 6,       // cap on live summoned wraiths
};

// Biome id for a given level (cyclic, 2 levels per biome)
export function biomeForLevel(level) {
  // Boss levels (every BOSS.INTERVAL-th) use the spectral boss biome.
  if (BOSS.INTERVAL > 0 && level % BOSS.INTERVAL === 0) return 'SPECTRAL_COURT';
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
  DEATH_HOLD: 2.0,   // corpse stays visible this long after death…
  DEATH_FADE: 0.35,  // …then fades out over this window (gone at DEATH_HOLD)
};

// --- Extended spec: enemy roster ------------------------------------------
export const ENEMY = {
  SPAWN_MIN_DIST: 6,
  BASE_SLOTS: 2,
  SLOTS_PER_LEVEL: 1,
  MAX_SLOTS: 10,
  ARENA_EXTRA_SLOTS: 2,
  MAX_ALIVE: 16,      // total living bodies (rats counted individually)
  RAT_PACK_MIN: 4,
  RAT_PACK_MAX: 6,
  RAT_CAP: 12,
  ELITE_CHANCE: 0.1,  // 1-in-10 per non-rat spawn
};

export const ARMORED = {
  HP: 5, SPEED: 1.8, DMG: 2, RANGE: 1.7,
  WINDUP: 0.5, SWING: 0.3, RECOVER: 0.5, COOLDOWN: 1.6,
  DROP: 2, SCORE: 2,
  BONE: 0x9a9282, PLATE: 0x5a5a66, SHIELD: 0x4a4a55, EYE: 0xff5533,
};

export const ARCHER = {
  HP: 2, SPEED: 2.4, DMG: 1,
  PREF_DIST: 8, RETREAT_DIST: 4, RETREAT_SPEED: 2.0, RANGE: 10,
  WINDUP: 0.5, SWING: 0.1, RECOVER: 0.4, COOLDOWN: 1.8,
  ARROW_SPEED: 8, ARROW_LIFE: 3, ARROW_RADIUS: 0.15,
  DROP: 1, SCORE: 1,
  BONE: 0xb8b0a0, HOOD: 0x2a2a35, ARROW_GLOW: 0xffcc88,
};

export const RAT = {
  HP: 1, SPEED: 4.2, DMG: 1, RANGE: 0.9, COOLDOWN: 0.8,
  DROP: 0, SCORE: 0,
  // Fluorescent toxic-green so rat packs read clearly in the dark
  BODY: 0x59ff66, HEAD: 0x3ce64a, EYE: 0xff2211,
  DEATH_HOLD: 2.0, DEATH_FADE: 0.3,
};

export const BRUTE = {
  HP: 8, SPEED: 1.2, DMG: 3, RANGE: 2.4, ARC: 0.87, // ±50°
  WINDUP: 1.2, SWING: 0.3, RECOVER: 1.2, COOLDOWN: 2.5,
  DROP: 3, SCORE: 3,
  BONE: 0x8a8070, TUNIC: 0x3a2a1a, CLUB: 0x4a3a2a, EYE: 0xff4422, FLASH: 0xff8830,
};

export const WRAITH = {
  HP: 2, SPEED: 2.4, DMG: 1, RANGE: 0.9, COOLDOWN: 1.0,
  DROP: 2, SCORE: 2,
  BODY: 0x88ffcc, EYE: 0xccffdd, BOB_AMP: 0.15, BOB_FREQ: 2,
  DEATH_HOLD: 2.0, DEATH_FADE: 0.4,
};

export const ELITE = {
  ARMORED: { HP: 10, SPEED_MULT: 1.3, DROP: 3, NAME: 'Warlord', BONE: 0xb8a888, TRIM: 0xd8b44a },
  ARCHER: { DROP: 2, NAME: 'Sharpshooter', BONE: 0xd8d0c0, HOOD: 0xcc2222 },
  BRUTE: { HP: 16, SPEED_MULT: 1.2, DROP: 4, NAME: 'Ogre', BONE: 0x7a7060, SCALE: 1.9 },
  WRAITH: { HP: 4, SPEED_MULT: 1.4, DROP: 3, NAME: 'Banshee', BODY: 0xff88cc },
};

// Per-biome spawn weights (sum = 100 each) — order: Skeleton, Magician, Armored, Archer, Rat, Brute, Wraith
export const ENEMY_SPAWN_WEIGHTS = {
  STONE: [45, 10, 15, 15, 10, 5, 0],
  HAUNTED_CRYPT: [25, 10, 10, 15, 5, 5, 30],
  FUNGAL_CAVERN: [30, 10, 10, 5, 40, 5, 0],
  VOLCANIC_DEPTHS: [20, 10, 25, 15, 10, 20, 0],
  FROZEN_HALLS: [25, 10, 20, 25, 10, 10, 0],
};
export const ENEMY_TYPES = ['SKELETON', 'MAGICIAN', 'ARMORED', 'ARCHER', 'RAT', 'BRUTE', 'WRAITH'];

// Room-type enemy rule multipliers: type -> { roomType: mult } (LIBRARY uses exclusion via 0)
export const ROOM_ENEMY_MODIFIERS = {
  ARMORY: { ARMORED: 1.3, ARCHER: 1.2 },
  LIBRARY: { SKELETON: 1, MAGICIAN: 0, ARMORED: 0, ARCHER: 0, RAT: 0, BRUTE: 0, WRAITH: 0 },
  CRYPT: { WRAITH: 1.4, SKELETON: 1.2 },
  MUSHROOM_GROVE: { RAT: 1.5 },
};

export const SWORD = {
  RANGE: 2.2,             // melee reach (base; scales with orb growth)
  COMBO: {
    WINDUP1: 0.10, SLASH1: 0.16, RECOVER1: 0.14,
    WINDUP2: 0.08, SLASH2: 0.15, RECOVER2: 0.14,
    WINDUP3: 0.12, THRUST3: 0.18, RECOVER3: 0.20,
    COMBO_WINDOW: 0.34,   // from each RECOVER start (0.14s recover + 0.20s input grace)
    COOLDOWN: 0.30,
    HIT1_DAMAGE: 2, HIT2_DAMAGE: 2, HIT3_DAMAGE: 3, // thrust = finisher
    ARC1: Math.PI * 0.38,  // ±68° diagonal slash
    ARC2: Math.PI * 0.38,  // ±68° opposite diagonal slash
    ARC3: Math.PI * 0.09,  // ±16° piercing thrust (line, not a cone)
    RANGE3: 1.25,          // thrust lunge reach multiplier (range × 1.25)
  },
};

export const HIT_STOP = 0.06; // seconds of world-freeze on sword hit

// Temporary buffs looted from breakables (6% per break). One random effect
// lasts BUFF.DURATION seconds. Effects:
//   1 = BRIGHT: level lights up (ambient up, fog down), mobs flee the player
//   2 = FIREBALL: dagger replaced by a free explosive fireball on right click
//   3 = EMPOWERED: dagger +50% longer, move speed +20%, attack speed +20%
//   4 = VISION: see enemies through walls (highlight ignores depth)
export const BUFF = {
  DURATION: 15,
  CHANCE: 0.06,            // drop chance per broken breakable (+20% from 5%)
  FIREBALL_COOLDOWN: 0.35, // seconds between free fireballs
  BRIGHT_AMBIENT: 2.5,     // ambient intensity multiplier while BRIGHT
  BRIGHT_FOG: 0.35,        // fog density multiplier while BRIGHT (less fog)
  EMPOWER_LENGTH: 1.5,     // dagger length multiplier
  EMPOWER_SPEED: 1.2,      // move speed multiplier
  EMPOWER_ATTACK: 1.2,     // dagger attack speed multiplier (faster cycle)
  BOSS_DURATION: 300,      // boss-kill buff lasts 5 minutes
};

export const ORB_WEAPON = {
  SPEED: 2 * PLAYER.SPEED * PLAYER.SPRINT_MULTIPLIER, // 12.4 u/s — 2× sprint
  LIFETIME: 2.5,          // seconds before fizzle (~31 units max range)
  DAMAGE: 1,
  RADIUS: 0.3,            // projectile collision radius (smaller orbs)
  VOLLEY: 3,              // orbs per SEQUENCE — 1 collected orb = 1 sequence of 3 steps
  STEP_INTERVAL: 0.22,    // min time between steps; also the held-fire repeat cadence
  SEQUENCE_WINDOW: 1.2,   // max pause between steps before the sequence resets
  BOUNCES: 3,             // the first VOLLEY-1 steps bounce this many times off walls/floor/ceiling
  EXPLODE_RADIUS: 1.5,    // last step: AOE damage radius around the explosion
  EXPLODE_DAMAGE: 1,      // last step: AOE damage dealt (same as a direct hit)
};

// The sword's size-bonus multiplier — ALSO scales the enemy spawn rate, so
// ammo banked = more enemies = more drops (risk/reward loop).
// +20% per 10 orbs held, capped at +200% (3x at 100 orbs).
export function orbPowerMultiplier(orbs) {
  return 1 + Math.min(Math.floor(orbs / 10), 10) * 0.2;
}

// New Game+ enemy HP: +10% per NG+ cycle (ngPlus = 0 on a fresh run).
export function enemyHpMultiplier(ngPlus) {
  return 1 + 0.1 * (ngPlus || 0);
}

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
  HEALTH_CHANCE: 0.15,   // per kill: chance to also drop a health reset (full heal)
  HEALTH_Y: 0.8,
};

// --- Extended spec: props --------------------------------------------------
export const PROPS = {
  BREAKABLE_HP: 1,
  LAVA_DAMAGE: 1,
  LAVA_INTERVAL: 0.8,
  LAVA_RADIUS: 1.2,
  SARCOPHAGUS_WRAITH_CHANCE: 0.3,
  SARCOPHAGUS_TRIGGER: 2.5,
  PROPS_PER_ROOM: {
    CHAMBER: 6, HALL: 4, VAULT: 10, ARMORY: 8,
    LIBRARY: 12, CRYPT: 10, MUSHROOM_GROVE: 12, ARENA: 6,
  },
  MAX_BREAKABLES_PER_ROOM: 3,
  MAX_INTERACTIVE_PER_ROOM: 3,
};

export const LIGHT_SOURCES = {
  CANDLE: { color: 0xffaa55, intensity: 0.6, distance: 5, decay: 1.8 },
  CHANDELIER: { color: 0xff9944, intensity: 0.5, distance: 6, decay: 1.8 },
  LAVA: { color: 0xff5522, intensity: 2.2, distance: 9, decay: 1.5 },
  MUSHROOM: { color: 0x44ff88, intensity: 1.2, distance: 6, decay: 1.7 },
  WISP: { color: 0x88ffcc, intensity: 1.0, distance: 7, decay: 1.8 },
  ICE: { color: 0x66ccff, intensity: 1.4, distance: 7, decay: 1.5 },
};

export const TIMED_RUN = {
  LEVEL_TIME_LIMIT: 180, // seconds per level — tunable; avg exit is ~22 cells ≈ 20-30s at sprint, so 3min leaves room to explore/collect orbs
};

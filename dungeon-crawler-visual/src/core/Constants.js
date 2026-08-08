// All magic numbers from the dungeon crawler spec
export const WORLD = {
  GRID_MIN: 12,
  GRID_MAX: 16,
  CELL_SIZE: 6,
  CORRIDOR_WIDTH: 1,
  WALL_HEIGHT: 20,       // ceiling height — halved from 40 (most of the tall wall was never visible)
  PLAYER_EYE_HEIGHT: 1.7,
};

export const PLAYER = {
  SPEED: 4,
  SPRINT_MULTIPLIER: 1.55,
  MAX_HEALTH: 3,
  INVULN_TIME: 0.8,
  SAFE_SPAWN: 5,        // seconds of spawn protection: immobile, invincible,
                        // countdown shown, mobs only track once it hits 0
  MOUSE_SENSITIVITY: 0.002,
  PITCH_CLAMP: Math.PI / 2 - 0.1, // ±85°
  SPRINT_ACCEL_WINDOW: 1,  // seconds of continuous sprinting per acceleration tier (was 5s)
  SPRINT_ACCEL_STEP: 0.05, // +5% sprint speed per tier, cumulative; resets when sprinting stops
  // Passive regen: +1 heart every REGEN_INTERVAL seconds once the player has
  // avoided damage for REGEN_DELAY seconds (0 = regen starts immediately).
  REGEN_DELAY: 0,        // seconds without taking a hit before regen starts (delay removed)
  REGEN_INTERVAL: 5,    // seconds between each regen tick
  REGEN_AMOUNT: 1,      // hearts restored per tick
};

export const CAMERA = {
  FOV: 90,              // +20% from 75 — wider view, still the DS-style look
  SPRINT_FOV_BOOST: 8,
  NEAR: 0.1,
  FAR: 160,           // raised so the 100m fog-of-war reads (not hard-clipped)
};

export const LIGHTING = {
  AMBIENT_COLOR: 0x111122,
  AMBIENT_INTENSITY: 0.3,   // raised from 0.2 — brighter base fill
  TORCH_COLOR: 0xff9944,
  TORCH_INTENSITY: 7,       // raised from 3.5
  TORCH_DISTANCE: 29,       // 36 -20%
  TORCH_DECAY: 1.2,         // lowered decay so light reaches further
  TORCH_SHADOW_COUNT: 1,   // 8 → 1 — one cube shadow = 6 depth passes (was 48/frame)
  TORCH_SHADOW_MAP: 256,
  TORCH_SHADOW_NEAR: 0.5,
  TORCH_SHADOW_FAR: 11,     // 14 -20%
  FOG_COLOR: 0x0a0a15,
  FOG_DENSITY: 0.01,        // reduced from 0.015 — brighter, more visible distance
  FLAME_COLOR: 0xff8830,
  BRACKET_COLOR: 0x5a4a3a,
  BRAZIER_COLOR: 0xff7733,
  BRAZIER_INTENSITY: 5,     // raised from 2.2
  BRAZIER_DISTANCE: 18,     // 23 -20%
  BRAZIER_DECAY: 1.2,       // lowered from 1.6
  CRYSTAL_COLOR: 0x44ddff,
  CRYSTAL_INTENSITY: 3.2,   // raised from 1.4
  CRYSTAL_DISTANCE: 14,     // 18 -20%
  CRYSTAL_DECAY: 1.2,       // lowered from 1.5
  CRYSTAL_COLORS: [0x44ddff, 0xbb66ff, 0x66ffcc], // per-crystal hue
  // Player headlight: attached to the camera, keeps close surroundings visible.
  PLAYER_LIGHT_COLOR: 0xffdd99,
  PLAYER_LIGHT_INTENSITY: 22,  // raised from 13 — wider, brighter headlight
  PLAYER_LIGHT_DISTANCE: 18,   // 22 -20%
  PLAYER_LIGHT_DECAY: 1.2,     // lowered from 1.6
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
    // --- Biome expansion: new room types (BIOME_EXPANSION_PLAN §4.1) ---
    CRYSTAL_CHAMBER: { weight: 8, minSize: 2, maxSize: 3 },
    TEMPLE: { weight: 8, minSize: 3, maxSize: 3 },
  },
  // Room-type eligibility: which biomes may generate a given room type
  ROOM_BIOME_ELIGIBILITY: {
    CHAMBER: 'all',
    HALL: 'all',
    VAULT: 'all',
    ARMORY: ['STONE', 'VOLCANIC_DEPTHS', 'GOLDEN_TEMPLE', 'EMBER_FORGE'],
    LIBRARY: ['STONE', 'HAUNTED_CRYPT'],
    CRYPT: ['HAUNTED_CRYPT'],
    MUSHROOM_GROVE: ['FUNGAL_CAVERN', 'POISON_SWAMP'],
    ARENA: 'all',
    CRYSTAL_CHAMBER: ['CRYSTAL_DEPTHS'],
    TEMPLE: ['GOLDEN_TEMPLE'],
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
  SEQUENCE: ['STONE', 'HAUNTED_CRYPT', 'FUNGAL_CAVERN', 'VOLCANIC_DEPTHS', 'FROZEN_HALLS',
    'CRYSTAL_DEPTHS', 'POISON_SWAMP', 'GOLDEN_TEMPLE', 'FLOODED_RUINS', 'EMBER_FORGE'],
  LEVELS_PER_BIOME: 2,
  // torchMode: 'standard' = torches on every exposed edge | 'vaultOnly' =
  // torches only inside VAULT rooms (torchless biomes, lit by their own glow).
  STONE: {
    wall: 0x3a3a4a, floor: 0x2a2a35, ceiling: 0x1a1a25,
    fog: 0x0a0a15, fogDensity: 0.011,   // reduced from 0.0195 — brighter distance
    ambient: 0x111122, ambientIntensity: 0.3,
    torchColor: 0xff9944, label: 'STONE DUNGEON', torchMode: 'standard',
  },
  HAUNTED_CRYPT: {
    wall: 0x2e2e3e, floor: 0x20202c, ceiling: 0x14141c,
    fog: 0x060610, fogDensity: 0.012,
    ambient: 0x10101e, ambientIntensity: 0.32,
    torchColor: 0x88ddff, label: 'HAUNTED CRYPT', torchMode: 'standard',
  },
  FUNGAL_CAVERN: {
    wall: 0x2a3a2e, floor: 0x1e2a22, ceiling: 0x141e18,
    fog: 0x0a140e, fogDensity: 0.011,
    ambient: 0x0c1a10, ambientIntensity: 0.34,
    torchColor: 0x44ff88, label: 'FUNGAL CAVERN', torchMode: 'vaultOnly',
  },
  VOLCANIC_DEPTHS: {
    wall: 0x3a2420, floor: 0x2a1814, ceiling: 0x1e100e,
    fog: 0x1a0a06, fogDensity: 0.013,
    ambient: 0x2a0e06, ambientIntensity: 0.34,
    torchColor: 0xff5522, label: 'VOLCANIC DEPTHS', torchMode: 'standard',
  },
  FROZEN_HALLS: {
    wall: 0x3a4654, floor: 0x28303c, ceiling: 0x1a2028,
    fog: 0x0c1220, fogDensity: 0.01,
    ambient: 0x16203a, ambientIntensity: 0.36,
    torchColor: 0x66ccff, label: 'FROZEN HALLS', torchMode: 'standard',
  },
  // --- Biome expansion: 5 new biomes (BIOME_EXPANSION_PLAN §3) ---
  CRYSTAL_DEPTHS: {
    wall: 0x3a2a4a, floor: 0x2a1e35, ceiling: 0x1a1425,
    fog: 0x120a20, fogDensity: 0.011,
    ambient: 0x1c1030, ambientIntensity: 0.34,
    torchColor: 0xcc66ff, label: 'CRYSTAL DEPTHS', torchMode: 'standard',
  },
  POISON_SWAMP: {
    wall: 0x3a3a20, floor: 0x2a2a14, ceiling: 0x1e1e0e,
    fog: 0x121a06, fogDensity: 0.012,
    ambient: 0x16220a, ambientIntensity: 0.32,
    torchColor: 0xccff44, label: 'POISON SWAMP', torchMode: 'vaultOnly',
  },
  GOLDEN_TEMPLE: {
    wall: 0x4a4230, floor: 0x3a3220, ceiling: 0x2a2416,
    fog: 0x241c0e, fogDensity: 0.010,
    ambient: 0x2a2412, ambientIntensity: 0.36,
    torchColor: 0xffcc66, label: 'GOLDEN TEMPLE', torchMode: 'standard',
    brazierRooms: ['HALL', 'TEMPLE'], // lit braziers also in TEMPLE rooms (§4.1)
  },
  FLOODED_RUINS: {
    wall: 0x2a3a3e, floor: 0x1e2a2e, ceiling: 0x141e20,
    fog: 0x0a1a1e, fogDensity: 0.012,
    ambient: 0x0e1e24, ambientIntensity: 0.33,
    torchColor: 0x55ddcc, label: 'FLOODED RUINS', torchMode: 'standard',
  },
  EMBER_FORGE: {
    wall: 0x3a3230, floor: 0x2a2420, ceiling: 0x1e1a18,
    fog: 0x1a0e0a, fogDensity: 0.013,
    ambient: 0x22120a, ambientIntensity: 0.35,
    torchColor: 0xff7733, label: 'EMBER FORGE', torchMode: 'standard',
  },
  // Boss arena: a haunted court lit by cold spectral flames.
  SPECTRAL_COURT: {
    wall: 0x2c3448, floor: 0x1c2434, ceiling: 0x10141e,
    fog: 0x0a1024, fogDensity: 0.009,
    ambient: 0x14204a, ambientIntensity: 0.38,
    torchColor: 0x66e0ff, label: 'SPECTRAL COURT', torchMode: 'standard',
  },
};

// Boss levels: every BOSS.INTERVAL-th level is a single-boss arena.
export const BOSS = {
  INTERVAL: 7,          // levels 7, 14, 21, ... are boss levels
  HP_MULT: 22.5,        // boss HP = 22.5x a base enemy's HP (15x +50%)
  SOULS_HP_BONUS: 0.25, // +25% boss HP per SOULS_HP_PER souls the player holds
  SOULS_HP_PER: 50,
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
  // --- Biome expansion (BIOME_EXPANSION_PLAN §4.3) ---
  CRYSTAL_DEPTHS: { CRYSTAL_CHAMBER: 3, VAULT: 1.2 },
  POISON_SWAMP: { MUSHROOM_GROVE: 2.5, VAULT: 0.5 },
  GOLDEN_TEMPLE: { TEMPLE: 3, VAULT: 2, ARMORY: 1.5 },
  FLOODED_RUINS: { VAULT: 1.5, CHAMBER: 1.2 },
  EMBER_FORGE: { ARMORY: 2.5, VAULT: 0.7 },
};

export const RENDERER = {
  ANTIALIAS: true,
  TONE_MAPPING: 'ACESFilmicToneMapping', // set via renderer.toneMapping
  EXPOSURE: 1.0,
  MAX_PIXEL_RATIO: 2,
  BACKGROUND_COLOR: 0x0a0a15,
};

export const SMOKE = {
  POOL_SIZE: 9,         // ~90% cut from 90 — smoke particles near-none
  RATE: 0.06,           // puffs/sec per emitter (was 0.6)
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
  SPAWN_INTERVAL: 0.5, // seconds between individual mob reveals at level start
  RAT_PACK_MIN: 2,    // was 4 — rat packs halved (harder enemy, cut 50%)
  RAT_PACK_MAX: 3,    // was 6
  RAT_CAP: 6,         // was 12
  ELITE_CHANCE: 0.1,  // 1-in-10 per non-rat spawn
  HP_LEVEL_INTERVAL: 5,  // mobs gain +HP_PER_STEP bonus HP every this many levels
  HP_PER_STEP: 0.1,      // +10% mob HP per 5 levels
};

export const ARMORED = {
  HP: 5, SPEED: 1.8, DMG: 2, RANGE: 0.85, // reach halved (÷2 from 1.7)
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
  // --- Biome expansion (BIOME_EXPANSION_PLAN §7) ---
  CRYSTAL_DEPTHS: [30, 15, 15, 20, 10, 10, 0],
  POISON_SWAMP: [15, 10, 10, 10, 45, 10, 0],
  GOLDEN_TEMPLE: [20, 10, 25, 20, 10, 15, 0],
  FLOODED_RUINS: [20, 15, 10, 15, 25, 15, 0],
  EMBER_FORGE: [10, 10, 25, 15, 5, 35, 0],
};
export const ENEMY_TYPES = ['SKELETON', 'MAGICIAN', 'ARMORED', 'ARCHER', 'RAT', 'BRUTE', 'WRAITH'];

// Room-type enemy rule multipliers: type -> { roomType: mult } (LIBRARY uses exclusion via 0)
export const ROOM_ENEMY_MODIFIERS = {
  ARMORY: { ARMORED: 1.3, ARCHER: 1.2 },
  LIBRARY: { SKELETON: 1, MAGICIAN: 0, ARMORED: 0, ARCHER: 0, RAT: 0, BRUTE: 0, WRAITH: 0 },
  CRYPT: { WRAITH: 1.4, SKELETON: 1.2 },
  MUSHROOM_GROVE: { RAT: 1.5 },
  // --- Biome expansion: TEMPLE guards (BIOME_EXPANSION_PLAN §4.1) ---
  TEMPLE: { ARMORED: 1.2 },
};

export const SWORD = {
  RANGE: 2.2,             // melee reach (base; scales with orb growth)
  // Electric legendary proc (WEAPON_EVOLUTION_PLAN §6): hoisted from COMBO —
  // Game reads SWORD.ELECTRIC_*; the old nested location made both undefined
  // and the 1% chain blast dead code.
  ELECTRIC_CHANCE: 0.01,  // 1% per landing strike: chain an electric blast
  ELECTRIC_RANGE: 20,     // ...that kills every enemy within this distance
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

// --- Weapon evolution: souls ladder (WEAPON_EVOLUTION_PLAN §3) ---
// Every EVOLUTION.TIER_SOULS lifetime souls the sword gains +1 damage per hit
// and a new form, stepping to a lightsaber that throws electric arcs (tier 5).
export const EVOLUTION = {
  TIER_SOULS: 100,
  MAX_TIER: 5,
  DAMAGE_PER_TIER: 1,
  BLADE_LENGTH: [0.76, 0.81, 0.86, 0.92, 0.96, 1.0], // form blade length per tier (u)
  RANGE_PER_TIER: 0.04,   // +4% melee reach per tier
  MAX_TOTAL_SCALE: 5.0,   // group-scale safety clamp (orb ladder × EMPOWERED)
  ARC_CHANCE: [0, 0, 0, 0.10, 0.35, 1.0], // arc bolts per landing strike
  ARC_BOLTS: [0, 0, 0, 1, 1, 2],
  // Weapon slot (HUD): per-tier display name + one-line effect.
  TIER_NAMES: ['Dagger', "Knight's Arming Sword", 'Runic Greatsword',
    'Crystal Soulblade', 'Soulfire Greatblade', 'Lightsaber'],
  TIER_EFFECTS: [
    'Base blade',
    '+1 dmg · longer steel',
    '+2 dmg · glowing runes',
    '+3 dmg · arc bolts (10%)',
    '+4 dmg · arc bolts (35%)',
    '+5 dmg · electric arcs on every strike',
  ],
  ARC_POOL: 8,
  ARC_SPEED: 24,
  ARC_LIFE: 1.2,
  ARC_DAMAGE: 1,
  ARC_RANGE: 20,
  BOLT_COLOR: 0x66eeff,
  T5_BLADE_LIGHT: { color: 0x66eeff, intensity: 1.5, distance: 6, decay: 1.6 },
};

// Tier from lifetime souls (monotonic; capped at MAX_TIER).
export function weaponTier(souls) {
  return Math.min(Math.floor(souls / EVOLUTION.TIER_SOULS), EVOLUTION.MAX_TIER);
}

// Base per-hit damage before the size multiplier: HIT{1,2,3} + tier.
export function swordHitDamage(step, tier) {
  const base = step === 2 ? SWORD.COMBO.HIT2_DAMAGE
    : step === 3 ? SWORD.COMBO.HIT3_DAMAGE
      : SWORD.COMBO.HIT1_DAMAGE;
  return base + tier * EVOLUTION.DAMAGE_PER_TIER;
}

// Temporary buffs looted from breakables (6% per break). One random effect
// lasts BUFF.DURATION seconds. Breakables also drop a soul orb 20% of the
// time (ORB_DROP_CHANCE). Effects:
//   1 = BRIGHT: level lights up (ambient up, fog down), mobs flee the player
//   2 = FIREBALL: dagger replaced by a free explosive fireball on right click
//   3 = EMPOWERED: dagger +50% longer, move speed +20%, attack speed +20%
//   4 = GODSPEED: +50% attack speed AND +50% move speed
//   5 = HUNTER: a spectral boss companion follows the player and attacks mobs
export const BUFF = {
  DURATION: 60,            // initial non-boss buff duration (x2 from 30s)
  CHANCE: 0.06,            // base drop chance per broken breakable (+20% from 5%)
  ORB_DROP_CHANCE: 0.2,    // 20% chance per broken breakable to drop soul orbs
  ORB_DROP_MIN: 1,         // soul-orb drop range: 1-5 per break
  ORB_DROP_MAX: 5,
  ORB_BUFF_CHANCE: 0.0005, // +0.05% buff drop per orb ABOVE 100
  FIREBALL_COOLDOWN: 0.35, // seconds between free fireballs
  BRIGHT_AMBIENT: 2.5,     // ambient intensity multiplier while BRIGHT
  BRIGHT_FOG: 0.35,        // fog density multiplier while BRIGHT (less fog)
  EMPOWER_LENGTH: 1.5,     // dagger length multiplier
  EMPOWER_SPEED: 1.2,      // move speed multiplier
  EMPOWER_ATTACK: 1.2,     // dagger attack speed multiplier (faster cycle)
  GODSPEED_SPEED: 1.5,     // GODSPEED: +50% move speed
  GODSPEED_ATTACK: 1.5,    // GODSPEED: +50% attack speed
  BOSS_DURATION: 300,      // boss-kill buff nominal 5 minutes
  MAX_DURATION: 90,        // hard cap on any buff duration (1:30)
};

// Spectral hunter companion summoned by the HUNTER buff: follows the player
// and lashes out at nearby mobs.
export const HUNTER = {
  HP: 9999,            // invulnerable companion
  SPEED: 6.5,          // follow speed (faster than the player)
  FOLLOW_DIST: 2.5,    // hovers ~this far from the player
  ATTACK_RANGE: 7,     // hits mobs within this distance
  ATTACK_DAMAGE: 2,    // damage per lash
  ATTACK_INTERVAL: 1.0,// seconds between lashes
  BEAM_TIME: 0.35,     // seconds the energy beam flash lasts
  SCALE: 1.3,
};

export const ORB_WEAPON = {
  SPEED: 2 * PLAYER.SPEED * PLAYER.SPRINT_MULTIPLIER, // 12.4 u/s — 2× sprint
  LIFETIME: 2.5,          // seconds before fizzle (~31 units max range)
  DAMAGE: 2,            // base orb damage (doubled from 1)
  RADIUS: 0.3,            // projectile collision radius (smaller orbs)
  VOLLEY: 3,              // orbs per SEQUENCE — 1 collected orb = 1 sequence of 3 steps
  STEP_INTERVAL: 0.22,    // min time between steps; also the held-fire repeat cadence
  SEQUENCE_WINDOW: 1.2,   // max pause between steps before the sequence resets
  BOUNCES: 3,             // the first VOLLEY-1 steps bounce this many times off walls/floor/ceiling
  EXPLODE_RADIUS: 1.5,    // last step: AOE damage radius around the explosion
  EXPLODE_DAMAGE: 2,      // last step: AOE damage dealt (same as a direct hit)
};

// The sword's size-bonus multiplier — the risk/reward core of the economy:
// +20% per 10 orbs held, capped at +300% (4x at 150 orbs). Orbs ABOVE 100
// additionally feed buff-drop chance via excessOrbs(). (Enemy spawns are now
// scaled by the separate (level + souls)/10 formula, NOT by this.)
export function orbPowerMultiplier(orbs) {
  return 1 + Math.min(Math.floor(orbs / 10), 15) * 0.2;
}

// Orb-weapon damage buff: each held orb adds 2% damage
// (=[total orbs]% * 2). 0 orbs -> x1; 50 orbs -> x2; 100 orbs -> x3.
// Gives ranged orbs real teeth that scale with how much ammo you've banked,
// matching the risk/reward of holding orbs (which also raises enemy spawns).
export function orbDamageMultiplier(orbs) {
  return 1 + orbs * 0.02;
}

// Orbs in excess of 100 (the 'power' threshold) funnel into buff-drop chance.
export function excessOrbs(orbs) {
  return Math.max(0, orbs - 100);
}

// Enemy HP: +100% per NG+ cycle (ngPlus = 0 on a fresh run), plus +10% bonus
// HP every 5 levels (ENEMY.HP_LEVEL_INTERVAL). Level 5 -> x1.1, 10 -> x1.2...
export function enemyHpMultiplier(ngPlus, level = 1) {
  return (1 + (ngPlus || 0))
    * (1 + ENEMY.HP_PER_STEP * Math.floor(level / ENEMY.HP_LEVEL_INTERVAL));
}

export const MAGICIAN = {
  CHANCE: 0.1,           // 1 skeleton out of 10
  CAST_RANGE: 9,         // fires from a distance instead of melee range
  ORB_SPEED: ORB_WEAPON.SPEED / 2, // half the player's orb speed
  ORB_LIFETIME: 4,
  ORB_RADIUS: 0.3,
  ORB_DAMAGE: 1,
};

// A mysterious red-and-black burning enemy. Does NOT spawn at level start —
// it appears only once ALL other enemies on the level are dead, as a final
// challenge. It has boss-tier HP (BOSS.HP_MULT x its base HP) and sets the
// ground on fire where it walks (Game's fire-patch hook). At most once per level.
export const BURN = {
  CHANCE: 1,            // always awaits after the level is cleared (once)
  HP: 3,
  BOSS_HP_MULT: 30,     // boss-tier HP: 30x base = 90 HP (same as BOSS.HP_MULT)
  SPEED: 2.6,
  DMG: 1,
  RANGE: 1.3,
  DROP: 2,
  COOLDOWN: 1.4,
  FIRE_INTERVAL: 0.6,   // seconds between ground-fire leaks while moving
};

export const DROP = {
  RADIUS: 1.4,           // auto-collect distance for health/buff pickups
  Y: 0.8,
  HEALTH_CHANCE: 0.15,   // per kill: chance to also drop a health pickup
  HEALTH_RESTORE: 3,     // hearts ADDED by a health pickup (capped at max)
  HEALTH_Y: 0.8,
  VISUAL_LIFE: 1,        // seconds an orb visual stays on screen (souls credit instantly on drop)
};

// --- Extended spec: props --------------------------------------------------
export const PROPS = {
  BREAKABLE_HP: 1,
  // Pool hazards (lava + acid share the same tick logic, keyed by type):
  // BIOME_EXPANSION_PLAN §6.2. LAVA_* legacy keys removed in Phase A3.
  POOLS: {
    LAVA: { damage: 1, interval: 0.8, radius: 1.2, color: 0xff5522, emissive: 2.2 },
    ACID: { damage: 1, interval: 0.8, radius: 1.2, color: 0x88ff22, emissive: 2.2 },
  },
  SARCOPHAGUS_WRAITH_CHANCE: 0.3,
  SARCOPHAGUS_TRIGGER: 2.5,
  PROPS_PER_ROOM: {
    CHAMBER: 6, HALL: 4, VAULT: 10, ARMORY: 8,
    LIBRARY: 12, CRYPT: 10, MUSHROOM_GROVE: 12, ARENA: 6,
    // --- Biome expansion (BIOME_EXPANSION_PLAN §4.1) ---
    CRYSTAL_CHAMBER: 10, TEMPLE: 10,
  },
  MAX_BREAKABLES_PER_ROOM: 3,
  MAX_INTERACTIVE_PER_ROOM: 3,
};

export const LIGHT_SOURCES = {
  CANDLE: { color: 0xffaa55, intensity: 1.4, distance: 9, decay: 1.2 },       // 11 -20%
  CHANDELIER: { color: 0xff9944, intensity: 1.4, distance: 11, decay: 1.2 },  // 14 -20%
  LAVA: { color: 0xff5522, intensity: 4.5, distance: 16, decay: 1.2 },        // 20 -20%
  MUSHROOM: { color: 0x44ff88, intensity: 3.2, distance: 12, decay: 1.2 }, // fungal caverns: brighter + wider
  WISP: { color: 0x88ffcc, intensity: 2.2, distance: 11, decay: 1.2 },        // 14 -20%
  ICE: { color: 0x66ccff, intensity: 3.0, distance: 11, decay: 1.2 },         // 14 -20%
  // --- Biome expansion (BIOME_EXPANSION_PLAN §6.1) ---
  CRYSTAL: { color: 0xcc66ff, intensity: 3.0, distance: 11, decay: 1.2 },
  ACID: { color: 0x88ff22, intensity: 4.5, distance: 16, decay: 1.2 },
};

// Measured per-level light ceiling (BIOME_EXPANSION_PLAN §9): the heaviest
// existing biome (VOLCANIC/FROZEN) averages 154 lights and peaks at 199
// (probe model; the faithful model in biome-check measures ~132). The vaultOnly
// torch bounds are calibrated to the EXISTING fungal biome (measured avg ~9,
// max ~49) — thresholds below that would fail the current game.
export const LIGHT_CEILING = { AVG: 154, MAX: 199, VAULT_ONLY_TORCH_AVG: 10, VAULT_ONLY_TORCH_MAX: 50 };

export const TIMED_RUN = {
  LEVEL_TIME_LIMIT: 180, // seconds per level — tunable; avg exit is ~22 cells ≈ 20-30s at sprint, so 3min leaves room to explore/collect orbs
};

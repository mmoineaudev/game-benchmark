/**
 * Constants.js — THE data contract of the game.
 * Every numeric constant, weight, formula helper, and biome/schema table
 * that other modules import lives here. Values are binding per
 * dungeon-crawler-visual-specv1.md.
 */

// ---------------------------------------------------------------------------
// World / player / camera / lighting / materials
// ---------------------------------------------------------------------------

export const WORLD = {
  // Ground plane, gravity is not simulated (top-down-ish crawler at y = 0)
  FLOOR_Y: 0,
  GROUND: true,
};

export const PLAYER = {
  SPEED: 4,                 // base speed 4 u/s (§8.1)
  RADIUS: 0.35,             // circle collision radius (§6)
  SPRINT_MULT: 1.55,        // ×1.55 while sprinting
  SPRINT_FOV_KICK: 8,       // FOV +8 while sprinting
  SPRINT_ACCEL_WINDOW: 1,   // consecutive seconds of holding Shift + moving per tier
  SPRINT_ACCEL_STEP: 0.05,  // +5% sprint speed per tier, cumulative
  SPRINT_ACCEL_MAX: 3,      // accel component capped at ×3
  BASE_HEALTH: 3,           // max health 3, +1 permanent heart per boss kill
  MAX_HEALTH_BONUS_PER_NG_PLUS: 1, // +1 permanent heart per boss kill (§26 NG+)
  HEIGHT: 1.7,              // player height above floor (camera anchor)
  WALK_SPEED: 4,            // base walk speed (SPEED)
  SPRINT_SPEED: 6.2,        // base sprint speed (SPEED × SPRINT_MULT)
  INVULN_TIME: 0.8,         // i-frames after any hit
  I_FRAMES: 0.8,            // i-frame window after any hit (§20)
  SHAKE_TIME: 0.25,
  REGEN_INTERVAL: 5,        // +1 heart every 5 s, capped at max
  SAFE_SPAWN: 5,            // rooted + invincible at level start
  EXIT_RADIUS: 2,           // inExitRoom = within 2 u of exit cell center
  STEP_SLIVER: 0.08,        // sub-stepped movement max sliver (anti-tunneling)
};

export const CAMERA = {
  FOV: 90,                  // §4.2.2
  NEAR: 0.1,
  FAR: 160,
  SENSITIVITY: 0.002,       // rad/px
  PITCH_CLAMP: 85 * Math.PI / 180, // ±85°
  EYE_HEIGHT: 0.2,         // eyes above PLAYER.HEIGHT
};

export const LIGHTING = {
  TORCH_SPACING: 16,        // binding budget value (§22: real spacing is 16)
  TORCH_Y: 2.5,
  TORCH_SHADOW_COUNT: 1,    // exactly ONE shadow-casting torch
  TORCH_SHADOW_MAP_SIZE: 256,
  TORCH_SHADOW_NEAR: 0.5,
  TORCH_SHADOW_FAR: 11,
  TORCH_SHADOW_BIAS: -0.005,
  TORCH_SHADOW_NORMAL_BIAS: 0.02,
};

export const MATERIALS = {
  TEXTURE_SIZE: 256,
  GLOW_TEXTURE_SIZE: 64,
  MIX_HEX_AMOUNT: 0.35,
  TEXTURE_REPEAT: 2,
};

// ---------------------------------------------------------------------------
// Dungeon generation (§5)
// ---------------------------------------------------------------------------

export const DUNGEON = {
  GRID_MIN: 12,             // grid 12–16 cells
  GRID_MAX: 16,
  CELL_SIZE: 6,             // 6 u per cell
  ROOMS_MIN: 8,             // rooms 8–12
  ROOMS_MAX: 12,
  WALL_HEIGHT: 20,
  WALL_THICKNESS: 0.3,
  COLLISION_DEPTH_MULT: 0.6, // collision thickness ×0.6 (0.18 u effective)
  MAX_PLACEMENT_ATTEMPTS: 200,
  DEAD_END_MAX: 4,           // 0–4 dead-end stubs
  MAX_LOOP_CORRIDORS: 3,     // up to min(3, floor(n/3)) loop corridors
  MIN_ROOM_DISTANCE: 1,

  // Room type catalog (§5.3): base weight, size, eligibility
  ROOM_TYPES: {
    CHAMBER:          { weight: 40, minW: 2, maxW: 3, minH: 2, maxH: 3, eligible: 'all' },
    HALL:             { weight: 35, minW: 1, maxW: 2, minH: 1, maxH: 1, eligible: 'all' },
    VAULT:            { weight: 25, minW: 3, maxW: 4, minH: 3, maxH: 4, eligible: 'all' },
    ARMORY:           { weight: 10, minW: 3, maxW: 3, minH: 3, maxH: 3, eligible: ['STONE', 'VOLCANIC_DEPTHS', 'GOLDEN_TEMPLE', 'EMBER_FORGE'] },
    LIBRARY:          { weight: 10, minW: 3, maxW: 3, minH: 3, maxH: 3, eligible: ['STONE', 'HAUNTED_CRYPT'] },
    CRYPT:            { weight: 10, minW: 2, maxW: 3, minH: 2, maxH: 3, eligible: ['HAUNTED_CRYPT'] },
    MUSHROOM_GROVE:   { weight: 8,  minW: 2, maxW: 3, minH: 2, maxH: 3, eligible: ['FUNGAL_CAVERN', 'POISON_SWAMP'] },
    ARENA:            { weight: 6,  minW: 4, maxW: 4, minH: 4, maxH: 4, eligible: 'all' },
    CRYSTAL_CHAMBER:  { weight: 8,  minW: 2, maxW: 3, minH: 2, maxH: 3, eligible: ['CRYSTAL_DEPTHS'] },
    TEMPLE:           { weight: 8,  minW: 3, maxW: 3, minH: 3, maxH: 3, eligible: ['GOLDEN_TEMPLE'] },
  },

  // Arena: +2 spawn slots, first spawn roll guaranteed elite
  ARENA_EXTRA_SLOTS: 2,
};

// Room-weight modifiers per biome (§5.3 table); missing keys = ×1, 0 excludes.
export const BIOME_ROOM_MODIFIERS = {
  STONE: {},
  HAUNTED_CRYPT:   { CRYPT: 3, LIBRARY: 1.5, ARMORY: 0.5 },
  FUNGAL_CAVERN:   { MUSHROOM_GROVE: 3, VAULT: 0.7 },
  VOLCANIC_DEPTHS: { ARMORY: 2, CHAMBER: 0.8 },
  FROZEN_HALLS:    { VAULT: 1.5, CHAMBER: 1.2, MUSHROOM_GROVE: 0 },
  CRYSTAL_DEPTHS:  { CRYSTAL_CHAMBER: 3, VAULT: 1.2 },
  POISON_SWAMP:    { MUSHROOM_GROVE: 2.5, VAULT: 0.5 },
  GOLDEN_TEMPLE:   { TEMPLE: 3, VAULT: 2, ARMORY: 1.5 },
  FLOODED_RUINS:   { VAULT: 1.5, CHAMBER: 1.2 },
  EMBER_FORGE:     { ARMORY: 2.5, VAULT: 0.7 },
  SPECTRAL_COURT:  {},
};

// Room enemy modifiers: multiplier on spawn weights inside that room type (§5.3)
export const ROOM_ENEMY_MODIFIERS = {
  ARMORY:         { ARMORED: 1.3, ARCHER: 1.2 },
  LIBRARY:        { SKELETON: 1, MAGICIAN: 0, ARMORED: 0, ARCHER: 0, RAT: 0, BRUTE: 0, WRAITH: 0 },
  CRYPT:          { WRAITH: 1.4, SKELETON: 1.2 },
  MUSHROOM_GROVE: { RAT: 1.5 },
  TEMPLE:         { ARMORED: 1.2 },
};

// ---------------------------------------------------------------------------
// Biomes (§7)
// ---------------------------------------------------------------------------

export const BIOMES = {
  STONE: {
    wall: 0x6b6560, floor: 0x4a453f, ceiling: 0x2e2b28, fog: 0x12100e, fogDensity: 0.016,
    ambient: 0x8a7a66, ambientIntensity: 0.5, torchColor: 0xffa030,
    label: 'STONE DUNGEON', torchMode: 'standard', brazierRooms: ['HALL'],
  },
  HAUNTED_CRYPT: {
    wall: 0x3d4450, floor: 0x2b3038, ceiling: 0x1a1d23, fog: 0x0a0c12, fogDensity: 0.023,
    ambient: 0x556088, ambientIntensity: 0.44, torchColor: 0x9db4ff,
    label: 'HAUNTED CRYPT', torchMode: 'standard', brazierRooms: ['HALL'],
  },
  FUNGAL_CAVERN: {
    wall: 0x35513a, floor: 0x24331f, ceiling: 0x161f14, fog: 0x0a120c, fogDensity: 0.020,
    ambient: 0x3d6b4a, ambientIntensity: 0.46, torchColor: 0x66ff99,
    label: 'FUNGAL CAVERN', torchMode: 'vaultOnly', brazierRooms: ['HALL'],
  },
  VOLCANIC_DEPTHS: {
    wall: 0x5a2f26, floor: 0x38201a, ceiling: 0x1f100c, fog: 0x160a06, fogDensity: 0.020,
    ambient: 0xb05020, ambientIntensity: 0.49, torchColor: 0xff6a20,
    label: 'VOLCANIC DEPTHS', torchMode: 'standard', brazierRooms: ['HALL'],
  },
  FROZEN_HALLS: {
    wall: 0x3a5570, floor: 0x273848, ceiling: 0x18202b, fog: 0x0b1118, fogDensity: 0.019,
    ambient: 0x6699cc, ambientIntensity: 0.48, torchColor: 0x9fd4ff,
    label: 'FROZEN HALLS', torchMode: 'standard', brazierRooms: ['HALL'],
  },
  CRYSTAL_DEPTHS: {
    wall: 0x4a3a66, floor: 0x332848, ceiling: 0x1e1830, fog: 0x100c1a, fogDensity: 0.019,
    ambient: 0x8866cc, ambientIntensity: 0.48, torchColor: 0xcc88ff,
    label: 'CRYSTAL DEPTHS', torchMode: 'standard', brazierRooms: ['HALL'],
  },
  POISON_SWAMP: {
    wall: 0x4a5a24, floor: 0x33401a, ceiling: 0x1c2410, fog: 0x101508, fogDensity: 0.023,
    ambient: 0x779922, ambientIntensity: 0.44, torchColor: 0xaaff44,
    label: 'POISON SWAMP', torchMode: 'vaultOnly', brazierRooms: ['HALL'],
  },
  GOLDEN_TEMPLE: {
    wall: 0x8a7340, floor: 0x6b5730, ceiling: 0x3d3018, fog: 0x1a1408, fogDensity: 0.015,
    ambient: 0xccaa55, ambientIntensity: 0.54, torchColor: 0xffcc44,
    label: 'GOLDEN TEMPLE', torchMode: 'standard', brazierRooms: ['HALL', 'TEMPLE'],
  },
  FLOODED_RUINS: {
    wall: 0x2f5558, floor: 0x1f3a3e, ceiling: 0x122325, fog: 0x081214, fogDensity: 0.021,
    ambient: 0x44aacc, ambientIntensity: 0.46, torchColor: 0x66e0ff,
    label: 'FLOODED RUINS', torchMode: 'standard', brazierRooms: ['HALL'],
  },
  EMBER_FORGE: {
    wall: 0x33302e, floor: 0x22201e, ceiling: 0x111010, fog: 0x0a0908, fogDensity: 0.020,
    ambient: 0xcc6633, ambientIntensity: 0.46, torchColor: 0xff8844,
    label: 'EMBER FORGE', torchMode: 'standard', brazierRooms: ['HALL'],
  },
  SPECTRAL_COURT: {
    wall: 0x2a2140, floor: 0x1c1730, ceiling: 0x0f0c1c, fog: 0x070510, fogDensity: 0.026,
    ambient: 0x7755cc, ambientIntensity: 0.49, torchColor: 0xb088ff,
    label: 'SPECTRAL COURT', torchMode: 'standard', brazierRooms: ['HALL'],
  },
};

// 2-levels-per-biome cyclic ladder (§7), boss levels (every 7th) → SPECTRAL_COURT
export const BIOME_SEQUENCE = [
  'STONE',
  'HAUNTED_CRYPT',
  'FUNGAL_CAVERN',
  'VOLCANIC_DEPTHS',
  'FROZEN_HALLS',
  'CRYSTAL_DEPTHS',
  'POISON_SWAMP',
  'GOLDEN_TEMPLE',
  'FLOODED_RUINS',
  'EMBER_FORGE',
];

export function biomeForLevel(level) {
  if (level % BOSS.INTERVAL === 0) return 'SPECTRAL_COURT';
  return BIOME_SEQUENCE[Math.floor((level - 1) / 2) % BIOME_SEQUENCE.length];
}

// ---------------------------------------------------------------------------
// Enemy spawning & roster (§16)
// ---------------------------------------------------------------------------

export const ENEMY_SPAWN_WEIGHTS = {
  // Keyed by biome id; values are [Skeleton, Magician, Armored, Archer, Rat, Brute, Wraith] (sum = 100)
  STONE:            [45, 10, 15, 15, 10, 5,  0],
  HAUNTED_CRYPT:    [25, 10, 10, 15, 5,  5,  30],
  FUNGAL_CAVERN:    [30, 10, 10, 5,  40, 5,  0],
  VOLCANIC_DEPTHS:  [20, 10, 25, 15, 10, 20, 0],
  FROZEN_HALLS:     [25, 10, 20, 25, 10, 10, 0],
  CRYSTAL_DEPTHS:   [30, 15, 15, 20, 10, 10, 0],
  POISON_SWAMP:     [15, 10, 10, 10, 45, 10, 0],
  GOLDEN_TEMPLE:    [20, 10, 25, 20, 10, 15, 0],
  FLOODED_RUINS:    [20, 15, 10, 15, 25, 15, 0],
  EMBER_FORGE:      [10, 10, 25, 15, 5,  35, 0],
};

export const ENEMY_TYPES = ['SKELETON', 'MAGICIAN', 'ARMORED', 'ARCHER', 'RAT', 'BRUTE', 'WRAITH'];

export const ENEMY = {
  MAX_ALIVE: 200,
  NOVICE_WINDOW: 3,          // levels 1..3: enemy HP multiplier frozen at 1 (base HP); linear ramp resumes at level 4
  SPAWN_INTERVAL: 0.5,        // reveal one mob every 0.5 s
  SPAWN_PLAYER_DIST: 30,      // spawns only > 30 m from the player
  FROZEN_DIST: 40,            // mobs > 40 m frozen immobile
  SPAWN_CAP: 100,             // spawnMult capped at ×100
  SPAWN_HP_OVERFLOW_PER_10: 1.5, // +150% HP per 10 excess points past the cap
  SPEED_PER_LEVEL: 0.02,      // (1 + 0.02 × (level − 1))
  BOSS_KILL_SPEED_BONUS: 0.1, // ×(1 + 0.1 × bossKills), permanent
  ATTACK_PER_THREE_LEVELS: 0.05, // attack ×(1 + 0.05 × floor((level−1)/3))
  ELITE_CHANCE: 0.1,          // 1-in-10 per non-rat spawn
  ELITE_TYPES: ['ARMORED', 'ARCHER', 'BRUTE', 'WRAITH'],
  RAT_PACK_MIN: 2,
  RAT_PACK_MAX: 3,
  RAT_CAP: 6,
  HEALTH_DROP_CHANCE: 0.15,   // 15% health pickup per kill
  PICKUP_RADIUS: 1.4,
  LOS_STEP: 0.4,
  LOS_RADIUS: 0.25,
  PATH_REEVAL_MS: 300,
  STEP_SLIVER: 0.08,
  RADIUS: 0.35,
  SWING_HIT_PROGRESS: 0.35,
  CANDIDATE_MIN_BFS_DIST: 6,
  // scaling helpers
  speedMult(level, bossKills) {
    return (1 + ENEMY.SPEED_PER_LEVEL * (level - 1)) * (1 + ENEMY.BOSS_KILL_SPEED_BONUS * bossKills);
  },
  attackMult(level, bossKills) {
    return (1 + ENEMY.ATTACK_PER_THREE_LEVELS * Math.floor((level - 1) / 3)) * (1 + ENEMY.BOSS_KILL_SPEED_BONUS * bossKills);
  },
};

export const SKELETON = {
  hp: 2, speed: 2.6, damage: 1, range: 1.6,
  windup: 0.35, swing: 0.25, recover: 0.4, cooldown: 1.2,
  drops: 1, elite: false,
};

export const MAGICIAN = {
  hp: 2, speed: 2.6, damage: 1, castRange: 9,
  windup: 0.35, swing: 0.25, recover: 0.4, cooldown: 1.2,
  projectile: { speed: 6.2, life: 4, radius: 0.3, damage: 1, stopFraction: 0.6 },
  drops: 1, elite: false,
};

export const ARMORED = {
  hp: 5, speed: 1.8, damage: 2, range: 0.85,
  windup: 0.5, swing: 0.3, recover: 0.5, cooldown: 1.6,
  drops: 2, elite: false,
};

export const ARCHER = {
  hp: 2, speed: 2.4, damage: 1, range: 10,
  windup: 0.5, swing: 0.1, recover: 0.4, cooldown: 1.8,
  kiteStop: 8, kiteRetreatUnder: 4, retreatSpeed: 2.0,
  projectile: { speed: 8, life: 3, radius: 0.15 },
  drops: 1, elite: false,
};

export const RAT = {
  hp: 1, speed: 4.2, damage: 1, range: 0.9,
  windup: 0, swing: 0.8, cooldown: 0,
  drops: 0, elite: false,
};

export const BRUTE = {
  hp: 8, speed: 1.2, damage: 3, range: 2.4,
  windup: 1.2, swing: 0.3, recover: 1.2, cooldown: 2.5,
  slamConeHalfAngle: 0.87, // ±50°
  drops: 3, elite: false,
};

export const WRAITH = {
  hp: 2, speed: 2.4, damage: 1, range: 0.9,
  windup: 0, swing: 1.0, cooldown: 0,
  drops: 2, elite: false, phases: true, // phasing: straight flight, no pathing/LOS
};

// Elites (1-in-10) (§16.3)
export const ELITE = {
  ARMORED:  { name: 'Warlord',      hp: 10, speedMult: 1.3, drops: 3 },
  ARCHER:   { name: 'Sharpshooter', hp: 2,  speedMult: 1.0, drops: 2, arrowFan: 2, arrowFanHalfAngle: 8 * Math.PI / 180 },
  BRUTE:    { name: 'Ogre',         hp: 16, speedMult: 1.2, drops: 4, scale: 1.9 },
  WRAITH:   { name: 'Banshee',      hp: 4,  speedMult: 1.4, drops: 3 },
};

/**
 * Enemy HP multiplier — the §3/§16.1 binding formula:
 * (1 + 3·ngPlus) × (1 + floor(level/10)) × (1 + 1.5·floor(max(0, level+souls−990)/10))
 * The overflow term is LINEAR by user ruling — never make it exponential/quadratic.
 * Playability window: levels 1..ENEMY.NOVICE_WINDOW freeze the multiplier at 1
 * (base HP warmup — applies to every run including NG+ starts); the linear
 * ramp resumes at level 4.
 */
export function enemyHpMultiplier(ngPlus, level, souls) {
  if (level <= ENEMY.NOVICE_WINDOW) return 1;
  const excess = Math.max(0, level + souls - 990);
  return (1 + 3 * ngPlus) * (1 + Math.floor(level / 10)) * (1 + 1.5 * Math.floor(excess / 10));
}

// ---------------------------------------------------------------------------
// Sword (§9)
// ---------------------------------------------------------------------------

export const SWORD = {
  RANGE: 2.2,                 // base range; × scale × (1 + 0.04·tier); thrust ×1.25
  TIER_REACH_BONUS: 0.04,     // +4% reach per tier
  THRUST_RANGE_MULT: 1.25,    // step 3 piercing thrust range ×1.25
  COMBO_WINDOW: 0.34,         // combo chain window (0.14 recover + 0.20 grace)
  COMBO_COOLDOWN: 0.30,       // cooldown between combos
  BLADE_FLASH: 0.1,
  HIT_STOP: 0.06,
  BREAKABLE_CONE_LOOSE: 0.12, // breakables hit in ±(maxDot − 0.12)
  // Electric proc (SWORD TOP LEVEL — NOT nested under COMBO, §27 hoist fix)
  ELECTRIC_CHANCE: 0.05,      // 5% on any landing strike
  ELECTRIC_RANGE: 20,
  ELECTRIC_DAMAGE_MULT: 5,    // × orb damage, no instant kill
  ELECTRIC_HIT_STOP: 0.12,

  COMBO: {
    // steps 1–3: windup / swing / recover / base damage / cone half-angle (radians)
    1: { windup: 0.10, swing: 0.16, recover: 0.14, damage: 2, arc: 0.38 * Math.PI }, // ±68°
    2: { windup: 0.08, swing: 0.15, recover: 0.14, damage: 2, arc: 0.38 * Math.PI }, // ±68°
    3: { windup: 0.12, swing: 0.18, recover: 0.20, damage: 3, arc: 0.09 * Math.PI, rangeMult: 1.25 }, // ±16° thrust
  },

  // Arc bolts (tiers 3–5)
  ARC_CHANCE: [0, 0, 0, 0.10, 0.35, 1.0], // T3 10% / T4 35% / T5 100%
  ARC_BOLTS: [0, 0, 0, 1, 1, 2],          // T5 fires 2 bolts
  ARC_POOL: 8,
  ARC_MAX_IN_FLIGHT: 6,
  ARC_SPEED: 24,
  ARC_LIFE: 1.2,
  ARC_TARGET_RANGE: 20,
};

/** Base combo damage: 2 / 2 / 3 (tier 0). */
export function swordHitDamage(step, tier) {
  return SWORD.COMBO[step].damage + tier;
}

/** Sword SIZE ladder: 1 + 0.8·tier (×5 at tier 5). */
export function swordSizeScale(tier) {
  return 1 + 0.8 * tier;
}

export const MAX_TOTAL_SCALE = 5.0;

/**
 * Damage multiplier (binding composition rule):
 * (1 + (scale − 1) × 0.5) × 1.1^tier × 1.1^⌊level/5⌋
 */
export function damageMult(scale, tier, level) {
  return (1 + (scale - 1) * 0.5) * Math.pow(1.1, tier) * Math.pow(1.1, Math.floor(level / 5));
}

/** Attack-speed souls component: 1 + 0.001·souls (+100% at 1000). */
export function attackSpeedFromSouls(souls) {
  return 1 + 0.001 * souls;
}

export const HIT_STOP = {
  SWORD: 0.06,
  ELECTRIC: 0.12,
  EVOLUTION: 0.1,
  ORB_HIT: 0.06,              // orb weapon direct hit (§10)
};

// ---------------------------------------------------------------------------
// Weapon evolution (§9.3)
// ---------------------------------------------------------------------------

export const EVOLUTION = {
  TIER_THRESHOLDS: [50, 100, 200, 400, 800], // T1..T5; evaluated as ceiling, never reverts in-run
  TIER_NAMES: [
    'Dagger',
    "Knight's Sword",
    'Runic Greatsword',
    'Crystal Soulblade',
    'Soulfire Greatblade',
    'Lightsaber',
  ],
  TIER_EFFECTS: [
    '5% electric blast (×5 orb dmg)',
    '—',
    '—',
    'arc bolt 10% per landing strike (orb dmg)',
    'arc bolt 35% per strike (orb dmg)',
    '2 arc bolts EVERY strike + idle crackle + 5% blast ×5 orb dmg',
  ],
  // T5: exactly one extra camera-attached point light
  MAX_TIER: 5,
  /** Display name for a 0-based tier index (clamped to array bounds). */
  tierName(i) {
    i = Math.max(0, Math.min(i, this.TIER_NAMES.length - 1));
    return this.TIER_NAMES[i];
  },
  /** Effect description for a 0-based tier index (clamped to array bounds). */
  tierDescr(i) {
    i = Math.max(0, Math.min(i, this.TIER_EFFECTS.length - 1));
    return this.TIER_EFFECTS[i];
  },
};

/** weaponTier(souls) — ceiling over TIER_THRESHOLDS, 0..5. */
export function weaponTier(souls) {
  let tier = 0;
  for (let i = 0; i < EVOLUTION.TIER_THRESHOLDS.length; i++) {
    if (souls >= EVOLUTION.TIER_THRESHOLDS[i]) tier = i + 1;
  }
  return tier;
}

// ---------------------------------------------------------------------------
// Orb weapon (§10)
// ---------------------------------------------------------------------------

export const ORB_WEAPON = {
  STEP_INTERVAL: 0.22,        // hold LMB steps every 0.22 s
  SEQUENCE_WINDOW: 1.2,       // sequence expires after 1.2 s without a step
  SPEED: 12.4,                // u/s
  LIFETIME: 2.5,              // s
  RADIUS: 0.3,
  BOUNCE_MAX: 3,              // steps 1–2 bounce up to 3 times
  BASE_DAMAGE: 2,             // direct-hit = round(2 × orbDamageMultiplier)
  EXPLODE_RADIUS: 2,
  EXPLODE_DAMAGE: 5,          // AOE = round(5 × orbDamageMultiplier)
  EXPLODE_Y_GATE: 2.6,        // blast only damages when blast point y < 2.6
  COST_PER_HIT: 1,            // first step of a 3-step sequence costs 1 orb (§10)
  EXPLOSION_RADIUS: 2,        // AOE radius (EXPLODE_RADIUS)
  POOL_SIZE: 48,              // normal orb slots
  FIREBALL_POOL_SIZE: 6,      // fireball slots
  FIREBALL_COOLDOWN: 0.35,
  FIREBALL_EMISSIVE: 2.2,
  FIREBALL_RING_TIME: 0.22,
  EXPLOSION_RING_POOL: 8,
  FIREBALL_RING_POOL: 6,
};

/** orbDamageMultiplier = 1 + 0.02 × orbs (orb damage +2%/orb). */
export function orbDamageMultiplier(orbs) {
  return 1 + 0.02 * orbs;
}

/** round(2 × orbDamageMultiplier) */
export function orbDamage(orbs) {
  return Math.round(2 * orbDamageMultiplier(orbs));
}

/** round(5 × orbDamageMultiplier) */
export function orbExplosionDamage(orbs) {
  return Math.round(ORB_WEAPON.EXPLODE_DAMAGE * orbDamageMultiplier(orbs));
}

// ---------------------------------------------------------------------------
// Buffs (§11)
// ---------------------------------------------------------------------------

export const BUFF = {
  CHANCE: 0.06,               // 6% buff roll per breakable break
  EXCESS_ORB_BONUS: 0.0005,   // +0.05% per orb above 100
  EXCESS_ORB_THRESHOLD: 100,
  ORB_DROP_MIN: 1,
  ORB_DROP_MAX: 5,
  ORB_DROP_CHANCE: 0.20,
  MAX_DURATION: 90,           // breakable buffs hard-capped at 90 s
  BOSS_DURATION: 300,         // boss-kill buff 5 min, uncapped
  CARRY_MULT: 5,              // level carry ×5 remaining time (capped 90 s)
  DURATION: 60,
  EFFECTS: [
    'BRIGHT',
    'FIREBALL',
    'EMPOWERED',
    'GODSPEED',
    'HUNTER',
  ],
  // per-buff tuning
  FIREBALL: { chargeTime: 0.35 }, // hold charge time = FIREBALL_COOLDOWN (0.35 s)
  BRIGHT: { ambientMult: 2.5, fogDensityMult: 0.35 },
  EMPOWERED: { swordLengthMult: 1.5, moveMult: 1.2, attackSpeedMult: 1.2 },
  GODSPEED: { attackSpeedMult: 1.5, moveMult: 1.5 },
  DESCRIPTIONS: {
    BRIGHT: 'BRIGHT — the level lights up, enemies flee from you',
    FIREBALL: 'FIREBALL — right-click hurls an explosive fireball',
    EMPOWERED: 'EMPOWERED — longer reach, faster movement & attacks',
    GODSPEED: 'GODSPEED — +50% attack speed and +50% move speed',
    HUNTER: 'HUNTER — a spectral boss companion follows and attacks mobs',
  },
};

// ---------------------------------------------------------------------------
// HUNTER companion (§11)
// ---------------------------------------------------------------------------

export const HUNTER = {
  HP: 9999,                   // invulnerable
  FOLLOW_SPEED: 6.5,
  FOLLOW_DISTANCE: 2.5,
  ATTACK_RANGE: 7,
  DAMAGE: 2,
  BASE_INTERVAL: 1.0,         // interval = 1.0 / clamp(collectedOrbs/100, 0.25, 5)
  INTERVAL_MIN: 0.25,
  INTERVAL_MAX: 5,
  BEAM_FLASH: 0.35,
};

// ---------------------------------------------------------------------------
// Boss — the Spectral Lord (§17)
// ---------------------------------------------------------------------------

export const BOSS = {
  INTERVAL: 7,                // every 7th level is a boss level
  HP_MULT: 22.5,              // base HP = ceil(4 × 22.5) = 90
  BASE_HP_FACTOR: 4,
  HEARTS_HP_BONUS: 0.1,       // +0.1 per permanent heart past 3
  // Boss HP hearts factor base: the §17 examples (49s+5h→118, 100s+5h→154 with
  // A=1+0.25·floor(s/50), 3h baseline F=1) require F(2 extra hearts) ∈ (1.6, 1.6148];
  // 1.1^(2.5·h) = 1.1^5 = 1.61051 per 2 hearts fits all five binding §17/§24 values.
  HEARTS_MULT_EXP: 2.5,       // hearts factor = 1.1^(2.5·heartsExtra)
  SOULS_HP_BONUS: 0.25,       // +0.25 per 50 souls
  DRIFT_SPEED: 2.2,           // drift toward player beyond 2.5 u
  DRIFT_DISTANCE: 2.5,
  RADIUS: 0.9,
  CHARGE_RANGE: 14,
  CHARGE_DMG: 2,
  CHARGE_SPEED: 14,
  CHARGE_TIME: 0.9,
  CHARGE_CD: 3.2,
  CHARGE_FIRST_CD_MULT: 0.6,
  CHARGE_CONTACT_RADIUS: 1.4,
  SUMMON_INTERVAL: 6,
  SUMMON_BASE_COUNT: 3,
  SUMMON_HEARTS_MULT: 1.5,    // floor(3 × 1.5^heartsExtra) wraiths
  MAX_MINIONS: 25,
  BLINK_CD: 8,
  BLINK_FIRST_CD_MULT: 0.5,
  BLINK_TELEGRAPH: 1.0,
  BLINK_RADIUS: 3,
  BLINK_DMG: 3,
  BLINK_SPARKS: 12,
  SMOKE_CD: 6,
  SMOKE_FIRST_CD_MULT: 0.7,
  SMOKE_FLIGHT: 0.7,
  SMOKE_SPEED: 10,
  SMOKE_DURATION: 4,
  SMOKE_RADIUS: 2.2,
  SMOKE_DMG: 1,
  // variant labels in enemy-type order (Skeleton, Armored, Archer, Brute, Wraith, Rat, Magician)
  VARIANT_LABELS: [
    'BONE LORD',
    'IRON GHOUL',
    'SPECTRAL HUNTER',
    'ASH TITAN',
    'SPECTRAL LORD',
    'VERMIN KING',
    'LICH ARCHMAGE',
  ],
  VARIANT_TYPES: ['SKELETON', 'ARMORED', 'ARCHER', 'BRUTE', 'WRAITH', 'RAT', 'MAGICIAN'],
};

// ---------------------------------------------------------------------------
// BURN — the final foe (§18)
// ---------------------------------------------------------------------------

export const BURN = {
  BASE_HP: 90,                // ceil(3 × 30) at NG 0; ×(1 + 3·ngPlus)
  BASE_HP_FACTOR: 30,
  HP_BASE: 3,
  hp(ngPlus) {
    return Math.ceil(BURN.BASE_HP * (1 + 3 * ngPlus));
  },
  speed: 2.6,
  damage: 1,
  range: 1.3,
  cooldown: 1.4,
  FIRE_PATCH_INTERVAL: 0.6,
  drops: 2,
};

// ---------------------------------------------------------------------------
// Light budget (§22) — also the verification limit for biome-check
// ---------------------------------------------------------------------------

export const LIGHT_CEILING = {
  AVG: 154,
  MAX: 199,
  TORCHLESS_AVG: 10,
  TORCHLESS_MAX: 50,
};

// Point light sources: [intensity, distance, decay], shadow flag
export const LIGHT_SOURCES = {
  TORCH:       { intensity: 5.5, distance: 26, decay: 1.1, shadow: false },
  BRAZIER:     { intensity: 7, distance: 30, decay: 1.1, shadow: false },
  CRYSTAL:     { intensity: 4.6, distance: 20, decay: 1.1, shadow: false },
  MUSHROOM:    { intensity: 5.2, distance: 19, decay: 1.1, shadow: false },
  WISP:        { intensity: 2.8, distance: 14, decay: 1.1, shadow: false },
  PORTAL:      { intensity: 5.5, distance: 28, decay: 1.1, shadow: false },
  HEALD:       { intensity: 2.2, distance: 11, decay: 1.1, shadow: false },
};

// ---------------------------------------------------------------------------
// Drops (§16.5 / §19)
// ---------------------------------------------------------------------------

export const DROP = {
  VISUAL_LIFE: 1,             // orb visual bobs ~1 s then vanishes (credit is instant)
  HEALTH_RESTORE: 3,          // health pickup ADDS 3 hearts, capped at max
  HEALTH_DROP_CHANCE: 0.15,
};

// ---------------------------------------------------------------------------
// Props (§13/§22 budgets: breakables ≤ 3/room; prop instances ≤ 400/level)
// ---------------------------------------------------------------------------

export const PROPS = {
  MAX_INSTANCES_PER_LEVEL: 400,
  MAX_BREAKABLES_PER_ROOM: 3,
  STEP_ON_BREAK_RADIUS: 0.45,
  SARCOPHAGUS_TRIGGER_DIST: 2.5,
  SARCOPHAGUS_LID_TIME: 0.6,
  SARCOPHAGUS_WRAITH_CHANCE: 0.30,
  SARCOPHAGUS_ORB_DROP: 1,
  // per-room-type decorative/breakable counts (weight pools for the PropSystem)
  PROPS_PER_ROOM: {
    CHAMBER: { decorative: 4, breakable: 2, interactive: 0 },
    HALL: { decorative: 2, breakable: 1, interactive: 0 },
    VAULT: { decorative: 3, breakable: 2, interactive: 1 },
    ARMORY: { decorative: 3, breakable: 3, interactive: 0 },
    LIBRARY: { decorative: 4, breakable: 2, interactive: 0 },
    CRYPT: { decorative: 3, breakable: 1, interactive: 3 },
    MUSHROOM_GROVE: { decorative: 6, breakable: 1, interactive: 0 },
    ARENA: { decorative: 4, breakable: 3, interactive: 0 },
    CRYSTAL_CHAMBER: { decorative: 5, breakable: 1, interactive: 0 },
    TEMPLE: { decorative: 5, breakable: 2, interactive: 1 },
  },
  // weighted pools per room type (weight → flavor; resolved with biome membership)
  POOLS: {
    CHAMBER: [
      { name: 'rubble', weight: 30 },
      { name: 'skullPile', weight: 15 },
      { name: 'barrel', weight: 20, breakable: true },
      { name: 'crate', weight: 20, breakable: true },
      { name: 'bones', weight: 15 },
    ],
    HALL: [
      { name: 'pillar', weight: 40 },
      { name: 'rubble', weight: 30 },
      { name: 'candle', weight: 30 },
    ],
    VAULT: [
      { name: 'goldPile', weight: 35 },
      { name: 'barrel', weight: 25, breakable: true },
      { name: 'chest', weight: 20, interactive: true },
      { name: 'skullPile', weight: 20 },
    ],
    ARMORY: [
      { name: 'weaponRack', weight: 40 },
      { name: 'anvil', weight: 30 },
      { name: 'crate', weight: 30, breakable: true },
    ],
    LIBRARY: [
      { name: 'bookshelf', weight: 60 },
      { name: 'candle', weight: 25 },
      { name: 'barrel', weight: 15, breakable: true },
    ],
    CRYPT: [
      { name: 'sarcophagus', weight: 70, interactive: true },
      { name: 'wispAnchor', weight: 30 },
    ],
    MUSHROOM_GROVE: [
      { name: 'mushroomCluster', weight: 60 },
      { name: 'rubble', weight: 25 },
      { name: 'barrel', weight: 15, breakable: true },
    ],
    ARENA: [
      { name: 'pillar', weight: 40 },
      { name: 'barrel', weight: 30, breakable: true },
      { name: 'crate', weight: 30, breakable: true },
    ],
    CRYSTAL_CHAMBER: [
      { name: 'crystalCluster', weight: 70 },
      { name: 'rubble', weight: 30 },
    ],
    TEMPLE: [
      { name: 'altar', weight: 50 },
      { name: 'pillar', weight: 30 },
      { name: 'goldPile', weight: 20 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Hazards (§7.3 / §26)
// ---------------------------------------------------------------------------

export const HAZARD = {
  TICK_DAMAGE: 1,
  TICK_INTERVAL: 0.8,
  DAMAGE_RADIUS: 1.2,
  MIN_EXIT_DIST: 3,
  POOLS_PER_ROOM_MIN: 1,
  POOLS_PER_ROOM_MAX: 2,
};

// ---------------------------------------------------------------------------
// Renderer (§12) — kept for completeness
// ---------------------------------------------------------------------------

export const RENDERER = {
  ANTIALIAS: true,
  TONE_MAPPING: 'ACESFilmic',
  EXPOSURE: 1.25,
  SHADOW_MAP: 'PCFSoft',
  MAX_PIXEL_RATIO: 2,
  POST_BLOOM_STRENGTH: 0.055,
  POST_BLOOM_RADIUS: 0.5,
  POST_BLOOM_THRESHOLD: 0.5,
  POST_SATURATION: 0.0175,
  ENEMY_GLOW_INTENSITY_SCALE: 0.05,
  ENEMY_GLOW_PULSE: 0.75,
  ENEMY_GLOW_PULSE_SPEED: 0.003,
  ENEMY_GLOW_FAR_FADE_START: 1.2,
  ENEMY_GLOW_FAR_FADE_END: 4.5,
  ENEMY_GLOW_MIN_FADE: 0.15,
};

// ---------------------------------------------------------------------------
// Pools (§13)
// ---------------------------------------------------------------------------

export const POOLS = {
  ORB: ORB_WEAPON.POOL_SIZE,
  FIREBALL: ORB_WEAPON.FIREBALL_POOL_SIZE,
  EXPLOSION_RINGS: ORB_WEAPON.EXPLOSION_RING_POOL,
  FIREBALL_RINGS: ORB_WEAPON.FIREBALL_RING_POOL,
  ARC_BOLTS: SWORD.ARC_POOL,
  ENEMY_ARROWS: 10,
  ENEMY_ORBS: 12,
  PICKUP_RINGS: 8,
  PICKUP_RING_TTL: 0.45,
  DEATH_BURSTS: 3,
  SWORD_SPARKS: 1,
  SWORD_TRAILS: 3,
  SWORD_SMOKE: 1,
  BLADE_CRACKLES: 3,
  FIRE_PATCHES: 6,
  FIRE_PATCH_TTL: 10,
  FIRE_PATCH_GROW: 0.3,
  SHOCKWAVES: 4,
  SHOCKWAVE_TTL: 0.25,
  BRUTE_SHOCKWAVES: 4,
  BRUTE_SHOCKWAVE_TTL: 0.25,
  SMOKE_PARTICLES: 9,
  DUST_MOTES: 30,
  STALACTITES: 60,
  WATER_POOLS: 24,
};


// Constants.js — the game's data contract. Every number that affects gameplay.
// Binding per spec v2 §4.1/§5-§23.

export const WORLD = {
  CELL_SIZE: 6,
  WALL_HEIGHT: 20
};

export const PLAYER = {
  RADIUS: 0.35,
  BASE_SPEED: 4,
  SPRINT_MULT: 1.55,
  SPRINT_ACCEL_WINDOW: 1,   // s of consecutive sprint to gain a tier
  SPRINT_ACCEL_STEP: 0.05,  // +5% per tier
  SPRINT_ACCEL_MAX: 3,      // cap ×3 (multiplicative on the 1.55 base)
  SENSITIVITY: 0.002,
  PITCH_CLAMP: Math.PI * 85 / 180,
  MAX_HEALTH_BASE: 3,
  REGEN_DELAY: 8,           // regen starts 8 s after last damage (damage is felt)
  REGEN_INTERVAL: 6,        // +1 heart / 6 s after the delay
  INVULN_TIME: 0.8,
  SAFE_SPAWN_TIME: 5,
  SHAKE_TIME: 0.25,
  EXIT_ROOM_DIST2: 4        // within 2 u of exit cell center
};

export const CAMERA = {
  FOV: 90,
  SPRINT_FOV_KICK: 8,
  NEAR: 0.1,
  FAR: 160
};

export const LIGHTING = {
  AMBIENT_INTENSITY_STONE: 0.55,
  HEADLIGHT_INTENSITY: 1.0,
  HEADLIGHT_DISTANCE: 30,
  HEADLIGHT_DECAY: 1.05
};

export const MATERIALS = {
  TEXTURE_REPEAT: 2,
  SURFACE_SIZE: 256,
  GLOW_SIZE: 64
};

export const DUNGEON = {
  GRID_MIN: 12,
  GRID_MAX: 16,
  ROOM_COUNT: 10,
  ROOM_COUNT_MIN: 8,
  MIN_ROOM_DIST: 1,     // cells of margin between rooms
  DEAD_END_MAX: 4,
  MAX_ATTEMPTS: 200,
  TORCH_SPACING_LEGACY: 16, // legacy/inert; real spacing lives in LightingSystem
  ARCH_PROBABILITY: 0,      // legacy/inert — WorldBuilder builds no arches/cracks
  CRACK_PROBABILITY: 0      // legacy/inert
};

export const ROOM_TYPES = [
  { id: 'CHAMBER',         weight: 40, minSize: 2, maxSize: 3, biomes: 'all' },
  { id: 'HALL',            weight: 35, minSize: 1, maxSize: 2, hMax: 1, biomes: 'all' },
  { id: 'VAULT',           weight: 25, minSize: 3, maxSize: 4, biomes: 'all' },
  { id: 'ARMORY',          weight: 10, minSize: 3, maxSize: 3, biomes: ['STONE', 'VOLCANIC_DEPTHS', 'GOLDEN_TEMPLE', 'EMBER_FORGE'] },
  { id: 'LIBRARY',         weight: 10, minSize: 3, maxSize: 3, biomes: ['STONE', 'HAUNTED_CRYPT'] },
  { id: 'CRYPT',           weight: 10, minSize: 2, maxSize: 3, biomes: ['HAUNTED_CRYPT'] },
  { id: 'MUSHROOM_GROVE',  weight: 8,  minSize: 2, maxSize: 3, biomes: ['FUNGAL_CAVERN', 'POISON_SWAMP'] },
  { id: 'ARENA',           weight: 6,  minSize: 4, maxSize: 4, biomes: 'all' },
  { id: 'CRYSTAL_CHAMBER', weight: 8,  minSize: 2, maxSize: 3, biomes: ['CRYSTAL_DEPTHS'] },
  { id: 'TEMPLE',          weight: 8,  minSize: 3, maxSize: 3, biomes: ['GOLDEN_TEMPLE'] }
];

// Palette values are FREE graphics (v2 ruling) — keys are the contract.
const P = (wall, floor, ceiling, fog, fogDensity, ambient, ambientIntensity, torchColor, label, torchMode = 'standard', brazierRooms = ['HALL']) =>
  ({ wall, floor, ceiling, fog, fogDensity, ambient, ambientIntensity, torchColor, label, torchMode, brazierRooms });

export const BIOMES = {
  STONE:           P(0x8a8074, 0x6e675c, 0x56504a, 0x0d0b08, 0.030, 0x40382c, 0.32, 0xff9a3c, 'STONE DUNGEON'),
  HAUNTED_CRYPT:   P(0x6f7580, 0x585d68, 0x444852, 0x07090d, 0.034, 0x2a3340, 0.26, 0x7ab8d8, 'HAUNTED CRYPT'),
  FUNGAL_CAVERN:   P(0x4a5a46, 0x39463a, 0x2b3630, 0x060b06, 0.032, 0x24352a, 0.22, 0x66ff99, 'FUNGAL CAVERN', 'vaultOnly'),
  VOLCANIC_DEPTHS: P(0x5c4438, 0x453228, 0x33241c, 0x100502, 0.038, 0x38221a, 0.26, 0xff5a1e, 'VOLCANIC DEPTHS'),
  FROZEN_HALLS:    P(0x9db8c8, 0x7d98aa, 0x607888, 0x0a1016, 0.033, 0x30485c, 0.30, 0x8ad0ff, 'FROZEN HALLS'),
  CRYSTAL_DEPTHS:  P(0x6a5580, 0x534268, 0x3e3050, 0x0c0614, 0.032, 0x3a2850, 0.28, 0xb07aff, 'CRYSTAL DEPTHS'),
  POISON_SWAMP:    P(0x4e563e, 0x3c4430, 0x2c3424, 0x080c05, 0.034, 0x26301e, 0.22, 0xaaff44, 'POISON SWAMP', 'vaultOnly'),
  GOLDEN_TEMPLE:   P(0xb89a5e, 0x94784a, 0x705a38, 0x120d04, 0.030, 0x48381c, 0.34, 0xffc84a, 'GOLDEN TEMPLE'),
  FLOODED_RUINS:   P(0x5a7a72, 0x46605a, 0x344a44, 0x040b09, 0.033, 0x1e3830, 0.26, 0x4adfc8, 'FLOODED RUINS'),
  EMBER_FORGE:     P(0x4a3c34, 0x382c26, 0x2a211c, 0x0e0603, 0.036, 0x301e14, 0.24, 0xff7a2a, 'EMBER FORGE'),
  SPECTRAL_COURT:  P(0x585070, 0x443e58, 0x343044, 0x080612, 0.032, 0x2c2444, 0.28, 0xaa88ff, 'SPECTRAL COURT')
};

export const BIOME_SEQUENCE = [
  'STONE', 'HAUNTED_CRYPT', 'FUNGAL_CAVERN', 'VOLCANIC_DEPTHS', 'FROZEN_HALLS',
  'CRYSTAL_DEPTHS', 'POISON_SWAMP', 'GOLDEN_TEMPLE', 'FLOODED_RUINS', 'EMBER_FORGE'
];

export const BOSS = {
  INTERVAL: 7,
  HP_MULT: 22.5,
  BASE_HP: 4,             // ceil(4 × 22.5) = 90
  CHARGE_DMG: 2,
  CHARGE_SPEED: 14,
  CHARGE_TIME: 0.9,
  CHARGE_RANGE: 14,
  CHARGE_COOLDOWN: 3.2,
  CHARGE_FIRST_MULT: 0.6,
  CONTACT_RADIUS: 1.4,
  BLINK_COOLDOWN: 8,
  BLINK_FIRST_MULT: 0.5,
  BLINK_TELEGRAPH: 1.0,
  BLINK_DMG: 3,
  BLINK_RADIUS: 3,
  SMOKE_COOLDOWN: 6,
  SMOKE_FIRST_MULT: 0.7,
  SMOKE_FLIGHT: 0.7,
  SMOKE_SPEED: 10,
  SMOKE_DURATION: 4,
  SMOKE_RADIUS: 2.2,
  SMOKE_DMG: 1,
  SUMMON_INTERVAL: 6,
  SUMMON_HEARTS_MULT: 1.5,
  MAX_MINIONS: 25,
  DRIFT_SPEED: 2.2,
  DRIFT_KEEP: 2.5,
  RADIUS: 0.9
};

export const BOSS_VARIANTS = ['Skeleton', 'Armored', 'Archer', 'Brute', 'Wraith', 'Rat', 'Magician'];
export const BOSS_LABELS = {
  Skeleton: 'BONE LORD', Armored: 'IRON GHOUL', Archer: 'SPECTRAL HUNTER',
  Brute: 'ASH TITAN', Wraith: 'SPECTRAL LORD', Rat: 'VERMIN KING', Magician: 'LICH ARCHMAGE'
};
export const HEARTS_HP_BONUS = 0.1;
export const SOULS_HP_BONUS = 0.25;

// Enemy HP multiplier (NG+ × level × linear overflow). §3/§16.1 — LINEAR overflow, do not change.
export function enemyHpMultiplier(ngPlus, level, souls) {
  return (1 + 3 * ngPlus)
    * (1 + Math.floor(level / 10))
    * (1 + 1.5 * Math.floor(Math.max(0, level + souls - 990) / 10));
}

// Boss HP with the halved wealth/hearts stack. §17.
export function bossHp(level, ngPlus, souls, maxHealth) {
  const heartsExtra = Math.max(0, maxHealth - 3);
  const soulsPart = (1 + SOULS_HP_BONUS * Math.floor(souls / 50));
  const heartsPart = Math.pow(1 + HEARTS_HP_BONUS, heartsExtra);
  return Math.ceil(BOSS.BASE_HP * BOSS.HP_MULT
    * (1 + 3 * ngPlus)
    * (1 + Math.floor(level / 10))
    * (1 + (soulsPart * heartsPart - 1) / 2));
}

// BURN HP — v2 ruling: 30 flat at NG0 every level, then ×(1 + 3·ngPlus).
export function burnHp(ngPlus) { return Math.ceil(30 * (1 + 3 * ngPlus)); }

// Biome for a level — boss branch first, else the 2-level cyclic ladder. §7.
export function biomeForLevel(level) {
  if (level % BOSS.INTERVAL === 0) return 'SPECTRAL_COURT';
  return BIOME_SEQUENCE[Math.floor((level - 1) / 2) % 10];
}

export const BIOME_ROOM_MODIFIERS = {
  STONE: {},
  HAUNTED_CRYPT: { CRYPT: 3, LIBRARY: 1.5, ARMORY: 0.5 },
  FUNGAL_CAVERN: { MUSHROOM_GROVE: 3, VAULT: 0.7 },
  VOLCANIC_DEPTHS: { ARMORY: 2, CHAMBER: 0.8 },
  FROZEN_HALLS: { VAULT: 1.5, CHAMBER: 1.2, MUSHROOM_GROVE: 0 },
  CRYSTAL_DEPTHS: { CRYSTAL_CHAMBER: 3, VAULT: 1.2 },
  POISON_SWAMP: { MUSHROOM_GROVE: 2.5, VAULT: 0.5 },
  GOLDEN_TEMPLE: { TEMPLE: 3, VAULT: 2, ARMORY: 1.5 },
  FLOODED_RUINS: { VAULT: 1.5, CHAMBER: 1.2 },
  EMBER_FORGE: { ARMORY: 2.5, VAULT: 0.7 },
  SPECTRAL_COURT: {}
};

export const ROOM_ENEMY_MODIFIERS = {
  ARMORY: { ARMORED: 1.3, ARCHER: 1.2 },
  LIBRARY: { SKELETON: 1, MAGICIAN: 0, ARMORED: 0, ARCHER: 0, RAT: 0, BRUTE: 0, WRAITH: 0 },
  CRYPT: { WRAITH: 1.4, SKELETON: 1.2 },
  MUSHROOM_GROVE: { RAT: 1.5 },
  TEMPLE: { ARMORED: 1.2 }
};

export const RENDERER = {
  MAX_PIXEL_RATIO: 2,
  BLOOM_STRENGTH: 0.055,
  BLOOM_RADIUS: 0.5,
  BLOOM_THRESHOLD: 0.5,
  SATURATION: 0.0175
};

export const ENEMY_GLOW = {
  BLUR_WEIGHTS: [0.227, 0.194, 0.121],
  COMPOSITE_SHARP: 0.5,
  COMPOSITE_BLUR: 1.6,
  HALF_RES: true
};

export const SMOKE = { PARTICLES: 9 };
export const AMBIENT_DUST = { PARTICLES: 30 };

export const SKELETON = { HP: 2, SPEED: 2.6, DMG: 1, RANGE: 1.6 };
export const MAGICIAN = { HP: 2, SPEED: 2.6, DMG: 1, CAST_RANGE: 9, ORB_SPEED: 6.2, ORB_LIFE: 4, ORB_RADIUS: 0.3, STOP_FRAC: 0.6 };
export const ARMORED = { HP: 5, SPEED: 1.8, DMG: 2, RANGE: 0.85 };
export const ARCHER = { HP: 2, SPEED: 2.4, DMG: 1, RANGE: 10, KITE_STOP: 8, KITE_RETREAT_UNDER: 4, RETREAT_SPEED: 2.0, ARROW_SPEED: 8, ARROW_LIFE: 3, ARROW_RADIUS: 0.15, ELITE_FAN_DEG: 8 };
export const RAT = { HP: 1, SPEED: 4.2, DMG: 1, RANGE: 0.9, PACK_MIN: 2, PACK_MAX: 3, CAP: 6 };
export const BRUTE = { HP: 8, SPEED: 1.2, DMG: 3, RANGE: 2.4, CONE_RAD: 0.87 };
export const WRAITH = { HP: 2, SPEED: 2.4, DMG: 1, RANGE: 0.9 };

export const ENEMY_TYPES = {
  SKELETON: { hp: 2, speed: 2.6, dmg: 1, range: 1.6, cycle: { windup: 0.35, swing: 0.25, recover: 0.4, cooldown: 1.2 }, drops: 1, eliteEligible: false },
  MAGICIAN: { hp: 2, speed: 2.6, dmg: 1, range: 9, ranged: 'orb', stopFrac: 0.6, cycle: { windup: 0.35, swing: 0.25, recover: 0.4, cooldown: 1.2 }, drops: 1, eliteEligible: false },
  ARMORED:  { hp: 5, speed: 1.8, dmg: 2, range: 0.85, cycle: { windup: 0.5, swing: 0.3, recover: 0.5, cooldown: 1.6 }, drops: 2, eliteEligible: true, elite: { name: 'Warlord', hp: 10, speedMult: 1.3, drops: 3 } },
  ARCHER:   { hp: 2, speed: 2.4, dmg: 1, range: 10, ranged: 'arrow', kiteStop: 8, retreatUnder: 4, retreatSpeed: 2.0, projectile: { speed: 8, life: 3, radius: 0.15 }, cycle: { windup: 0.5, swing: 0.1, recover: 0.4, cooldown: 1.8 }, drops: 1, eliteEligible: true, elite: { name: 'Sharpshooter', hp: 2, speedMult: 1.0, drops: 2, fanDeg: 8 } },
  RAT:      { hp: 1, speed: 4.2, dmg: 1, range: 0.9, pack: [2, 3], instantAttack: true, attackCooldown: 0.8, drops: 0, eliteEligible: false },
  BRUTE:    { hp: 8, speed: 1.2, dmg: 3, range: 2.4, coneRad: 0.87, shockwave: true, cycle: { windup: 1.2, swing: 0.3, recover: 1.2, cooldown: 2.5 }, drops: 3, eliteEligible: true, elite: { name: 'Ogre', hp: 16, speedMult: 1.2, drops: 4, scale: 1.9 } },
  WRAITH:   { hp: 2, speed: 2.4, dmg: 1, range: 0.9, phases: true, instantAttack: true, attackCooldown: 1.0, drops: 2, eliteEligible: true, elite: { name: 'Banshee', hp: 4, speedMult: 1.4, drops: 3 } }
};

// Spawn weights per biome (sum 100): Skeleton, Magician, Armored, Archer, Rat, Brute, Wraith
export const ENEMY_SPAWN_WEIGHTS = {
  STONE:            { SKELETON: 45, MAGICIAN: 10, ARMORED: 15, ARCHER: 15, RAT: 10, BRUTE: 5,  WRAITH: 0 },
  HAUNTED_CRYPT:    { SKELETON: 25, MAGICIAN: 10, ARMORED: 10, ARCHER: 15, RAT: 5,  BRUTE: 5,  WRAITH: 30 },
  FUNGAL_CAVERN:    { SKELETON: 30, MAGICIAN: 10, ARMORED: 10, ARCHER: 5,  RAT: 40, BRUTE: 5,  WRAITH: 0 },
  VOLCANIC_DEPTHS:  { SKELETON: 20, MAGICIAN: 10, ARMORED: 25, ARCHER: 15, RAT: 10, BRUTE: 20, WRAITH: 0 },
  FROZEN_HALLS:     { SKELETON: 25, MAGICIAN: 10, ARMORED: 20, ARCHER: 25, RAT: 10, BRUTE: 10, WRAITH: 0 },
  CRYSTAL_DEPTHS:   { SKELETON: 30, MAGICIAN: 15, ARMORED: 15, ARCHER: 20, RAT: 10, BRUTE: 10, WRAITH: 0 },
  POISON_SWAMP:     { SKELETON: 15, MAGICIAN: 10, ARMORED: 10, ARCHER: 10, RAT: 45, BRUTE: 10, WRAITH: 0 },
  GOLDEN_TEMPLE:    { SKELETON: 20, MAGICIAN: 10, ARMORED: 25, ARCHER: 20, RAT: 10, BRUTE: 15, WRAITH: 0 },
  FLOODED_RUINS:    { SKELETON: 20, MAGICIAN: 15, ARMORED: 10, ARCHER: 15, RAT: 25, BRUTE: 15, WRAITH: 0 },
  EMBER_FORGE:      { SKELETON: 10, MAGICIAN: 10, ARMORED: 25, ARCHER: 15, RAT: 5,  BRUTE: 35, WRAITH: 0 },
  SPECTRAL_COURT:   { SKELETON: 40, MAGICIAN: 15, ARMORED: 15, ARCHER: 15, RAT: 5,  BRUTE: 10, WRAITH: 0 }
};

export const ELITE_CHANCE = 0.1;

export const ENEMY_SPAWN = {
  SPAWN_INTERVAL: 0.5,
  MAX_ALIVE: 200,
  SPAWN_CAP: 100,          // spawnMult capped at ×100
  EXCESS_HP_PER_10: 1.5,   // past cap: +150% HP per 10 excess (linear)
  SPAWN_PLAYER_DIST: 30,   // spawns only > 30 m from player
  DEFER_PLAYER_DIST: 30,   // queued spawn within 30 m rotates back
  FROZEN_DIST: 40,         // mobs > 40 m frozen immobile
  BFS_MIN_FROM_ENTRANCE: 6,
  PATH_REEVAL: 0.3,
  SUBSTEP: 0.08,
  LOS_STEP: 0.4,
  LOS_RADIUS: 0.25
};

// Speed/attack scaling. §16.1
export const SPEED_PER_LEVEL = 0.02;
export const ATTACK_PER_3_LEVELS = 0.05;
export const BOSS_KILL_BUFF = 0.1;

export const SWORD = {
  RANGE: 2.2,
  ELECTRIC_CHANCE: 0.05,     // kept at SWORD level (gotcha §27)
  ELECTRIC_DAMAGE_MULT: 5,
  ELECTRIC_RANGE: 20,
  ARC_POOL: 8,
  ARC_MAX_FLIGHT: 6,
  ARC_SPEED: 24,
  ARC_LIFE: 1.2,
  ARC_TARGET_RANGE: 20,
  HIT_STOP: 0.06,
  BLADE_FLASH: 0.1
};

export const SWORD_COMBO = [
  { windup: 0.10, swing: 0.16, recover: 0.14, damage: 2, arcDot: Math.cos(0.38 * Math.PI), thrust: false },
  { windup: 0.08, swing: 0.15, recover: 0.14, damage: 2, arcDot: Math.cos(0.38 * Math.PI), thrust: false },
  { windup: 0.12, swing: 0.18, recover: 0.20, damage: 3, arcDot: Math.cos(0.09 * Math.PI), thrust: true, rangeMult: 1.25 }
];
export const COMBO_WINDOW = 0.34;      // from each recover start
export const COMBO_COOLDOWN = 0.30;

export const HIT_STOP = { swordHit: 0.06, electricChain: 0.12, evolution: 0.1 };

export const EVOLUTION = {
  TIER_THRESHOLDS: [50, 100, 200, 400, 800],
  TIER_NAMES: ['Dagger', "Knight's Arming Sword", 'Runic Greatsword', 'Crystal Soulblade', 'White-Hot Soulfire Greatblade', 'Lightsaber'],
  TIER_EFFECTS: [
    '5% electric blast',
    '—',
    '—',
    'arc bolts 10%',
    'arc bolts 35%',
    'double arc bolts · idle crackle · electric blast'
  ]
};

// weaponTier(souls): ceiling over thresholds. Pure.
export function weaponTier(souls) {
  let t = 0;
  for (let i = 0; i < EVOLUTION.TIER_THRESHOLDS.length; i++) if (souls >= EVOLUTION.TIER_THRESHOLDS[i]) t = i + 1;
  return t;
}
export const MAX_TIER = 5;

// Damage ladder: base per step + tier. Pure.
export function swordHitDamage(step, tier) { return SWORD_COMBO[step].damage + tier; }

// damageMult composition: size part × tier part × level part. §9.2
export function damageMult(scale, tier, level) {
  return (1 + (scale - 1) * 0.5) * Math.pow(1.1, tier) * Math.pow(1.1, Math.floor(level / 5));
}

// Sword SIZE ladder: tier-driven only (+80%/tier, ×5 at T5). Orbs never drive size. §9.2
export const MAX_TOTAL_SCALE = 5.0;
export function swordSizeScale(tier) { return 1 + 0.8 * tier; }

export function totalSwordScale(tier, lengthMult = 1) {
  return Math.min(swordSizeScale(tier) * lengthMult, MAX_TOTAL_SCALE);
}

// Attack speed: buffs × souls component. §9.2
export function attackSpeedFromSouls(souls) { return 1 + 0.001 * souls; }

// Orb weapon economy. §10
export const ORB_WEAPON = {
  STEP_INTERVAL: 0.22,
  SEQUENCE_WINDOW: 1.2,
  SPEED: 12.4,
  LIFE: 2.5,
  RADIUS: 0.3,
  BASE_DAMAGE: 2,
  EXPLODE_DAMAGE: 5,
  EXPLODE_RADIUS: 2,
  EXPLODE_Y_GATE: 2.6,
  BOUNCES: 3,
  POOL_NORMAL: 48,
  POOL_FIREBALL: 6,
  FIREBALL_COOLDOWN: 0.35
};

export function orbDamageMultiplier(orbs) { return 1 + 0.02 * orbs; }
export function orbDirectDamage(orbs) { return Math.round(ORB_WEAPON.BASE_DAMAGE * orbDamageMultiplier(orbs)); }
export function orbExplodeDamage(orbs) { return Math.round(ORB_WEAPON.EXPLODE_DAMAGE * orbDamageMultiplier(orbs)); }

// Arc bolt chances per tier (index by tier; 0-2 none). §9.3
export const ARC_CHANCE = [0, 0, 0, 0.10, 0.35, 1.0];
export const ARC_BOLTS = [0, 0, 0, 1, 1, 2];

export const BUFF = {
  CHANCE: 0.06,
  EXCESS_ORB_BONUS: 0.0005, // +0.05% per orb above 100
  EXCESS_ORB_THRESHOLD: 100,
  ORB_DROP_CHANCE: 0.20,
  ORB_DROP_MIN: 1,
  ORB_DROP_MAX: 5,
  MAX_DURATION: 90,
  BOSS_DURATION: 300,
  CARRY_MULT: 5
};

export const HUNTER = {
  HP: 9999,
  FOLLOW_SPEED: 6.5,
  KEEP_DIST: 2.5,
  ATTACK_RANGE: 7,
  BEAM_DMG: 2,
  BEAM_FLASH: 0.35
};

export const DROP = {
  VISUAL_LIFE: 1,
  HEALTH_CHANCE: 0.15,
  HEALTH_RESTORE: 3,
  PICKUP_RADIUS: 1.4
};

export const PROPS = {
  MAX_PER_LEVEL: 400,
  BREAKABLES_PER_ROOM: 3,
  BREAKABLE_HP: 1,
  STEP_BREAK_DIST: 0.45,
  SARCOPHAGUS_TRIGGER: 2.5,
  SARCOPHAGUS_WRAITH: 0.3,
  DEBRIS_PER_CELL: 0.2,   // ~1/cell cut 80%
  POOLS: {
    STALACTITES: 60,
    WATER_POOLS: 24
  },
  PROPS_PER_ROOM: {
    CHAMBER: ['rubble', 'bones'],
    HALL: [],
    VAULT: ['water', 'godRays'],
    ARMORY: ['rack', 'breakable'],
    LIBRARY: ['shelf', 'books'],
    CRYPT: ['sarcophagus', 'wisp?'],
    MUSHROOM_GROVE: ['mushrooms'],
    ARENA: ['pillars'],
    CRYSTAL_CHAMBER: ['crystals'],
    TEMPLE: ['altar', 'brazier']
  }
};

export const LIGHT_SOURCES = {
  TORCH: { intensity: 0.9, distance: 16, decay: 1.15, shadow: false },
  BRAZIER: { intensity: 1.1, distance: 18, decay: 1.15, shadow: false },
  CRYSTAL: { intensity: 1.4, distance: 14, decay: 1.2, shadow: false },
  MUSHROOM: { intensity: 3.2, distance: 12, decay: 1.2, shadow: false }, // binding §7.3
  MARKER_START: { intensity: 1.0, distance: 10, decay: 1.4, shadow: false },
  MARKER_EXIT: { intensity: 1.6, distance: 16, decay: 1.3, shadow: false },
  WISP: { intensity: 1.0, distance: 10, decay: 1.3, shadow: false },
  SWORD_EXTRA_T5: { intensity: 0.9, distance: 8, decay: 1.4, shadow: false }
};

export const LIGHT_CEILING = { AVG: 154, MAX: 199 };
export const TORCH_SHADOW_COUNT = 1;

export const TIMED_RUN = { LEVEL_TIME_LIMIT: 180 };

export const HAZARD = {
  TICK: 0.8,
  DAMAGE: 1,
  INNER_RADIUS: 1.2,
  EXIT_CLEARANCE: 3
};

export const LEADERBOARD_SIZE = 10;
export const SAVE_KEY = 'dungeonCrawlerSave';
export const SAVE_SERVER = 'http://localhost:5174';

/**
 * Constants.js — every magic number from SPEC.md, named exports only.
 * Any number appearing elsewhere in the codebase must come from here.
 */

// ---------------------------------------------------------------------------
// §3 Player Ship (base, pre-upgrades)
// ---------------------------------------------------------------------------

/** Player hull / shield / speed / weapon / cargo / collision stats. */
export const PLAYER = {
  /** Hull HP (no regen; repaired at stations). */
  hull: 100,
  /** Shield pool; regenerates after SHIELD_DELAY_S without a hit. */
  shield: 50,
  /** Shield regen rate, points/s. */
  shieldRegen: 10,
  /** Seconds without a hit before shield regen starts. */
  shieldDelay: 3,
  /** Max speed, u/s (boost multiplies this). */
  maxSpeed: 80,
  /** Boost speed multiplier (user feedback: exactly ×2 max speed). */
  boostMultiplier: 2,
  /** Accel, u/s². */
  accel: 60,
  /** Linear drag coefficient, 1/s. */
  drag: 0.5,
  /** Collision radius, u. */
  radius: 2.5,
  /** Cargo slots (scrap stacks, items 1 slot each). */
  cargoMax: 50,
  weapon: {
    /** "Pulse Autocannon" damage per hit. */
    damage: 10,
    /** Shots per second. */
    rate: 6,
    /** Projectile speed, u/s. */
    projectileSpeed: 1500,
    /** Projectile lifetime, s. */
    projectileLife: 1.6,
  },
  /** Screen shake duration on player hit, s. */
  shakeDuration: 0.15,
  /** Player invulnerability window after taking a hit, s (SPEC §4). */
  invuln: 0.75,
};

// ---------------------------------------------------------------------------
// §2 Controls
// ---------------------------------------------------------------------------

/** Input rates / thresholds (all binds are `event.code`, AZERTY-safe). */
export const CONTROLS = {
  /** Ship nose-turn rate toward the cursor, rad/s (mouse aim steering). */
  turnRate: 2.4,
  /**
   * Aim damping: when the angular error between nose and cursor drops below
   * this, the turn rate decays so the ship settles straight onto the aim
   * (no perpetual circling around the target). rad.
   */
  aimDampStart: 0.12,
  /** Angular error where damping reaches full stop, rad (nose holds course). */
  aimDampEnd: 0.02,
  /**
   * Nose-straighten rate: when the cursor is idle, the ship noses back
   * toward its velocity vector at this angular rate (rad/s) — after ~1 s
   * of no aim input the ship flies straight along its trajectory.
   */
  straightenRate: 1.0,
  /** Straighten kicks in only below this angular error to velocity, rad. */
  straightenMaxError: 0.5,
  /** Roll rate, rad/s (KeyQ / KeyE flourish). */
  rollRate: 2.8,
  /** Throttle step per scroll notch (0..1 range). */
  wheelStepPerNotch: 0.12,
  /** Throttle ease rate toward target, /s. */
  throttleSmooth: 3.0,
  /** Retro-burn deceleration factor per second (scroll fully down). */
  brakeDecel: 1.6,
  /** Mouse camera-orbit rate, rad per px (MMB held free-look). */
  mouseOrbitRate: 0.0032,
  /** Free-look pitch clamp, rad. */
  orbitPitchMax: 1.2,
  /** Orbit ease-back rate to chase position after release, /s. */
  orbitReturn: 4,
  /** Boost cooldown, s (user feedback: 2× longer to recharge). */
  boostCooldown: 8,
  /** Boost burn time, s (user feedback: 3× longer effect). */
  boostDuration: 4.5,
  /** Bank/interact range at stations, u. */
  bankRadius: 120,
};

/** Chase camera (chase, offset behind ship). */
export const CAMERA = {
  /** Offset behind ship in ship-local space (x, y, z). */
  offsetX: 0,
  offsetY: 3.2,
  offsetZ: -9,
  /** Position lerp rate, 1/s. */
  lerp: 8,
  /** FOV at zero throttle, degrees. */
  fovMin: 72,
  /** FOV at full throttle, degrees. */
  fovMax: 95,
  /** FOV kick added while boosting, degrees. */
  boostKick: 4,
  /** Turret mode: camera lift above the ship (u) — ship sits low in frame. */
  turretLift: 6,
  /** Turret-mode camera distance behind the ship, u. */
  turretDist: 18,
  /** Turret mode: aim-point distance in front of the camera, u (cursor ray). */
  turretAimDist: 400,
  /** Turret mode: aim smoothing rate, 1/s (higher = snappier). */
  turretAimSmooth: 6,
};

/**
 * Secondary weapon attacks (SPEC: 3-attack loadout).
 *   pulse  — KeyF autocannon (baseline, PLAYER.weapon);
 *   iem    — KeyC AoE burst around the ship, then system shutdown (cooldown);
 *   missiles — KeyV 5-missile autoguided volley (homing, proximity fuse).
 */
export const WEAPON_ATTACKS = {
  iem: {
    /** Effect radius around the ship, u. */
    radius: 160,
    /** Damage per enemy caught in the burst (kills drones/interceptors). */
    damage: 60,
    /** Shutdown after firing, s. */
    cooldown: 5,
  },
  missiles: {
    /** Missiles per volley. */
    count: 5,
    /** Damage per missile hit. */
    damage: 45,
    /** Missile speed, u/s. */
    speed: 300,
    /** Missile lifetime, s. */
    life: 5,
    /** Homing turn rate, rad/s. */
    turnRate: 3.5,
    /** Proximity fuse radius, u (added to target radius). */
    hitRadius: 4,
    /** Cooldown between volleys, s. */
    cooldown: 6,
    /** Gap between the 3 salvos of one volley, s. */
    salvoGap: 0.5,
  },
};

// ---------------------------------------------------------------------------
// §3 Hit feedback
// ---------------------------------------------------------------------------

/** Feedback timing values. */
export const FEEDBACK = {
  /** Screen shake duration on landing (non-player) hits, s. */
  landingShakeDuration: 0.06,
  /** Enemy hit white-flash duration, s. */
  hitFlashDuration: 0.1,
};

// ---------------------------------------------------------------------------
// §5 World, Chunks & Ladder
// ---------------------------------------------------------------------------

/** Chunk cube edge length, u. */
export const CHUNK_SIZE = 2500;

/** Chunks loaded within this Manhattan-ish radius (5×5×3 region around ship). */
export const LOAD_RADIUS = 2;

/** Chunks unloaded only beyond this radius (hysteresis). */
export const UNLOAD_RADIUS = 3;

/**
 * The SUN (user feedback: distance needs a reference point). The sun sits at
 * the world origin; the player spawns NEAR it (SUN.spawnDistance away, not
 * inside it) and the HUD distance is measured from it (position length).
 * The sun is always visible from afar (screen-space marker sprite) so the
 * player always has an orientation reference.
 */
export const SUN = {
  /** Core sphere radius, u — the biggest entity in the game. */
  coreRadius: 1200,
  /** Player spawn distance from the sun (near it, not inside it), u. */
  spawnDistance: 3000,
  /** Screen-space marker size (fraction of viewport height, always visible). */
  markerScreenSize: 0.05,
  /** Marker color. */
  color: 0xffd27a,
};

/**
 * Sector table (SPEC §5, distances ×3 per user feedback — endgame should be
 * a long haul). Ranges are in u along the ladder; voids are empty travel
 * sectors between content sectors. `mult` is the enemy stat scale
 * `1 + 0.25 × (sector − 1)` capped at sector 6 — voids reuse the mult of the
 * adjacent content sector per spec table.
 */
export const SECTORS = [
  { key: 'open-space',  name: 'Open Space',            start: 0,     end: 9000,   mult: 1.0, palette: 'blue-grey' },
  { key: 'void-1',      name: 'Void',                  start: 9000,  end: 12000,  mult: 1.0, palette: 'near-black' },
  { key: 'asteroid-belt', name: 'Asteroid Belt',     start: 12000, end: 24000,  mult: 1.2, palette: 'rust-orange' },
  { key: 'void-2',      name: 'Void',                  start: 24000, end: 28500,  mult: 1.2, palette: 'near-black' },
  { key: 'crystal-fields', name: 'Crystal Fields',    start: 28500, end: 42000,  mult: 1.5, palette: 'cyan-magenta' },
  { key: 'void-3',      name: 'Void',                  start: 42000, end: 48000,  mult: 1.5, palette: 'near-black' },
  { key: 'plasma-storm', name: 'Plasma Storm',        start: 48000, end: 63000,  mult: 2.0, palette: 'teal' },
  { key: 'void-4',      name: 'Void',                  start: 63000, end: 70500,  mult: 2.0, palette: 'near-black' },
  { key: 'derelict-graveyard', name: 'Derelict Graveyard', start: 70500, end: 85500, mult: 2.5, palette: 'amber' },
  { key: 'void-5',      name: 'Void',                  start: 85500, end: 94500,  mult: 2.5, palette: 'near-black' },
  { key: 'the-forge',   name: 'THE FORGE',            start: 94500, end: 120000, mult: 3.0, palette: 'red-gold' },
  { key: 'the-abyss',   name: 'THE ABYSS',            start: 120000, end: 150000, mult: 3.5, palette: 'void-purple' },
  { key: 'dead-star-reach', name: 'DEAD STAR REACH',  start: 150000, end: 190000, mult: 4.0, palette: 'dead-star' },
  { key: 'ship-graveyard', name: 'THE SHIP GRAVEYARD', start: 190000, end: 230000, mult: 4.5, palette: 'bone-rot' },
  { key: 'the-end',     name: 'THE END',              start: 230000, end: Infinity, mult: 1.0, palette: 'the-end' },
];

/** Linear stat scaling: `stat × (1 + 0.25 × (sector − 1))`, capped at sector 6. */
export const SECTOR_SCALING = {
  /** Per-sector linear increment. */
  step: 0.25,
  /** Sector index at which scaling caps. */
  capSector: 6,
};

/** Per-chunk content density (content sectors only). */
export const CHUNK_CONTENT = {
  /** Landmarks per chunk. */
  landmarks: 1,
  /** Enemy groups per chunk, min (user feedback: more enemies — the world
      should feel populated). */
  enemyGroupsMin: 4,
  /** Max enemy groups per chunk. */
  enemyGroupsMax: 8,
  /** Loot clusters per chunk, min. */
  lootClustersMin: 1,
  /** Loot clusters per chunk, max. */
  lootClustersMax: 2,
  /** Station spawn chance per content chunk (user feedback: 5× rarer —
      stations are rare waypoints, ~1 per 25 chunks of travel). */
  stationChance: 0.0025,
  /** Derelict decoration cap in void chunks. */
  voidDerelicts: 1,
  /** Rare loot cache chance in void chunks (the "void treasure" hook). */
  voidTreasureChance: 0.05,
};

// ---------------------------------------------------------------------------
// §4 Enemies (7 total; MVP ships first 3)
// ---------------------------------------------------------------------------

/** Aggro radius, u — raised per user feedback (enemies too passive/rare
    feeling): dormant enemies wake and engage from further out. */
export const AGGRO_RADIUS = 700;

/**
 * World spawn safe zone, u — radius around the world spawn (player spawn)
 * where NO threats exist: enemies never wake here and no hostiles spawn
 * inside it. Lets the player get oriented before the fight starts.
 */
export const WORLD_SAFE_RADIUS = 1200;

/** Enemy stat table (SPEC §4). */
export const ENEMIES = {
  drone: {
    sector: 1,
    hp: 15,
    damage: 5,
    damageType: 'contact',
    speed: 60,
    /** Swarm size, min. */
    swarmMin: 4,
    /** Swarm size, max. */
    swarmMax: 6,
    behavior: 'seek-contact',
  },
  interceptor: {
    sector: 1,
    hp: 40,
    damage: 12,
    damageType: 'shot',
    speed: 55,
    /** Approach / orbit distance, u. */
    orbitRadius: 250,
    /** Shots per second. */
    fireRate: 1.5,
    behavior: 'orbit-fire',
  },
  rammer: {
    sector: 2,
    hp: 25,
    damage: 25,
    damageType: 'explode',
    speed: 90,
    /** Detonation radius, u. */
    explodeRadius: 20,
    /** Detonation trigger distance, u. */
    detonateDistance: 5,
    behavior: 'charge-detonate',
  },
  frigate: {
    sector: 3,
    hp: 150,
    damage: 20,
    damageType: 'heavy-shot',
    speed: 8,
    /** Shot interval, 1/s. */
    fireRate: 0.8,
    /** Turret body radius, u. */
    radius: 8,
    behavior: 'stationary-turret',
  },
  sniper: {
    sector: 4,
    hp: 35,
    damage: 30,
    damageType: 'rail',
    speed: 45,
    /** Cloak opacity when beyond cloakRange. */
    cloakOpacity: 0.15,
    /** Cloaks beyond this range, u. */
    cloakRange: 600,
    /** Beam telegraph before firing, s. */
    telegraph: 0.8,
    /** Fire interval, s. */
    fireInterval: 4,
    behavior: 'cloak-rail',
  },
  sentinel: {
    /** Mini-boss; per sector exit. */
    boss: true,
    hp: 400,
    hpPerSector: 400,
    damage: 25,
    damageType: 'mixed',
    speed: 35,
    /** Summoned drone count per attack. */
    summonCount: 4,
    dropsGuaranteedRare: true,
    behavior: 'spread-burst-summon',
  },
  golden: {
    sector: 1,
    hp: 200,
    damage: 0,
    damageType: 'none',
    speed: 120,
    behavior: 'flee',
    bountyScrap: 250,
  },
  warden: {
    /** Finale boss, sector 6. */
    boss: true,
    sector: 6,
    hp: 3000,
    damage: 40,
    damageType: 'mixed',
    speed: 30,
    /** Phase order: barrage → minefield + drones → enrage beams. */
    phases: ['barrage', 'minefield-drones', 'enrage-beams'],
    behavior: 'three-phase',
    /** Core sphere radius, u. */
    coreRadius: 10,
    /** Armor ring segment count (torus arcs). */
    ringSegments: 3,
    /** Beam emitter cone count. */
    emitterCones: 2,
    /** Enrage beam damage rate, /s (while player within beam radius). */
    beamDps: 15,
    /** Enrage beam damage radius (distance to beam axis), u. */
    beamRadius: 12,
    /** Enrage beam reach from the warden core, u. */
    beamLength: 220,
    /** Enrage beam sweep speed, rad/s. */
    beamSweep: 1.1,
    /** Barrage volley size (rapid 3-shot). */
    volleyShots: 3,
    /** Barrage volley interval, s. */
    volleyInterval: 1.2,
    /** Minefield-drones phase summon interval, s (every 8 s). */
    summonInterval: 8,
    /** Minefield-drones phase radial burst shot count. */
    radialShots: 8,
    /** Warden projectile speed, u/s. */
    shotSpeed: 320,
    /** Warden keep-distance from the player, u. */
    keepDistance: 200,
  },
  // Chrome Sentinels (user feedback: endemic enemy of THE ABYSS) — mirror
  // alien ships that hunt in fleets of 5, wing-formation strafing runs.
  chrome: {
    sector: 7,
    hp: 90,
    damage: 18,
    damageType: 'shot',
    speed: 130,
    /** Fleet size (fixed: 5 ships per spawn). */
    fleetSize: 5,
    /** Approach distance before strafing runs, u. */
    orbitRadius: 180,
    fireRate: 2.2,
    /** Strafe weave frequency, rad/s. */
    weaveFreq: 2.5,
    behavior: 'fleet-strafe',
  },
};

/** THE FORGE finale-arena layout values (SPEC §5 sector 6, P9).
 *  position ×3 with the sector ladder (was 32000). */
export const WARDEN_ARENA = {
  /** Fixed arena position: warden spawn offset beyond the sector start. */
  position: 96000,
  /** Forge decoration collision damage to the player, points. */
  structureCollisionDamage: 20,
  /** Forge decoration collision radius, u (big megastructure boxes/arcs). */
  structureRadius: 30,
};

// ---------------------------------------------------------------------------
// §6 Loot, Items & Magnetism
// ---------------------------------------------------------------------------

/** Fixed tier colors. */
export const TIERS = {
  common: '#b8c4cc',
  uncommon: '#4ade80',
  rare: '#38bdf8',
  exotic: '#fbbf24',
};

/**
 * 22-item catalog (SPEC §6). `weight` is the base weight in the generic drop
 * table; per-source drop tables in LootSystem reference these ids with their
 * own explicit weights. Exotics ≤ 2% outside scripted drops.
 */
export const ITEMS = [
  // --- Common (7) ---
  { id: 'scrap',              name: 'Scrap',                  tier: 'common',   weight: 100 },
  { id: 'salvage_plate',    name: 'Salvage Plate',          tier: 'common',   weight: 40 },
  { id: 'coolant',          name: 'Coolant',                tier: 'common',   weight: 40 },
  { id: 'ammo_cell',        name: 'Ammo Cell',              tier: 'common',   weight: 40 },
  { id: 'hull_patch',       name: 'Hull Patch',             tier: 'common',   weight: 30 },
  { id: 'fuel_skip',        name: 'Fuel Skip',              tier: 'common',   weight: 30 },
  { id: 'data_fragment',   name: 'Data Fragment',            tier: 'common',   weight: 30 },
  // --- Uncommon (7) ---
  { id: 'shield_cell',      name: 'Shield Cell',              tier: 'uncommon', weight: 25 },
  { id: 'mod_fire_rate',  name: 'Weapon Mod: Fire Rate',    tier: 'uncommon', weight: 20 },
  { id: 'mod_damage',     name: 'Weapon Mod: Damage',       tier: 'uncommon', weight: 20 },
  { id: 'mod_engine',     name: 'Engine Mod',               tier: 'uncommon', weight: 20 },
  { id: 'magnet_coil',    name: 'Magnet Coil',              tier: 'uncommon', weight: 15 },
  { id: 'trade_chip',     name: 'Trade Chip',               tier: 'uncommon', weight: 15 },
  { id: 'mystery_crate',  name: 'Mystery Crate',            tier: 'uncommon', weight: 10 },
  // --- Rare (5) ---
  { id: 'mod_split_beam', name: 'Weapon Mod: Split Beam',   tier: 'rare',     weight: 6 },
  { id: 'mod_homing',     name: 'Weapon Mod: Homing',       tier: 'rare',     weight: 6 },
  { id: 'core_overclock', name: 'Core: Overclock',          tier: 'rare',     weight: 4 },
  { id: 'core_aegis',     name: 'Core: Aegis',              tier: 'rare',     weight: 4 },
  { id: 'station_voucher', name: 'Station Voucher',         tier: 'rare',     weight: 3 },
  // --- Exotic (3) — ≤ 2% except scripted drops ---
  { id: 'warden_shard',   name: 'Warden Shard',             tier: 'exotic',   weight: 1.5 },
  { id: 'void_relic',     name: 'Void Relic',               tier: 'exotic',   weight: 1 },
  { id: 'golden_drone',   name: 'Golden Drone',             tier: 'exotic',   weight: 0.5 },
];

/** Item behavior values. */
export const ITEM_EFFECTS = {
  /** Base pickup radius, u. */
  pickupRadius: 8,
  /** Base magnet radius, u (Magnet Coil adds magnetRadiusBonus). */
  magnetRadius: 30,
  /** Magnet pull speed, u/s (pickups fly toward player at this rate). */
  magnetSpeed: 120,
  /** Magnet Coil pickup radius bonus, u. */
  magnetRadiusBonus: 5,
  /** Trade Chip scrap multiplier. */
  tradeChipMultiplier: 1.25,
  /** Trade Chip duration, s. */
  tradeChipDuration: 60,
  /** Golden Drone: flees with this HP and a huge bounty. */
  goldenDroneHp: 200,
  /** Exotic rarity beam: beacon + spawn shockwave. */
  rarityBeamVisible: 800,
  /** Max active exotic beacon dynamic lights. */
  exoticBeaconLightsMax: 2,
  /** Loot cluster pickup count, min. */
  clusterMin: 3,
  /** Loot cluster pickup count, max. */
  clusterMax: 6,
  /** Loot cluster scatter radius, u. */
  clusterRadius: 40,
  /** Collection log total types. */
  collectionSize: 22,
  /** Exotics cap in generic drop weights, % (except scripted drops). */
  exoticWeightCap: 2,
};

// ---------------------------------------------------------------------------
// §7 Hangar (meta, localStorage key `void_warband_meta`)
// ---------------------------------------------------------------------------

/**
 * Station TRADING (user feedback: interacting with a base opens a shop —
 * pause — to install up to 3 modules from the collectibles, or sell them;
 * plus a BUY tab spending banked scrap on fresh modules). Full definition
 * with buy prices lives near ITEM_BUFFS below; this anchor comment kept for
 * the section header.
 */
/**
 * ITEM BUFFS (user feedback: ALL 22 items give a buff — carrying cargo gives
 * the PASSIVE value; INSTALLING it (station, ≤3 modules) gives the STRONG
 * installed value. `scrap` is currency-only).
 * Keys map onto GameState._statValue / weaponRate / LootSystem / sell math:
 *   hull, shield, weaponDamage, maxSpeed — stat points
 *   weaponRate — shots/s
 *   pickupRadius — extra pickup+magnet radius, u
 *   shieldRegen — extra regen points/s
 *   sellBonus — % extra scrap when selling at the station
 */
export const ITEM_BUFFS = {
  // --- Common ---
  salvage_plate:   { hull: 4,  hullInstalled: 12 },
  coolant:         { shieldRegen: 2, shieldRegenInstalled: 6 },
  ammo_cell:       { weaponRate: 0.5, weaponRateInstalled: 1.5 },
  hull_patch:      { hull: 5,  hullInstalled: 15 },
  fuel_skip:       { maxSpeed: 4, maxSpeedInstalled: 12 },
  data_fragment:   { weaponDamage: 1, weaponDamageInstalled: 3 },
  // --- Uncommon ---
  shield_cell:     { shield: 5, shieldInstalled: 20 },
  mod_fire_rate:   { weaponRate: 1, weaponRateInstalled: 3 },
  mod_damage:      { weaponDamage: 4, weaponDamageInstalled: 12 },
  mod_engine:      { maxSpeed: 8, maxSpeedInstalled: 24 },
  magnet_coil:     { pickupRadius: 4, pickupRadiusInstalled: 12 },
  trade_chip:      { sellBonus: 5, sellBonusInstalled: 20 },    // % sell value
  mystery_crate:   { weaponDamage: 2, weaponDamageInstalled: 6, hull: 2, hullInstalled: 6 },
  // --- Rare ---
  mod_split_beam:  { weaponDamage: 6, weaponDamageInstalled: 18, weaponRate: 0.5, weaponRateInstalled: 1.5 },
  mod_homing:      { weaponDamage: 3, weaponDamageInstalled: 10, maxSpeed: 4, maxSpeedInstalled: 10 },
  core_overclock:  { weaponRate: 1, weaponRateInstalled: 3, weaponDamage: 3, weaponDamageInstalled: 8 },
  core_aegis:      { hull: 10, hullInstalled: 30, shield: 10, shieldInstalled: 30 },
  station_voucher: { sellBonus: 10, sellBonusInstalled: 30 },   // % sell value
  // --- Exotic ---
  warden_shard:    { weaponDamage: 10, weaponDamageInstalled: 30, shield: 5, shieldInstalled: 15 },
  void_relic:      { shieldRegen: 4, shieldRegenInstalled: 12, maxSpeed: 6, maxSpeedInstalled: 18 },
  golden_drone:    { pickupRadius: 6, pickupRadiusInstalled: 20, sellBonus: 10, sellBonusInstalled: 30 },
};

/**
 * Station TRADING (user feedback: interacting with a base opens a shop —
 * pause — to install up to 3 modules from the collectibles, or sell them;
 * plus a BUY tab spending banked scrap on fresh modules).
 */
export const TRADE = {
  /** Max distinct installed items at once. */
  installMax: 3,
  /** Sell value per item tier, scrap (× (1 + sellBonus/100) buffs). */
  sellValue: { common: 10, uncommon: 25, rare: 60, exotic: 150 },
  /** Shop buy price per item tier, scrap (≈ 2.5× sell value). */
  buyPrice: { common: 30, uncommon: 70, rare: 160, exotic: 400 },
};

/** Back-compat alias (legacy references to per-item install bonuses). */
export const ITEM_INSTALL_BONUS = ITEM_BUFFS;

/**
 * SHIPS (user feedback: 3 purchasable ships at the station).
 * Multipliers are relative to the base PLAYER stats / drop tables.
 * `enemySpawnMult` is the aggression malus (more enemies spawn).
 * `boostCharges` — simultaneous boost burns before the shared cooldown.
 * `reflectShield` — fraction of received damage bounced back to the attacker.
 * `scale` — visual mesh scale (bigger hull).
 */
export const SHIPS = [
  {
    id: 'explorer',
    name: 'Explorer',
    price: 300,
    color: 0xff3b30,
    desc: 'Cheap red scout — fastest hull (×3.5 speed), ×2 damage, 2 boost charges. Aggravates swarms (×2 spawns).',
    damageMult: 2,
    speedMult: 3.5,
    shieldMult: 1,
    lootMult: 1,
    pickupMult: 1,
    enemySpawnMult: 2,
    boostCharges: 2,
    reflectShield: 0,
    scale: 1,
  },
  {
    id: 'fighter',
    name: 'Fighter',
    price: 600,
    color: 0x4a90d9,
    desc: 'Bigger gunship — more shield, ×1.5 speed, ×2 damage, ×2 enemy loot. Malus ×2 spawns.',
    damageMult: 2,
    speedMult: 1.5,
    shieldMult: 1.5,
    lootMult: 2,
    pickupMult: 1,
    enemySpawnMult: 2,
    boostCharges: 1,
    reflectShield: 0,
    scale: 1.3,
  },
  {
    id: 'flagship',
    name: 'Flagship',
    price: 1200,
    color: 0xfbbf24,
    desc: 'Heavy cruiser — ×3 speed, ×3 damage, ×2 pickup range, damage-reflecting shield. Malus ×3 spawns.',
    damageMult: 3,
    speedMult: 3,
    shieldMult: 1.5,
    lootMult: 1,
    pickupMult: 2,
    enemySpawnMult: 3,
    boostCharges: 1,
    reflectShield: 0.5,
    scale: 1.7,
  },
];

/** localStorage key for the purchased ships (persisted meta ids). */
export const SHIP_KEY_OWNED = 'owned';

/** localStorage key for meta progression. */
export const SAVE_KEY = 'void_warband_meta';

/**
 * Upgrades (linear costs, capped). cost = base + step × (level).
 * level starts at 0; max level inclusive.
 */
export const UPGRADES = [
  { id: 'hull_plating',       name: 'Hull Plating',       effect: 25,  costBase: 100, costStep: 100, max: 4, stat: 'hull' },
  { id: 'shield_capacitor',  name: 'Shield Capacitor',    effect: 15,  costBase: 120, costStep: 120, max: 4, stat: 'shield' },
  { id: 'weapon_tuning',     name: 'Weapon Tuning',       effect: 2,   costBase: 150, costStep: 150, max: 5, stat: 'weaponDamage' },
  { id: 'cargo_pods',        name: 'Cargo Pods',          effect: 15,  costBase: 80,  costStep: 80,  max: 3, stat: 'cargoMax' },
  { id: 'engine_mk',         name: 'Engine Mk',           effect: 8,   costBase: 200, costStep: 200, max: 3, stat: 'maxSpeed' },
];

// ---------------------------------------------------------------------------
// §8 Performance Budgets (hard)
// ---------------------------------------------------------------------------

/** Hard performance budgets — enforced by `?perf=1` + `npm run check:perf`. */
export const PERF = {
  /** Target FPS. */
  fpsTarget: 60,
  /** Floor FPS; headless check fails below. */
  fpsFloor: 30,
  /** Max draw calls, all sectors incl. finale. */
  drawCallsMax: 200,
  /** Headless check fails above. */
  drawCallsCheckMax: 220,
  /** Max dynamic lights (exotic beacons included). */
  lightsMax: 8,
  /** Max live particles (pooled). */
  particlesMax: 1500,
  /** Projectiles pool total. */
  projectilesPool: 200,
  /** Projectiles pool: player share. */
  projectilesPlayer: 60,
  /** Projectiles pool: enemy share. */
  projectilesEnemy: 140,
  /** Device pixel ratio cap. */
  dprCap: 2,
  /** Delta time cap, s (also: RAF pause on tab hidden). */
  deltaCap: 0.1,
  /** Memory growth budget, MB per 5 min. */
  memoryGrowthMb: 15,
  /** Headless check run duration, s (finale teleport). */
  headlessDuration: 60,
  /** `?perf=1` overlay FPS average window, frames. */
  fpsWindow: 60,
};

// ---------------------------------------------------------------------------
// §5 Sector 3-4 hazards (P7)
// ---------------------------------------------------------------------------

/** Hazard behavior values (SPEC §5 sectors 3-4; P7). */
export const HAZARDS = {
  /** Crystal cluster size, min instances. */
  crystalClusterMin: 4,
  /** Crystal cluster size, max instances. */
  crystalClusterMax: 8,
  /** Crystal HP (shatters on projectile hit; 1 hit at weapon damage 10). */
  crystalHp: 20,
  /** Pulsar beam cone length, u. */
  pulsarBeamLength: 500,
  /** Pulsar beam touch damage. */
  pulsarDamage: 25,
  /** Pulsar beam touch radius (distance to axis), u. */
  pulsarBeamRadius: 6,
  /** Mine explosion trigger radius, u. */
  mineExplodeRadius: 15,
  /** Mine explosion damage. */
  mineDamage: 30,
  /** Minefield size per chunk, min. */
  mineFieldMin: 3,
  /** Minefield size per chunk, max. */
  mineFieldMax: 6,
  /** Storm cloud cluster size, min. */
  stormCloudsMin: 3,
  /** Storm cloud cluster size, max. */
  stormCloudsMax: 5,
  /** Lightning bolt damage. */
  boltDamage: 20,
  /** Lightning bolt telegraph (cloud brightening) before strike, s. */
  boltTelegraph: 0.5,
  /** Lightning bolt damage radius around the bolt midline, u. */
  boltDamageRadius: 30,
  /** Lightning bolt post-strike visible life, s. */
  boltLife: 0.15,
  // -- Black holes (THE ABYSS) ------------------------------------------------
  /** Black hole event-horizon radius, u (instant heavy damage inside). */
  blackHoleRadius: 14,
  /** Damage per second while inside the event horizon. */
  blackHoleDamage: 60,
  /** Gravity well strength: accel = strength / (dist² / 1000), clamped. */
  blackHolePull: 90000,
  /** Gravity influence radius, u (beyond this, no pull). */
  blackHoleReach: 1400,
  /** Max pull accel, u/s² (prevents slingshot absurdity). */
  blackHoleMaxAccel: 120,
  /** Black holes per chunk, min. */
  blackHoleMin: 1,
  /** Black holes per chunk, max. */
  blackHoleMax: 3,
  // -- Death stars (DEAD STAR REACH) -------------------------------------------
  /** Chance a chunk carries one death star. */
  deathStarChance: 0.3,
  /** Station hull radius, u (visual + collision). */
  deathStarRadius: 90,
  /** Ship hangar spawn interval, s. */
  deathStarSpawnInterval: 6,
  /** Ships spawned per hangar wave. */
  deathStarWaveSize: 3,
  /** Max live spawned ships per station (performance cap). */
  deathStarMaxShips: 9,
  /** Red laser damage per hit. */
  deathStarLaserDamage: 22,
  /** Red laser shot speed, u/s. */
  deathStarLaserSpeed: 520,
  /** Red laser fire interval per battery, s. */
  deathStarLaserInterval: 2.8,
  /** Laser battery range, u. */
  deathStarLaserRange: 900,
  /** Station cruise speed, u/s. */
  deathStarSpeed: 12,
  /** Boost thrust, u/s² (fast accelerations). */
  deathStarBoost: 60,
  /** Turn thrust, u/s² (sharp turns: slow down, pivot, re-accelerate). */
  deathStarTurnThrust: 40,
  // -- THE SHIP GRAVEYARD -------------------------------------------------------
  /** Broken ship hulks per chunk, min/max (large debris fields). */
  graveHulkMin: 4,
  graveHulkMax: 8,
  /** Alien worms per chunk, min/max. */
  graveWormMin: 1,
  graveWormMax: 2,
  /** Worm segment count (head + tail chain). */
  wormSegments: 10,
  /** Worm segment spacing, u. */
  wormSegSpacing: 7,
  /** Worm max speed, u/s. */
  wormSpeed: 85,
  /** Worm bite damage per contact tick, s-gated by invuln. */
  wormBiteDamage: 25,
  /** Worm aggro radius, u. */
  wormAggro: 600,
  /** Worm despawn range, u. */
  wormDespawn: 3000,
  // -- THE END (post-graveyard decay) ---------------------------------------------
  /** HP lost per second while in THE END (universe decay). */
  endDrainPerSec: 4,
  /** Grace: drain starts this many seconds after entering THE END. */
  endDrainGraceSec: 8,
};

// ---------------------------------------------------------------------------
// §8 Pool sizes
// ---------------------------------------------------------------------------

/** Object pool sizes (every repeated class pooled + instanced). */
export const POOLS = {
  projectiles: PERF.projectilesPool,
  particles: PERF.particlesMax,
  damageNumbers: 64,
  pickups: 256,
};

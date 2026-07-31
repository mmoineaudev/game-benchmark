// All magic numbers, colors, timings, configs — zero hardcoded values in logic.
export const Constants = {
  GAME_NAME: 'Void Drift',
  VERSION: '2.0.0',

  // Ship
  MAX_SHIP_SPEED: 88,          // +10% (was 80)
  SHIP_ACCELERATION: 44,       // +10% (was 40), keeps time-to-max identical
  SHIP_DRAG: 0.98,          // per-frame multiplier for lateral drift decay (60 fps basis)
  SHIP_ROLL_SPEED: 3.0,
  MOUSE_LOOK_SPEED: 0.0025, // rad per pixel, yaw & pitch
  KEYBOARD_PITCH_SPEED: 1.5, // rad/s for Z (dive) / S (climb)
  THROTTLE_SCROLL_SENSITIVITY: 0.0005, // throttle change per scroll deltaY unit
  PITCH_LIMIT: 1.2,         // rad, prevents gimbal flip
  SHIP_SPAWN: { x: 0, y: 2, z: 0 },

  // Headlight (very powerful — reveals asteroids ahead)
  HEADLIGHT: { intensity: 6.5, range: 95, angle: 0.7, penumbra: 0.45, color: 0xffffff },

  // Electronic deflagration (right-click burst): shoves asteroids/debris away.
  SHIELD: {
    radius: 22,          // radial push radius (u)
    deflectPower: 60,    // impulse on pushed bodies, falls off with distance
    cooldown: 1.0,       // seconds between bursts
  },

  // Camera
  CAMERA_DISTANCE: 6,           // behind ship (half of original 12)
  CAMERA_HEIGHT: 3,             // above ship (half of original 5)
  CAMERA_FOV_REST: 75,
  CAMERA_FOV_MAX: 95,
  CAMERA_DAMPING: 5.0,      // smoothed: lerp factor per second

  // Weapon — continuous quad beams (2 cockpit + 1 per wingtip, hold to fire)
  FIRE_RATE: 6,
  PROJECTILE_SPEED: 200,
  PROJECTILE_LIFETIME: 1.5,
  PROJECTILE_RANGE: 200,
  PROJECTILE_DAMAGE: 25,
  LASER_POOL: 96,               // 4 muzzles × sustained beams + 12 child beams
  LASER_LENGTH: 9,              // beam length (u)
  LASER_RADIUS: 0.18,           // beam core radius (u)
  LASER_GLOW_RADIUS: 0.5,       // outer glow radius (u)
  LASER_HIT_RADIUS: 1.8,        // collision radius (u)
  LASER_COLOR: 0x33ff66,        // green
  LASER_GLOW_COLOR: 0x22ff66,
  // Muzzle offsets in ship-local space (x right, y up, z forward = -Z):
  // two cockpit cannons + one per wing end.
  WEAPON_MUZZLES: [
    { x: -0.3, y: 0.45, z: -0.5 },
    { x: 0.3, y: 0.45, z: -0.5 },
    { x: -3.6, y: 0.05, z: 0.5 },
    { x: 3.6, y: 0.05, z: 0.5 },
  ],

  // Health
  MAX_HEALTH: 100,
  HEALTH_REGEN_PERCENT_PER_SEC: 0.02, // passive hull repair: 2% of max health per second
  COLLISION_THRESHOLD_LARGE: 2.0,
  COLLISION_DAMAGE_LARGE: 20,
  COLLISION_DAMAGE_SMALL: 5,
  WARNING_HEALTH_THRESHOLD: 30,
  DAMAGE_INVULNERABILITY: 0.75,
  ASTEROID_HP: { large: 100, medium: 50, small: 25 },
  ASTEROID_DRIFT_MIN: 1,
  ASTEROID_DRIFT_MAX: 4,

  // Comets
  COMET_MIN_SCALE: 3,
  COMET_MAX_SCALE: 6,
  COMET_SPEED_MIN: 15,
  COMET_SPEED_MAX: 30,
  COMET_HP: 150,
  COMET_DAMAGE: 25,
  COMET_SCORE: 100,
  COMET_TUMBLE_SPEED: 0.3,
  COMET_CURVE_AMPLITUDE: 10,
  COMET_CURVE_WAVELENGTH: 150,
  COMET_MIN_DIST_FROM_SHIP: 150,
  COMET_LIGHT: { color: 0x88bbff, intensity: 1.0, range: 90, decay: 1.5 }, // dim icy glow

  // Black holes — variable size: bigger = stronger pull (rework 2026-07)
  BLACK_HOLE_RADIUS_MIN: 10,
  BLACK_HOLE_RADIUS_MAX: 22,        // per-hole radius drawn in this range
  BLACK_HOLE_GRAVITY_RADIUS: 450,   // base; per-hole = base * (0.6 + radius/30) → 420..600
  BLACK_HOLE_GRAVITY_STRENGTH: 7500, // base; per-hole = base * (radius/10)² → 7500..36300
  BLACK_HOLE_SHIP_PULL_FACTOR: 1.15, // ship feels FULL pull +15% (real impact)
  BLACK_HOLE_MAX_PULL: 160,
  BLACK_HOLE_WARNING_RANGE: 55,
  BLACK_HOLE_DISK_SPEED: 0.5,
  BLACK_HOLE_MIN_DISTANCE: 3000,
  BLACK_HOLE_ATTRACT_RANGE: 480,     // holes attract each other within this
  BLACK_HOLE_ATTRACT_STRENGTH: 60000, // mutual acceleration = strength / d²
  BLACK_HOLE_MAX_PULL_BETWEEN: 100,  // cap on mutual pull
  BLACK_HOLE_MERGE_DISTANCE: 24,     // base; merge when d < (rA+rB)*1.2
  BLACK_HOLE_COLLAPSE_RADIUS: 80,    // ship within this of a collapse takes heavy damage

  // Dead stars
  DEAD_STAR_RADIUS_MIN: 25,
  DEAD_STAR_RADIUS_MAX: 45,
  DEAD_STAR_GLOW_SCALE: 6,
  DEAD_STAR_LIGHT_INTENSITY: 3.0,
  DEAD_STAR_LIGHT_RANGE: 600,
  DEAD_STAR_LIGHT_COLOR: 0xff3322,
  DEAD_STAR_WARNING_RANGE: 60,
  DEAD_STAR_MIN_SPACING: 1500,
  DEAD_STAR_MIN_DIST_FROM_SHIP: 400,
  DEAD_STAR_EMBER_POOL: 100,

  // Wormhole tunnel
  WORMHOLE_TUNNEL_RADIUS: 40,
  WORMHOLE_WALL_THICKNESS: 25,
  WORMHOLE_BLUR_MAX_INTENSITY: 0.85,
  WORMHOLE_BLUR_FADE: 0.5,

  // Space stations
  STATION_MIN_SCALE: 12,
  STATION_MAX_SCALE: 20,
  STATION_MIN_DIST_FROM_SHIP: 300,

  // Screen shake
  SHAKE_DAMAGE_INTENSITY: 0.5,
  SHAKE_DAMAGE_DURATION: 0.3,
  SHAKE_EXPLOSION_INTENSITY: 0.8,
  SHAKE_EXPLOSION_DURATION: 0.5,
  SHAKE_DECAY_RATE: 4.0,

  // World / chunks — perf-tuned: radius 1 keeps 27 chunks (3x3x3) instead of
  // 75, spawn/cleanup are staggered across frames to avoid boundary hitches.
  CHUNK_SIZE: 200,
  CHUNKS_RADIUS: 1,         // chunks kept around ship (Chebyshev distance, 3x3 grid)
  CHUNKS_CLEANUP_RADIUS: 1.6,
  CHUNKS_VERTICAL_RADIUS: 1, // 3 vertical layers: below, current, above
  CHUNK_SPAWN_PER_FRAME: 3,  // max chunk populations per frame (staggered streaming)
  INSTANCE_CULL_RADIUS: 460, // skip per-frame matrix writes for bodies beyond this
  CONTENT_Y_BAND: 90,        // ±u within each chunk's Y layer
  DENSITY_REDUCTION: 0.75,   // per-layer density (3 layers → total ≈ 2.25× old, per user)
  SHIP_FORWARD_AXIS: 'z',

  // Biomes (distance in units traveled, odometer) — rungs 1-4 of the ladder
  BIOMES: {
    OPEN_SPACE:       { range: [0, 1000],    asteroidDensity: 10, nebulaCount: 2, cometDensity: 3, blackHoleDensity: 0, deadStarDensity: 1, stationDensity: 0, color: [0.1, 0.15, 0.3] },
    ASTEROID_BELT:    { range: [1000, 3000], asteroidDensity: 40, nebulaCount: 3, cometDensity: 6, blackHoleDensity: 0, deadStarDensity: 2, stationDensity: 2, color: [0.4, 0.2, 0.1] },
    NEBULA_CORRIDOR:  { range: [3000, 5000], asteroidDensity: 20, nebulaCount: 6, cometDensity: 8, blackHoleDensity: 4, deadStarDensity: 3, stationDensity: 3, color: [0.3, 0.15, 0.4] },
    WORMHOLE:         { range: [5000, 7000], asteroidDensity: 60, nebulaCount: 8, cometDensity: 10, blackHoleDensity: 8, deadStarDensity: 4, stationDensity: 4, color: [0.2, 0.1, 0.5] },
  },

  // Biome ladder (v2.0 — fixed ascending sequence, 9 content rungs + 4 Deep Voids).
  // New-rung densities are FINAL per-chunk counts (no ×0.75, no distance mult);
  // pulsarDensity / cityChance are per-chunk percentage chances (max 1 per chunk).
  // Built after the object literal (see bottom of file) — needs Constants.BIOMES.

  // Difficulty caps (v2.0 §3.5)
  INTENSITY_CAPS: { asteroid: 3.0, nebula: 2.5, comet: 2.5, blackHolePull: 2.0 },

  // Crystal Fields (v2.0 §3.4.1)
  CRYSTAL: {
    density: 8, hp: 25, score: 40, damage: 5,
    clusterMin: 4, clusterMax: 8, radiusMin: 1.2, radiusMax: 2.5,
    driftMin: 0.5, driftMax: 1.5, tumble: 0.2,
    splitAngle: 0.3142, childBeamMax: 12,
    colors: [0x66e0ff, 0xff66e0, 0x66ffcc],
    instancedPool: 5000,          // 75 chunks × 8 clusters × ~6 shards ≈ 3600 worst case
    minDistFromShip: 150,
  },

  // Pulsars (v2.0 §3.4.2) — reworked: bigger bodies, faster wider sweeps
  PULSAR: {
    density: 4, radiusMin: 22, radiusMax: 30,
    beamLength: 500, beamHalfAngle: 0.06, beamTouchRadius: 9,
    damage: 50, speedA: 0.45, speedB: 0.36, leadAngle: 0.45,
    lightIntensity: 8, lightRange: 800, lightColor: 0xbfd8ff,
    pulseRate: 1.5, minSpacing: 800, minDistFromShip: 400,
    bodyColor: 0xcfe8ff, beamColor: 0x9fd8ff,
  },

  // Plasma Storm (v2.0 §3.4.3) — reworked: faster strikes, less telegraph
  STORM: {
    density: 4, cloudRadiusMin: 20, cloudRadiusMax: 40,
    boltDistanceMax: 120, boltSegments: 6, boltLife: 0.15,
    boltReMin: 1.2, boltReMax: 2.8, telegraphTime: 0.4,
    strikeDamage: 45, strikeRadius: 28,
    staticRange: 350, staticRangeIntense: 150, staticOpacity: 0.04, staticOpacityIntense: 0.08, staticHz: 20,
    flickerHz: 6, cloudColor: 0x0a1512, boltColor: 0x9fffe0, lightColor: 0x55ffcc,
    minDistFromShip: 200,
  },

  // Derelict hulks (v2.0 §3.4.4) — reworked: faster drift, hits harder
  HULK: {
    density: 4, hp: 100, damage: 30, score: 150,
    driftMin: 0.6, driftMax: 1.8, tumble: 0.05,
    minDistShip: 200, minSpacing: 80, scrapParticles: 16,
    hullColor: 0x5a4632, scrapColor: 0x8a6f4d, emergencyColor: 0xff5040,
  },

  // Spatial Graveyard finale (v2.0 §3.4.5) — reworked: denser, drifting, menacing
  CITY: {
    fragmentChance: 0.75, fragmentHp: 0, damage: 25,
    driftMin: 0.4, driftMax: 0.9, rotMin: 0.01, rotMax: 0.03,
    minDistShip: 600, minSpacing: 500,
    windowCount: 90, flickerFreq: 0.8, dropoutEvery: 2, dropoutLen: 0.2,
    glowColor: 0x5aa88f, glowOpacity: 0.08, glowScale: 4,
    hullColor: 0x2a3533, windowColor: 0x9fe8c8,
    fragmentRadius: 70, fragmentScale: 260,
    wreckDensity: 5, wreckHp: 100, wreckDamage: 25, wreckScore: 200,
    wreckScaleMin: 0.5, wreckScaleMax: 0.9, wreckScrap: 16,
    strobeFreq: 3.0, strobeRed: 0xff5040, strobeWhite: 0xd8e8e0,
    wreckColor: 0x3a4a45,
  },

  // LightManager (v2.0 §6.3)
  LIGHT_MANAGER: {
    capAuto: 16, capEco: 6, landmarkBudget: 4, signatureBudget: 4, reevalEvery: 6,
    priorities: { pulsarSweep: 1, stormFlicker: 2, crystalCluster: 3, wreckStrobe: 4, cityWindow: 5, hulkEmergency: 6 },
    storageKey: 'void_drift_light_profile',
  },

  // Adaptive quality (v2.0 §7.2.5)
  ADAPTIVE_QUALITY: {
    sampleFrames: 60, dropFps: 45, dropHold: 2, hardFps: 30,
    scale1: 0.85, scale2: 0.7, recoverFps: 55, recoverHold: 3,
  },

  // Remaster extras (v2.0 §5)
  REMASTER: {
    shootingStarEvery: 30, shootingStarMax: 2,
    speedLineCount: 24, speedLineOpacity: 0.25, speedLineLength: 40,
    shockRingLife: 0.4, shockRingScale: 14, shardCount: 6, shardGravity: 8,
    impactGlowIntensity: 0.5, impactGlowRange: 8, ionTailLength: 12,
  },

  // Starfield
  STAR_LAYERS: {
    far:  { count: 5000, size: 0.5, parallaxSpeed: 0.1, color: [0.8, 0.85, 1.0], twinkle: 0.0 },
    mid:  { count: 2000, size: 1.0, parallaxSpeed: 0.3, color: [1.0, 0.95, 0.8], twinkle: 0.3 },
    near: { count: 500,  size: 2.0, parallaxSpeed: 0.8, color: [1.0, 0.9, 0.7], twinkle: 1.0 },
  },
  BRIGHT_STAR_COUNT: 30,
  STARFIELD_WRAP: 1200,     // stars wrap in a box of ±this around ship

  // Post-processing
  BLOOM: { strength: 1.5, radius: 0.4, threshold: 0.15 },
  VIGNETTE: { darkness: 0.5, offset: 0.2 },
  FILM_GRAIN: { intensity: 0.03 },
  CHROMATIC_ABERRATION_MAX: 0.003,

  // Fog
  FOG_COLOR: 0x000011,
  FOG_DENSITY: 0.008,

  // Particles
  PARTICLE_POOLS: {
    exhaust:    { maxParticles: 200, lifetime: 0.8, size: 0.3 },
    laserSpark: { maxParticles: 50,  lifetime: 0.3, size: 0.15 },
    explosion:  { maxParticles: 80,  lifetime: 1.2, size: 0.4 },
    ember:      { maxParticles: 100, lifetime: 2.0, size: 0.3 },
    sparkle:    { maxParticles: 256, lifetime: 0.8, size: 0.7 },
  },

  // Scoring
  SCORE_ASTEROID_BASE: 10,
  SCORE_DEBRIS: 1,
  SCORE_DISTANCE_DIVISOR: 10,
  DEBRIS_DENSITY_FACTOR: 0.4,

  // Misc gameplay
  DEATH_SCREEN_DELAY: 1.0,
  HIGH_SCORE_KEY: 'void_drift_highscore',
  MAX_DELTA: 0.1,

  // Performance targets
  MAX_DRAW_CALLS: 50,
  MAX_TRIANGLES: 200000,
  MAX_INSTANCED_OBJECTS: 2000,
  DPR_MAX: 2,
  TARGET_FPS: 60,
  MIN_ACCEPTABLE_FPS: 30,
  MAX_ACTIVE_LIGHTS: 8,
};

// Ladder built after the literal (BIOMES must exist first) — spec v2.0 §3.1
// Entity counts tuned for perf (2026-07): dense entities -30%, rare -10%.
(() => {
  const V = { crystalDensity: 0, pulsarDensity: 0, stormDensity: 0, hulkDensity: 0, wreckDensity: 0, cityChance: 0 };
  const VOID = { asteroidDensity: 2, nebulaCount: 0, cometDensity: 2, blackHoleDensity: 0, deadStarDensity: 0, stationDensity: 1, color: [0.05, 0.08, 0.15], crystalDensity: 0, pulsarDensity: 0, stormDensity: 0, hulkDensity: 0, wreckDensity: 0, cityChance: 0 };
  Constants.LADDER = [
    { key: 'OPEN_SPACE',           name: 'Open Space',           range: [0, 1000],     scoreMult: 1.0, cfg: { asteroidDensity: 7, nebulaCount: 2, cometDensity: 2, blackHoleDensity: 0, deadStarDensity: 1, stationDensity: 0, ...V, color: [0.1, 0.15, 0.3] } },
    { key: 'ASTEROID_BELT',        name: 'Asteroid Belt',        range: [1000, 3000],  scoreMult: 1.0, cfg: { asteroidDensity: 28, nebulaCount: 3, cometDensity: 4, blackHoleDensity: 0, deadStarDensity: 2, stationDensity: 2, ...V, color: [0.4, 0.2, 0.1] } },
    { key: 'NEBULA_CORRIDOR',      name: 'Nebula Corridor',      range: [3000, 5000],  scoreMult: 1.2, cfg: { asteroidDensity: 14, nebulaCount: 5, cometDensity: 6, blackHoleDensity: 3, deadStarDensity: 3, stationDensity: 3, ...V, color: [0.3, 0.15, 0.4] } },
    { key: 'WORMHOLE',             name: 'Wormhole',             range: [5000, 7000],  scoreMult: 1.5, cfg: { asteroidDensity: 42, nebulaCount: 7, cometDensity: 7, blackHoleDensity: 7, deadStarDensity: 4, stationDensity: 4, ...V, color: [0.2, 0.1, 0.5] } },
    { key: 'DEEP_VOID',            name: 'Deep Void',            range: [7000, 8000],   scoreMult: 1.5, cfg: { ...VOID } },
    { key: 'CRYSTAL_FIELDS',       name: 'Crystal Fields',       range: [8000, 11000],  scoreMult: 2.0, cfg: { asteroidDensity: 18, nebulaCount: 4, cometDensity: 5, blackHoleDensity: 0, deadStarDensity: 0, stationDensity: 2, crystalDensity: 6, pulsarDensity: 0, stormDensity: 0, hulkDensity: 0, wreckDensity: 0, cityChance: 0, color: [0.55, 0.85, 0.95] } },
    { key: 'DEEP_VOID',            name: 'Deep Void',            range: [11000, 12500], scoreMult: 2.0, cfg: { ...VOID } },
    { key: 'PULSAR_REGION',        name: 'Pulsar Region',        range: [12500, 16000], scoreMult: 2.5, cfg: { asteroidDensity: 21, nebulaCount: 3, cometDensity: 6, blackHoleDensity: 2, deadStarDensity: 0, stationDensity: 2, crystalDensity: 0, pulsarDensity: 4, stormDensity: 0, hulkDensity: 0, wreckDensity: 0, cityChance: 0, color: [0.65, 0.7, 1.0] } },
    { key: 'DEEP_VOID',            name: 'Deep Void',            range: [16000, 18000], scoreMult: 2.5, cfg: { ...VOID } },
    { key: 'PLASMA_STORM',         name: 'Plasma Storm',         range: [18000, 22000], scoreMult: 3.0, cfg: { asteroidDensity: 25, nebulaCount: 6, cometDensity: 6, blackHoleDensity: 3, deadStarDensity: 2, stationDensity: 1, crystalDensity: 0, pulsarDensity: 0, stormDensity: 4, hulkDensity: 0, wreckDensity: 0, cityChance: 0, color: [0.25, 0.55, 0.5] } },
    { key: 'DEEP_VOID',            name: 'Deep Void',            range: [22000, 25000], scoreMult: 3.0, cfg: { ...VOID } },
    { key: 'DERELICT_GRAVEYARD',   name: 'Derelict Graveyard',   range: [25000, 29000], scoreMult: 3.5, cfg: { asteroidDensity: 14, nebulaCount: 3, cometDensity: 4, blackHoleDensity: 5, deadStarDensity: 2, stationDensity: 0, crystalDensity: 0, pulsarDensity: 0, stormDensity: 0, hulkDensity: 4, wreckDensity: 0, cityChance: 0, color: [0.35, 0.25, 0.2] } },
    { key: 'DEEP_VOID',            name: 'Deep Void',            range: [29000, 35000], scoreMult: 3.5, cfg: { ...VOID } },
    { key: 'SPATIAL_GRAVEYARD',    name: 'Spatial Graveyard',    range: [35000, Infinity], scoreMult: 4.0, cfg: { asteroidDensity: 28, nebulaCount: 4, cometDensity: 6, blackHoleDensity: 7, deadStarDensity: 4, stationDensity: 0, crystalDensity: 0, pulsarDensity: 0, stormDensity: 0, hulkDensity: 0, wreckDensity: 5, cityChance: 0.75, color: [0.15, 0.45, 0.4] } },
  ];
})();

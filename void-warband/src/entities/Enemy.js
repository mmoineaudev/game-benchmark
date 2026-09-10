/**
 * Enemy.js — combat enemy entity (SPEC §4, P4: drone / interceptor / rammer).
 *
 * Three enemy types, each a low-poly flat-shaded mesh with a SHARED geometry
 * and SHARED material per type (SPEC §8/§11: no unique materials on pooled
 * objects). The rammer is the one exception: it has a pulsing emissive, so
 * it clones its material per instance; drone/interceptor share their single
 * material across all instances.
 *
 * Stats come straight from ENEMIES[typeKey] and are scaled linearly by
 * sector: `stat × (1 + 0.25 × (sector − 1))`, capped at ×2.25 (SPEC §5).
 *
 * Behaviors (3D steering only, no pathfinding, SPEC §4):
 *   drone       — seek the player; deals contact damage (resolved by the
 *                 manager's collision check).
 *   interceptor — approach to orbitRadius, then orbit (tangential velocity)
 *                 and fire shots at the player.
 *   rammer      — charge straight at the player; within detonateDistance it
 *                 detonates: AoE damage if the player is within explodeRadius,
 *                 then self-destruct FX.
 *   sentinel    — mini-boss (SPEC §4): composite icosahedron core + rotating
 *                 outer ring torus; keeps ~300 u from the player, fires a
 *                 5-shot cone spread burst every 3 s, and every 12 s emits
 *                 'sentinel:summon' {position} via EventBus (main spawns
 *                 4 drones there).
 *   warden      — finale boss (SPEC §4 sector 6): large composite mesh
 *                 (dark core sphere r=10 + 3 rotating armor ring segments
 *                 (torus arcs) + 2 beam emitter cones). Phase machine driven
 *                 by HP fraction: >66% 'barrage' (rapid 3-shot volleys),
 *                 33–66% 'minefield-drones' (every 8 s emits
 *                 'warden:summon' {position, phase} + a radial burst),
 *                 <33% 'enrage-beams' (sweeping additive beam cylinder that
 *                 calls damageHooks 15/s while the player is within beam
 *                 radius 12). Exposes .phase and emits 'boss:spawned'
 *                 {position} on first activation.
 *
 * Enemies spawn `dormant` and activate on proximity (< AGGRO_RADIUS) or when
 * damaged. Death (shrink + FX + 'enemy:killed') is owned by EnemyManager via
 * kill(); this class only handles its own per-frame steering / firing.
 */
import * as THREE from 'three';
import { ENEMIES, AGGRO_RADIUS, WORLD_SAFE_RADIUS, SECTOR_SCALING } from '../core/Constants.js';
import { EventBus } from '../core/EventBus.js';
import { GLOW_COLOR, GLOW_SIZE } from './EnemyGlow.js';
import { Station, STATION_RADIUS } from './Station.js';


// -- Shared geometry (module-level, never disposed; SPEC §8) ----------------
// Each enemy type is a hand-built composite ship (distinct "manufacturer"
// silhouette per user feedback — they should look like spaceships, not
// primitives). All children share the type's material.

// DRONE — Vespid hive swarm-craft: small organic-look wedge, spore pods.
const _DRONE_HULL_GEO = new THREE.ConeGeometry(1.2, 2.6, 5);
_DRONE_HULL_GEO.rotateX(Math.PI / 2); // point +Z
const _DRONE_POD_GEO = new THREE.SphereGeometry(0.55, 6, 5);

// INTERCEPTOR — Aurora Corp racing needle: sleek fuselage + swept fins.
const _INT_FUSE_GEO = new THREE.CylinderGeometry(0.42, 0.75, 3.4, 6);
_INT_FUSE_GEO.rotateX(Math.PI / 2);
const _INT_NOSE_GEO = new THREE.ConeGeometry(0.42, 1.4, 6);
_INT_NOSE_GEO.rotateX(Math.PI / 2);
const _INT_FIN_GEO = new THREE.BoxGeometry(0.08, 1.1, 1.6);

// RAMMER — Kessler Industrial breaching ram: boxy tug with front bumper.
const _RAM_HULL_GEO = new THREE.BoxGeometry(1.8, 1.4, 3.2);
const _RAM_BUMPER_GEO = new THREE.BoxGeometry(2.4, 1.9, 1.0);
const _RAM_STACK_GEO = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 6);

// FRIGATE — Kessler heavy gunship: chunky slab hull, side gun pods.
const _FRIG_HULL_GEO = new THREE.BoxGeometry(8, 5, 12);
const _FRIG_POD_GEO = new THREE.BoxGeometry(2.2, 2.2, 6);

// SNIPER — Aurora long-range railer: thin needle + stabilizer rings.
const _SNIP_NEEDLE_GEO = new THREE.CylinderGeometry(0.28, 0.55, 7, 6);
_SNIP_NEEDLE_GEO.rotateX(Math.PI / 2);
const _SNIP_RING_GEO = new THREE.TorusGeometry(1.0, 0.14, 6, 14);

// GOLDEN — Aurora luxury yacht: teardrop hull + tail fins, all gold.
const _GOLD_HULL_GEO = new THREE.SphereGeometry(1.4, 10, 8);
const _GOLD_FIN_GEO = new THREE.BoxGeometry(0.08, 0.9, 1.4);

// SENTINEL — sector-exit mini-boss: icosahedron core + rotating ring.
const _SENTINEL_CORE_GEO = new THREE.IcosahedronGeometry(4, 1);
const _SENTINEL_RING_GEO = new THREE.TorusGeometry(6.5, 0.8, 8, 24);

// WARDEN — finale boss: gothic fortress-cathedral. Central eye-core, three
// rotating obsidian armor plates, a crown of spires, hanging tethers.
const _WARDEN_CORE_GEO = new THREE.SphereGeometry(ENEMIES.warden.coreRadius * 0.55, 16, 12);
const _WARDEN_EYE_GEO = new THREE.SphereGeometry(ENEMIES.warden.coreRadius * 0.32, 12, 10);
// Armor plates: curved slabs (box, beveled by flat shading).
const _WARDEN_PLATE_GEO = new THREE.BoxGeometry(
  ENEMIES.warden.coreRadius * 1.35, 2.2, ENEMIES.warden.coreRadius * 0.55);
// Crown spires: tall thin pyramids.
const _WARDEN_SPIRE_GEO = new THREE.ConeGeometry(1.1, 9, 4);
// Tether links: small octahedra hung below.
const _WARDEN_TETHER_GEO = new THREE.OctahedronGeometry(0.8);
const _WARDEN_EMITTER_GEO = new THREE.ConeGeometry(2.5, 6, 8);
const _WARDEN_BEAM_GEO = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);

// CHROME SENTINEL (THE ABYSS endemic) — mirror-polished alien dart: swept
// delta wing planform, mirrored surface, violet rim glow.
const _CHROME_BODY_GEO = new THREE.ConeGeometry(1.1, 3.6, 3);
_CHROME_BODY_GEO.rotateX(Math.PI / 2); // point +Z, triangular cross-section
const _CHROME_WING_GEO = new THREE.BoxGeometry(2.8, 0.08, 1.1);
const _CHROME_MAT = new THREE.MeshStandardMaterial({
  color: 0xc8d2dc,
  emissive: new THREE.Color(0x6a4aff),
  emissiveIntensity: 0.35,
  metalness: 1.0,
  roughness: 0.08, // near-mirror chrome
  envMapIntensity: 1.5,
});
const _CHROME_GLOW_MAT = new THREE.MeshBasicMaterial({
  color: 0x9a6aff,
  transparent: true,
  opacity: 0.85,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

// -- Distance-visibility glow constants ---------------------------------------
// Bodies are 1.6–2 u, sub-pixel beyond ~200 u. EnemyManager renders ONE
// additive Points cloud for all enemies; per-type color + base size below.
/** Glow color per enemy type (matches body material identity). */
const _GLOW_COLOR = {
  drone: 0xff3b30,
  interceptor: 0x8a93a8,
  rammer: 0xff8c1a,
  frigate: 0x9f5cff,
  sniper: 0x27e0c0,
  golden: 0xffd24a,
  sentinel: 0x9f5cff,
  warden: 0xff3b30,
  chrome: 0x9a6aff,
};
/** Base glow world size per type, u (bosses bigger). */
const _GLOW_SIZE = {
  drone: 6,
  interceptor: 7,
  rammer: 7,
  frigate: 10,
  sniper: 7,
  golden: 8,
  sentinel: 18,
  warden: 30,
  chrome: 7,
};

// -- Shared material (one per type; rammer cloned per instance) -------------
/** @type {THREE.MeshStandardMaterial} drone, red, flat shaded. */
const _DRONE_MAT = new THREE.MeshStandardMaterial({
  color: 0xff3b30,
  flatShading: true,
  metalness: 0.3,
  roughness: 0.7,
});
/** @type {THREE.MeshStandardMaterial} interceptor, dark, flat shaded. */
const _INTERCEPTOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x2b2f3a,
  flatShading: true,
  metalness: 0.5,
  roughness: 0.5,
});
/** @type {THREE.MeshStandardMaterial} rammer base, orange, pulsing emissive. */
const _RAMMER_MAT = new THREE.MeshStandardMaterial({
  color: 0xff8a00,
  emissive: new THREE.Color(0xff5500),
  emissiveIntensity: 1.0,
  flatShading: true,
  metalness: 0.3,
  roughness: 0.6,
});
/** @type {THREE.MeshStandardMaterial} sentinel core, dark magenta glow. */
const _SENTINEL_CORE_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a2450,
  emissive: new THREE.Color(0x7a2bd6),
  emissiveIntensity: 0.8,
  flatShading: true,
  metalness: 0.5,
  roughness: 0.5,
});
/** @type {THREE.MeshStandardMaterial} sentinel ring, additive glow ring. */
const _SENTINEL_RING_MAT = new THREE.MeshStandardMaterial({
  color: 0x8a2be2,
  emissive: new THREE.Color(0xb44bff),
  emissiveIntensity: 1.2,
  flatShading: true,
  metalness: 0.4,
  roughness: 0.4,
});
/** @type {THREE.MeshStandardMaterial} warden dark obsidian armor. */
const _WARDEN_CORE_MAT = new THREE.MeshStandardMaterial({
  color: 0x1a1420,
  emissive: new THREE.Color(0x2a0a12),
  emissiveIntensity: 0.4,
  flatShading: true,
  metalness: 0.75,
  roughness: 0.35,
});
/** @type {THREE.MeshStandardMaterial} warden eye-core, blazing red. */
const _WARDEN_EYE_MAT = new THREE.MeshStandardMaterial({
  color: 0x8a1008,
  emissive: new THREE.Color(0xff2020),
  emissiveIntensity: 3.0,
  metalness: 0.2,
  roughness: 0.3,
});
/** @type {THREE.MeshStandardMaterial} warden gold trim (spires/tethers). */
const _WARDEN_RING_MAT = new THREE.MeshStandardMaterial({
  color: 0x6b4a0a,
  emissive: new THREE.Color(0xfbbf24),
  emissiveIntensity: 0.8,
  flatShading: true,
  metalness: 0.6,
  roughness: 0.4,
});
/** @type {THREE.MeshStandardMaterial} warden emitter cones, red. */
const _WARDEN_EMITTER_MAT = new THREE.MeshStandardMaterial({
  color: 0x4a0a05,
  emissive: new THREE.Color(0xff3b30),
  emissiveIntensity: 0.8,
  flatShading: true,
  metalness: 0.4,
  roughness: 0.5,
});
/** @type {THREE.MeshBasicMaterial} warden enrage beam, additive. */
const _WARDEN_BEAM_MAT = new THREE.MeshBasicMaterial({
  color: 0xff3b30,
  transparent: true,
  opacity: 0.55,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

/** Golden drone: small bright sphere (fleeing bounty target, SPEC §6). */
const _GOLDEN_GEO = new THREE.SphereGeometry(1.4, 12, 8);
/** Turret frigate: chunky box turret (stationary, SPEC §4). */
const _FRIGATE_GEO = new THREE.BoxGeometry(8, 5, 12);
/** Sniper: long needle (SPEC §4). */
const _SNIPER_GEO = new THREE.ConeGeometry(1.0, 6, 6);
_SNIPER_GEO.rotateX(Math.PI / 2); // point +Z

/**
 * Invisible anchor geometry/material for composite bodies: the Enemy root
 * is a Mesh (so all existing mesh-based collision/logic keeps working) but
 * carries no visual — the ship hull lives in _buildBody children.
 */
const _BODY_ANCHOR_GEO = new THREE.BufferGeometry();
const _ANCHOR_MAT = new THREE.MeshBasicMaterial({ visible: false });

/** Golden drone material: gold, emissive, shared. */
const _GOLDEN_MAT = new THREE.MeshStandardMaterial({
  color: 0xfbbf24,
  emissive: new THREE.Color(0xfbbf24),
  emissiveIntensity: 1.2,
  metalness: 0.7,
  roughness: 0.3,
});
/** Frigate material: gunmetal + amber emissive, shared. */
const _FRIGATE_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a3f46,
  emissive: new THREE.Color(0x8a5500),
  emissiveIntensity: 0.4,
  flatShading: true,
  metalness: 0.6,
  roughness: 0.6,
});
/** Sniper base material — CLONED per instance (cloak opacity per enemy). */
const _SNIPER_MAT = new THREE.MeshStandardMaterial({
  color: 0x0f3a3a,
  emissive: new THREE.Color(0x2dd4bf),
  emissiveIntensity: 0.7,
  flatShading: true,
  metalness: 0.5,
  roughness: 0.5,
});

/** Collision radius per type, u (frigate = turret body 8; warden = core 10). */
const _RADIUS = {
  drone: 1.5, interceptor: 2.5, rammer: 3.5,
  frigate: 8, sniper: 2.5, golden: 2,
  sentinel: 8, warden: 10, chrome: 2.2,
};

/** Sentinel keeps this distance from the player, u (SPEC §4 mini-boss). */
const _SENTINEL_KEEP_DIST = 300;
/** Sentinel spread-burst shot count. */
const _SENTINEL_BURST_SHOTS = 5;
/** Sentinel spread-burst fire interval, s. */
const _SENTINEL_BURST_INTERVAL = 3;
/** Sentinel summon interval, s (emits 'sentinel:summon', SPEC §4). */
const _SENTINEL_SUMMON_INTERVAL = 12;
/** Sentinel cone half-angle, rad (spread around aim dir). */
const _SENTINEL_CONE_HALF = 0.12;
/** Sentinel projectile speed, u/s. */
const _SENTINEL_SHOT_SPEED = 300;
/** Scratch: shield keep-out radial. */
const _shieldOut = new THREE.Vector3();

/**
 * True when the PLAYER is inside any station shield bubble (safe haven —
 * enemies hold fire).
 * @param {THREE.Vector3} playerPos
 * @param {Array<{position: THREE.Vector3}>|null} stations
 * @returns {boolean}
 */
function _playerShielded(playerPos, stations) {
  return Station.isShielded(playerPos, stations ?? []);
}
/** Sentinel ring spin, rad/s. */
const _SENTINEL_RING_SPIN = 0.8;

/** Rammer emissive pulse (sin period, s; amplitude kept modest). */
const _RAMMER_PULSE_PERIOD = 1.2;
const _RAMMER_PULSE_AMP = 0.6;
/** Rammer emissive base intensity (rest value at pulse mid). */
const _RAMMER_EMISSIVE_BASE = 1.0;

/** Warden volley cone half-angle, rad. */
const _WARDEN_VOLLEY_HALF = 0.08;
/** Warden armor ring spin, rad/s. */
const _WARDEN_RING_SPIN = 0.5;

/** Tangential orbit speed for the interceptor, u/s. */
const _ORBIT_SPEED = 40;

/** Scratch (shared, no per-frame allocation across all enemies). */
const _toPlayer = new THREE.Vector3();
/** Spawn-safe-zone center: the spawn station position (main.js). */
const _SAFE_CENTER = { x: 90, y: 25, z: 3600 };
const _up = new THREE.Vector3(0, 1, 0);
const _tangent = new THREE.Vector3();
/** Sentinel aim scratch (world scratch, no per-frame allocation). */
const _sentinelAim = new THREE.Vector3();
const _sentinelSpread = new THREE.Vector3();
const _sentinelQ = new THREE.Quaternion();
/** Warden aim scratch (world scratch, no per-frame allocation). */
const _wardenAim = new THREE.Vector3();
const _wardenSpread = new THREE.Vector3();
const _wardenQ = new THREE.Quaternion();
const _WARDEN_UP = new THREE.Vector3(0, 1, 0);
const _WARDEN_FZ = new THREE.Vector3(0, 0, 1);
const _WARDEN_TMP = new THREE.Vector3();
const _WARDEN_M4 = new THREE.Matrix4();

class _Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {string} typeKey ENEMIES key: 'drone' | 'interceptor' | 'rammer'.
   * @param {THREE.Vector3} position world spawn position.
   * @param {number} sectorIndex 1-based content sector for stat scaling.
   */
  constructor(scene, typeKey, position, sectorIndex) {
    /** @type {string} */
    this.typeKey = typeKey;
    /** @type {object} base stat row from ENEMIES. */
    this._stats = ENEMIES[typeKey];

    // -- Body: hand-built composite ship per type (shared geos/mats) ----------
    // Rammer (pulsing emissive) and sniper (per-instance cloak opacity) get
    // a cloned "fx" material; every other type shares its static material.
    /** @type {THREE.MeshStandardMaterial|null} per-instance fx material. */
    this._fxMat = null;
    if (typeKey === 'rammer') this._fxMat = _RAMMER_MAT.clone();
    if (typeKey === 'sniper') this._fxMat = _SNIPER_MAT.clone();
    /** @type {THREE.Mesh} flat-shaded ship body (composite root). */
    this.mesh = new THREE.Mesh(
      _BODY_ANCHOR_GEO, // invisible anchor: children carry the visual hull
      _ANCHOR_MAT,
    );
    this.mesh.visible = true;
    this.mesh.userData.enemy = this;
    this.mesh.position.copy(position);
    scene.add(this.mesh);
    this._buildBody(typeKey);
    // Distance-visibility glow is rendered by EnemyManager's shared Points
    // cloud (1 draw call for ALL enemies); per-type color/size below.

    // -- Sentinel composite: rotating outer ring torus -----------------------
    /** @type {THREE.Mesh|null} sentinel ring child (rotates around world Z). */
    this._ring = null;
    if (typeKey === 'sentinel') {
      this._ring = new THREE.Mesh(_SENTINEL_RING_GEO, _SENTINEL_RING_MAT);
      this._ring.rotation.x = Math.PI / 2; // tilt so the ring faces travel plane
      this.mesh.add(this._ring);
    }

    // -- Warden composite (SPEC §4 P9): core + 3 ring arcs + 2 emitter cones
    //   + hidden enrage beam cylinder (made visible in the enrage phase).
    /** @type {THREE.Mesh[]|null} warden rotating armor plate children. */
    this._wardenRings = null;
    /** @type {THREE.Mesh|null} warden enrage beam cylinder child. */
    this._wardenBeam = null;
    if (typeKey === 'warden') {
      this._buildWarden();
    }

    // -- Stats (ENEMIES × sector scaling) -------------------------------------
    // HP/speed use the capped linear scale; DAMAGE uses the uncapped
    // distance scale (user feedback: farther from the sun = harder hits).
    const scale = _sectorScale(sectorIndex);
    /** @type {number} max HP (scaled). */
    this.maxHp = this._stats.hp * scale;
    // Golden drone: fixed 200 HP (SPEC §6 — not sector-scaled).
    if (typeKey === 'golden') {
      this.maxHp = ENEMIES.golden.hp;
    }
    /** @type {number} remaining HP. */
    this.hp = this.maxHp;
    /** @type {number} damage dealt (contact / shot / explode). */
    this.damage = this._stats.damage * _sectorDamageScale(sectorIndex);
    /** @type {number} max speed, u/s (scaled). */
    this.speed = this._stats.speed * scale;
    /** @type {number} collision radius, u. */
    this.radius = _RADIUS[typeKey] ?? 2;

    // Glow cloud per-vertex data (used by EnemyManager's Points shader).
    this.glowColor = GLOW_COLOR[typeKey] ?? 0xff3b30;
    this.glowBase = GLOW_SIZE[typeKey] ?? 6;

    // -- Motion / state -------------------------------------------------------
    /** @type {THREE.Vector3} velocity, u/s. */
    this.velocity = new THREE.Vector3();
    /** @type {'dormant'|'active'} */
    this.state = 'dormant';
    /** Cooldown until next shot, s (interceptor). */
    this.fireCooldown = 0;
    /** Sentinel spread-burst timer, s. */
    this._burstTimer = _SENTINEL_BURST_INTERVAL;
    /** Sentinel summon timer, s. */
    this._summonTimer = _SENTINEL_SUMMON_INTERVAL;

    // -- Warden (SPEC §4 P9) phase machine ------------------------------------
    /** @type {string} current phase (one of ENEMIES.warden.phases). */
    this.phase = 'barrage';
    /** Warden barrage volley timer, s. */
    this._volleyTimer = this._stats.volleyInterval;
    /** Warden minefield summon timer, s (every 8 s). */
    this._wardenSummonTimer = this._stats.summonInterval;
    /** Warden enrage beam sweep angle, rad. */
    this._wardenBeamAngle = 0;
    /** @type {boolean} 'boss:spawned' emitted for this warden. */
    this._bossSpawnedEmitted = false;

    // -- Internal ------------------------------------------------------------
    /** @type {boolean} dead (driven by EnemyManager via kill()). */
    this.alive = true;
    /** @type {boolean} death shrink in progress (EnemyManager). */
    this.dying = false;
    /** Interceptor orbit direction sign (+1 / -1). */
    this._orbitSign = Math.random() < 0.5 ? 1 : -1;
    /** Emissive pulse phase offset (rammer). */
    this._pulsePhase = Math.random() * Math.PI * 2;
  }

  /**
   * Build the composite ship body for this type (distinct "manufacturer"
   * silhouette per user feedback). All children share the type material
   * (SPEC §11); the rammer/sniper keep their per-instance cloned material
   * for pulse/cloak effects.
   * @param {string} typeKey
   */
  _buildBody(typeKey) {
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      m.scale.setScalar(s);
      this.mesh.add(m);
      return m;
    };
    switch (typeKey) {
      case 'drone': {
        // Vespid swarm-craft: wedge hull + 2 spore pods + tail spike.
        add(_DRONE_HULL_GEO, _DRONE_MAT, 0, 0, 0);
        add(_DRONE_POD_GEO, _DRONE_MAT, -0.9, -0.35, -0.6, 0, 0, 0, 1);
        add(_DRONE_POD_GEO, _DRONE_MAT, 0.9, -0.35, -0.6, 0, 0, 0, 1);
        add(_DRONE_POD_GEO, _DRONE_MAT, 0, 0.55, -1.0, 0, 0, 0, 0.7);
        break;
      }
      case 'interceptor': {
        // Aurora racer: fuselage + nose + twin swept fins + engine block.
        add(_INT_FUSE_GEO, _INTERCEPTOR_MAT, 0, 0, -0.4);
        add(_INT_NOSE_GEO, _INTERCEPTOR_MAT, 0, 0, 2.0);
        add(_INT_FIN_GEO, _INTERCEPTOR_MAT, -0.9, 0.15, -1.0, 0, 0.5);
        add(_INT_FIN_GEO, _INTERCEPTOR_MAT, 0.9, 0.15, -1.0, 0, -0.5);
        add(_INT_FIN_GEO, _INTERCEPTOR_MAT, 0, 0.7, -1.2, 0.25);
        break;
      }
      case 'rammer': {
        // Kessler breaching ram: boxy hull + heavy front bumper + stacks.
        const mat = this._fxMat ?? _RAMMER_MAT;
        add(_RAM_HULL_GEO, mat, 0, 0, 0.2);
        add(_RAM_BUMPER_GEO, mat, 0, 0, 2.1);
        add(_RAM_STACK_GEO, mat, -0.55, 1.0, -0.8);
        add(_RAM_STACK_GEO, mat, 0.55, 1.0, -0.8);
        break;
      }
      case 'frigate': {
        // Kessler heavy gunship: slab hull + 2 side gun pods + bridge block.
        add(_FRIG_HULL_GEO, _FRIGATE_MAT, 0, 0, 0);
        add(_FRIG_POD_GEO, _FRIGATE_MAT, -5.2, 0, 0.5);
        add(_FRIG_POD_GEO, _FRIGATE_MAT, 5.2, 0, 0.5);
        add(_FRIG_POD_GEO, _FRIGATE_MAT, 0, 3.4, -2.0, 0, 0, 0, 0.6);
        break;
      }
      case 'sniper': {
        // Aurora railer: needle + 2 stabilizer rings (cloned mat for cloak).
        const mat = this._fxMat ?? _SNIPER_MAT;
        add(_SNIP_NEEDLE_GEO, mat, 0, 0, 0);
        add(_SNIP_RING_GEO, mat, 0, 0, 1.8, Math.PI / 2);
        add(_SNIP_RING_GEO, mat, 0, 0, -1.8, Math.PI / 2);
        break;
      }
      case 'golden': {
        // Aurora luxury yacht: teardrop + tail fins (gold, emissive).
        add(_GOLD_HULL_GEO, _GOLDEN_MAT, 0, 0, 0, 0, 0, 0, 1);
        add(_GOLD_FIN_GEO, _GOLDEN_MAT, -0.8, 0.2, -1.0, 0, 0.45);
        add(_GOLD_FIN_GEO, _GOLDEN_MAT, 0.8, 0.2, -1.0, 0, -0.45);
        break;
      }
      case 'sentinel':
        // Boss core + ring added below (existing composite code attaches
        // the ring to this.mesh — keep the core as a child for parity).
        add(_SENTINEL_CORE_GEO, _SENTINEL_CORE_MAT, 0, 0, 0);
        break;
      case 'warden':
        add(_WARDEN_CORE_GEO, _WARDEN_CORE_MAT, 0, 0, 0);
        break;
      case 'chrome': {
        // Chrome dart: mirrored body + delta wings + violet glow fins.
        add(_CHROME_BODY_GEO, _CHROME_MAT, 0, 0, 0);
        add(_CHROME_WING_GEO, _CHROME_MAT, -1.2, 0, -0.5, 0, 0.3);
        add(_CHROME_WING_GEO, _CHROME_MAT, 1.2, 0, -0.5, 0, -0.3);
        // Engine glow fin (violet, additive) behind the dart.
        const fin = add(new THREE.BoxGeometry(0.7, 0.7, 0.1), _CHROME_GLOW_MAT, 0, 0, -1.9);
        fin.rotation.z = Math.PI / 4;
        break;
      }
      default:
        add(_DRONE_HULL_GEO, _DRONE_MAT, 0, 0, 0);
        break;
    }
  }

  /**
   * WARDEN — gothic fortress-cathedral redesign (user feedback: the old
   * sphere+arcs boss was ugly). Composition:
   *   - central blazing EYE-core (pulsing red) set in an obsidian orb;
   *   - THREE obsidian armor plates orbiting the core (each a curved slab,
   *     gold-trimmed) — these are the destructible-looking shields;
   *   - a CROWN of 6 gold spires on top, slight outward splay;
   *   - 3 gold tether links hanging below (cathedral chains);
   *   - hidden enrage beam retained (phase machine unchanged).
   * The armor plates + spires spin slowly around the core (alternating
   * directions), giving the fortress a living, grinding motion.
   */
  _buildWarden() {
    const R = ENEMIES.warden.coreRadius; // 10
    const add = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz);
      this.mesh.add(m);
      return m;
    };

    // -- Obsidian orb shell (dark, slightly larger than the eye) -----------
    add(_WARDEN_CORE_GEO, _WARDEN_CORE_MAT, 0, 0, 0);
    // -- Blazing eye: hung on a gold PROW ARM extending forward-down from
    // the orb — always clear of the orbiting armor plates, like a lantern
    // swung out on a gallows-arm. The arm reads as part of the fortress.
    const armGeo = new THREE.BoxGeometry(0.7, 0.7, R * 0.9);
    add(armGeo, _WARDEN_CORE_MAT, 0, -R * 0.25, R * 0.55);
    const eyeZ = R * 1.15; // arm tip, past the armor-plate orbit (R*1.15)
    const eyeY = -R * 0.5;
    this._wardenEye = add(
      _WARDEN_EYE_GEO, _WARDEN_EYE_MAT, 0, eyeY, eyeZ,
      0, 0, 0, 1.2, 1.2, 1.2,
    );
    // Eye socket rim (gold ring framing the eye).
    const rimGeo = new THREE.TorusGeometry(
      ENEMIES.warden.coreRadius * 0.42, 0.35, 6, 14);
    add(rimGeo, _WARDEN_RING_MAT, 0, eyeY, eyeZ + 0.6);

    // -- 3 rotating obsidian armor plates (curved slabs, gold trim) --------
    this._wardenRings = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const plate = add(
        _WARDEN_PLATE_GEO, _WARDEN_CORE_MAT,
        Math.cos(a) * R * 1.15, 0, Math.sin(a) * R * 1.15,
        0, -a, 0, // face outward
      );
      plate.userData.arcStart = -a; // base yaw (spin adds on top)
      // Gold trim edge on each plate (thin bright slab).
      add(
        new THREE.BoxGeometry(_WARDEN_PLATE_GEO.parameters.width, 0.5, 0.7),
        _WARDEN_RING_MAT,
        Math.cos(a) * R * 1.15, 1.2, Math.sin(a) * R * 1.15,
        0, -a, 0,
      );
      this._wardenRings.push(plate);
    }

    // -- Crown of 6 gold spires on top (slight outward splay) --------------
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = R * 0.62;
      add(
        _WARDEN_SPIRE_GEO, _WARDEN_RING_MAT,
        Math.cos(a) * r, R * 0.85, Math.sin(a) * r,
        Math.cos(a) * 0.18, 0, -Math.sin(a) * 0.18, // splay outward
        0.8 + (i % 2) * 0.35, // alternating heights
      );
    }

    // -- 3 gold tether links hanging below (cathedral chains) --------------
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      add(
        _WARDEN_TETHER_GEO, _WARDEN_RING_MAT,
        Math.cos(a) * R * 0.55, -R * (0.8 + i * 0.28), Math.sin(a) * R * 0.55,
        0, a, 0,
        1 - i * 0.18, // links shrink as they descend
      );
    }

    // -- Enrage beam: unit cylinder, scaled per frame (phase machine) ------
    this._wardenBeam = new THREE.Mesh(_WARDEN_BEAM_GEO, _WARDEN_BEAM_MAT);
    this._wardenBeam.visible = false;
    this.mesh.add(this._wardenBeam);
  }

  /**
   * Eye-core pulse: blazing red, intensity breathes with a slow sine —
   * called from _wardenUpdate each frame.
   * @param {number} time total elapsed s (this._pulsePhase reused).
   */
  _pulseWardenEye() {
    if (!this._wardenEye) return;
    const pulse = 1.8 + Math.sin(this._pulsePhase * 2.2) * 0.9;
    this._wardenEye.material.emissiveIntensity = Math.max(0.8, pulse);
    // Eye scale breathes too (sin gives a subtle heartbeat).
    const s = 1 + Math.sin(this._pulsePhase * 2.2) * 0.08;
    this._wardenEye.scale.setScalar(s);
  }

  /**
   * Reset to a fresh, dormant enemy at its current position (restart, SPEC §11).
   */
  reset() {
    this.hp = this.maxHp;
    this.state = 'dormant';
    this.alive = true;
    this.dying = false;
    this.velocity.set(0, 0, 0);
    this.fireCooldown = 0;
    this._burstTimer = _SENTINEL_BURST_INTERVAL;
    this._summonTimer = _SENTINEL_SUMMON_INTERVAL;
    this.mesh.visible = true;
    this.mesh.scale.setScalar(1);
    if (this.typeKey === 'rammer') {
      this._fxMat.emissiveIntensity = _RAMMER_EMISSIVE_BASE;
    }
    if (this.typeKey === 'warden') {
      this.phase = 'barrage';
      this._volleyTimer = this._stats.volleyInterval;
      this._wardenSummonTimer = this._stats.summonInterval;
      this._wardenBeamAngle = 0;
      this._bossSpawnedEmitted = false;
      if (this._wardenBeam) this._wardenBeam.visible = false;
    }
  }

  /**
   * Apply damage: wake from dormancy (activate on hit, SPEC §4).
   * Death FX / removal / 'enemy:killed' are the manager's job (kill()).
   * @param {number} amount
   */
  takeDamage(amount) {
    if (this.dying) return;
    this.hp -= amount;
    if (this.state === 'dormant') this.state = 'active';
  }

  /**
   * Per-frame steering + firing.
   * @param {number} dt delta, s.
   * @param {THREE.Vector3} playerPos player world position.
   * @param {object} gameState GameState singleton.
   * @param {import('../systems/WeaponSystem.js')} weapon System used to fire.
   * @param {Array<{position: THREE.Vector3}>|null} [stations] live stations —
   *        enemies steer AROUND their shield bubbles (keep-out) and hold fire
   *        at a player inside one.
   */
  update(dt, playerPos, gameState, weapon, stations) {
    if (!this.alive || this.dying) return;

    // Wake on proximity (dormant until within AGGRO_RADIUS or damaged).
    // NEVER wake inside the world spawn safe zone — the area around the
    // spawn station (90, 25, 420) stays threat-free no matter where enemies
    // drifted/spawned. Safe center = station, not world origin.
    if (this.state === 'dormant') {
      if (
        _toPlayer.copy(playerPos).distanceTo(this.mesh.position) < AGGRO_RADIUS &&
        this.mesh.position.distanceTo(_SAFE_CENTER) > WORLD_SAFE_RADIUS
      ) {
        this.state = 'active';
      } else {
        return; // stay dormant, no steering
      }
    }

    this._steer(dt, playerPos);
    this._avoidStationShields(stations);
    if (this.typeKey === 'interceptor' && weapon) {
      // Hold fire while the player is inside a station shield (safe haven).
      if (!_playerShielded(playerPos, stations)) this._fire(dt, playerPos, weapon);
    }
    if (this.typeKey === 'frigate' && weapon &&
        !_playerShielded(playerPos, stations)) this._frigateFire(dt, playerPos, weapon);
    if (this.typeKey === 'sniper' && !_playerShielded(playerPos, stations)) {
      this._sniperUpdate(dt, playerPos, weapon);
    }
    if (this.typeKey === 'golden') this._goldenFlee(dt, playerPos);
    if (this.typeKey === 'rammer') this._pulse(dt);
    if (this.typeKey === 'chrome') {
      // Weave phase advances (fleet offset gives wing-like motion).
      this._pulsePhase += dt * this._stats.weaveFreq * (1 + (this._fleetIndex ?? 0) * 0.15);
      // Fire on the interceptor-style cooldown (chrome uses _fire).
      if (!_playerShielded(playerPos, stations)) {
        this._fire(dt, playerPos, weapon);
      }
    }
    if (this.typeKey === 'sentinel' && !_playerShielded(playerPos, stations)) {
      this._sentinelUpdate(dt, playerPos, weapon);
    }
    if (this.typeKey === 'warden') this._wardenUpdate(dt, playerPos, weapon);

    // Integrate position (velocity already set by steering).
    this.mesh.position.addScaledVector(this.velocity, dt);
    // Face travel direction (nose +Z).
    if (this.velocity.lengthSq() > 1e-6) {
      this.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        this.velocity.clone().normalize(),
      );
    }
  }

  /**
   * Type-specific steering, writes into this.velocity.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   */
  _steer(dt, playerPos) {
    switch (this.typeKey) {
      case 'drone':
      case 'rammer': {
        // Seek / charge straight at the player.
        _toPlayer.copy(playerPos).sub(this.mesh.position);
        const dist = _toPlayer.length();
        this.velocity.copy(_toPlayer.multiplyScalar(this.speed / Math.max(dist, 1e-4)));
        break;
      }
      case 'warden': {
        // Keep distance ~keepDistance from the player (same shell logic as
        // the sentinel, tuned for the big finale body).
        _toPlayer.copy(playerPos).sub(this.mesh.position);
        const dist = _toPlayer.length();
        const keep = this._stats.keepDistance;
        if (dist > keep) {
          this.velocity
            .copy(_toPlayer)
            .multiplyScalar(this.speed / Math.max(dist, 1e-4));
        } else if (dist < keep * 0.6) {
          this.velocity
            .copy(_toPlayer)
            .multiplyScalar(-this.speed / Math.max(dist, 1e-4));
        } else {
          _tangent.crossVectors(_up, _toPlayer).multiplyScalar(this._orbitSign);
          if (_tangent.lengthSq() < 1e-4) _tangent.set(0, 0, 1);
          _tangent.normalize();
          this.velocity.copy(_tangent).multiplyScalar(this.speed);
        }
        break;
      }
      case 'sentinel': {
        // Keep distance ~_SENTINEL_KEEP_DIST from the player: approach from
        // outside the shell, retreat from inside, tangential drift inside the
        // shell (like a lazy orbit around the player).
        _toPlayer.copy(playerPos).sub(this.mesh.position);
        const dist = _toPlayer.length();
        if (dist > _SENTINEL_KEEP_DIST) {
          this.velocity
            .copy(_toPlayer)
            .multiplyScalar(this.speed / Math.max(dist, 1e-4));
        } else if (dist < _SENTINEL_KEEP_DIST * 0.6) {
          this.velocity
            .copy(_toPlayer)
            .multiplyScalar(-this.speed / Math.max(dist, 1e-4));
        } else {
          _tangent.crossVectors(_up, _toPlayer).multiplyScalar(this._orbitSign);
          if (_tangent.lengthSq() < 1e-4) _tangent.set(0, 0, 1);
          _tangent.normalize();
          this.velocity.copy(_tangent).multiplyScalar(this.speed);
        }
        break;
      }
      case 'interceptor': {
        _toPlayer.copy(playerPos).sub(this.mesh.position);
        const dist = _toPlayer.length();
        const orbitRadius = this._stats.orbitRadius;
        if (dist > orbitRadius) {
          // Approach to the orbit shell.
          this.velocity.copy(_toPlayer.multiplyScalar(this.speed / Math.max(dist, 1e-4)));
        } else {
          // Orbit: tangential velocity (perpendicular to the radius vector).
          _tangent.crossVectors(_up, _toPlayer).multiplyScalar(this._orbitSign);
          if (_tangent.lengthSq() < 1e-4) {
            // Degenerate (player directly above/below): pick a lateral axis.
            _tangent.set(0, 0, 1);
          }
          _tangent.normalize();
          this.velocity.copy(_tangent).multiplyScalar(_ORBIT_SPEED);
        }
        break;
      }
      case 'chrome': {
        // Fleet-strafe (THE ABYSS endemic): approach to orbitRadius, then
        // fast strafing runs weaving across the player's position — the
        // fleet's members phase-offset their weaves so the pack moves like
        // a living wing (offset shared via this._fleetIndex).
        _toPlayer.copy(playerPos).sub(this.mesh.position);
        const dist = _toPlayer.length();
        const orbit = this._stats.orbitRadius;
        if (dist > orbit * 1.2) {
          // Approach at full speed.
          this.velocity.copy(_toPlayer).multiplyScalar(this.speed / Math.max(dist, 1e-4));
        } else {
          // Strafe: tangential drive + weave across the orbit plane.
          _tangent.crossVectors(_up, _toPlayer).normalize().multiplyScalar(this._orbitSign);
          const weave = Math.sin(this._pulsePhase) * 0.9;
          // Radial breathing: push in/out around the orbit shell.
          const radial = (_toPlayer.clone().normalize())
            .multiplyScalar(Math.cos(this._pulsePhase) * this.speed * 0.35);
          this.velocity.copy(_tangent).multiplyScalar(this.speed * 0.8)
            .addScaledVector(_up, weave * this.speed * 0.35)
            .add(radial);
          // Clamp to ship speed.
          if (this.velocity.lengthSq() > this.speed * this.speed) {
            this.velocity.setLength(this.speed);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Station-shield keep-out: if this enemy is inside (or within a margin of)
   * a station shield bubble, push its position out along the radial and
   * zero the inward velocity component. Enemies simply cannot stay inside
   * the protected zone.
   * @param {Array<{position: THREE.Vector3}>|null} stations
   */
  _avoidStationShields(stations) {
    if (!stations || !stations.length) return;
    for (const st of stations) {
      const d = this.mesh.position.distanceTo(st.position);
      if (d < STATION_RADIUS + 5) {
        // Push out to just outside the bubble.
        _shieldOut.copy(this.mesh.position).sub(st.position);
        if (_shieldOut.lengthSq() < 1e-6) _shieldOut.set(0, 1, 0);
        _shieldOut.normalize();
        this.mesh.position
          .copy(st.position)
          .addScaledVector(_shieldOut, STATION_RADIUS + 5);
        // Kill the inward velocity component (slide along the bubble).
        const into = this.velocity.dot(_shieldOut);
        if (into < 0) this.velocity.addScaledVector(_shieldOut, -into);
      }
    }
  }

  /**
   * Interceptor fire: shots at the player using the shared weapon pool.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {import('../systems/WeaponSystem.js')} weapon
   */
  _fire(dt, playerPos, weapon) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.fireCooldown > 0) return;
    this.fireCooldown = 1 / this._stats.fireRate;

    _toPlayer.copy(playerPos).sub(this.mesh.position).normalize();
    weapon.fire(this.mesh.position, _toPlayer, {
      fromPlayer: false,
      damage: this.damage,
      speed: 300,
    });
  }

  /**
   * Sentinel behaviors (SPEC §4): rotating outer ring, 5-shot cone spread
   * burst every 3 s, and every 12 s emits 'sentinel:summon' {position}
   * via EventBus (main spawns 4 drones at that position).
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {import('../systems/WeaponSystem.js')} weapon
   */
  _sentinelUpdate(dt, playerPos, weapon) {
    // Rotating outer ring (world Z axis via local child rotation).
    if (this._ring) this._ring.rotation.z += _SENTINEL_RING_SPIN * dt;

    if (!weapon) return;

    // Summon timer: 4 drones at the sentinel's position (main owns spawn).
    this._summonTimer -= dt;
    if (this._summonTimer <= 0) {
      this._summonTimer = _SENTINEL_SUMMON_INTERVAL;
      EventBus.emit('sentinel:summon', {
        position: this.mesh.position.clone(),
      });
    }

    // Spread burst: 5 shots in a cone every 3 s.
    this._burstTimer -= dt;
    if (this._burstTimer > 0) return;
    this._burstTimer = _SENTINEL_BURST_INTERVAL;

    _sentinelAim.copy(playerPos).sub(this.mesh.position).normalize();
    for (let i = 0; i < _SENTINEL_BURST_SHOTS; i++) {
      const t =
        _SENTINEL_BURST_SHOTS === 1
          ? 0.5
          : i / (_SENTINEL_BURST_SHOTS - 1);
      // Random-ish cone: rotate the aim by ±cone around a random-ish axis.
      const ang = (t - 0.5) * 2 * _SENTINEL_CONE_HALF;
      const axis =
        Math.abs(_sentinelAim.y) > 0.9
          ? new THREE.Vector3(1, 0, 0)
          : _up;
      _sentinelQ.setFromAxisAngle(axis, ang + Math.sin(this._pulsePhase) * 0.05);
      _sentinelSpread.copy(_sentinelAim).applyQuaternion(_sentinelQ);
      weapon.fire(this.mesh.position, _sentinelSpread, {
        fromPlayer: false,
        damage: this.damage,
        speed: _SENTINEL_SHOT_SPEED,
      });
    }
  }

  /**
   * Warden (SPEC §4 P9) phase machine, driven by HP fraction:
   *   >66%  'barrage'          — rapid 3-shot volleys every 1.2 s;
   *   33–66% 'minefield-drones' — every 8 s: 'warden:summon' {position, phase}
   *                                + 8-shot radial burst;
   *   <33%  'enrage-beams'     — sweeping additive beam cylinder; 15/s to the
   *                                player while within beam radius 12 of the
   *                                beam axis (beamHooks = manager's
   *                                damageHooks, invuln-gated upstream). Emits
   *                                'boss:spawned' {position} on first activation.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {import('../systems/WeaponSystem.js')} weapon
   */
  _wardenUpdate(dt, playerPos, weapon) {
    // First activation: 'boss:spawned' (SPEC P9). state is already 'active'
    // here (dormant frames return before this call).
    if (!this._bossSpawnedEmitted) {
      this._bossSpawnedEmitted = true;
      EventBus.emit('boss:spawned', { position: this.mesh.position.clone() });
    }

    // Rotating armor plates (shared spin, alternating direction) + the
    // breathing eye-core pulse.
    if (this._wardenRings) {
      this._wardenRingSpin = (this._wardenRingSpin ?? 0) + _WARDEN_RING_SPIN * dt;
      for (let i = 0; i < this._wardenRings.length; i++) {
        this._wardenRings[i].rotation.y =
          this._wardenRings[i].userData.arcStart +
          this._wardenRingSpin * (i % 2 ? 1 : -1);
      }
    }
    this._pulseWardenEye();

    // Phase machine: driven by HP fraction (SPEC §4 P9).
    const frac = this.maxHp > 0 ? this.hp / this.maxHp : 0;
    this.phase =
      frac > 2 / 3 ? 'barrage' : frac >= 1 / 3 ? 'minefield-drones' : 'enrage-beams';

    if (this.phase === 'barrage') {
      // Rapid 3-shot volleys (less: no summons in this phase).
      if (this._wardenBeam) this._wardenBeam.visible = false;
      if (!weapon) return;
      this._volleyTimer -= dt;
      if (this._volleyTimer > 0) return;
      this._volleyTimer = this._stats.volleyInterval;
      this._fireVolley(playerPos, weapon);
      return;
    }

    if (this.phase === 'minefield-drones') {
      if (this._wardenBeam) this._wardenBeam.visible = false;
      if (!weapon) return;
      // Every 8 s: summon minefield drones + a radial burst around the warden.
      this._wardenSummonTimer -= dt;
      if (this._wardenSummonTimer > 0) return;
      this._wardenSummonTimer = this._stats.summonInterval;
      EventBus.emit('warden:summon', {
        position: this.mesh.position.clone(),
        phase: 'minefield-drones',
      });
      this._fireRadialBurst(playerPos, weapon);
      return;
    }

    // -- 'enrage-beams' --------------------------------------------------------
    // Sweeping beam attack: a rotating additive beam cylinder from the core;
    // damageHooks 15/s while the player is within beam radius 12 of the
    // beam axis. ('warden:summon' is NOT emitted in this phase: less.)
    const beamLen = this._stats.beamLength;
    const beamRadius = this._stats.beamRadius;
    if (this._wardenBeam) {
      this._wardenBeam.visible = true;
      this._wardenBeamAngle += this._stats.beamSweep * dt;
      _WARDEN_TMP.set(
        Math.cos(this._wardenBeamAngle) * beamLen * 0.5,
        0,
        Math.sin(this._wardenBeamAngle) * beamLen * 0.5,
      );
      this._wardenBeam.position.copy(_WARDEN_TMP);
      // Cylinder axis is local +Y; rotate it to point along XZ (radial).
      _wardenQ.setFromAxisAngle(_up, this._wardenBeamAngle + Math.PI / 2);
      this._wardenBeam.quaternion.copy(_wardenQ);
      this._wardenBeam.scale.set(beamRadius, beamLen, beamRadius);
    }
    // Damage: player within beam radius of the beam axis → beamDps.
    const p = this.mesh.position;
    const ax = Math.cos(this._wardenBeamAngle), az = Math.sin(this._wardenBeamAngle);
    const px = playerPos.x - p.x, pz = playerPos.z - p.z;
    const t = px * ax + pz * az;
    if (t >= 0 && t <= beamLen) {
      const dx = px - ax * t, dz = pz - az * t;
      if (Math.sqrt(dx * dx + dz * dz) <= beamRadius) {
        if (this.damageHooks) this.damageHooks(this._stats.beamDps * dt);
      }
    }
  }

  /**
   * Warden barrage: rapid 3-shot volley at the player.
   * @param {THREE.Vector3} playerPos
   * @param {import('../systems/WeaponSystem.js')} weapon
   */
  _fireVolley(playerPos, weapon) {
    _wardenAim.copy(playerPos).sub(this.mesh.position).normalize();
    const shots = this._stats.volleyShots;
    for (let i = 0; i < shots; i++) {
      const ang = (i / (shots - 1) - 0.5) * 2 * _WARDEN_VOLLEY_HALF;
      const axis = Math.abs(_wardenAim.y) > 0.9 ? _WARDEN_FZ : _WARDEN_UP;
      _wardenQ.setFromAxisAngle(axis, ang + Math.sin(this._pulsePhase) * 0.04);
      _wardenSpread.copy(_wardenAim).applyQuaternion(_wardenQ);
      weapon.fire(this.mesh.position, _wardenSpread, {
        fromPlayer: false,
        damage: this.damage,
        speed: this._stats.shotSpeed,
      });
    }
  }

  /**
   * Warden minefield-drones phase: 8-shot radial burst around the warden.
   * @param {THREE.Vector3} playerPos
   * @param {import('../systems/WeaponSystem.js')} weapon
   */
  _fireRadialBurst(playerPos, weapon) {
    void playerPos;
    const n = this._stats.radialShots;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _wardenSpread.set(Math.cos(a), 0.15 * Math.sin(a * 3), Math.sin(a)).normalize();
      weapon.fire(this.mesh.position, _wardenSpread, {
        fromPlayer: false,
        damage: this.damage,
        speed: this._stats.shotSpeed,
      });
    }
  }

  /**
   * Turret frigate (SPEC §4 sector 3+): stationary drift (8 u/s), heavy
   * 0.8 shots/s at the player.
   */
  _frigateFire(dt, playerPos, weapon) {
    // Slow drift: gentle velocity so the nose-facing code has something.
    this.velocity.set(0, 0, this._stats.speed * 0.5);
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.fireCooldown > 0) return;
    this.fireCooldown = 1 / this._stats.fireRate;
    _toPlayer.copy(playerPos).sub(this.mesh.position).normalize();
    weapon.fire(this.mesh.position, _toPlayer, {
      fromPlayer: false,
      damage: this.damage,
      speed: 260,
    });
  }

  /**
   * Sniper (SPEC §4 sector 4+): cloak (opacity 0.15) beyond cloakRange,
   * telegraph 0.8 s then fire a rail shot every 4 s.
   */
  _sniperUpdate(dt, playerPos, weapon) {
    const dist = _toPlayer.copy(playerPos).sub(this.mesh.position).length();
    const cloaked = dist > this._stats.cloakRange;
    if (this._sniperCloaked !== cloaked) {
      this._sniperCloaked = cloaked;
      this._fxMat.opacity = cloaked ? this._stats.cloakOpacity : 1;
      this._fxMat.transparent = cloaked;
    }
    // Slow repositioning drift toward the player while uncloaked-far.
    if (dist > this._stats.cloakRange * 0.5) {
      this.velocity.copy(_toPlayer).multiplyScalar(this.speed / Math.max(dist, 1e-4));
    } else {
      this.velocity.multiplyScalar(0.9);
    }

    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    // Telegraph: emissive ramp in the last 0.8 s before firing.
    if (this.fireCooldown <= this._stats.telegraph && this.fireCooldown > 0) {
      const t = 1 - this.fireCooldown / this._stats.telegraph;
      this._fxMat.emissiveIntensity = 0.7 + t * 2.3;
    }
    if (this.fireCooldown > 0 || !weapon) return;
    this.fireCooldown = this._stats.fireInterval;
    this._fxMat.emissiveIntensity = 0.7;
    _toPlayer.copy(playerPos).sub(this.mesh.position).normalize();
    weapon.fire(this.mesh.position, _toPlayer, {
      fromPlayer: false,
      damage: this.damage,
      speed: 700, // rail: fast
      life: 2.5,
    });
  }

  /**
   * Golden drone (SPEC §6): flees the player at speed 120; bounty paid via
   * the 'enemy:killed' handler in main (golden → crate-table + bonus scrap).
   */
  _goldenFlee(dt, playerPos) {
    void dt;
    _toPlayer.copy(this.mesh.position).sub(playerPos);
    const dist = _toPlayer.length();
    this.velocity.copy(_toPlayer).multiplyScalar(this.speed / Math.max(dist, 1e-4));
  }

  /**
   * Rammer pulsing emissive (the only type with a cloned material).
   * @param {number} dt
   */
  _pulse(dt) {
    this._pulsePhase += dt * (Math.PI * 2 / _RAMMER_PULSE_PERIOD);
    this._fxMat.emissiveIntensity =
      _RAMMER_EMISSIVE_BASE + _RAMMER_PULSE_AMP * Math.sin(this._pulsePhase);
  }
}

/**
 * Linear sector scaling: `1 + 0.25 × (sector − 1)`, capped at ×2.25 (SPEC §5).
 * @param {number} sectorIndex 1-based.
 */
/**
 * Sector scaling for stats. Per SPEC §5: linear ×(1 + 0.25 × (sector − 1))
 * capped at ×2.25 through the core ladder — but damage KEEPS SCALING with
 * distance beyond the cap (user feedback: the farther from the sun, the
 * more damage enemies deal). Result:
 *   HP/speed: capped at ×2.25 (sectors 6+ unchanged).
 *   Damage:   ×2.25 at sector 6, then continues +0.25/sector unbounded —
 *             Abyss (S7) ×2.5, Dead Star Reach (S8) ×2.75,
 *             Ship Graveyard (S9) ×3.0, THE END (S10) ×3.25.
 * @param {number} sectorIndex 1-based.
 */
function _sectorScale(sectorIndex) {
  const s = Math.max(1, sectorIndex);
  const linear = 1 + SECTOR_SCALING.step * (s - 1);
  const cap = 1 + SECTOR_SCALING.step * (SECTOR_SCALING.capSector - 1);
  if (linear <= cap) return linear;
  // Past the cap (user-approved scaling review): HP resumes at HALF rate
  // (+0.125/sector) so late enemies toughen without TTK collapsing.
  // Graveyard (S9) ×2.63, THE END (S15) ×3.13.
  return cap + SECTOR_SCALING.step / 2 * (s - SECTOR_SCALING.capSector);
}

/**
 * Damage-only scaling: grows +0.25 per CONTENT sector — voids and THE END
 * are skipped so the curve doesn't advance during empty/dead stretches.
 * Forge ×3.0, Abyss ×3.25, Dead Star ×3.5, Graveyard ×3.75, THE END ×3.75.
 * @param {number} sectorIndex 1-based.
 */
function _sectorDamageScale(sectorIndex) {
  const CONTENT = new Set([1, 3, 5, 7, 9, 11, 12, 13, 14]);
  let rank = 0;
  for (let s = 1; s <= Math.max(1, sectorIndex); s++) {
    if (CONTENT.has(s)) rank++;
  }
  return 1 + SECTOR_SCALING.step * Math.max(0, rank - 1);
}

export { _Enemy as Enemy };
export default _Enemy;

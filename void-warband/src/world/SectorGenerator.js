/**
 * SectorGenerator.js — P3 seeded content placement (SPEC §5, §8, §9).
 *
 * One chunk = one content decision made from a deterministic seed:
 * `chunkSeed(worldSeed, cx, cy, cz)` is a 32-bit integer hash of the chunk
 * coords, so the same worldSeed + chunk coords always produce the same
 * world (SPEC §5). `populate()` is a pure builder: given the seed and the
 * sector definition, it decides WHAT goes in the chunk and builds the
 * three.js objects for it (instanced asteroids, loot-cluster markers,
 * optional landmark, void derelict). It returns an array of descriptors;
 * `dispose()` tears everything down (SPEC §5: dispose non-shared geometry,
 * zero dangling objects on unload).
 *
 * Performance (SPEC §8): asteroids are strictly ONE InstancedMesh per chunk
 * (one draw call), built from module-level shared geometry/material
 * singletons so no chunk ever allocates its own rock. Loot clusters are
 * placeholder glowing sprites (actual pickups arrive in P5). Enemy spawn
 * POINTS are stored on the descriptor only (P4 spawns the enemies).
 */
import * as THREE from 'three';
import { CHUNK_CONTENT, SECTORS, CHUNK_SIZE, HAZARDS } from '../core/Constants.js';
import { BREAKABLE_TYPES } from './Breakables.js';

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/**
 * 32-bit integer hash of (worldSeed, cx, cy, cz).
 * FNV-1a style mixing on the four coordinates; output is a 32-bit signed
 * int so the same chunk is always seeded the same (SPEC §5 determinism).
 * @param {number} worldSeed
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {number} 32-bit integer seed.
 */
export function chunkSeed(worldSeed, cx, cy, cz) {
  // SplitMix32-style mixing of each coordinate with the world seed.
  let h = (worldSeed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h + 0x6d2b79f5 | 0), 0x5bd1e995);
  h ^= cx | 0; h = Math.imul(h, 0x27d4eb2d);
  h ^= cy | 0; h = Math.imul(h, 0x2545f491);
  h ^= cz | 0; h = Math.imul(h, 0x21f0aaad);
  // Final avalanche for well-distributed bits.
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h | 0;
}

/**
 * Distance-based station rarity (user feedback: the farther from the sun,
 * the rarer stations). The base chance decays with distance: full 1.25%
 * near the sun → 0.1% floor beyond 120k (rare lifeline, not a supply line).
 * @param {number} distanceFromSun u.
 * @returns {number} station spawn chance for this distance.
 */
function _stationChanceForDistance(distanceFromSun) {
  const decay = Math.max(0, 1 - distanceFromSun / 120000);
  return CHUNK_CONTENT.stationChance * (0.08 + 0.92 * decay);
}

/**
 * mulberry32 — tiny, fast, deterministic PRNG from a 32-bit seed.
 * Returns a function producing floats in [0, 1).
 * @param {number} seed
 */
export function mulberry32(seed) {
  let a = seed | 0;
  return function mulberry() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick a sector definition by distance along the ladder (SPEC §5 table).
 * @param {number} distance u along the ladder.
 */
/**
 * Pick a sector definition by distance along the ladder (SPEC §5 table).
 * @param {number} distance u along the ladder.
 * @returns {object} the matching SECTORS entry.
 */
export function sectorForDistance(distance) {
  for (const s of SECTORS) {
    if (distance >= s.start && distance < s.end) return s;
  }
  return SECTORS[SECTORS.length - 1];
}

// ---------------------------------------------------------------------------
// Shared module-level singletons (SPEC §8: no per-chunk allocation)
// ---------------------------------------------------------------------------

/** Shared asteroid geometry — one icosahedron for every chunk. */
const _asteroidGeo = new THREE.IcosahedronGeometry(1, 0);

/** Shared asteroid material — flat grey rock, one material for all. */
const _asteroidMat = new THREE.MeshStandardMaterial({
  color: 0x8a8f98,
  flatShading: true,
  metalness: 0.2,
  roughness: 0.9,
});

/** Shared loot-marker sprite geometry (unit plane, billboarded by sprite). */
const _lootSpriteGeo = new THREE.PlaneGeometry(1, 1);
const _lootSpriteMat = new THREE.SpriteMaterial({
  color: 0xfbbf24,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

/** Shared landmark materials (station-ish composite box + cylinder). */
const _landmarkMat = new THREE.MeshStandardMaterial({
  color: 0x6b7d8f,
  metalness: 0.5,
  roughness: 0.5,
});
const _landmarkBoxGeo = new THREE.BoxGeometry(1, 1, 1);
const _landmarkCylGeo = new THREE.CylinderGeometry(1, 1, 1, 12);

/** Shared void derelict material (dark box). */
const _derelictMat = new THREE.MeshStandardMaterial({
  color: 0x1c222b,
  metalness: 0.4,
  roughness: 0.9,
});
const _derelictGeo = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------------------
// SectorGenerator
// ---------------------------------------------------------------------------

/**
 * Content counts per sector type (from CHUNK_CONTENT + sector table).
 */
const _ASTEROIDS_PER_CHUNK_MIN = 6;
const _ASTEROIDS_PER_CHUNK_MAX = 14;
const _LANDMARK_CHANCE = 0.25;

class _SectorGenerator {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    /** @type {THREE.Scene} */
    this._scene = scene;
  }

  /**
   * Decide and build all content for one chunk.
   * @param {string} chunkKey  'cx,cy,cz'
   * @param {THREE.Vector3} chunkCenter world center of the chunk cube.
   * @param {object} sectorDef sector definition from SECTORS.
   * @param {Function} rng mulberry32-style [0,1) function (seeded).
   * @param {object} registry { group: THREE.Group } parent to attach to.
   * @returns {Array<object>} placed descriptors (see below).
   */
  populate(chunkKey, chunkCenter, sectorDef, rng, registry, seed = 0) {
    const group = registry.group;
    void chunkKey;
    const descriptors = [];
    const isVoid = sectorDef.key.startsWith('void');

    if (!isVoid) {
      // -- Asteroids: strictly one InstancedMesh, N random instances --------
      const n =
        _ASTEROIDS_PER_CHUNK_MIN +
        Math.floor(rng() * (_ASTEROIDS_PER_CHUNK_MAX - _ASTEROIDS_PER_CHUNK_MIN + 1));
      const inst = new THREE.InstancedMesh(_asteroidGeo, _asteroidMat, n);
      inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      const half = _HALF; // chunk half-extent for interior placement
      for (let i = 0; i < n; i++) {
        p.set(
          (rng() * 2 - 1) * half,
          (rng() * 2 - 1) * half,
          (rng() * 2 - 1) * half,
        );
        const scale = 3 + rng() * 22; // 3–25 u (SPEC: random scale 3-25)
        s.setScalar(scale);
        // Random rotation via random quaternion.
        q.set(
          rng() * 2 - 1,
          rng() * 2 - 1,
          rng() * 2 - 1,
          1,
        ).normalize();
        m.compose(p, q, s);
        inst.setMatrixAt(i, m);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
      // Collision: expose each asteroid's world position + radius so main can
      // do cheap sphere checks against the player (solid, deals contact dmg).
      const rockList = [];
      for (let i = 0; i < n; i++) {
        inst.getMatrixAt(i, m);
        rockList.push({
          pos: new THREE.Vector3().setFromMatrixPosition(m).add(group.position),
          r: Math.max(m.getMaxScaleOnAxis(), 1),
        });
      }
      descriptors.push({
        type: 'asteroids',
        count: n,
        object: inst,
        rocks: rockList,
      });

      // -- Loot clusters: 1–2 placeholder glowing sprite markers --------------
      const lootN =
        CHUNK_CONTENT.lootClustersMin +
        Math.floor(
          rng() * (CHUNK_CONTENT.lootClustersMax - CHUNK_CONTENT.lootClustersMin + 1),
        );
      const lootPositions = [];
      for (let i = 0; i < lootN; i++) {
        const pos = new THREE.Vector3(
          (rng() * 2 - 1) * half,
          (rng() * 2 - 1) * half,
          (rng() * 2 - 1) * half,
        );
        const sprite = new THREE.Sprite(_lootSpriteMat);
        sprite.position.copy(pos);
        sprite.scale.setScalar(12);
        group.add(sprite);
        lootPositions.push(pos.clone());
        descriptors.push({ type: 'loot-marker', object: sprite, position: pos.clone() });
      }
      descriptors.push({
        type: 'loot-cluster',
        positions: lootPositions,
      });
    } // end !isVoid (asteroids + loot clusters)

    // -- Breakables (user feedback: 4 distinct destructible prop models) -----
    // Content sectors: container / podcluster / satellite / buoy — 2 props
    // per chunk, type picked by the chunk rng. Voids: satellite wreck only.
    if (!isVoid) {
      const types = Object.keys(BREAKABLE_TYPES);
      const n = 2;
      for (let i = 0; i < n; i++) {
        const t = types[Math.floor(rng() * types.length)];
        descriptors.push({
          type: 'breakable',
          breakableType: t,
          position: new THREE.Vector3(
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
          ),
          rng: mulberry32((seed ^ 0x8b3a7 ^ i) | 0),
        });
      }
      // -- Landmark: 25% chance, big station-ish composite -------------------
      if (rng() < _LANDMARK_CHANCE) {
        const lm = this._buildLandmark(group, chunkCenter);
        descriptors.push({ type: 'landmark', object: lm.object, position: lm.position });
      }
    } else {
      // -- Void sector: near-empty, 10% one satellite wreck ------------------
      if (rng() < 0.1) {
        descriptors.push({
          type: 'breakable',
          breakableType: 'satellite',
          position: new THREE.Vector3(
            (rng() * 2 - 1) * _HALF * 0.5,
            (rng() * 2 - 1) * _HALF * 0.5,
            (rng() * 2 - 1) * _HALF * 0.5,
          ),
          rng: mulberry32((seed ^ 0x8b3a9) | 0),
        });
      }
    }

      // -- Hazard descriptors (P7; HazardSystem materializes them) -----------
      // Positions only, deterministic: hazard sub-seeds derive from the chunk
      // seed (passed as `seed`), so the same worldSeed → same hazards.
      if (sectorDef.key === 'crystal-fields') {
        const clusters = 1 + Math.floor(rng() * 2); // 1–2 clusters
        for (let i = 0; i < clusters; i++) {
          const pos = new THREE.Vector3(
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
          );
          descriptors.push({
            type: 'crystal-cluster',
            position: pos,
            count: 4 + Math.floor(rng() * 5), // 4–8 octahedra
            rng: mulberry32((seed ^ 0x9c11a1 ^ i) | 0),
          });
        }
        // 15% chance a pulsar in the chunk (SPEC §5 sector-3 hazard).
        if (rng() < 0.15) {
          const pos = new THREE.Vector3(
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
          );
          descriptors.push({ type: 'pulsar', position: pos });
        }
      } else if (sectorDef.key === 'asteroid-belt') {
        descriptors.push({
          type: 'mine-field',
          position: new THREE.Vector3(0, 0, 0),
          count: 3 + Math.floor(rng() * 4), // 3–6 mines
          rng: mulberry32((seed ^ 0x7745e1) | 0),
        });
      } else if (sectorDef.key === 'plasma-storm') {
        const clusters = 1 + Math.floor(rng() * 2); // 1–2 storm clusters
        for (let i = 0; i < clusters; i++) {
          const pos = new THREE.Vector3(
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
            (rng() * 2 - 1) * _HALF * 0.8,
          );
          descriptors.push({
            type: 'storm-cloud',
            position: pos,
            count: 3 + Math.floor(rng() * 3), // 3–5 clouds
            rng: mulberry32((seed ^ 0x510277 ^ i) | 0),
          });
        }
        const n = 3 + Math.floor(rng() * 4); // 3–6 mines (plasma-storm minefields)
        descriptors.push({
          type: 'mine-field',
          position: new THREE.Vector3(0, 0, 0),
          count: n,
          rng: mulberry32((seed ^ 0x7745e1) | 0),
        });
      }

    // -- Stations (SPEC §5/§7): rarity scales with distance from the sun
    // (user feedback: the farther out, the rarer stations are) — BUT one
    // GUARANTEED station per content sector at its midpoint (user-approved
    // scaling review: the outer biomes need a reliable supply line).
    const dist = chunkCenter.length();
    const isMidpointChunk = (() => {
      // Midpoint ± half a chunk counts as "the middle" of the sector.
      for (const s of SECTORS) {
        if (s.key.startsWith('void') || s.key === 'the-end') continue;
        const mid = (s.start + Math.min(s.end, s.start + 60000)) / 2;
        if (dist >= mid - CHUNK_SIZE / 2 && dist < mid + CHUNK_SIZE / 2) return true;
      }
      return false;
    })();
    if (!isVoid && (isMidpointChunk || rng() < _stationChanceForDistance(dist))) {
      descriptors.push({
        type: 'station',
        position: new THREE.Vector3(
          (rng() * 2 - 1) * _HALF * 0.6,
          (rng() * 2 - 1) * _HALF * 0.6,
          (rng() * 2 - 1) * _HALF * 0.6,
        ),
      });
    }

    // -- Void treasure (SPEC §5): rare cache in empty voids ------------------
    if (isVoid && rng() < CHUNK_CONTENT.voidTreasureChance) {
      descriptors.push({
        type: 'void-treasure',
        position: new THREE.Vector3(
          (rng() * 2 - 1) * _HALF * 0.5,
          (rng() * 2 - 1) * _HALF * 0.5,
          (rng() * 2 - 1) * _HALF * 0.5,
        ),
      });
    }

    // -- Enemy spawn POINTS only (P4 spawns enemies) -------------------------
    // Stored on the descriptor; no enemies exist yet.
    const spawnPoints = [];
    const spawnFlags = [];
    if (!isVoid) {
      // No enemies within ~1 chunk of the spawn station (player feedback:
      // the spawn hub must be a safe zone).
      const station = new THREE.Vector3(90, 25, 3600);
      const safeR = CHUNK_SIZE * 1.5;
      const groups =
        CHUNK_CONTENT.enemyGroupsMin +
        Math.floor(
          rng() * (CHUNK_CONTENT.enemyGroupsMax - CHUNK_CONTENT.enemyGroupsMin + 1),
        );
      const half = _HALF;
      for (let i = 0; i < groups; i++) {
        const p = new THREE.Vector3(
          (rng() * 2 - 1) * half,
          (rng() * 2 - 1) * half,
          (rng() * 2 - 1) * half,
        );
        if (p.add(chunkCenter).distanceTo(station) < safeR) continue;
        spawnPoints.push(p.sub(chunkCenter));
        // SPEC §5 sector 5 (Derelict Graveyard): 30% ambush flag per
        // enemy spawn point — main spawns extra drones there.
        spawnFlags.push(sectorDef.key === 'derelict-graveyard' && rng() < 0.3);
      }

      // -- SPEC §4/§5: Sentinel mini-boss at every content-sector exit ------
      // The LAST chunk before the next void: sectorDef.end − distance along
      // the ladder <= CHUNK_SIZE. Spawn position: chunk-center-ish random
      // offset (descriptor `position` is local chunk space, converted to
      // world space by the materializer against the chunk center).
      const remaining = sectorDef.end - chunkCenter.length();
      if (remaining <= CHUNK_SIZE) {
        descriptors.push({
          type: 'sentinel',
          position: new THREE.Vector3(
            (rng() * 2 - 1) * _HALF * 0.3,
            (rng() * 2 - 1) * _HALF * 0.3,
            (rng() * 2 - 1) * _HALF * 0.3,
          ),
        });
      }

      // -- SPEC §5 sector 6 (THE FORGE, P9): the finale arena -------------
      // The FIRST forge chunk (center.length() <= sector start + CHUNK_SIZE)
      // carries the warden arena descriptor at a fixed arena position;
      // EVERY forge chunk carries 1 broken-megastructure decoration
      // (indestructible, collision 20 dmg — main handles the collision).
      if (sectorDef.key === 'ship-graveyard') {
        // THE SHIP GRAVEYARD (user feedback): fields of broken ships + long
        // alien worms that try to eat the player's ship.
        const hulks = HAZARDS.graveHulkMin +
          Math.floor(rng() * (HAZARDS.graveHulkMax - HAZARDS.graveHulkMin + 1));
        for (let i = 0; i < hulks; i++) {
          descriptors.push({
            type: 'grave-hulk',
            position: new THREE.Vector3(
              (rng() * 2 - 1) * _HALF * 0.85,
              (rng() * 2 - 1) * _HALF * 0.85,
              (rng() * 2 - 1) * _HALF * 0.85,
            ),
            rng: mulberry32((seed ^ 0x6b6172 ^ i) | 0),
          });
        }
        const worms = HAZARDS.graveWormMin +
          Math.floor(rng() * (HAZARDS.graveWormMax - HAZARDS.graveWormMin + 1));
        for (let i = 0; i < worms; i++) {
          descriptors.push({
            type: 'grave-worm',
            position: new THREE.Vector3(
              (rng() * 2 - 1) * _HALF * 0.7,
              (rng() * 2 - 1) * _HALF * 0.7,
              (rng() * 2 - 1) * _HALF * 0.7,
            ),
            rng: mulberry32((seed ^ 0x776f726d ^ i) | 0),
          });
        }
      } else if (sectorDef.key === 'dead-star-reach') {
        // Death stars (user feedback): ~30% of chunks carry one — very big
        // battlestations that spawn interceptor ships and fire red lasers.
        if (rng() < HAZARDS.deathStarChance) {
          descriptors.push({
            type: 'death-star',
            position: new THREE.Vector3(
              (rng() * 2 - 1) * _HALF * 0.6,
              (rng() * 2 - 1) * _HALF * 0.6,
              (rng() * 2 - 1) * _HALF * 0.6,
            ),
            rng: mulberry32((seed ^ 0xdeada) | 0),
          });
        }
      } else if (sectorDef.key === 'the-abyss') {
        // Black holes (user feedback): 1–3 per chunk, attracting the ship
        // proportionally to proximity (gravity handled by HazardSystem).
        const n = HAZARDS.blackHoleMin +
          Math.floor(rng() * (HAZARDS.blackHoleMax - HAZARDS.blackHoleMin + 1));
        for (let i = 0; i < n; i++) {
          descriptors.push({
            type: 'black-hole',
            position: new THREE.Vector3(
              (rng() * 2 - 1) * _HALF * 0.8,
              (rng() * 2 - 1) * _HALF * 0.8,
              (rng() * 2 - 1) * _HALF * 0.8,
            ),
          });
        }
      } else if (sectorDef.key === 'the-forge') {
        if (chunkCenter.length() <= sectorDef.start + CHUNK_SIZE) {
          descriptors.push({
            type: 'warden-arena',
            // Fixed arena position (local chunk space): main offsets it
            // by +500 u along the ladder and calls spawnWarden there.
            position: new THREE.Vector3(0, 0, 0),
          });
        }
        descriptors.push({
          type: 'forge-structure',
          position: new THREE.Vector3(
            (rng() * 2 - 1) * _HALF * 0.7,
            (rng() * 2 - 1) * _HALF * 0.7,
            (rng() * 2 - 1) * _HALF * 0.7,
          ),
          rng: mulberry32((seed ^ 0xf00d1 ^ 0x5f0e) | 0),
        });
      }

      // -- SPEC §5 sector 5 (Derelict Graveyard): 2–3 destructible hulks ---
      // per chunk (main builds the composite wreck meshes + collision/HP).
      if (sectorDef.key === 'derelict-graveyard') {
        const hulkCount = 2 + Math.floor(rng() * 2); // 2–3
        for (let i = 0; i < hulkCount; i++) {
          descriptors.push({
            type: 'hulk',
            position: new THREE.Vector3(
              (rng() * 2 - 1) * _HALF * 0.8,
              (rng() * 2 - 1) * _HALF * 0.8,
              (rng() * 2 - 1) * _HALF * 0.8,
            ),
            rng: mulberry32((seed ^ 0x116501 ^ i) | 0),
          });
        }
      }
    }
    descriptors.push({
      type: 'enemy-spawn-points',
      positions: spawnPoints,
      flags: spawnFlags,
    });

    return descriptors;
  }

  /**
   * Build the landmark composite (box + cylinder) at chunk center.
   * @returns {{object: THREE.Group, position: THREE.Vector3}}
   */
  _buildLandmark(group, chunkCenter) {
    const g = new THREE.Group();
    // Base box.
    const box = new THREE.Mesh(_landmarkBoxGeo, _landmarkMat);
    box.scale.set(40, 12, 40);
    g.add(box);
    // Top cylinder (antenna/spire).
    const cyl = new THREE.Mesh(_landmarkCylGeo, _landmarkMat);
    cyl.scale.set(6, 50, 6);
    cyl.position.y = 30;
    g.add(cyl);
    // Registry.group is already positioned at chunkCenter, so origin (0,0,0)
    // here lands the landmark exactly at the chunk center.
    group.add(g);
    return { object: g, position: chunkCenter.clone() };
  }

  /**
   * Build a void derelict decoration (dark box).
   * @returns {{object: THREE.Mesh, position: THREE.Vector3}}
   */
  _buildDerelict(group, chunkCenter, rng) {
    const m = new THREE.Mesh(_derelictGeo, _derelictMat);
    const half = _HALF;
    m.position.set(
      (rng() * 2 - 1) * half * 0.5,
      (rng() * 2 - 1) * half * 0.5,
      (rng() * 2 - 1) * half * 0.5,
    );
    m.scale.setScalar(20 + rng() * 20);
    m.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    group.add(m);
    return { object: m, position: m.position.clone() };
  }

  /**
   * Dispose every object this generator placed (SPEC §5 unload cleanup).
   * Shared geometry/material singletons are NOT disposed (they are shared
   * across chunks); only per-instance data (instanced matrices, sprites,
   * composite children with unique transforms) is released.
   * @param {Array<object>} descriptors
   */
  dispose(descriptors) {
    for (const d of descriptors) {
      if (!d.object) continue;
      const obj = d.object;
      // Remove from parent + drop GPU buffers. For InstancedMesh the
      // instanceMatrix buffer is per-mesh, so dispose the GPU instance data
      // but keep the shared geometry/material singletons.
      if (obj.parent) obj.parent.remove(obj);
      if (obj.isInstancedMesh) {
        // Free the per-instance GPU buffer; geometry/material stay shared.
        obj.dispose();
      } else if (obj.type === 'Group' || obj.type === 'Object3D') {
        // Composite: dispose any child that had its own geometry/material
        // (children here use shared singletons, so just clear children).
        obj.traverse((child) => {
          if (child.isInstancedMesh) child.dispose();
        });
        obj.clear();
      }
      // Sprites/meshes referencing shared geo+mat: nothing to dispose.
    }
  }
}

/** Half of a chunk edge, u — interior placement bound. */
const _HALF = 1000;

export { _SectorGenerator as SectorGenerator, _asteroidMat as asteroidMat };
export default _SectorGenerator;

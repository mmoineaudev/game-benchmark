/**
 * ChunkManager.js — P3 chunk streaming (SPEC §5, §8, §9).
 *
 * Owns the set of active chunks around the ship. `update(shipPosition)`:
 *   - computes the ship's chunk coords `floor(pos / CHUNK_SIZE)`;
 *   - LOADS every chunk within LOAD_RADIUS (Chebyshev, cy clamped to
 *     [-1, 1] so the active region is 5×5×3);
 *   - UNLOADS anything beyond UNLOAD_RADIUS (hysteresis, SPEC §5).
 *
 * Each active chunk is a THREE.Group positioned at its chunkCenter holding
 * the content built by SectorGenerator (instanced asteroids, loot markers,
 * optional landmark, void derelict) plus enemy spawn POINTS. Loads are
 * seeded deterministically via mulberry32(chunkSeed(...)) so the same world
 * seed always yields the same world (SPEC §5).
 *
 * Frustum culling is left at its default (on). Shared geometry/material
 * singletons live in SectorGenerator — ChunkManager only owns per-chunk
 * Group + instanced-mesh GPU buffers.
 */
import * as THREE from 'three';
import { CHUNK_SIZE, LOAD_RADIUS, UNLOAD_RADIUS, SECTORS } from '../core/Constants.js';
import {
  SectorGenerator,
  sectorForDistance,
  mulberry32,
  chunkSeed,
} from './SectorGenerator.js';

/** Half of a chunk edge, u — for computing chunkCenter from coords. */
const _HALF = CHUNK_SIZE * 0.5;

class _ChunkManager {
  /**
   * @param {THREE.Scene} scene
   * @param {number} worldSeed
   */
  constructor(scene, worldSeed) {
    /** @type {THREE.Scene} */
    this._scene = scene;
    /** @type {number} */
    this._worldSeed = worldSeed | 0;
    /** Optional callback (chunkKey) — fired when a chunk unloads. */
    this._onChunkUnload = null;

    /** @type {SectorGenerator} */
    this._gen = new SectorGenerator(scene);

    /**
     * Active chunks: key 'cx,cy,cz' → { descriptors: Array, group: Group }.
     * @type {Map<string, {descriptors: Array, group: THREE.Group}>}
     */
    this._chunks = new Map();

    // -- Stats (SPEC §8 perf) --------------------------------------------------
    /** Total chunks loaded this session. */
    this.chunksLoaded = 0;
    /** Total asteroid instances across active chunks. */
    this.asteroidsTotal = 0;

    // Scratch (no per-frame allocation).
    this._v3 = new THREE.Vector3();
  }

  /**
   * Stream chunks around the ship.
   * @param {THREE.Vector3} shipPosition
   */
  update(shipPosition) {
    const sx = Math.floor(shipPosition.x / CHUNK_SIZE);
    const sy = Math.floor(shipPosition.y / CHUNK_SIZE);
    const sz = Math.floor(shipPosition.z / CHUNK_SIZE);

    // -- Load: Chebyshev radius, cy clamped to [-1, 1] (5×5×3 region) -------
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
        for (let dz = -LOAD_RADIUS; dz <= LOAD_RADIUS; dz++) {
          // Clamp vertical extent to one layer above/below the ship chunk.
          if (dy < -1 || dy > 1) continue;
          const cx = sx + dx;
          const cy = sy + dy;
          const cz = sz + dz;
          const key = `${cx},${cy},${cz}`;
          if (this._chunks.has(key)) continue;
          this._loadChunk(cx, cy, cz, key);
        }
      }
    }

    // -- Unload: hysteresis beyond UNLOAD_RADIUS ----------------------------
    for (const [key, entry] of this._chunks) {
      // Chebyshev distance in chunk coords from ship chunk.
      const dx = Math.abs(entry.group.userData.cx - sx);
      const dy = Math.abs(entry.group.userData.cy - sy);
      const dz = Math.abs(entry.group.userData.cz - sz);
      const dist = Math.max(dx, dy, dz);
      if (dist > UNLOAD_RADIUS) this._unloadChunk(key, entry);
    }
  }

  /**
   * Sector definition for a world position (by ladder distance).
   * @param {THREE.Vector3} pos
   * @returns {object} sectorDef from SECTORS.
   */
  getSector(pos) {
    return sectorForDistance(pos.length());
  }

  // -- Load / Unload ----------------------------------------------------------

  /**
   * Build + attach one chunk at the given integer coords.
   * @param {number} cx @param {number} cy @param {number} cz
   * @param {string} key
   */
  _loadChunk(cx, cy, cz, key) {
    const center = this._v3.set(
      (cx + 0.5) * CHUNK_SIZE,
      (cy + 0.5) * CHUNK_SIZE,
      (cz + 0.5) * CHUNK_SIZE,
    ).clone();

    const group = new THREE.Group();
    group.position.copy(center);
    group.userData.cx = cx;
    group.userData.cy = cy;
    group.userData.cz = cz;

    // Deterministic content (SPEC §5): sector by ladder distance.
    const sectorDef = sectorForDistance(center.length());
    const seed = chunkSeed(this._worldSeed, cx, cy, cz);
    const rng = mulberry32(seed);

    const descriptors = this._gen.populate(
      key,
      center,
      sectorDef,
      rng,
      { group },
      seed,
    );

    this._scene.add(group);
    const entry = { descriptors, group, userDataMaterialized: false };
    this._chunks.set(key, entry);
    // PERF (FIX #7): notify main.js — solid-rock list + station pruning are
    // rebuilt on this dirty flag instead of every frame.
    this._worldDirty = true;

    // Stats.
    this.chunksLoaded += 1;
    for (const d of descriptors) {
      if (d.type === 'asteroids') this.asteroidsTotal += d.count;
    }
  }

  /**
   * Tear down one chunk (SPEC §5: dispose non-shared, zero dangling).
   * @param {string} key
   * @param {{descriptors: Array, group: THREE.Group}} entry
   */
  _unloadChunk(key, entry) {
    this._gen.dispose(entry.descriptors);
    this._scene.remove(entry.group);
    this._chunks.delete(key);
    // PERF (FIX #3): hazards (crystals/storms/hulks/…) materialized for this
    // chunk are detached here — before this hook they lived in the scene root
    // until a full restart, accumulating hundreds of simulated far entities.
    if (this._onChunkUnload) this._onChunkUnload(key);
    // PERF (FIX #7): world changed — main.js rebuilds its derived lists.
    this._worldDirty = true;

    // Keep the asteroid total consistent with what is currently active.
    for (const d of entry.descriptors) {
      if (d.type === 'asteroids') this.asteroidsTotal -= d.count;
    }
  }
}

export { _ChunkManager as ChunkManager };
export default _ChunkManager;

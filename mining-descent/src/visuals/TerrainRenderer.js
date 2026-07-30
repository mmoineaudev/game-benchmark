// =============================================================================
// TerrainRenderer — InstancedMesh with per-instance color.
// Cutaway: dynamically HIDE tiles in camera direction so the interior is visible.
// Separate additive mesh for ore glow.
// =============================================================================

import * as THREE from 'three';
import { WORLD_WIDTH, WORLD_DEPTH, WORLD_HEIGHT, TILE, TILE_COLOR, GLOW } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { Logger } from '../core/Logger.js';
import { idx } from '../systems/TerrainGenerator.js';

const TOTAL = WORLD_WIDTH * WORLD_DEPTH * WORLD_HEIGHT;
const CUTAWAY_MARGIN = 2.0;
const SEARCH_RADIUS = 18;

export class TerrainRenderer {
  constructor(scene, terrainGen) {
    this._scene = scene;
    this._gen = terrainGen;
    this._bus = getEventBus();

    this._mesh = null;
    this._glowMesh = null;

    // gridIdx → instance index in each mesh (-1 = hidden or AIR)
    this._opaqueMap = new Int32Array(TOTAL);
    this._glowMap = new Int32Array(TOTAL);

    // Saved instance data for restoration (tiles currently cutaway-hidden)
    this._hiddenCache = []; // { gridIdx, opaqueIdx, matrix, colorHex, glowIdx, glowMatrix }

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    this._glowTime = 0;

    // Frame-to-frame cutaway state
    this._lastKey = null; // "pgx,pgy,pgz,angle" string for dedup
  }

  init() {
    const t0 = performance.now();

    let opaqueCount = 0, oreCount = 0;
    for (let i = 0; i < TOTAL; i++) {
      const t = this._gen.data[i];
      if (t !== TILE.AIR) opaqueCount++;
      if (t === TILE.COAL_ORE || t === TILE.COPPER_ORE) oreCount++;
    }

    const geom = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    const mat = new THREE.MeshLambertMaterial({ roughness: 0.8 });
    this._mesh = new THREE.InstancedMesh(geom, mat, opaqueCount);
    this._mesh.count = opaqueCount;
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._glowMesh = new THREE.InstancedMesh(geom, glowMat, oreCount);
    this._glowMesh.count = oreCount;
    this._glowMesh.renderOrder = 2;

    this._opaqueMap.fill(-1);
    this._glowMap.fill(-1);
    let si = 0, gi = 0;

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < WORLD_DEPTH; z++) {
        for (let x = 0; x < WORLD_WIDTH; x++) {
          const tile = this._gen.data[idx(x, y, z)];
          if (tile === TILE.AIR) continue;

          const wx = x + 0.5, wy = -(y + 0.5), wz = z + 0.5;
          this._dummy.position.set(wx, wy, wz);
          this._dummy.scale.set(1, 1, 1);
          this._dummy.updateMatrix();
          const m4 = this._dummy.matrix.clone();

          this._mesh.setMatrixAt(si, m4);
          this._color.setHex(TILE_COLOR[tile] || 0x888888);
          this._mesh.setColorAt(si, this._color);
          const gIdx = idx(x, y, z);
          this._opaqueMap[gIdx] = si;
          si++;

          if (tile === TILE.COAL_ORE || tile === TILE.COPPER_ORE) {
            this._glowMesh.setMatrixAt(gi, m4);
            this._glowMap[gIdx] = gi;
            gi++;
          }
        }
      }
    }

    this._mesh.instanceMatrix.needsUpdate = true;
    if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
    this._glowMesh.instanceMatrix.needsUpdate = true;

    this._scene.add(this._mesh);
    this._scene.add(this._glowMesh);

    this._unsubTile = this._bus.on(Events.TILE_REMOVED, ({ x, y, z }) => this._onTileRemoved(x, y, z));

    Logger.info('TerrainRenderer', `built (${(performance.now() - t0).toFixed(1)}ms)`, {
      opaque: opaqueCount, glow: oreCount,
    });
  }

  /** Restore all tiles previously hidden by cutaway. */
  _restoreAll() {
    if (this._hiddenCache.length === 0) return;

    for (const entry of this._hiddenCache) {
      // Restore opaque
      if (entry.opaqueIdx >= 0) {
        this._mesh.setMatrixAt(entry.opaqueIdx, entry.matrix);
        this._color.setHex(entry.colorHex);
        this._mesh.setColorAt(entry.opaqueIdx, this._color);
        this._opaqueMap[entry.gridIdx] = entry.opaqueIdx;
      }
      // Restore glow
      if (entry.glowIdx >= 0) {
        this._glowMesh.setMatrixAt(entry.glowIdx, entry.glowMatrix);
        this._glowMap[entry.gridIdx] = entry.glowIdx;
      }
    }

    this._mesh.instanceMatrix.needsUpdate = true;
    if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
    this._glowMesh.instanceMatrix.needsUpdate = true;
    this._hiddenCache.length = 0;
  }

  /**
   * Cutaway: hide tiles in camera half-space that are at or above player level.
   * Uses dot product with camera direction vector to determine blocking.
   */
  setCutaway(pgx, pgy, pgz, camAngle) {
    const key = `${pgx}|${pgy}|${pgz}|${camAngle.toFixed(3)}`;
    if (key === this._lastKey) return;
    this._lastKey = key;

    // First restore everything
    this._restoreAll();

    const sinA = Math.sin(camAngle);
    const cosA = Math.cos(camAngle);

    const xMin = Math.max(0, pgx - SEARCH_RADIUS);
    const xMax = Math.min(WORLD_WIDTH - 1, pgx + SEARCH_RADIUS);
    const zMin = Math.max(0, pgz - SEARCH_RADIUS);
    const zMax = Math.min(WORLD_DEPTH - 1, pgz + SEARCH_RADIUS);

    for (let y = 0; y <= pgy; y++) {
      for (let x = xMin; x <= xMax; x++) {
        for (let z = zMin; z <= zMax; z++) {
          const dx = x - pgx;
          const dz = z - pgz;

          // Tiles in the camera's approaching half-space
          const dot = dx * sinA + dz * cosA;
          if (dot <= CUTAWAY_MARGIN) continue;

          const gIdx = idx(x, y, z);
          const opaqueIdx = this._opaqueMap[gIdx];
          if (opaqueIdx < 0) continue;

          // Save instance data
          const m4 = new THREE.Matrix4();
          this._mesh.getMatrixAt(opaqueIdx, m4);

          const colorHex = 0x888888;
          const entry = {
            gridIdx: gIdx,
            opaqueIdx,
            matrix: m4,
            colorHex,
            glowIdx: -1,
            glowMatrix: null,
          };

          // Read color
          if (this._mesh.instanceColor) {
            const ca = this._mesh.instanceColor.array;
            const r = ca[opaqueIdx * 3];
            const g = ca[opaqueIdx * 3 + 1];
            const b = ca[opaqueIdx * 3 + 2];
            entry.colorHex = new THREE.Color(r, g, b).getHex();
          }

          // Save glow if present
          const glowIdx = this._glowMap[gIdx];
          if (glowIdx >= 0) {
            entry.glowIdx = glowIdx;
            const gMatrix = new THREE.Matrix4();
            this._glowMesh.getMatrixAt(glowIdx, gMatrix);
            entry.glowMatrix = gMatrix;
          }

          this._hiddenCache.push(entry);

          // Hide the tile
          this._mesh.setMatrixAt(opaqueIdx, this._zeroMatrix);
          this._opaqueMap[gIdx] = -1;

          if (glowIdx >= 0) {
            this._glowMesh.setMatrixAt(glowIdx, this._zeroMatrix);
            this._glowMap[gIdx] = -1;
          }
        }
      }
    }

    if (this._hiddenCache.length > 0) {
      this._mesh.instanceMatrix.needsUpdate = true;
      if (this._mesh.instanceColor) this._mesh.instanceColor.needsUpdate = true;
      if (this._hiddenCache.some(e => e.glowIdx >= 0)) {
        this._glowMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  _onTileRemoved(x, y, z) {
    const gIdx = idx(x, y, z);

    const op = this._opaqueMap[gIdx];
    if (op >= 0) {
      this._mesh.setMatrixAt(op, this._zeroMatrix);
      this._mesh.instanceMatrix.needsUpdate = true;
      this._opaqueMap[gIdx] = -1;
    }

    const gl = this._glowMap[gIdx];
    if (gl >= 0) {
      this._glowMesh.setMatrixAt(gl, this._zeroMatrix);
      this._glowMesh.instanceMatrix.needsUpdate = true;
      this._glowMap[gIdx] = -1;
    }
  }

  updateGlow(dt) {
    if (!this._glowMesh) return;
    this._glowTime += dt;
    const sine = Math.sin(this._glowTime * GLOW.PULSE_SPEED);
    this._glowMesh.material.opacity =
      GLOW.MIN_INTENSITY + (sine * 0.5 + 0.5) * (GLOW.MAX_INTENSITY - GLOW.MIN_INTENSITY);
  }

  get mesh() { return this._mesh; }

  dispose() {
    if (this._unsubTile) this._unsubTile();
    if (this._mesh) { this._mesh.geometry.dispose(); this._mesh.material.dispose(); this._scene.remove(this._mesh); }
    if (this._glowMesh) { this._glowMesh.geometry.dispose(); this._glowMesh.material.dispose(); this._scene.remove(this._glowMesh); }
    this._hiddenCache = [];
    Logger.info('TerrainRenderer', 'disposed');
  }
}

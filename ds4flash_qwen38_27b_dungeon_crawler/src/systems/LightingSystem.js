/**
 * LightingSystem.js — biome ambience + torch/brazier/crystal lighting,
 * god rays, start/exit markers, and the single shadow-casting torch
 * (§7.3, §12.1, §22, §26).
 *
 * Binding rules implemented here:
 *  - ambient + FogExp2 from BIOMES[biomeId] (§12.1); scene.background = fog color
 *  - torch mode: 'standard' = one torch per exposed grid edge (spacing 16 u,
 *    y 2.5); 'vaultOnly' (FUNGAL_CAVERN, POISON_SWAMP) = torches ONLY inside
 *    VAULT rooms (§7.3, §22)
 *  - braziers: one per room of BIOMES[biomeId].brazierRooms (§7.3)
 *  - crystal lamps: CRYSTAL_DEPTHS 1/room, FROZEN_HALLS 2/room (§7.3)
 *  - god rays: VAULT rooms only — one additive light shaft per torch inside
 *    a VAULT (§26)
 *  - EXACTLY ONE shadow-casting torch (TORCH_SHADOW_COUNT = 1), assigned
 *    statically at build to the torch nearest the entrance, map 256²,
 *    near 0.5, far 11, bias −0.005, normalBias 0.02. Every other light
 *    castShadow = false forever (§12.1). Degraded tier 2 → budget 0.
 *  - start marker: green ring + light at entrance; exit marker: golden ring
 *    + glow + vertical beam + light (§26)
 *  - BRIGHT buff: ambient ×2.5, fog density ×0.35 (§11)
 *
 * Headless shim (§27): no document/window access at module top level; all
 * geometry is plain three.js objects so build() works in Node.
 */

import * as THREE from 'three';
import {
  BIOMES,
  DUNGEON,
  LIGHTING,
  LIGHT_SOURCES,
  BUFF,
} from '../core/Constants.js';

const CELL = DUNGEON.CELL_SIZE;

export class LightingSystem {
  constructor() {
    this.scene = null;
    this.ambient = null;
    this.fog = null;
    /** @type {Array<{mesh: THREE.Object3D, light: THREE.PointLight, position: THREE.Vector3, castShadow: boolean}>} */
    this.torches = [];
    /** Every point light placed by this system (budget counting, §22). */
    this.lightList = [];
    this.group = new THREE.Group();
    this.group.userData.owner = this;

    this.geometries = [];
    this.materials = [];
    this.textures = [];
    this._biomeAmbient = null;
    this._biomeFogDensity = null;
    this._shadowTorch = null; // the ONE shadow-casting torch (or null)
    this._shadowBudget = LIGHTING.TORCH_SHADOW_COUNT;
    this._entrancePos = null;  // cached for setDegraded() re-assignment
    this._brightBaseAmbient = 0;
    this.disposed = false;
  }

  /**
   * Build all lighting for one level.
   * @param {THREE.Scene} scene
   * @param {object} dungeon — DungeonGenerator.generate() output
   * @param {string} biomeId
   */
  build(scene, dungeon, biomeId) {
    if (this.disposed) return this;
    this.scene = scene;
    const biome = BIOMES[biomeId] || BIOMES.STONE;

    // --- ambient + fog (§12.1) -------------------------------------------
    this._biomeAmbient = new THREE.AmbientLight(biome.ambient, biome.ambientIntensity);
    this.ambient = this._biomeAmbient;
    this._brightBaseAmbient = biome.ambientIntensity;
    scene.add(this.ambient);

    this._biomeFogDensity = biome.fogDensity;
    this.fog = new THREE.FogExp2(biome.fog, biome.fogDensity);
    scene.fog = this.fog;
    scene.background = new THREE.Color(biome.fog);

    if (!dungeon) return this;
    this._entrancePos = null;
    const { grid, gridSize, cellSize = CELL, rooms = [], entranceCell, exitCell } = dungeon;
    const n = gridSize;
    const cellCenter = (c) => c * cellSize + cellSize / 2;
    const entrancePos = new THREE.Vector3(cellCenter(entranceCell.x), 0, cellCenter(entranceCell.z));
    const exitPos = new THREE.Vector3(cellCenter(exitCell.x), 0, cellCenter(exitCell.z));
    this._entrancePos = entrancePos.clone();

    // --- torches (§7.3 / §22) --------------------------------------------
    const torchPositions = this._torchPositions(grid, gridSize, cellSize, rooms, biome);
    for (const p of torchPositions) {
      this._addTorch(p, biome);
    }

    // --- shadow torch: the ONE nearest the entrance, static (§12.1) --------
    this._shadowTorch = null;
    if (this._shadowBudget > 0 && this.torches.length > 0) {
      let best = null;
      let bestD = Infinity;
      for (const t of this.torches) {
        const d = t.position.distanceToSquared(entrancePos);
        if (d < bestD) { bestD = d; best = t; }
      }
      this._applyShadowBudget(best);
    }

    // --- braziers: one per room of brazierRooms (§7.3) ---------------------
    for (const room of rooms) {
      if (!biome.brazierRooms.includes(room.type)) continue;
      const bx = cellCenter(room.cx + (room.w >> 1));
      const bz = cellCenter(room.cz + (room.h >> 1));
      this._addBrazier(new THREE.Vector3(bx, 0, bz), biome);
    }

    // --- crystal lamps: CRYSTAL_DEPTHS 1/room, FROZEN_HALLS 2/room (§7.3) --
    const lampsPerRoom = biomeId === 'FROZEN_HALLS' ? 2 : (biomeId === 'CRYSTAL_DEPTHS' ? 1 : 0);
    if (lampsPerRoom > 0) {
      for (const room of rooms) {
        for (let k = 0; k < lampsPerRoom; k++) {
          const jx = room.cx + (k % 2);
          const jz = room.cz + (k >> 1);
          this._addCrystalLamp(
            new THREE.Vector3(cellCenter(jx), 1.8, cellCenter(jz)),
            biome,
          );
        }
      }
    }

    // --- god rays: VAULT rooms only, one additive shaft per torch inside ---
    for (const room of rooms) {
      if (room.type !== 'VAULT') continue;
      const inVault = this.torches.filter((t) => this._cellInRoom(t.position, room, cellSize));
      for (const t of inVault) {
        this._addGodRay(t.position);
      }
    }

    // --- start / exit markers (§26) ---------------------------------------
    this._addStartMarker(entrancePos);
    this._addExitMarker(exitPos);

    scene.add(this.group);
    return this;
  }

  /** BRIGHT buff: ambient ×2.5, fog density ×0.35 (§11). */
  setBright(bright) {
    if (!this.ambient) return this;
    this.ambient.intensity = this._brightBaseAmbient * (bright ? BUFF.BRIGHT.ambientMult : 1);
    if (this.fog) {
      this.fog.density = this._biomeFogDensity * (bright ? BUFF.BRIGHT.fogDensityMult : 1);
    }
    return this;
  }

  /**
   * Degraded tier 2: drop the shadow-casting torch budget to 0 (§12.1/§22).
   * Passing 0 strips the budget; passing 1 restores it (re-picks the
   * nearest-entrance torch, which was assigned statically at build).
   */
  setDegraded(count = 0) {
    this._shadowBudget = count;
    if (count > 0) {
      if (this._shadowTorch) return this; // already holding the budget
      if (this.torches.length === 0 || !this._entrancePos) return this;
      let best = null;
      let bestD = Infinity;
      for (const t of this.torches) {
        const d = t.position.distanceToSquared(this._entrancePos);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best) this._applyShadowBudget(best);
    } else {
      if (this._shadowTorch) {
        this._shadowTorch.light.castShadow = false;
        this._shadowTorch.castShadow = false;
        this._shadowTorch = null;
      }
    }
    return this;
  }

  /** Dispose torch lights AND ambient from the scene; dispose tracked resources. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    if (this.ambient && this.scene) this.scene.remove(this.ambient);
    if (this.scene) this.scene.remove(this.group);

    // lights are parented to their meshes; removing the group removes the lights

    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;

    this.torches.length = 0;
    this.lightList.length = 0;
    this._shadowTorch = null;
    this.group.clear();
    this.ambient = null;
    this.fog = null;
    this.scene = null;
  }

  // ------------------------------------------------------------------------
  // internals
  // ------------------------------------------------------------------------

  /**
   * Torch placement per §7.3/§22: one torch per exposed grid edge at 16 u
   * spacing, y 2.5; vaultOnly biomes → only edges inside VAULT rooms.
   * Returns world-space positions (Vector3, y = LIGHTING.TORCH_Y).
   */
  _torchPositions(grid, gridSize, cellSize, rooms, biome) {
    const positions = [];
    const spacing = LIGHTING.TORCH_SPACING; // 16 u
    const every = Math.max(1, Math.ceil(spacing / cellSize)); // 16/6 → 3 cells apart

    // exposed edges with the open cell + boundary line, like RuneSystem.
    // An edge is "exposed" only where a SOLID cell borders an EMPTY cell —
    // that's the interior wall face lighting the playable space. The dungeon's
    // OUTER perimeter (cx/cz === 0 or gridSize-1) is the exterior shell: it
    // borders the void, not a corridor, so it must NOT emit edges. Treating it
    // as exposed (the old `cx === 0 ||` short-circuit) placed torches + their
    // PointLights on the dungeon's outside face, i.e. lights "outside the map."
    const edges = [];
    for (let cx = 0; cx < gridSize; cx++) {
      for (let cz = 0; cz < gridSize; cz++) {
        if (grid[cx][cz] === 'empty') continue;
        if (cx > 0 && grid[cx - 1][cz] === 'empty') edges.push({ axis: 'X', cx, cz, boundary: cx * cellSize });
        if (cx < gridSize - 1 && grid[cx + 1][cz] === 'empty') edges.push({ axis: 'X', cx, cz, boundary: (cx + 1) * cellSize });
        if (cz > 0 && grid[cx][cz - 1] === 'empty') edges.push({ axis: 'Z', cx, cz, boundary: cz * cellSize });
        if (cz < gridSize - 1 && grid[cx][cz + 1] === 'empty') edges.push({ axis: 'Z', cx, cz, boundary: (cz + 1) * cellSize });
      }
    }

    const vaultByCell = new Set();
    for (const r of rooms) {
      if (r.type !== 'VAULT') continue;
      for (let i = r.cx; i < r.cx + r.w; i++) {
        for (let j = r.cz; j < r.cz + r.h; j++) {
          vaultByCell.add(i + ',' + j);
        }
      }
    }

    // Group edges into continuous collinear runs: same axis, same boundary
    // value, consecutive along-coordinate. For axis X edges the wall line is
    // fixed in x (boundary) and runs along z (along = cz); for axis Z edges
    // it is fixed in z and runs along x (along = cx).
    const runs = new Map(); // key: axis|boundary → array of edges (in along order)
    for (const e of edges) {
      // axis X: boundary fixed in x, along-coord is cz; axis Z: boundary fixed
      // in z, along-coord is cx.
      const lineKey = e.axis + '|' + e.boundary;
      if (!runs.has(lineKey)) runs.set(lineKey, []);
      runs.get(lineKey).push(e);
    }

    for (const run of runs.values()) {
      // sort by along-coordinate (cz for axis X, cx for axis Z)
      run.sort((a, b) => (a.axis === 'X' ? a.cz - b.cz : a.cx - b.cx));
      // torches: first edge of the run, then every `every` consecutive edge
      for (let i = 0; i < run.length; i++) {
        if (i % every !== 0) continue;
        const e = run[i];
        if (biome.torchMode === 'vaultOnly' && !vaultByCell.has(e.cx + ',' + e.cz)) continue;
        if (e.axis === 'X') {
          const z = e.boundary + cellSize / 2;
          // nudge slightly off the wall line into the open cell
          const westOpen = (e.cx === 0) || grid[e.cx - 1][e.cz] === 'empty';
          const off = (westOpen ? -1 : 1) * 0.25;
          positions.push(new THREE.Vector3(e.boundary + off, LIGHTING.TORCH_Y, z));
        } else {
          const x = e.boundary + cellSize / 2;
          const northOpen = (e.cz === 0) || grid[e.cx][e.cz - 1] === 'empty';
          const off = (northOpen ? -1 : 1) * 0.25;
          positions.push(new THREE.Vector3(x, LIGHTING.TORCH_Y, e.boundary + off));
        }
      }
    }
    return positions;
  }

  _addTorch(pos, biome) {
    const src = LIGHT_SOURCES.TORCH;

    const mesh = new THREE.Group();
    mesh.position.copy(pos);

    // pole
    const poleGeo = new THREE.CylinderGeometry(0.04, 0.06, LIGHTING.TORCH_Y, 5);
    this.geometries.push(poleGeo);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 1 });
    this.materials.push(poleMat);
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.y = -LIGHTING.TORCH_Y / 2;
    mesh.add(pole);

    // flame (basic emissive-look sphere; cheap + headless-safe)
    const flameGeo = new THREE.SphereGeometry(0.14, 8, 6);
    this.geometries.push(flameGeo);
    const flameMat = new THREE.MeshBasicMaterial({ color: biome.torchColor });
    this.materials.push(flameMat);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 0.05;
    mesh.add(flame);

    const light = new THREE.PointLight(biome.torchColor, src.intensity, src.distance, src.decay);
    light.castShadow = false; // every light shadow-free until budget assigned
    light.position.set(0, 0.05, 0);
    mesh.add(light);

    this.group.add(mesh);
    const entry = { mesh, light, position: pos.clone(), castShadow: false };
    this.torches.push(entry);
    this.lightList.push(light);
    return entry;
  }

  /** Assign (or revoke) the single shadow budget to `torch`. Static (§12.1). */
  _applyShadowBudget(torch) {
    if (!torch) return;
    const s = torch.light;
    s.castShadow = true;
    s.shadow.mapSize.set(LIGHTING.TORCH_SHADOW_MAP_SIZE, LIGHTING.TORCH_SHADOW_MAP_SIZE);
    s.shadow.camera.near = LIGHTING.TORCH_SHADOW_NEAR;
    s.shadow.camera.far = LIGHTING.TORCH_SHADOW_FAR;
    s.shadow.bias = LIGHTING.TORCH_SHADOW_BIAS;
    s.shadow.normalBias = LIGHTING.TORCH_SHADOW_NORMAL_BIAS;
    torch.castShadow = true;
    this._shadowTorch = torch;
  }

  _addBrazier(pos, biome) {
    const src = LIGHT_SOURCES.BRAZIER;
    const mesh = new THREE.Group();
    mesh.position.copy(pos);

    const bowlGeo = new THREE.CylinderGeometry(0.5, 0.35, 0.9, 8);
    this.geometries.push(bowlGeo);
    const bowlMat = new THREE.MeshStandardMaterial({ color: biome.wall, roughness: 0.8 });
    this.materials.push(bowlMat);
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.position.y = 0.45;
    mesh.add(bowl);

    const flameGeo = new THREE.SphereGeometry(0.22, 8, 6);
    this.geometries.push(flameGeo);
    const flameMat = new THREE.MeshBasicMaterial({ color: biome.torchColor });
    this.materials.push(flameMat);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.y = 1.1;
    mesh.add(flame);

    const light = new THREE.PointLight(biome.torchColor, src.intensity, src.distance, src.decay);
    light.castShadow = false;
    light.position.y = 1.2;
    mesh.add(light);

    this.group.add(mesh);
    this.lightList.push(light);
  }

  _addCrystalLamp(pos, biome) {
    const src = LIGHT_SOURCES.CRYSTAL;
    const mesh = new THREE.Group();
    mesh.position.copy(pos);

    const shardGeo = new THREE.ConeGeometry(0.25, 1.1, 5);
    this.geometries.push(shardGeo);
    const shardMat = new THREE.MeshBasicMaterial({
      color: biome.torchColor,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.materials.push(shardMat);
    const shard = new THREE.Mesh(shardGeo, shardMat);
    mesh.add(shard);

    const light = new THREE.PointLight(biome.torchColor, src.intensity, src.distance, src.decay);
    light.castShadow = false;
    light.position.y = 0.2;
    mesh.add(light);

    this.group.add(mesh);
    this.lightList.push(light);
  }

  /** Additive light shaft for a torch inside a VAULT room (§26). */
  _addGodRay(pos) {
    const geo = new THREE.CylinderGeometry(0.02, 0.9, DUNGEON.WALL_HEIGHT, 8, 1, true);
    this.geometries.push(geo);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe9b0,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(mat);
    const shaft = new THREE.Mesh(geo, mat);
    shaft.position.set(pos.x, DUNGEON.WALL_HEIGHT / 2, pos.z);
    this.group.add(shaft);
  }

  _addStartMarker(pos) {
    const ringGeo = new THREE.RingGeometry(0.6, 0.9, 24);
    this.geometries.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x33ff66,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    });
    this.materials.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.05, pos.z);
    this.group.add(ring);

    const light = new THREE.PointLight(0x33ff66, 2, 10, 1.4);
    light.castShadow = false;
    light.position.set(pos.x, 1.2, pos.z);
    this.group.add(light);
    this.lightList.push(light);
  }

  _addExitMarker(pos) {
    const ringGeo = new THREE.RingGeometry(0.8, 1.1, 28);
    this.geometries.push(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffcc33,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    this.materials.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, 0.06, pos.z);
    this.group.add(ring);

    // glow disc (additive)
    const glowGeo = new THREE.CircleGeometry(0.8, 24);
    this.geometries.push(glowGeo);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffcc33,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.materials.push(glowMat);
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(pos.x, 0.07, pos.z);
    this.group.add(glow);

    // vertical beam
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, DUNGEON.WALL_HEIGHT, 12, 1, true);
    this.geometries.push(beamGeo);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffcc33,
      transparent: true,
      opacity: 0.10,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.materials.push(beamMat);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.set(pos.x, DUNGEON.WALL_HEIGHT / 2, pos.z);
    this.group.add(beam);

    const src = LIGHT_SOURCES.PORTAL;
    const light = new THREE.PointLight(0xffcc33, src.intensity, src.distance, src.decay);
    light.castShadow = false;
    light.position.set(pos.x, 1.3, pos.z);
    this.group.add(light);
    this.lightList.push(light);
  }

  /** Is a world position inside a room's cell footprint? */
  _cellInRoom(pos, room, cellSize) {
    const cx = Math.floor(pos.x / cellSize);
    const cz = Math.floor(pos.z / cellSize);
    return cx >= room.cx && cx < room.cx + room.w && cz >= room.cz && cz < room.cz + room.h;
  }
}

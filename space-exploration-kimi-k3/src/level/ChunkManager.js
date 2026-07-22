// VOID DRIFT — ChunkManager.js
// 3D cubic chunk streaming. Seeded per-chunk generation, biome-tuned content,
// origin safety radius, wormhole tunnels, collidable aggregation.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { mulberry32, chunkSeed } from '../utils/MathHelpers.js';
import { BiomeGenerator } from './BiomeGenerator.js';
import { SIMPLEX_3D_GLSL, WORMHOLE_VERTEX, WORMHOLE_FRAGMENT } from '../utils/ShaderHelpers.js';

export class ChunkManager {
  constructor(scene, subsystems) {
    this._scene = scene;
    // subsystems: { asteroids, debris, collectibles, nebula, npcs, planets, wormholes }
    this._sub = subsystems;
    this._wormholes = subsystems.wormholes || { register(){}, unregister(){}, update(){}, applyTeleport(){} };
    this._biome = new BiomeGenerator();
    this._chunks = new Map();   // "cx,cy,cz" -> { cx, cy, cz, center, wormhole? }
    this.currentBiomeName = '';
  }

  init() { /* lazy */ }

  _chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }

  _spawnChunk(cx, cy, cz, shipPos) {
    const key = this._chunkKey(cx, cy, cz);
    if (this._chunks.has(key)) return;
    const S = Constants.CHUNK.SIZE;
    const center = new THREE.Vector3(cx * S + S / 2, cy * S + S / 2, cz * S + S / 2);
    const shipDistance = shipPos ? shipPos.length() : center.length();

    // Biome from ship distance so transitions follow player progress.
    const params = this._biome.getBiomeParams(shipDistance);
    const rng = mulberry32(chunkSeed(cx, cy, cz));

    // Origin safety: no hostile content near spawn.
    const isSafe = shipDistance < Constants.CHUNK.ORIGIN_SAFETY_RADIUS + Constants.CHUNK.SIZE;

    let wormhole = null;
    if (params.wormhole && !isSafe) {
      wormhole = this._spawnWormhole(center, rng, params.nebulaColors);
      wormhole.userData.chunkKey = key;
      this._wormholes.register(wormhole, center, key);
    }

    this._chunks.set(key, { cx, cy, cz, center, wormhole });

    // Ship-relative spawning: entities live near the ship shell, not the chunk center.
    const spawnRadius = Constants.CHUNK.SIZE * 0.5;
    const keepOutRadius = Constants.CHUNK.KEEP_OUT_RADIUS || 0;

    const allowed = new Set(params.entities || []);
    if (allowed.has('asteroid')) {
      this._sub.asteroids.generateChunk(center, rng, params.asteroidDensity, isSafe, shipPos, spawnRadius, keepOutRadius);
      this._sub.asteroids.tagChunk(key);
    }
    if (allowed.has('debris')) {
      this._sub.debris.generateChunk(center, rng, params.debrisCount, isSafe, shipPos, spawnRadius, keepOutRadius);
      this._sub.debris.tagChunk(key);
    }
    if (allowed.has('crystal') || allowed.has('ruin') || allowed.has('boost')) {
      this._sub.collectibles.generateChunk(center, rng, isSafe, allowed, key, shipPos, spawnRadius, keepOutRadius);
      this._sub.collectibles.tagChunk(key);
    }
    if (allowed.has('cloud')) {
      this._sub.nebula.generateChunk(center, rng, params.nebulaCount || 1, params.nebulaColors, isSafe);
      this._sub.nebula.tagChunk(key);
    }
  }

  _spawnWormhole(center, rng, colors) {
    const length = Constants.CHUNK.SIZE * 3.5;
    const outerGeo = new THREE.CylinderGeometry(32, 32, length, 28, 8, true);
    const outerMat = new THREE.ShaderMaterial({
      vertexShader: WORMHOLE_VERTEX,
      fragmentShader: `${SIMPLEX_3D_GLSL}\n${WORMHOLE_FRAGMENT}`,
      uniforms: {
        uTime: { value: rng() * 100 },
        uColor1: { value: new THREE.Color(colors[0]) },
        uColor2: { value: new THREE.Color(colors[1 % colors.length]) },
      },
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.position.copy(center);
    outer.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    outer.userData = { isChunkObject: true, isWormhole: true };
    this._scene.add(outer);

    const innerGeo = new THREE.CylinderGeometry(18, 18, length, 24, 6, true);
    const innerMat = new THREE.ShaderMaterial({
      vertexShader: WORMHOLE_VERTEX,
      fragmentShader: `${SIMPLEX_3D_GLSL}\n${WORMHOLE_FRAGMENT}`,
      uniforms: {
        uTime: { value: outerMat.uniforms.uTime.value },
        uColor1: { value: new THREE.Color(colors[1 % colors.length]) },
        uColor2: { value: new THREE.Color(colors[0]) },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.copy(center);
    inner.rotation.copy(outer.rotation);
    inner.userData = { isChunkObject: true, isWormholeInner: true };
    this._scene.add(inner);

    const group = { outer, outerMat, inner, innerMat, rotation: outer.rotation };
    group.userData = { isChunkObject: true, isWormhole: true };
    return group;
  }

  _evictChunk(key, chunk) {
    this._sub.asteroids.clearChunk(key);
    this._sub.debris.clearChunk(key);
    this._sub.collectibles.clearChunk(key);
    this._sub.nebula.clearChunk(key);
    if (chunk.wormhole) {
      const w = chunk.wormhole;
      this._scene.remove(w.outer);
      this._scene.remove(w.inner);
      w.outer.geometry.dispose();
      w.outerMat.dispose();
      w.inner.geometry.dispose();
      w.innerMat.dispose();
      this._wormholes.unregister(chunk.wormhole.userData.chunkKey);
    }
    this._chunks.delete(key);
  }

  update(shipPos, time) {
    const S = Constants.CHUNK.SIZE;
    const scx = Math.floor(shipPos.x / S);
    const scy = Math.floor(shipPos.y / S);
    const scz = Math.floor(shipPos.z / S);
    const ahead = Constants.CHUNK.SPAWN_AHEAD;

    // Spawn neighborhood shell (3D).
    for (let dx = -ahead; dx <= ahead; dx++) {
      for (let dy = -ahead; dy <= ahead; dy++) {
        for (let dz = -ahead; dz <= ahead; dz++) {
          this._spawnChunk(scx + dx, scy + dy, scz + dz);
        }
      }
    }

    // Evict: signed-axis check (3D migration pitfall — never require all axes).
    const toRemove = [];
    for (const [key, chunk] of this._chunks) {
      const dx = chunk.cx - scx;
      const dy = chunk.cy - scy;
      const dz = chunk.cz - scz;
      if (dx < -Constants.CHUNK.CLEANUP_BEHIND || dx > ahead + 1 ||
          dy < -Constants.CHUNK.CLEANUP_BEHIND || dy > ahead + 1 ||
          dz < -Constants.CHUNK.CLEANUP_BEHIND || dz > ahead + 1) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) this._evictChunk(key, this._chunks.get(key));

    // Track current biome for ambience.
    const biome = this._biome.getBiome(shipPos.length());
    this.currentBiomeName = biome.name;

    // Animate wormholes.
    for (const [, chunk] of this._chunks) {
      if (chunk.wormhole) {
        const t = time;
        chunk.wormhole.outerMat.uniforms.uTime.value = t;
        chunk.wormhole.innerMat.uniforms.uTime.value = t;
      }
    }
  }

  /**
   * Aggregate collidables near the ship: instanced per-instance records are
   * exposed via the meshes (PhysicsSystem iterates them), plus individual
   * meshes and NPC ships.
   */
  getCollidables(shipPos) {
    if (!shipPos) return [];
    const S = Constants.CHUNK.SIZE * 1.5;
    const list = [];
    for (const o of this._sub.asteroids._objects) {
      if (Math.abs(o.position.x - shipPos.x) < S &&
          Math.abs(o.position.y - shipPos.y) < S &&
          Math.abs(o.position.z - shipPos.z) < S) list.push(o);
    }
    for (const m of this._sub.debris._meshes) {
      if (Math.abs(m.position.x - shipPos.x) < S &&
          Math.abs(m.position.y - shipPos.y) < S &&
          Math.abs(m.position.z - shipPos.z) < S) list.push(m);
    }
    const planets = this._sub.planets && this._sub.planets._planets;
    if (planets) {
      for (const [, p] of planets) {
        if (Math.abs(p.mesh.position.x - shipPos.x) < S &&
            Math.abs(p.mesh.position.y - shipPos.y) < S &&
            Math.abs(p.mesh.position.z - shipPos.z) < S) list.push(p.mesh);
      }
    }
    for (const npcMesh of this._sub.npcs.getCollidables()) {
      if (Math.abs(npcMesh.position.x - shipPos.x) < S &&
          Math.abs(npcMesh.position.y - shipPos.y) < S &&
          Math.abs(npcMesh.position.z - shipPos.z) < S) list.push(npcMesh);
    }
    for (const [, chunk] of this._chunks) {
      if (chunk.wormhole) {
        const dx = shipPos.x - chunk.center.x;
        const dy = shipPos.y - chunk.center.y;
        const dz = shipPos.z - chunk.center.z;
        if (Math.abs(dx) < S && Math.abs(dy) < S && Math.abs(dz) < S) list.push(chunk.wormhole.outer || chunk.wormhole);
      }
    }
    return list;
  }

  /** Route a destruction to the owning subsystem. */
  destroyTarget(hit) {
    if (hit.kind === 'instance') {
      const mesh = hit.mesh;
      if (mesh.userData.tier === 'debris') {
        this._sub.debris.killInstance(mesh, hit.instance.instanceId);
      } else {
        this._sub.asteroids.killInstance(mesh, hit.instance.instanceId);
      }
      hit.instance.alive = false;
      return mesh.userData.tier === 'debris' ? 'debris' : 'asteroid';
    }
    if (mesh.userData.kind === 'npc') {
      return this._sub.npcs.buildShipHull(mesh.userData.npcPreset);
    }
    // Large asteroid mesh.
    hit.mesh.userData.isDestroyed = true;
    this._sub.asteroids.destroyMesh(hit.mesh);
    return 'asteroid';
  }

  resolveNpcHit(hit) {
    if (hit && hit.mesh && hit.mesh.userData && hit.mesh.userData.kind === 'npc') {
      this._sub.npcs.killNPC(hit.mesh);
      return 'npc';
    }
    return null;
  }

  clearAll() {
    for (const [key, chunk] of [...this._chunks]) this._evictChunk(key, chunk);
    this._sub.asteroids.clearAll();
    this._sub.debris.clearAll();
    this._sub.collectibles.clearAll();
    this._sub.nebula.clearAll();
    this._sub.npcs.clearAll();
  }

  destroy() { this.clearAll(); }
}

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
    // subsystems: { asteroids, debris, collectibles, nebula, npcs }
    this._sub = subsystems;
    this._biome = new BiomeGenerator();
    this._chunks = new Map();   // "cx,cy,cz" -> { cx, cy, cz, center, wormhole? }
    this._center = new THREE.Vector3();
    this.currentBiomeName = '';
  }

  init() { /* lazy */ }

  _chunkKey(cx, cy, cz) { return `${cx},${cy},${cz}`; }

  _spawnChunk(cx, cy, cz) {
    const key = this._chunkKey(cx, cy, cz);
    if (this._chunks.has(key)) return;
    const S = Constants.CHUNK.SIZE;
    const center = new THREE.Vector3(cx * S + S / 2, cy * S + S / 2, cz * S + S / 2);

    // Biome from distance of chunk center.
    const distance = center.length();
    const params = this._biome.getBiomeParams(distance);
    const rng = mulberry32(chunkSeed(cx, cy, cz));

    // Origin safety: no hostile content near spawn.
    const isSafe = center.length() < Constants.CHUNK.ORIGIN_SAFETY_RADIUS + Constants.CHUNK.SIZE;

    this._sub.asteroids.generateChunk(center, rng, params.asteroidDensity, isSafe);
    this._sub.asteroids.tagChunk(key);
    this._sub.debris.generateChunk(center, rng, params.debrisCount, isSafe);
    this._sub.debris.tagChunk(key);
    this._sub.collectibles.generateChunk(center, rng, isSafe);
    this._sub.collectibles.tagChunk(key);
    this._sub.nebula.generateChunk(center, rng, params.nebulaCount, params.nebulaColors, false);
    this._sub.nebula.tagChunk(key);

    let wormhole = null;
    if (params.wormhole && !isSafe) {
      wormhole = this._spawnWormhole(center, rng, params.nebulaColors);
      wormhole.userData.chunkKey = key;
    }

    this._chunks.set(key, { cx, cy, cz, center, wormhole });
  }

  _spawnWormhole(center, rng, colors) {
    const length = Constants.CHUNK.SIZE * 1.6;
    const geo = new THREE.CylinderGeometry(28, 28, length, 24, 1, true);
    const mat = new THREE.ShaderMaterial({
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
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    mesh.userData = { isChunkObject: true, isWormhole: true };
    this._scene.add(mesh);
    return mesh;
  }

  _evictChunk(key, chunk) {
    this._sub.asteroids.clearChunk(key);
    this._sub.debris.clearChunk(key);
    this._sub.collectibles.clearChunk(key);
    this._sub.nebula.clearChunk(key);
    if (chunk.wormhole) {
      this._scene.remove(chunk.wormhole);
      chunk.wormhole.geometry.dispose();
      chunk.wormhole.material.dispose();
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
      if (chunk.wormhole) chunk.wormhole.material.uniforms.uTime.value = time;
    }
  }

  /**
   * Aggregate collidables near the ship: instanced per-instance records are
   * exposed via the meshes (PhysicsSystem iterates them), plus individual
   * meshes and NPC ships.
   */
  getCollidables(shipPos) {
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
    for (const npcMesh of this._sub.npcs.getCollidables()) {
      if (Math.abs(npcMesh.position.x - shipPos.x) < S &&
          Math.abs(npcMesh.position.y - shipPos.y) < S &&
          Math.abs(npcMesh.position.z - shipPos.z) < S) list.push(npcMesh);
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
    if (hit.kind === 'npc') {
      this._sub.npcs.killNPC(hit.mesh);
      return 'npc';
    }
    // Large asteroid mesh.
    hit.mesh.userData.isDestroyed = true;
    this._sub.asteroids.destroyMesh(hit.mesh);
    return 'asteroid';
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

import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { mulberry32, hash2, randRange } from '../utils/MathHelpers.js';

// Chunk/segment spawn (around ship) & cleanup (spec §6.3).
// Content is seeded by chunk coordinates for deterministic regeneration.
const TUNNEL_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const TUNNEL_FRAGMENT = `
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float swirl = sin(uv.y * 24.0 + uTime * 3.0) * 0.5 + 0.5;
  float band = sin(uv.x * 6.2831 * 3.0 + uTime * 1.5) * 0.5 + 0.5;
  vec3 colA = vec3(0.45, 0.2, 0.8);
  vec3 colB = vec3(0.15, 0.6, 0.9);
  vec3 col = mix(colA, colB, swirl * 0.55 + band * 0.45);
  float edge = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);
  float a = 0.32 * edge;
  gl_FragColor = vec4(col, a);
}
`;

export class ChunkManager {
  constructor(scene, events, systems, biomeGen) {
    this.scene = scene;
    this.events = events;
    this.systems = systems; // { asteroidField, debrisSystem, nebulaSystem, cometSystem, blackHoleSystem, deadStarSystem, stationSystem }
    this.biomeGen = biomeGen;
    this.chunks = new Map();
    this.tunnels = []; // { curve, closestT } — for wormhole blur
    this._group = new THREE.Group();
    this._group.name = 'chunks';
    scene.add(this._group);
  }

  currentChunk(pos) {
    const s = Constants.CHUNK_SIZE;
    return {
      cx: Math.floor(pos.x / s),
      cy: Math.floor(pos.y / s),
      cz: Math.floor(pos.z / s),
    };
  }

  update(shipPos, odometer) {
    const { cx, cy, cz } = this.currentChunk(shipPos);
    const R = Constants.CHUNKS_RADIUS;
    const VR = Constants.CHUNKS_VERTICAL_RADIUS;

    // Spawn missing chunks around the ship (5x5 horizontal, 3 vertical layers)
    for (let dy = -VR; dy <= VR; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          if (!this.chunks.has(key)) {
            this._spawnChunk(cx + dx, cy + dy, cz + dz, odometer, shipPos);
          }
        }
      }
    }

    // Cleanup chunks too far away
    const cleanup = Constants.CHUNKS_CLEANUP_RADIUS;
    for (const [key, chunk] of [...this.chunks]) {
      const d = Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz), Math.abs(chunk.cy - cy));
      if (d > cleanup) this._cleanupChunk(chunk);
    }
  }

  _spawnChunk(cx, cy, cz, odometer, shipPos) {
    const biome = this.biomeGen.getBiome(odometer);
    const cfg = biome.cfg;
    const mult = this.biomeGen.intensity(odometer);
    const rng = mulberry32(hash2(cx, cz));
    const chunk = {
      cx, cz,
      cy,
      key: `${cx},${cy},${cz}`,
      biome: biome.key,
      rng,
    };

    const S = this.systems;
    S.asteroidField.spawnChunk(chunk, rng, cfg, mult);
    S.debrisSystem.spawnChunk(chunk, rng, cfg);
    S.nebulaSystem.spawnChunk(chunk, rng, cfg, mult);
    S.cometSystem.spawnChunk(chunk, rng, cfg, mult, shipPos);
    S.blackHoleSystem.spawnChunk(chunk, rng, cfg, mult);
    S.deadStarSystem.spawnChunk(chunk, rng, cfg, shipPos);
    S.stationSystem.spawnChunk(chunk, rng, cfg, shipPos);
    if (S.crystalSystem) S.crystalSystem.spawnChunk(chunk, rng, cfg, shipPos);
    if (S.pulsarSystem) S.pulsarSystem.spawnChunk(chunk, rng, cfg, shipPos);
    if (S.stormSystem) S.stormSystem.spawnChunk(chunk, rng, cfg, shipPos);
    if (S.hulkSystem) S.hulkSystem.spawnChunk(chunk, rng, cfg, shipPos);
    if (S.citySystem) S.citySystem.spawnChunk(chunk, rng, cfg, shipPos);

    if (biome.key === 'WORMHOLE') this._spawnTunnel(chunk, rng);

    this.chunks.set(chunk.key, chunk);
    this.events.emit('environment:chunkSpawned', { chunkX: cx, chunkZ: cz });
  }

  _spawnTunnel(chunk, rng) {
    const s = Constants.CHUNK_SIZE;
    const x0 = chunk.cx * s;
    const z0 = chunk.cz * s;
    const y = chunk.cy * s + randRange(rng, -30, 30);
    const points = [
      new THREE.Vector3(x0 + randRange(rng, 0, s), y, z0 + randRange(rng, 0, s)),
      new THREE.Vector3(x0 + randRange(rng, 0, s), y + randRange(rng, -35, 35), z0 + randRange(rng, 0, s)),
      new THREE.Vector3(x0 + randRange(rng, 0, s), y + randRange(rng, -35, 35), z0 + randRange(rng, 0, s)),
      new THREE.Vector3(x0 + randRange(rng, 0, s), y, z0 + randRange(rng, 0, s)),
    ];
    const curve = new THREE.CatmullRomCurve3(points);

    const geo = new THREE.TubeGeometry(curve, 48, Constants.WORMHOLE_TUNNEL_RADIUS, 14, false);
    const mat = new THREE.ShaderMaterial({
      vertexShader: TUNNEL_VERTEX,
      fragmentShader: TUNNEL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: randRange(rng, 0, 100) } },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'wormhole-tunnel';
    this._group.add(mesh);

    chunk.tunnel = { curve, mesh, mat };
    this.tunnels.push({ curve, closestT: 0 });
  }

  _cleanupChunk(chunk) {
    const S = this.systems;
    S.asteroidField.cleanupChunk(chunk);
    S.debrisSystem.cleanupChunk(chunk);
    S.nebulaSystem.cleanupChunk(chunk);
    S.cometSystem.cleanupChunk(chunk);
    S.blackHoleSystem.cleanupChunk(chunk);
    S.deadStarSystem.cleanupChunk(chunk);
    S.stationSystem.cleanupChunk(chunk);
    if (S.crystalSystem) S.crystalSystem.cleanupChunk(chunk);
    if (S.pulsarSystem) S.pulsarSystem.cleanupChunk(chunk);
    if (S.stormSystem) S.stormSystem.cleanupChunk(chunk);
    if (S.hulkSystem) S.hulkSystem.cleanupChunk(chunk);
    if (S.citySystem) S.citySystem.cleanupChunk(chunk);
    if (chunk.tunnel) {
      this._group.remove(chunk.tunnel.mesh);
      chunk.tunnel.geo?.dispose();
      chunk.tunnel.mat.dispose();
      const idx = this.tunnels.findIndex((t) => t.curve === chunk.tunnel.curve);
      if (idx >= 0) this.tunnels.splice(idx, 1);
    }
    this.chunks.delete(chunk.key);
    this.events.emit('environment:chunkCleaned', { chunkX: chunk.cx, chunkZ: chunk.cz });
  }

  updateTunnelTime(dt) {
    for (const chunk of this.chunks.values()) {
      if (chunk.tunnel) chunk.tunnel.mat.uniforms.uTime.value += dt;
    }
  }

  /** Remove everything (restart / dispose). */
  clearAll() {
    for (const chunk of [...this.chunks.values()]) this._cleanupChunk(chunk);
  }

  dispose() {
    this.clearAll();
    this.scene.remove(this._group);
  }
}

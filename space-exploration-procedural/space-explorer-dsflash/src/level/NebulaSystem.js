import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { NEBULA_VERTEX, NEBULA_FRAGMENT } from '../utils/ShaderHelpers.js';
import { randRange } from '../utils/MathHelpers.js';

// Volumetric-feel nebula clouds: billboard clusters with fbm noise shader (spec §5.2).
export class NebulaSystem {
  constructor(scene) {
    this.scene = scene;
    this.clusters = [];
    this._group = new THREE.Group();
    this._group.name = 'nebulae';
    scene.add(this._group);
  }

  /** Spawn `count` clusters into a chunk record. */
  spawnChunk(chunk, rng, biomeCfg, mult) {
    const count = Math.max(1, Math.round(biomeCfg.nebulaCount * mult.nebula));
    chunk.nebulae = [];
    for (let i = 0; i < count; i++) {
      chunk.nebulae.push(this._spawnCluster(chunk, rng, biomeCfg));
    }
  }

  _spawnCluster(chunk, rng, biomeCfg) {
    const center = new THREE.Vector3(
      chunk.cx * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE),
      randRange(rng, -Constants.WORLD_Y_BAND, Constants.WORLD_Y_BAND),
      chunk.cz * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE),
    );

    const base = new THREE.Color(biomeCfg.color[0], biomeCfg.color[1], biomeCfg.color[2]);
    const colorA = base.clone().multiplyScalar(2.2);
    const colorB = base.clone().multiplyScalar(3.2).add(new THREE.Color(0.15, 0.15, 0.25));

    const seed = Math.floor(rng() * 1000);
    const mat = new THREE.ShaderMaterial({
      vertexShader: NEBULA_VERTEX,
      fragmentShader: NEBULA_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: rng() * 100 },
        uColorA: { value: colorA },
        uColorB: { value: colorB },
        uOpacity: { value: 0.25 + rng() * 0.2 },
        uScale: { value: 2.5 + rng() * 2.5 },
        uSeed: { value: seed },
      },
    });

    const group = new THREE.Group();
    group.position.copy(center);
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    const billboards = [];
    const n = 8 + Math.floor(rng() * 5); // 8-12
    for (let i = 0; i < n; i++) {
      const plane = new THREE.Mesh(planeGeo, mat);
      const s = randRange(rng, 40, 90);
      plane.scale.set(s, s * randRange(rng, 0.6, 1), 1);
      plane.position.set(randRange(rng, -60, 60), randRange(rng, -45, 45), randRange(rng, -60, 60));
      plane.rotation.z = rng() * Math.PI;
      group.add(plane);
      billboards.push(plane);
    }
    // Core point light (spec §5.3) — visibility toggled by update()
    const light = new THREE.PointLight(biomeCfg.color[0] * 3, 0.8 + rng() * 0.7, 120, 2);
    light.position.set(0, 0, 0);
    group.add(light);

    this._group.add(group);
    const cluster = { group, billboards, light, center, mat, base };
    this.clusters.push(cluster);
    return cluster;
  }

  /** Billboard planes toward camera; cull lights to budget. */
  update(dt, camera) {
    const camPos = camera.position;
    // Distance-sorted light budget
    const candidates = [];
    for (const c of this.clusters) {
      const d = c.center.distanceToSquared(camPos);
      c._distSq = d;
      if (d < 600 * 600) candidates.push(c);
      c.light.visible = false;
    }
    candidates.sort((a, b) => a._distSq - b._distSq);
    const budget = Math.min(Constants.MAX_ACTIVE_LIGHTS, candidates.length);
    for (let i = 0; i < budget; i++) candidates[i].light.visible = true;

    for (const c of this.clusters) {
      c.mat.uniforms.uTime.value += dt;
      for (const p of c.billboards) p.lookAt(camPos);
    }
  }

  /** Remove all clusters belonging to a chunk record. */
  cleanupChunk(chunk) {
    if (!chunk.nebulae) return;
    for (const c of chunk.nebulae) {
      this._group.remove(c.group);
      c.mat.dispose();
      const idx = this.clusters.indexOf(c);
      if (idx >= 0) this.clusters.splice(idx, 1);
    }
    chunk.nebulae = [];
  }

  dispose() {
    for (const c of [...this.clusters]) {
      this._group.remove(c.group);
      c.mat.dispose();
    }
    this.clusters = [];
    this.scene.remove(this._group);
  }
}

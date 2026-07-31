import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';
import { softDotTexture } from '../utils/ShaderHelpers.js';

// Crystal shard clusters (spec v2.0 §3.4.1): translucent instanced octahedra,
// fragile (1 beam hit), 40 pts, and BEAM-SPLIT — a beam hitting a shard spawns
// 2 child beams at ±18° (handled by WeaponSystem via the crystal body type).
export class CrystalSystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.bodies = [];
    this.clusters = [];
    this._group = new THREE.Group();
    this._group.name = 'crystals';
    scene.add(this._group);

    const C = Constants.CRYSTAL;
    this._geo = new THREE.OctahedronGeometry(1, 0);
    this._mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    this._inst = new THREE.InstancedMesh(this._geo, this._mat, C.instancedPool);
    this._inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._group.add(this._inst);
    // Pre-seed instance colors
    for (let i = 0; i < C.instancedPool; i++) {
      this._inst.setColorAt(i, new THREE.Color(C.colors[i % C.colors.length]));
    }
    this._nextSlot = 0;
    this._slotChunk = new Map();

    this._glowTex = softDotTexture();
  }

  spawnChunk(chunk, rng, cfg, shipPos) {
    const C = Constants.CRYSTAL;
    if (!cfg.crystalDensity || cfg.crystalDensity <= 0) { chunk.crystals = []; return; }
    const count = cfg.crystalDensity; // final per-chunk count (spec v2.0 §3.3)
    const s = Constants.CHUNK_SIZE;
    const x0 = chunk.cx * s, z0 = chunk.cz * s;
    const yBase = chunk.cy * s;

    for (let c = 0; c < count; c++) {
      const cx = x0 + randRange(rng, 0, s);
      const cz = z0 + randRange(rng, 0, s);
      const cy = yBase + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
      if (shipPos && Math.hypot(cx - shipPos.x, cy - shipPos.y, cz - shipPos.z) < C.minDistFromShip) continue;

      // Cluster glow sprite
      const glowMat = new THREE.SpriteMaterial({
        map: this._glowTex,
        color: 0x88ffff,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(cx, cy, cz);
      glow.scale.setScalar(4);
      this._group.add(glow);
      this.clusters.push({ x: cx, y: cy, z: cz, glow, glowMat });

      const shards = Math.round(randRange(rng, C.clusterMin, C.clusterMax));
      for (let i = 0; i < shards; i++) {
        const slot = this._nextSlot++;
        if (slot >= C.instancedPool) break; // pool exhausted — skip silently
        const radius = randRange(rng, C.radiusMin, C.radiusMax);
        const ang = randRange(rng, 0, Math.PI * 2);
        const rad = randRange(rng, 0, 6);
        const body = {
          type: 'crystal',
          owner: this,
          x: cx + Math.cos(ang) * rad,
          y: cy + randRange(rng, -3, 3),
          z: cz + Math.sin(ang) * rad,
          vx: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          vy: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          vz: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          radius,
          hp: C.hp,
          score: C.score,
          active: true,
          slot,
          phase: rng() * Math.PI * 2,
          chunkKey: chunk.key,
        };
        this.bodies.push(body);
        this._slotChunk.set(slot, chunk.key);
        this._writeInstance(body);
      }
    }
  }

  _writeInstance(body) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(body.phase, 1, 0).normalize(), body.phase,
    );
    const pos = new THREE.Vector3(body.x, body.y, body.z);
    m.compose(pos, q, new THREE.Vector3(body.radius, body.radius, body.radius));
    this._inst.setMatrixAt(body.slot, m);
    this._inst.count = Math.max(this._inst.count, body.slot + 1);
  }

  update(dt) {
    for (const b of this.bodies) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.phase += dt * Constants.CRYSTAL.tumble;
      this._writeInstance(b);
    }
    if (this.bodies.length) this._inst.instanceMatrix.needsUpdate = true;
  }

  remove(body) {
    if (!body.active) return;
    body.active = false;
    // zero-scale the instance (cheap despawn)
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    m.setPosition(body.x, body.y, body.z);
    this._inst.setMatrixAt(body.slot, m);
    this._inst.instanceMatrix.needsUpdate = true;
    this.events.emit('environment:crystalDestroyed', { position: { x: body.x, y: body.y, z: body.z }, score: body.score });
  }

  getColliders() {
    return this.bodies;
  }

  cleanupChunk(chunk) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      if (this.bodies[i].chunkKey === chunk.key) this.bodies.splice(i, 1);
    }
    for (let i = this.clusters.length - 1; i >= 0; i--) {
      if (this.clusters[i].glow) this._group.remove(this.clusters[i].glow);
      if (this.clusters[i].glowMat) this.clusters[i].glowMat.dispose();
      this.clusters.splice(i, 1);
    }
    // Reuse slots when the world is fully cleared (restart / region churn)
    if (this.bodies.length === 0) {
      this._nextSlot = 0;
      this._inst.count = 0;
    }
  }

  dispose() {
    this.scene.remove(this._group);
    this._geo.dispose();
    this._mat.dispose();
    this._glowTex.dispose();
    this._group.traverse((o) => {
      if (o.material && o.material !== this._mat) o.material.dispose();
    });
  }
}

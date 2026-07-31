import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';

// Floating debris + space junk (spec §5.7): tiny boxes + broken cylinders.
// Same body/collider API as AsteroidField so physics/weapons treat them uniformly.
export class DebrisSystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.bodies = [];
    this.colliders = [];
    this._group = new THREE.Group();
    this._group.name = 'debris';
    scene.add(this._group);

    this._geoBox = new THREE.BoxGeometry(1, 1, 1);
    this._geoJunk = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
    this._instBox = this._makeInstanced(this._geoBox, 2000);
    this._instJunk = this._makeInstanced(this._geoJunk, 2000);
    this._nextBox = 0;
    this._nextJunk = 0;
  }

  _makeInstanced(geo, count) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.3 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._group.add(mesh);
    return mesh;
  }

  _color() {
    const c = new THREE.Color();
    c.setHSL(Math.random() * 0.1 + 0.05, 0.1 + Math.random() * 0.2, 0.35 + Math.random() * 0.3);
    return c;
  }

  spawnChunk(chunk, rng, biomeCfg) {
    const count = Math.round(biomeCfg.asteroidDensity * Constants.DEBRIS_DENSITY_FACTOR * Constants.DENSITY_REDUCTION);
    chunk.debrisBodies = [];
    for (let i = 0; i < count; i++) {
      const isBox = rng() < 0.55;
      const scale = isBox
        ? randRange(rng, 0.05, 0.3)
        : randRange(rng, 0.1, 0.5);
      const speed = randRange(rng, 0.5, 2);
      const dir = new THREE.Vector3(randRange(rng, -1, 1), randRange(rng, -1, 1), randRange(rng, -1, 1)).normalize();
      const body = {
        type: 'debris',
        owner: this,
        isBox,
        scale,
        radius: scale * 0.6,
        hp: 25,
        score: Constants.SCORE_DEBRIS,
        x: chunk.cx * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE),
        y: chunk.cy * Constants.CHUNK_SIZE + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND),
        z: chunk.cz * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE),
        vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed,
        rotAxis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
        rotSpeed: randRange(rng, 0.5, 2) * (rng() > 0.5 ? 1 : -1),
        quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6.28, rng() * 6.28, rng() * 6.28)),
        active: false,
        chunkKey: chunk.key,
        instIndex: -1,
      };
      const pool = isBox ? this._instBox : this._instJunk;
      const idx = isBox ? this._nextBox++ : this._nextJunk++;
      body.instIndex = idx;
      pool.count = Math.max(pool.count, idx + 1);
      pool.setColorAt(idx, this._color());
      if (pool.instanceColor) pool.instanceColor.needsUpdate = true;
      body.active = true;
      this.bodies.push(body);
      this.colliders.push(body);
      chunk.debrisBodies.push(body);
    }
  }

  update(dt) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (const b of this.bodies) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      q.setFromAxisAngle(axis.copy(b.rotAxis), b.rotSpeed * dt);
      b.quat.premultiply(q);
      const pool = b.isBox ? this._instBox : this._instJunk;
      p.set(b.x, b.y, b.z);
      s.set(b.scale, b.scale * (b.isBox ? randAspect(b) : 1), b.scale * (b.isBox ? 1 : randAspect(b)));
      m4.compose(p, b.quat, s);
      pool.setMatrixAt(b.instIndex, m4);
    }
    if (this._instBox.count > 0) this._instBox.instanceMatrix.needsUpdate = true;
    if (this._instJunk.count > 0) this._instJunk.instanceMatrix.needsUpdate = true;
  }

  applyGravity(center, strength, maxPull, dt) {
    for (const b of this.bodies) {
      if (!b.active) continue;
      const dx = center.x - b.x, dy = center.y - b.y, dz = center.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1 || d2 > Constants.BLACK_HOLE_GRAVITY_RADIUS * Constants.BLACK_HOLE_GRAVITY_RADIUS) continue;
      const a = Math.min(strength / d2, maxPull);
      const inv = a / Math.sqrt(d2);
      b.vx += dx * inv * dt;
      b.vy += dy * inv * dt;
      b.vz += dz * inv * dt;
    }
  }

  remove(body, { silent = false } = {}) {
    if (!body.active) return;
    body.active = false;
    const pool = body.isBox ? this._instBox : this._instJunk;
    pool.setMatrixAt(body.instIndex, new THREE.Matrix4().makeScale(0, 0, 0));
    pool.instanceMatrix.needsUpdate = true;
    const idx = this.colliders.indexOf(body);
    if (idx >= 0) this.colliders.splice(idx, 1);
    if (silent) {
      this.events.emit('environment:objectConsumed', { objectType: 'debris', position: { x: body.x, y: body.y, z: body.z } });
    } else {
      this.events.emit('environment:debrisDestroyed', { position: { x: body.x, y: body.y, z: body.z }, score: body.score });
    }
  }

  cleanupChunk(chunk) {
    if (!chunk.debrisBodies) return;
    for (const b of chunk.debrisBodies) this.remove(b, { silent: true });
    chunk.debrisBodies = [];
  }

  getColliders() { return this.colliders; }
  getGravityBodies() { return this.bodies; }

  dispose() {
    for (const b of [...this.bodies]) this.remove(b, { silent: true });
    this.scene.remove(this._group);
    this._geoBox.dispose();
    this._geoJunk.dispose();
    this._instBox.material.dispose();
    this._instJunk.material.dispose();
  }
}

let _aspect = 0.4;
function randAspect(b) {
  _aspect = b.isBox ? 0.5 + Math.abs(Math.sin(b.x * 7.3)) * 1.5 : 0.5 + Math.abs(Math.sin(b.z * 5.1)) * 1.5;
  return _aspect;
}

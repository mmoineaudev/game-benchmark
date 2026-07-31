import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';

// Procedural asteroid field (spec §5.7): large = individual meshes,
// medium/small = InstancedMesh. Per-instance collision via body registry.
const TIER = { LARGE: 0, MEDIUM: 1, SMALL: 2 };
const GEOM = { 0: 1.0, 1: 1.0, 2: 1.0 };

export class AsteroidField {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.bodies = [];
    this.colliders = [];
    this._group = new THREE.Group();
    this._group.name = 'asteroids';
    scene.add(this._group);

    this._buildGeometries();
    this._meshLarge = [];
    this._instMedium = this._makeInstanced(this._geoMedium, 5000);
    this._instSmall = this._makeInstanced(this._geoSmall, 5000);
    this._nextMedium = 0;
    this._nextSmall = 0;
    this._slotChunk = new Map(); // instanceSlot key -> chunkKey
  }

  _buildGeometries() {
    this._geoLarge = this._displace(new THREE.IcosahedronGeometry(1, 1), 11, 0.55);
    this._geoMedium = this._displace(new THREE.DodecahedronGeometry(1, 0), 23, 0.4);
    this._geoSmall = this._displace(new THREE.OctahedronGeometry(1, 0), 37, 0.35);
  }

  _displace(geo, seed, amp) {
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 0.6 * Math.sin(v.x * 3.1 + seed) + 0.3 * Math.sin(v.y * 4.7 + seed * 2) + 0.1 * Math.sin(v.z * 5.3 + seed * 3);
      v.normalize().multiplyScalar(1 + n * amp);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  _makeInstanced(geo, count) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.15 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._group.add(mesh);
    return mesh;
  }

  _bodyBase(chunk, rng, tier, scale) {
    const x = chunk.cx * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const z = chunk.cz * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const y = chunk.cy * Constants.CHUNK_SIZE + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
    const speed = randRange(rng, Constants.ASTEROID_DRIFT_MIN, Constants.ASTEROID_DRIFT_MAX);
    const dir = new THREE.Vector3(randRange(rng, -1, 1), randRange(rng, -1, 1), randRange(rng, -1, 1)).normalize();
    return {
      type: 'asteroid',
      owner: this,
      tier,
      scale,
      radius: scale * (tier === TIER.LARGE ? 0.95 : 0.85),
      hp: Constants.ASTEROID_HP[tier === TIER.LARGE ? 'large' : tier === TIER.MEDIUM ? 'medium' : 'small'],
      score: (tier + 1) * Constants.SCORE_ASTEROID_BASE,
      x, y, z,
      vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed,
      rotAxis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      rotSpeed: randRange(rng, 0.1, 0.5) * (rng() > 0.5 ? 1 : -1),
      quat: new THREE.Quaternion(),
      active: false,
      chunkKey: chunk.key,
      instIndex: -1,
      mesh: null,
    };
  }

  spawnChunk(chunk, rng, biomeCfg, mult) {
    const count = Math.round(biomeCfg.asteroidDensity * mult.asteroid * Constants.DENSITY_REDUCTION);
    chunk.asteroidBodies = [];
    let largeCount = 0;
    for (let i = 0; i < count; i++) {
      const roll = rng();
      let tier;
      if (roll < 0.1) tier = TIER.LARGE;
      else if (roll < 0.4) tier = TIER.MEDIUM;
      else tier = TIER.SMALL;
      if (tier === TIER.LARGE && largeCount >= 4) tier = TIER.MEDIUM; // cap big rocks per chunk
      if (tier === TIER.LARGE) largeCount++;

      const scale = tier === TIER.LARGE ? randRange(rng, 2, 5)
        : tier === TIER.MEDIUM ? randRange(rng, 0.8, 2)
        : randRange(rng, 0.2, 0.8);

      const body = this._bodyBase(chunk, rng, tier, scale);
      this._activate(body);
      chunk.asteroidBodies.push(body);
    }
  }

  _activate(body) {
    const rng = () => 0; // unused here
    if (body.tier === TIER.LARGE) {
      const mesh = new THREE.Mesh(this._geoLarge, new THREE.MeshStandardMaterial({
        color: this._rockColor(), roughness: 0.9, metalness: 0.1,
      }));
      mesh.scale.setScalar(body.scale);
      body.mesh = mesh;
      body.instIndex = -1;
      this._meshLarge.push(mesh);
      this._group.add(mesh);
    } else {
      const pool = body.tier === TIER.MEDIUM ? this._instMedium : this._instSmall;
      const idx = pool === this._instMedium ? this._nextMedium++ : this._nextSmall++;
      body.instIndex = idx;
      pool.count = Math.max(pool.count, idx + 1);
      pool.setColorAt(idx, this._rockColor());
      pool.instanceColor.needsUpdate = true;
    }
    body.active = true;
    this.colliders.push(body);
    this.bodies.push(body);
  }

  _rockColor() {
    const c = new THREE.Color();
    const t = Math.random();
    if (t < 0.5) c.setHSL(0.07, 0.15 + Math.random() * 0.2, 0.25 + Math.random() * 0.2);
    else c.setHSL(0.55, 0.08 + Math.random() * 0.1, 0.2 + Math.random() * 0.2);
    return c;
  }

  update(dt) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();

    for (const b of this.bodies) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      q.setFromAxisAngle(axis.copy(b.rotAxis), b.rotSpeed * dt);
      b.quat.premultiply(q);

      if (b.mesh) {
        b.mesh.position.set(b.x, b.y, b.z);
        b.mesh.quaternion.copy(b.quat);
      } else {
        const pool = b.tier === TIER.MEDIUM ? this._instMedium : this._instSmall;
        p.set(b.x, b.y, b.z);
        s.setScalar(b.scale);
        m4.compose(p, b.quat, s);
        pool.setMatrixAt(b.instIndex, m4);
      }
    }
    if (this._instMedium.count > 0) this._instMedium.instanceMatrix.needsUpdate = true;
    if (this._instSmall.count > 0) this._instSmall.instanceMatrix.needsUpdate = true;
  }

  /** Black hole gravity: pull all active bodies toward center. */
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

  /** Remove a body (destroyed by lasers or consumed by a black hole). */
  remove(body, { silent = false, reason = 'destroyed' } = {}) {
    if (!body.active) return;
    body.active = false;
    if (body.mesh) {
      this._group.remove(body.mesh);
      body.mesh.geometry.dispose();
      body.mesh.material.dispose();
      body.mesh = null;
    } else {
      const pool = body.tier === TIER.MEDIUM ? this._instMedium : this._instSmall;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      pool.setMatrixAt(body.instIndex, zero);
      pool.instanceMatrix.needsUpdate = true;
    }
    const idx = this.colliders.indexOf(body);
    if (idx >= 0) this.colliders.splice(idx, 1);
    if (silent) {
      this.events.emit('environment:objectConsumed', { objectType: 'asteroid', position: { x: body.x, y: body.y, z: body.z } });
    } else {
      this.events.emit('environment:asteroidDestroyed', {
        position: { x: body.x, y: body.y, z: body.z },
        size: body.scale,
        score: body.score,
      });
    }
  }

  /** Destroy all bodies of a chunk (cleanup). */
  cleanupChunk(chunk) {
    if (!chunk.asteroidBodies) return;
    for (const b of chunk.asteroidBodies) this.remove(b, { silent: true });
    chunk.asteroidBodies = [];
  }

  getColliders() { return this.colliders; }
  getGravityBodies() { return this.bodies; }

  dispose() {
    for (const b of [...this.bodies]) this.remove(b, { silent: true });
    this.scene.remove(this._group);
    [this._geoLarge, this._geoMedium, this._geoSmall].forEach((g) => g.dispose());
    this._instMedium.material.dispose();
    this._instSmall.material.dispose();
  }
}

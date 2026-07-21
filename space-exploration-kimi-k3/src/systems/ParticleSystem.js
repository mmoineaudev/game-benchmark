// VOID DRIFT — ParticleSystem.js
// Exhaust pool (reused Points) + explosion pool. Zero per-particle allocation
// in hot paths: direct array access with stride.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

export class ParticleSystem {
  constructor(scene) {
    this._scene = scene;
    this._exhaust = null;
    this._exhaustData = null;    // { life, maxLife, vx, vy, vz }[]
    this._explosions = [];
    this._tmpColor = new THREE.Color();
  }

  init() {
    const n = Constants.PARTICLES.EXHAUST_POOL;
    const positions = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x66bbff, size: 0.35, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this._exhaust = new THREE.Points(geo, mat);
    this._exhaust.frustumCulled = false;
    this._scene.add(this._exhaust);
    this._exhaustData = [];
    for (let i = 0; i < n; i++) {
      this._exhaustData.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });
      positions[i * 3 + 1] = -99999;
    }
    this._exhaustCursor = 0;
  }

  /** Spawn one exhaust particle at world position with backward velocity. */
  spawnExhaust(origin, backDir, speed) {
    const i = this._exhaustCursor;
    this._exhaustCursor = (this._exhaustCursor + 1) % Constants.PARTICLES.EXHAUST_POOL;
    const d = this._exhaustData[i];
    d.life = 0;
    d.maxLife = Constants.PARTICLES.EXHAUST_LIFE_MIN +
      Math.random() * (Constants.PARTICLES.EXHAUST_LIFE_MAX - Constants.PARTICLES.EXHAUST_LIFE_MIN);
    const spread = 0.6;
    d.vx = backDir.x * (4 + speed * 0.15) + (Math.random() - 0.5) * spread;
    d.vy = backDir.y * (4 + speed * 0.15) + (Math.random() - 0.5) * spread;
    d.vz = backDir.z * (4 + speed * 0.15) + (Math.random() - 0.5) * spread;
    const arr = this._exhaust.geometry.attributes.position.array;
    arr[i * 3] = origin.x + (Math.random() - 0.5) * 0.2;
    arr[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.2;
    arr[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.2;
  }

  /** Explosion: pooled Points per event, colored by tier. */
  spawnExplosion(position, size = 1, colorHex = 0xffaa44) {
    const count = Constants.PARTICLES.EXPLOSION_COUNT;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let j = 0; j < count; j++) {
      const j3 = j * 3;
      positions[j3] = position.x; positions[j3 + 1] = position.y; positions[j3 + 2] = position.z;
      // Random direction in sphere.
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const spd = (3 + Math.random() * 9) * Math.max(size * 0.5, 0.6);
      velocities[j3] = s * Math.cos(phi) * spd;
      velocities[j3 + 1] = s * Math.sin(phi) * spd;
      velocities[j3 + 2] = u * spd;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: colorHex, size: 0.5 * Math.max(size * 0.5, 0.7), transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this._scene.add(points);
    this._explosions.push({ points, velocities, life: 0, maxLife: Constants.PARTICLES.EXPLOSION_LIFE * (0.7 + size * 0.2) });
  }

  /** Small sparkle burst for pickups. */
  spawnSparkle(position, colorHex = 0x55ffaa) {
    this.spawnExplosion(position, 0.35, colorHex);
  }

  update(dt) {
    // Exhaust — direct array stride access.
    if (this._exhaust) {
      const arr = this._exhaust.geometry.attributes.position.array;
      const damp = Math.pow(Constants.PARTICLES.EXHAUST_DAMPING, dt * 60);
      for (let i = 0; i < this._exhaustData.length; i++) {
        const d = this._exhaustData[i];
        if (d.life >= d.maxLife) continue;
        d.life += dt;
        const i3 = i * 3;
        d.vx *= damp; d.vy *= damp; d.vz *= damp;
        arr[i3] += d.vx * dt;
        arr[i3 + 1] += d.vy * dt;
        arr[i3 + 2] += d.vz * dt;
        if (d.life >= d.maxLife) arr[i3 + 1] = -99999;
      }
      this._exhaust.geometry.attributes.position.needsUpdate = true;
    }

    // Explosions — reverse iterate, dispose when dead.
    for (let k = this._explosions.length - 1; k >= 0; k--) {
      const e = this._explosions[k];
      e.life += dt;
      const arr = e.points.geometry.attributes.position.array;
      const vel = e.velocities;
      const drag = Math.pow(0.4, dt);
      for (let j = 0; j < vel.length; j += 3) {
        vel[j] *= drag; vel[j + 1] *= drag; vel[j + 2] *= drag;
        arr[j] += vel[j] * dt;
        arr[j + 1] += vel[j + 1] * dt;
        arr[j + 2] += vel[j + 2] * dt;
      }
      e.points.geometry.attributes.position.needsUpdate = true;
      e.points.material.opacity = Math.max(0, 0.9 * (1 - e.life / e.maxLife));
      if (e.life >= e.maxLife) {
        this._scene.remove(e.points);
        e.points.geometry.dispose();
        e.points.material.dispose();
        this._explosions.splice(k, 1);
      }
    }
  }

  clear() {
    for (const e of this._explosions) {
      this._scene.remove(e.points);
      e.points.geometry.dispose();
      e.points.material.dispose();
    }
    this._explosions = [];
    if (this._exhaust) {
      const arr = this._exhaust.geometry.attributes.position.array;
      for (let i = 0; i < this._exhaustData.length; i++) {
        this._exhaustData[i].life = 0; this._exhaustData[i].maxLife = 1;
        arr[i * 3 + 1] = -99999;
      }
      this._exhaust.geometry.attributes.position.needsUpdate = true;
    }
  }

  destroy() {
    this.clear();
    if (this._exhaust) {
      this._scene.remove(this._exhaust);
      this._exhaust.geometry.dispose();
      this._exhaust.material.dispose();
      this._exhaust = null;
    }
  }
}

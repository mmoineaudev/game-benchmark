// ============================================================
// ParticleSystem — Pool-based particle manager (trails, explosions)
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';

class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this._pool = [];
    this._explosionPool = [];
    this._scratch = new THREE.Vector3();
  }

  init() {
    for (let i = 0; i < Constants.PARTICLE.EXHAUST_POOL; i++) {
      this._pool.push(this._createExhaustParticle());
    }
  }

  _createExhaustParticle() {
    const positions = new Float32Array([0, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: Constants.SHIP.ENGINE_COLOR,
      size: 0.25,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.visible = false;
    points.userData = {
      _active: false, _life: 0, _maxLife: 0,
      velocity: new THREE.Vector3(), position: new THREE.Vector3(),
    };
    // hot-path shims
    points._active = points.userData._active;
    points._life = points.userData._life;
    points._maxLife = points.userData._maxLife;
    points._position = points.userData.position;
    points._velocity = points.userData.velocity;
    this.scene.add(points);
    return points;
  }

  spawnExhaust(origin, direction, count = 3, speedRatio = 1) {
    let spawned = 0;
    for (const p of this._pool) {
      if (p.userData._active) continue;
      if (spawned >= count) break;

      p.userData._active = true;
      p.userData._life = 0;
      p.userData._maxLife = 0.3 + Math.random() * 0.4;
      p.userData.position.copy(origin);
      p.userData.velocity.copy(direction);
      p.userData.velocity.z -= 5 + Math.random() * 10 * speedRatio;
      p.userData.velocity.x += (Math.random() - 0.5) * 3;
      p.userData.velocity.y += (Math.random() - 0.5) * 3;

      p.visible = true;
      spawned++;
    }
  }

  createExplosion(position, sizeTier = 1) {
    const count = Math.floor(
      Constants.PARTICLE.EXPLOSION_MIN +
      Math.random() * (Constants.PARTICLE.EXPLOSION_MAX - Constants.PARTICLE.EXPLOSION_MIN) * sizeTier
    );
    const maxLife = 0.5 + sizeTier * 0.3;

    const points = this._getExplosionPoints() || this._createExplosionPoints(count);
    const geo = points.geometry;
    const positions = geo.attributes.position.array;
    const velocities = points.userData._velocities;

    for (let i = 0, l = positions.length / 3; i < l; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      points.userData._lifetimes[i] = 0;
      points.userData._maxLifes[i] = maxLife * (0.5 + Math.random() * 0.5);

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 20 + Math.random() * 40 * sizeTier;
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
      velocities[i * 3 + 2] = Math.cos(phi) * speed;
    }

    geo.attributes.position.needsUpdate = true;
    points.userData._maxLife = maxLife;
    points.userData._alive = true;
    points.visible = true;
    this._explosionPool.push(points);

    return points;
  }

  _createExplosionPoints(count) {
    const positions = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const maxLifes = new Float32Array(count);
    const velocities = new Float32Array(count * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xffaa00,
      size: 0.45,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.userData = {
      _type: 'explosion',
      _lifetimes: lifetimes,
      _maxLifes: maxLifes,
      _maxLife: 1,
      _velocities: velocities,
      _origin: new THREE.Vector3(),
    };
    this.scene.add(points);
    return points;
  }

  _getExplosionPoints() {
    for (let i = this._explosionPool.length - 1; i >= 0; i--) {
      const p = this._explosionPool[i];
      if (!p.userData._alive) {
        if (i < this._explosionPool.length - 1) {
          this._explosionPool[i] = this._explosionPool[this._explosionPool.length - 1];
        }
        this._explosionPool.pop();
        return p;
      }
    }
    return null;
  }

  createSparks(position, color = new THREE.Color(0x00ffaa), count = 15) {
    const maxLife = 0.3;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const maxLifes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;
      lifetimes[i] = 0;
      maxLifes[i] = maxLife;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color,
      size: 0.18,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.userData = { _type: 'spark', _lifetimes: lifetimes, _maxLifes: maxLifes, _maxLife };
    this.scene.add(points);
    this._explosionPool.push(points);
  }

  update(dt) {
    for (const p of this._pool) {
      if (!p.userData._active) continue;

      p.userData._life += dt;
      if (p.userData._life >= p.userData._maxLife) {
        p.userData._active = false;
        p.visible = false;
        continue;
      }

      p.userData.position.addScaledVector(p.userData.velocity, dt);
      p.userData.velocity.multiplyScalar(0.95);
      p.position.copy(p.userData.position);
      p.visible = true;
    }

    for (let i = this._explosionPool.length - 1; i >= 0; i--) {
      const p = this._explosionPool[i];
      const lives = p.userData._lifetimes;
      const maxLives = p.userData._maxLifes;
      const vel = p.userData._velocities;
      let allDead = true;
      const posArray = p.geometry.attributes.position.array;
      for (let j = 0; j < lives.length; j++) {
        lives[j] += dt;
        if (lives[j] < maxLives[j]) {
          allDead = false;
          const j3 = j * 3;
          posArray[j3] += vel[j3] * dt;
          posArray[j3 + 1] += vel[j3 + 1] * dt;
          posArray[j3 + 2] += vel[j3 + 2] * dt;
          vel[j3] *= 0.98;
          vel[j3 + 1] *= 0.98;
          vel[j3 + 2] *= 0.98;
        }
      }

      if (allDead) {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this._explosionPool.splice(i, 1);
      }
    }
  }

  destroy() {
    for (const p of this._pool) {
      this.scene.remove(p);
      p.geometry.dispose();
      p.material.dispose();
    }
    for (const p of this._explosionPool) {
      this.scene.remove(p);
      p.geometry.dispose();
      p.material.dispose();
    }
    this._pool.length = 0;
    this._explosionPool.length = 0;
  }
}

export default ParticleSystem;

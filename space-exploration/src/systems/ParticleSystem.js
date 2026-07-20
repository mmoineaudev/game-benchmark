// ============================================================
// ParticleSystem — Pool-based particle manager (trails, explosions)
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { SIMPLEX_3D_GLSL } from '../utils/ShaderHelpers.js';

class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this._particles = [];
    this._pool = [];
    this._explosionPool = [];
    this._scratch = new THREE.Vector3();
  }

  init() {
    // Initialize particle pools
    for (let i = 0; i < Constants.PARTICLE.EXHAUST_POOL; i++) {
      this._pool.push(this._createExhaustParticle());
    }
    // Pre-create a shared geometry for sparks (reused)
    this._sparkGeo = new THREE.BufferGeometry();
  }

  _createExhaustParticle() {
    const positions = new Float32Array([0, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(Constants.SHIP.ENGINE_COLOR) },
      },
      vertexShader: `
        attribute vec3 position;
        uniform float uTime;
        varying float vAlpha;
        void main() {
          vAlpha = 1.0;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = mix(4.0, 1.0, 0.5) * (200.0 / max(-mvPos.z, 1.0));
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float glow = exp(-d * 10.0);
          gl_FragColor = vec4(uColor, glow * vAlpha * 0.6);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.visible = false;
    points.userData = {
      _active: false, _life: 0, _maxLife: 0,
      velocity: new THREE.Vector3(), position: new THREE.Vector3(),
    };
    this.scene.add(points);
    return points;  }

  /**
   * Spawn exhaust particles from a source point and direction
   */
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

  /**
   * Create an explosion at position with given size tier
   */
  createExplosion(position, sizeTier = 1) {
    const count = Math.floor(
      Constants.PARTICLE.EXPLOSION_MIN + 
      Math.random() * (Constants.PARTICLE.EXPLOSION_MAX - Constants.PARTICLE.EXPLOSION_MIN) * sizeTier
    );
    const maxLife = 0.5 + sizeTier * 0.3;
    const colors = [
      new THREE.Color(0xffaa00),
      new THREE.Color(0xff4400),
      new THREE.Color(0x220000),
    ];

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
    points.userData._type = 'explosion';
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

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uStartColor: { value: new THREE.Color(0xffaa00) },
        uEndColor: { value: new THREE.Color(0x220000) },
      },
      vertexShader: `
        attribute float life;
        attribute float maxLife;
        attribute vec3 velocity;
        varying float vLife;
        void main() {
          vLife = life / maxLife;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = mix(6.0, 1.0, vLife) * (200.0 / max(-mvPos.z, 1.0));
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uStartColor;
        uniform vec3 uEndColor;
        varying float vLife;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          if (d > 0.5) discard;
          float glow = exp(-d * 6.0);
          vec3 color = mix(uStartColor, uEndColor, vLife);
          float alpha = glow * (1.0 - vLife * vLife);
          gl_FragColor = vec4(color, alpha);
        }
      `,
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

  /**
   * Create spark burst
   */
  createSparks(position, color = new THREE.Color(0x00ffaa), count = 10) {
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
    geo.setAttribute('life', new THREE.BufferAttribute(lifetimes, 1));
    geo.setAttribute('maxLife', new THREE.BufferAttribute(maxLifes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color } },
      vertexShader: `
        attribute float life;
        attribute float maxLife;
        varying float vLife;
        void main() {
          vLife = life / maxLife;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = mix(3.0, 0.5, vLife) * (200.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vLife;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float glow = exp(-d * 8.0);
          gl_FragColor = vec4(uColor, glow * (1.0 - vLife));
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geo, mat);
    points.userData = { _type: 'spark', _lifetimes: lifetimes, _maxLifes: maxLifes, _maxLife };
    this.scene.add(points);
    this._explosionPool.push(points);
  }

  /**
   * Update all particles each frame
   */
  update(dt) {
    // Update exhaust pool
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

    // Update explosions/sparks
    for (let i = this._explosionPool.length - 1; i >= 0; i--) {
      const p = this._explosionPool[i];
      const lives = p.userData._lifetimes;
      const maxLives = p.userData._maxLifes;
      const vel = p.userData._velocities;
      let allDead = true;
      const posAttr = p.geometry.getAttribute('position');

      for (let j = 0; j < lives.length; j++) {
        lives[j] += dt;
        if (lives[j] < maxLives[j]) {
          allDead = false;
          // Expand outward using stored velocities
          posAttr.setX(j, posAttr.getX(j) + vel[j * 3] * dt);
          posAttr.setY(j, posAttr.getY(j) + vel[j * 3 + 1] * dt);
          posAttr.setZ(j, posAttr.getZ(j) + vel[j * 3 + 2] * dt);
          // Slight drag on particles
          vel[j * 3] *= 0.98;
          vel[j * 3 + 1] *= 0.98;
          vel[j * 3 + 2] *= 0.98;
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

  /**
   * Cleanup all particles
   */
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

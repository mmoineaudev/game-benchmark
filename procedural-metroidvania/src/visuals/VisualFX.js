import * as THREE from 'three';
import { COLORS, LOG } from '../core/Constants.js';

const FX_EL = document.getElementById('fxLayer');

/**
 * VisualFX — screen shake, damage numbers, GPU particle effects.
 */
export default class VisualFX {
  constructor(scene, camera) {
    this._scene = scene;
    this._camera = camera;
    this._shakeIntensity = 0;
    this._shakeDuration = 0;
    this._shakeElapsed = 0;
    this._cameraBasePos = new THREE.Vector3(0, 0, 20);
    this._activeDamageNumbers = [];

    // ── GPU particle systems ──────────────────────────────────────────
    this._particlePools = {};  // { type: ParticlePool }
    this._initParticlePools();

    LOG('VisualFX', 'Initialized (GPU particles)');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PARTICLE SYSTEM
  // ═══════════════════════════════════════════════════════════════════════

  _initParticlePools() {
    this._particlePools = {
      spark: new ParticlePool(this._scene, 60, {
        color: 0x88ccff,
        size: 0.04,
        life: 0.5,
        speed: 3,
        gravity: 5,
      }),
      enemyDeath: new ParticlePool(this._scene, 40, {
        color: COLORS.ENEMY_RIM,
        size: 0.05,
        life: 0.7,
        speed: 4,
        gravity: 2,
      }),
      dashTrail: new ParticlePool(this._scene, 30, {
        color: COLORS.PLAYER_EMISSIVE,
        size: 0.06,
        life: 0.35,
        speed: 0.5,
        gravity: 0,
      }),
      hitSpark: new ParticlePool(this._scene, 20, {
        color: 0xffffff,
        size: 0.03,
        life: 0.25,
        speed: 6,
        gravity: 10,
      }),
    };
  }

  /** Emit particles at a world position */
  emit(type, x, y, count = 10) {
    const pool = this._particlePools[type];
    if (!pool) return;
    pool.emit(x, y, count);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SCREEN SHAKE
  // ═══════════════════════════════════════════════════════════════════════

  screenShake(duration, intensity) {
    this._shakeDuration = duration;
    this._shakeIntensity = intensity;
    this._shakeElapsed = 0;
    this._cameraBasePos.copy(this._camera.position);
  }

  hitFlash(mesh) {
    // Handled by ModelFactory.flashEnemy
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DAMAGE NUMBERS (DOM)
  // ═══════════════════════════════════════════════════════════════════════

  damageNumber(x, y, amount, color = COLORS.DAMAGE_NUMBER) {
    const el = document.createElement('div');
    el.textContent = amount;
    el.style.cssText = `
      position:absolute;
      color:${color};
      font-family:monospace;
      font-size:18px;
      font-weight:bold;
      text-shadow: 0 0 4px ${color};
      pointer-events:none;
      z-index:100;
      transform:translate(-50%, -50%);
    `;

    const v = new THREE.Vector3(x, y, 0).project(this._camera);
    const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';

    FX_EL.appendChild(el);

    this._activeDamageNumbers.push({ el, life: 1.0, startY: sy });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════════════════════════

  update(dt = 1 / 60) {
    // Screen shake
    if (this._shakeDuration > 0) {
      this._shakeElapsed += dt;
      const t = this._shakeElapsed / this._shakeDuration;
      const decay = 1 - t;
      const intensity = this._shakeIntensity * decay;
      if (t >= 1) {
        this._camera.position.copy(this._cameraBasePos);
        this._shakeDuration = 0;
        this._shakeIntensity = 0;
      } else {
        this._camera.position.x = this._cameraBasePos.x + (Math.random() - 0.5) * intensity;
        this._camera.position.y = this._cameraBasePos.y + (Math.random() - 0.5) * intensity;
      }
    }

    // Particles
    for (const pool of Object.values(this._particlePools)) {
      pool.update(dt);
    }

    // Damage numbers
    for (let i = this._activeDamageNumbers.length - 1; i >= 0; i--) {
      const dn = this._activeDamageNumbers[i];
      dn.life -= 0.02;
      dn.el.style.top = (parseFloat(dn.el.style.top) - 1.5) + 'px';
      dn.el.style.opacity = dn.life;
      if (dn.life <= 0) {
        dn.el.remove();
        this._activeDamageNumbers.splice(i, 1);
      }
    }
  }

  reset() {
    this._shakeDuration = 0;
    this._shakeIntensity = 0;
    for (const pool of Object.values(this._particlePools)) {
      pool.reset();
    }
    for (const dn of this._activeDamageNumbers) dn.el.remove();
    this._activeDamageNumbers.length = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTICLE POOL — pre-allocated GPU billboarded particles
// ═══════════════════════════════════════════════════════════════════════════
class ParticlePool {
  constructor(scene, maxCount, config) {
    this._scene = scene;
    this._maxCount = maxCount;
    this._config = config;
    this._particles = [];
    this._freeIndices = [];

    // Shared geometry: one point per potential particle
    const positions = new Float32Array(maxCount * 3);
    const sizes = new Float32Array(maxCount);
    const alphas = new Float32Array(maxCount);

    for (let i = 0; i < maxCount; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = -999; // Hide off-screen
      positions[i * 3 + 2] = 0;
      sizes[i] = config.size;
      alphas[i] = 0;
      this._freeIndices.push(i);
      this._particles.push({
        alive: false,
        x: 0, y: 0,
        vx: 0, vy: 0,
        life: 0, maxLife: 0,
        size: config.size,
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Simple circle sprite texture
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.PointsMaterial({
      color: config.color,
      size: config.size,
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    });

    this._points = new THREE.Points(geo, mat);
    this._points.name = `_particlePool_${maxCount}`;
    this._points.frustumCulled = false;
    scene.add(this._points);

    this._positions = positions;
    this._alphas = alphas;
    this._material = mat;

    LOG('VisualFX', `Particle pool ${maxCount} created`);
  }

  emit(x, y, count) {
    let emitted = 0;
    for (const idx of this._freeIndices) {
      if (emitted >= count) break;
      const p = this._particles[idx];

      const angle = Math.random() * Math.PI * 2;
      const speed = this._config.speed * (0.5 + Math.random());
      p.x = x + (Math.random() - 0.5) * 0.2;
      p.y = y + (Math.random() - 0.5) * 0.2;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = this._config.life * (0.5 + Math.random() * 0.5);
      p.maxLife = p.life;
      p.alive = true;

      this._positions[idx * 3] = p.x;
      this._positions[idx * 3 + 1] = p.y;
      this._alphas[idx] = 1.0;

      // Remove from free list
      const fi = this._freeIndices.indexOf(idx);
      if (fi >= 0) this._freeIndices.splice(fi, 1);

      emitted++;
    }
    // Update geometry
    this._points.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    const usedIndices = [];

    for (let i = 0; i < this._maxCount; i++) {
      const p = this._particles[i];
      if (!p.alive) continue;

      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this._positions[i * 3 + 1] = -999;
        this._alphas[i] = 0;
        this._freeIndices.push(i);
      } else {
        // Physics
        p.vy -= this._config.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.98;

        // Write to buffer
        const t = p.life / p.maxLife;
        this._positions[i * 3] = p.x;
        this._positions[i * 3 + 1] = p.y;
        this._alphas[i] = t;
      }

      usedIndices.push(i);
    }

    if (usedIndices.length > 0) {
      this._points.geometry.attributes.position.needsUpdate = true;
    }

    // Overall material opacity
    this._material.opacity = 0.7;
  }

  reset() {
    for (let i = 0; i < this._maxCount; i++) {
      const p = this._particles[i];
      p.alive = false;
      p.life = 0;
      this._positions[i * 3 + 1] = -999;
      this._alphas[i] = 0;
    }
    this._freeIndices = Array.from({ length: this._maxCount }, (_, i) => i);
    this._points.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    if (this._points.parent) this._scene.remove(this._points);
    this._points.geometry.dispose();
    this._points.material.dispose();
    if (this._points.material.map) this._points.material.map.dispose();
  }
}

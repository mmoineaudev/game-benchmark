import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { softDotTexture } from '../utils/ShaderHelpers.js';

// Pool-based particle manager (spec §5.5) with per-particle size/color/alpha.
// Named pools: exhaust, laserSpark, explosion, cometDust, cometSmoke, ember.
// Zero allocations in the update loop.

const PARTICLE_VERTEX = `
uniform float uPixelRatio;
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio * (300.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAGMENT = `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  float a = tex.a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * tex.r, a);
}
`;

const POOL_STYLE = {
  exhaust:    { color: [0.5, 0.7, 1.0], blending: THREE.AdditiveBlending,   curve: null, grow: 0.6 },
  laserSpark: { color: [1.0, 0.9, 0.6], blending: THREE.AdditiveBlending,   curve: null, grow: 0.4 },
  explosion:  { color: [1.0, 1.0, 1.0], blending: THREE.AdditiveBlending,   curve: [[1.0, 0.9, 0.2], [1.0, 0.3, 0.05], [0.1, 0.02, 0.0]], grow: 1.4 },
  cometDust:  { color: [1.0, 0.95, 0.8], blending: THREE.AdditiveBlending,  curve: null, grow: 0.8 },
  cometSmoke: { color: [0.45, 0.42, 0.4], blending: THREE.NormalBlending,   curve: null, grow: 2.2 },
  ember:      { color: [0.9, 0.25, 0.08], blending: THREE.AdditiveBlending, curve: null, grow: 0.5 },
};

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.pools = {};
    for (const [name, cfg] of Object.entries(Constants.PARTICLE_POOLS)) {
      this.pools[name] = this._makePool(name, cfg);
    }
  }

  _makePool(name, cfg) {
    const style = POOL_STYLE[name] || POOL_STYLE.exhaust;
    const soft = softDotTexture();
    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uMap: { value: soft },
      },
      transparent: true,
      depthWrite: false,
      blending: style.blending,
    });
    const max = cfg.maxParticles;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3);
    const vel = new Float32Array(max * 3);
    const life = new Float32Array(max);
    const maxLife = new Float32Array(max);
    const size = new Float32Array(max);
    const alpha = new Float32Array(max);
    const col = new Float32Array(max * 3);
    // Hide unused particles initially
    pos.fill(99999);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);

    return {
      name, cfg, style, geo, mat, points,
      pos, vel, life, maxLife, size, alpha, col,
      cursor: 0,
      active: 0,
      lastColor: [1, 1, 1],
    };
  }

  emit(name, x, y, z, vx, vy, vz, opts = {}) {
    const pool = this.pools[name];
    if (!pool) return;
    const i = pool.cursor;
    pool.cursor = (pool.cursor + 1) % pool.cfg.maxParticles;
    const life = opts.lifetime ?? pool.cfg.lifetime;
    pool.pos[i * 3] = x;
    pool.pos[i * 3 + 1] = y;
    pool.pos[i * 3 + 2] = z;
    pool.vel[i * 3] = vx;
    pool.vel[i * 3 + 1] = vy;
    pool.vel[i * 3 + 2] = vz;
    pool.life[i] = life;
    pool.maxLife[i] = life;
    pool.size[i] = opts.size ?? pool.cfg.size;
    const c = opts.color ?? pool.style.color;
    pool.col[i * 3] = c[0];
    pool.col[i * 3 + 1] = c[1];
    pool.col[i * 3 + 2] = c[2];
    pool.alpha[i] = 1;
    pool.active++;
  }

  /** Burst n particles at a point with random spherical velocity. */
  burst(name, x, y, z, n, speed, opts = {}) {
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit(name, x, y, z,
        Math.sin(phi) * Math.cos(theta) * s,
        Math.sin(phi) * Math.sin(theta) * s,
        Math.cos(phi) * s,
        { ...opts, size: opts.size ? opts.size * (0.6 + Math.random() * 0.8) : undefined });
    }
  }

  /** Continuous emitter for streams (exhaust, comet tails, embers). */
  emitStream(name, x, y, z, vx, vy, vz, opts = {}) {
    const pool = this.pools[name];
    if (!pool) return;
    const perFrame = opts.perFrame ?? 1;
    for (let i = 0; i < perFrame; i++) {
      const jitter = opts.jitter ?? 0.2;
      this.emit(name,
        x + (Math.random() - 0.5) * jitter,
        y + (Math.random() - 0.5) * jitter,
        z + (Math.random() - 0.5) * jitter,
        vx + (Math.random() - 0.5) * 2,
        vy + (Math.random() - 0.5) * 2,
        vz + (Math.random() - 0.5) * 2,
        { lifetime: opts.lifetime, color: opts.color, size: opts.size });
    }
  }

  update(dt) {
    for (const pool of Object.values(this.pools)) {
      const { pos, vel, life, maxLife, size, alpha, col } = pool;
      const count = pool.cfg.maxParticles;
      const grow = pool.style.grow;
      const curve = pool.style.curve;
      for (let i = 0; i < count; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        if (life[i] <= 0) {
          pos[i * 3] = 99999;
          alpha[i] = 0;
          pool.active--;
          continue;
        }
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        const t = life[i] / maxLife[i]; // 1 → 0
        alpha[i] = t;
        size[i] = pool.cfg.size * (1 + (1 - t) * grow);
        if (curve) {
          const u = 1 - t;
          const seg = u * (curve.length - 1);
          const i0 = Math.min(curve.length - 2, Math.floor(seg));
          const f = seg - i0;
          col[i * 3] = curve[i0][0] + (curve[i0 + 1][0] - curve[i0][0]) * f;
          col[i * 3 + 1] = curve[i0][1] + (curve[i0 + 1][1] - curve[i0][1]) * f;
          col[i * 3 + 2] = curve[i0][2] + (curve[i0 + 1][2] - curve[i0][2]) * f;
        }
      }
      pool.geo.attributes.position.needsUpdate = true;
      pool.geo.attributes.aAlpha.needsUpdate = true;
      pool.geo.attributes.aSize.needsUpdate = true;
      pool.geo.attributes.aColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const pool of Object.values(this.pools)) {
      this.scene.remove(pool.points);
      pool.geo.dispose();
      pool.mat.dispose();
    }
    this.pools = {};
  }
}

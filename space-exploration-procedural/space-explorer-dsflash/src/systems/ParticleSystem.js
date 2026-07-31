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
  sparkle:    { color: [0.9, 0.95, 1.0], blending: THREE.AdditiveBlending, curve: null, grow: 2.5 },
};

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.pools = {};
    for (const [name, cfg] of Object.entries(Constants.PARTICLE_POOLS)) {
      this.pools[name] = this._makePool(name, cfg);
    }
    this._buildMeshPools();
  }

  // ---- v2.0 remaster mesh pools (rings, shards, speed lines, impact glow) ----
  _buildMeshPools() {
    const RM = Constants.REMASTER;
    this._group = new THREE.Group();
    this._group.name = 'vfx-pools';
    this.scene.add(this._group);

    // shockwave rings
    this._rings = [];
    const ringGeo = new THREE.RingGeometry(0.9, 1.0, 32);
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x66ccff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this._group.add(mesh);
      this._rings.push({ mesh, mat, life: 0, max: RM.shockRingLife });
    }

    // debris shards
    this._shards = [];
    const shardGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffcc88, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(shardGeo, mat);
      mesh.visible = false;
      this._group.add(mesh);
      this._shards.push({ mesh, mat, vx: 0, vy: 0, vz: 0, life: 0, max: 0.8 });
    }

    // speed line streaks
    this._speedLines = [];
    const dot = softDotTexture();
    for (let i = 0; i < RM.speedLineCount; i++) {
      const mat = new THREE.SpriteMaterial({
        map: dot, color: 0xaaddff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      this._group.add(spr);
      this._speedLines.push({ spr, mat, life: 0, max: 0.25, vx: 0, vy: 0, vz: 0 });
    }

    // laser impact glow lights
    this._impactGlows = [];
    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight(0x66ff88, 0, 8, 2);
      light.name = 'ship:impact';
      this._group.add(light);
      this._impactGlows.push({ light, life: 0, max: 0.15 });
    }
  }

  /** Expanding shockwave ring (v2.0 §5). */
  burstRing(x, y, z) {
    const r = this._rings.find((q) => q.life <= 0);
    if (!r) return;
    r.life = r.max;
    r.mesh.position.set(x, y, z);
    r.mesh.visible = true;
    r.mesh.scale.setScalar(1);
  }

  /** Debris shards with gravity (v2.0 §5). */
  burstShards(x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const s = this._shards.find((q) => q.life <= 0);
      if (!s) return;
      s.life = s.max;
      s.mesh.position.set(x, y, z);
      s.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      s.mesh.visible = true;
      const speed = 8 + Math.random() * 14;
      const ang = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.5) * 1.6;
      s.vx = Math.cos(ang) * speed;
      s.vz = Math.sin(ang) * speed;
      s.vy = Math.sin(elev) * speed * 0.6;
      s.mat.opacity = 1;
    }
  }

  /** Speed-line streaks around the camera at high throttle (v2.0 §5). */
  emitSpeedLines(cameraPos, cameraQuat, count) {
    for (let i = 0; i < count; i++) {
      const l = this._speedLines.find((q) => q.life <= 0);
      if (!l) return;
      l.life = l.max;
      // random direction around the camera, then fly backward past it
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      l.spr.position.copy(cameraPos).addScaledVector(dir, 60 + Math.random() * 60);
      l.vx = -dir.x * 260;
      l.vy = -dir.y * 260;
      l.vz = -dir.z * 260;
      l.spr.material.rotation = Math.atan2(dir.x, dir.z);
      l.spr.scale.set(2, 30, 1);
      l.spr.visible = true;
      l.mat.opacity = Constants.REMASTER.speedLineOpacity;
    }
  }

  /** Brief green glow at laser impact (v2.0 §5). */
  impactGlow(x, y, z) {
    const g = this._impactGlows.find((q) => q.life <= 0);
    if (!g) return;
    g.life = g.max;
    g.light.position.set(x, y, z);
    g.light.intensity = Constants.REMASTER.impactGlowIntensity;
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

    // v2.0 mesh pools
    const RM = Constants.REMASTER;
    for (const r of this._rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; r.mat.opacity = 0; continue; }
      const t = r.life / r.max; // 1 → 0
      r.mesh.scale.setScalar(1 + (1 - t) * RM.shockRingScale);
      r.mat.opacity = t * 0.7;
    }
    for (const s of this._shards) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) { s.mesh.visible = false; s.mat.opacity = 0; continue; }
      s.vy -= RM.shardGravity * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += dt * 6;
      s.mesh.rotation.y += dt * 5;
      s.mat.opacity = s.life / s.max;
    }
    for (const l of this._speedLines) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) { l.spr.visible = false; l.mat.opacity = 0; continue; }
      l.spr.position.x += l.vx * dt;
      l.spr.position.y += l.vy * dt;
      l.spr.position.z += l.vz * dt;
    }
    for (const g of this._impactGlows) {
      if (g.life <= 0) continue;
      g.life -= dt;
      g.light.intensity = g.life <= 0 ? 0 : RM.impactGlowIntensity * (g.life / g.max);
    }
  }

  get liveCount() {
    let n = 0;
    for (const pool of Object.values(this.pools)) n += pool.active;
    for (const r of this._rings) if (r.life > 0) n++;
    for (const s of this._shards) if (s.life > 0) n++;
    for (const l of this._speedLines) if (l.life > 0) n++;
    return n;
  }

  dispose() {
    for (const pool of Object.values(this.pools)) {
      this.scene.remove(pool.points);
      pool.geo.dispose();
      pool.mat.dispose();
    }
    this.pools = {};
    this.scene.remove(this._group);
    this._group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

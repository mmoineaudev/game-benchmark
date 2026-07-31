import * as THREE from 'three';
import { SMOKE } from '../core/Constants.js';

const VERT = `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform sampler2D uTex;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vec3(0.62, 0.6, 0.58), tex.a * vAlpha * uOpacity);
}`;

export class SmokeSystem {
  constructor(scene) {
    this.scene = scene;
    this.emitters = [];   // { x, y, z, rate } — spawn source positions (torches, braziers)
    this.pool = [];
    this._tex = null;
    this.points = null;
  }

  init() {
    // Soft round smoke texture (gray, hard core -> soft edge)
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this._tex = new THREE.CanvasTexture(canvas);

    const count = SMOKE.POOL_SIZE;
    this.positions = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.alphas = new Float32Array(count);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this._tex },
        uOpacity: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // Park all particles off-screen until spawned
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = 0;
      this.positions[i * 3 + 1] = -100;
      this.positions[i * 3 + 2] = 0;
      this.sizes[i] = 0;
      this.alphas[i] = 0;
    }
  }

  addEmitter(x, y, z, rate = SMOKE.RATE) {
    this.emitters.push({ x, y, z, rate, acc: 0 });
  }

  // One-shot emitter that auto-removes after ttl seconds (combat feedback puffs)
  addTransient(x, y, z, rate = 8, ttl = 0.4) {
    this.emitters.push({ x, y, z, rate, acc: 0, transient: true, ttl });
  }

  clearEmitters() {
    this.emitters = [];
  }

  update(dt, playerPos) {
    if (!this.points) return;
    const px = playerPos.x;
    const pz = playerPos.z;

    // Spawn + expire transient emitters
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      if (e.transient) {
        e.ttl -= dt;
        if (e.ttl <= 0) {
          this.emitters.splice(i, 1);
          continue;
        }
      }
      e.acc += dt;
      const interval = 1 / e.rate;
      while (e.acc >= interval) {
        e.acc -= interval;
        this._spawn(e);
      }
    }

    // Simulate
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) { p.alive = false; this.alphas[p.idx] = 0; this.sizes[p.idx] = 0; continue; }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx += (Math.random() - 0.5) * dt * SMOKE.TURBULENCE;
      p.vz += (Math.random() - 0.5) * dt * SMOKE.TURBULENCE;

      const idx = p.idx * 3;
      this.positions[idx] = p.x;
      this.positions[idx + 1] = p.y;
      this.positions[idx + 2] = p.z;

      // Grow then fade: alpha rises early, falls late
      const fadeIn = Math.min(1, t / 0.2);
      const fadeOut = 1 - Math.max(0, (t - 0.55) / 0.45);
      this.alphas[p.idx] = p.baseAlpha * fadeIn * fadeOut;
      this.sizes[p.idx] = p.baseSize * (0.6 + t * 1.6);
    }

    // Distance fade of the whole system (smoke only visible near the player)
    let nearest = Infinity;
    for (const e of this.emitters) {
      const d = Math.hypot(e.x - px, e.z - pz);
      if (d < nearest) nearest = d;
    }
    const fade = Math.max(0, Math.min(1, 1 - (nearest - SMOKE.VISIBLE_RADIUS) / 8));
    this.points.material.uniforms.uOpacity.value = fade;

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }

  _spawn(emitter) {
    if (this.pool.length >= SMOKE.POOL_SIZE) return;
    const idx = this.pool.length;
    this.pool.push({
      idx,
      alive: true,
      x: emitter.x + (Math.random() - 0.5) * 0.2,
      y: emitter.y + Math.random() * 0.1,
      z: emitter.z + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 0.2,
      vy: SMOKE.RISE_SPEED * (0.7 + Math.random() * 0.6),
      vz: (Math.random() - 0.5) * 0.2,
      life: 0,
      maxLife: SMOKE.LIFETIME * (0.7 + Math.random() * 0.6),
      baseSize: SMOKE.BASE_SIZE * (0.7 + Math.random() * 0.6),
      baseAlpha: SMOKE.BASE_ALPHA,
    });
  }

  dispose() {
    if (this.points) {
      this.points.geometry.dispose();
      this.points.material.dispose();
      if (this._tex) this._tex.dispose();
      this.scene.remove(this.points);
      this.points = null;
    }
    this.emitters = [];
    this.pool = [];
  }
}

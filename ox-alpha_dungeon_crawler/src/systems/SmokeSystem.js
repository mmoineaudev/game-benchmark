// SmokeSystem.js — pooled GPU point-sprite smoke (9 particles, §13/§27 cuts are intentional)
import * as THREE from 'three';
import { SMOKE } from '../core/Constants.js';

export default class SmokeSystem {
  constructor(scene) {
    this.count = SMOKE.PARTICLES;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.count * 3);
    this.alphas = new Float32Array(this.count);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color(0x333340) } },
      vertexShader: `
        attribute float alpha; varying float vA;
        void main() {
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 90.0 / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.1, length(d)) * vA * 0.5;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
        }`
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.emitters = []; // {x,y,z,rate,acc}
    this.puffs = [];    // transient: {i, life, ttl, vy}
    for (let i = 0; i < this.count; i++) {
      this.puffs.push({ active: false, life: 0, ttl: 1, vy: 0.5 });
      this.positions[i * 3 + 1] = -100;
    }
    this._next = 0;
  }

  addEmitter(x, y, z, rate = 6) {
    this.emitters.push({ x, y, z, rate, acc: 0 });
  }

  clearEmitters() { this.emitters = []; }

  puff(x, y, z, ttl = 0.8) {
    // round-robin slot
    let tries = 0;
    while (tries++ < this.count) {
      const p = this.puffs[this._next];
      const idx = this._next;
      this._next = (this._next + 1) % this.count;
      if (!p.active || p.life >= p.ttl * 0.7) {
        p.active = true; p.life = 0; p.ttl = ttl;
        this.positions[idx * 3] = x; this.positions[idx * 3 + 1] = y; this.positions[idx * 3 + 2] = z;
        return;
      }
    }
  }

  update(dt) {
    for (const e of this.emitters) {
      e.acc += dt * e.rate;
      while (e.acc >= 1) { e.acc -= 1; this.puff(e.x, e.y, e.z); }
    }
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const p = this.puffs[i];
      if (!p.active) continue;
      p.life += dt;
      this.positions[i * 3 + 1] += p.vy * dt;
      this.alphas[i] = Math.max(0, 1 - p.life / p.ttl);
      if (p.life >= p.ttl) {
        p.active = false;
        this.positions[i * 3 + 1] = -100;
        this.alphas[i] = 0;
      }
      dirty = true;
    }
    if (dirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.alpha.needsUpdate = true;
    }
  }

  dispose(scene) {
    scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
  }
}

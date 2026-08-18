/**
 * SmokeSystem.js — pooled GPU point-sprite smoke (§13: SMOKE_PARTICLES = 9,
 * "GPU Points, shared geometry" — the 90→9 perf cut is intentional, §27).
 *
 * A single THREE.Points over one shared BufferGeometry. Particles carry
 * life/position/velocity/size/opacity in typed attribute buffers
 * (aSize, aOpacity) and a small ShaderMaterial handles per-particle size +
 * distance fade. Emitters are continuous (emitRate per emitter, seconds)
 * and transient puffs are one-shot (emitPuff). Round-robin slot reuse —
 * zero per-frame allocation.
 *
 * Headless shim (§27): geometry/attributes are plain data, so everything
 * constructs and updates without a DOM; generateGlowTexture() returns null
 * headless, which is fine since the shader does not depend on it.
 */

import * as THREE from 'three';
import { POOLS, MATERIALS } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

const POOL_SIZE = POOLS.SMOKE_PARTICLES; // 9

const VERT = /* glsl */ `
attribute float aSize;
attribute float aOpacity;
varying float vOpacity;
void main() {
  vOpacity = aOpacity;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uMaxDist;
varying float vOpacity;
void main() {
  if (vOpacity <= 0.0) discard;
  // soft radial falloff
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float alpha = smoothstep(1.0, 0.0, d) * vOpacity;
  gl_FragColor = vec4(uColor, alpha);
}`;

export class SmokeSystem {
  constructor(group = null) {
    this.group = group; // optional parent; Points is added when a group is given
    this.poolSize = POOL_SIZE;
    this.emitters = [];      // [{ pos, emitRate, life, size, spread, scale, active }]
    this._slot = 0;          // round-robin index

    const pos = new Float32Array(this.poolSize * 3);
    this.size = new Float32Array(this.poolSize);
    this.opacity = new Float32Array(this.poolSize);
    this.life = new Float32Array(this.poolSize);
    this.maxLife = new Float32Array(this.poolSize);
    this.velocity = new Float32Array(this.poolSize * 3);
    this.scale = new Float32Array(this.poolSize);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(this.opacity, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0.6, 0.6, 0.62) },
        uMaxDist: { value: 24 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    // Owned by this system; only ever non-null in a real browser (§27 shim).
    this.glowTexture = generateGlowTexture(MATERIALS.GLOW_TEXTURE_SIZE);

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    if (this.group) this.group.add(this.points);

    this.disposed = false;
  }

  /**
   * Start a continuous emitter.
   * @param {THREE.Vector3|number[]} pos
   * @param {{emitRate?: number, life?: [number, number], size?: number, spread?: number, scale?: number}} opts
   */
  addEmitter(pos, opts = {}) {
    this.emitters.push({
      pos: pos.slice ? pos.slice() : [pos.x || 0, pos.y || 0, pos.z || 0],
      emitRate: opts.emitRate ?? 1.5,   // puffs per second
      life: opts.life || [1.5, 2.5],
      size: opts.size || 1.4,
      spread: opts.spread || 0.35,
      scale: opts.scale || 1,
      _acc: 0,
    });
  }

  /** Transient puff: spawn a burst of pooled particles at (x,y,z). */
  emitPuff(x, y, z, scale = 1) {
    if (this.disposed) return;
    const count = Math.max(1, Math.min(3, this.poolSize));
    for (let k = 0; k < count; k++) this._spawn(x, y, z, scale, [0.8, 1.6], 1.2, 0.4);
  }

  _spawn(x, y, z, scale, lifeRange, sizeBase, spread) {
    const i = this._slot;
    this._slot = (this._slot + 1) % this.poolSize;
    this._spawnAt(i, x, y, z, scale, lifeRange, sizeBase, spread);
  }

  _spawnAt(i, x, y, z, scale, lifeRange, sizeBase, spread) {
    const life = lifeRange[0] + Math.random() * (lifeRange[1] - lifeRange[0]);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = sizeBase * scale;
    this.opacity[i] = 0.35;
    this.scale[i] = scale;
    this._set3(this.geometry.attributes.position.array, i * 3, x, y, z);
    this._set3(this.velocity, i * 3,
      (Math.random() - 0.5) * spread,
      0.5 + Math.random() * 0.5,
      (Math.random() - 0.5) * spread);
  }

  _set3(arr, o, x, y, z) { arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; }

  /**
   * Advance particles + emitters.
   * @param {number} dt seconds
   * @param {THREE.Vector3|number[]} cameraPos — for distance fade
   */
  update(dt, cameraPos = null) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.1);
    const posArr = this.geometry.attributes.position.array;

    // continuous emitters
    for (const e of this.emitters) {
      e._acc += dt;
      const interval = 1 / e.emitRate;
      while (e._acc >= interval) {
        e._acc -= interval;
        this._spawn(
          e.pos[0] + (Math.random() - 0.5) * 0.3,
          e.pos[1] + (Math.random() - 0.5) * 0.2,
          e.pos[2] + (Math.random() - 0.5) * 0.3,
          e.scale, e.life, e.size, e.spread,
        );
      }
    }

    const cx = cameraPos ? (cameraPos.x || 0) : 0;
    const cy = cameraPos ? (cameraPos.y || 0) : 0;
    const cz = cameraPos ? (cameraPos.z || 0) : 0;
    const maxDist = this.material.uniforms.uMaxDist.value;

    for (let i = 0; i < this.poolSize; i++) {
      if (this.life[i] <= 0) { this.opacity[i] = 0; continue; }
      this.life[i] -= dt;
      const o = i * 3;
      posArr[o] += this.velocity[o] * dt;
      posArr[o + 1] += this.velocity[o + 1] * dt;
      posArr[o + 2] += this.velocity[o + 2] * dt;
      // grow + fade over life, plus distance fade to camera
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      let op = 0.35 * (1 - t);
      if (cameraPos) {
        const dx = posArr[o] - cx, dy = posArr[o + 1] - cy, dz = posArr[o + 2] - cz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        op *= Math.max(0, 1 - dist / maxDist);
      }
      this.opacity[i] = op;
      this.size[i] += dt * 0.4 * this.scale[i];
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aOpacity.needsUpdate = true;
  }

  /** Dispose tracked geometry/material (idempotent, §14). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.group) this.group.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
    if (this.glowTexture) this.glowTexture.dispose();
  }
}

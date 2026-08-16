/**
 * ParticleSystem.js — ambient dust motes (§13: DUST_MOTES = 30, "GPU Points"
 * — the 300→30 perf cut is intentional, §27).
 *
 * One THREE.Points over a single shared BufferGeometry. Each mote drifts
 * lazily on a slow sinusoid and its opacity is boosted near torch positions
 * (torch light scatters dust). All state lives in typed arrays — zero
 * per-frame allocation. Headless-safe: pure data + shader, no DOM needed.
 */

import * as THREE from 'three';
import { POOLS, MATERIALS } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

const POOL_SIZE = POOLS.DUST_MOTES; // 30

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
varying float vOpacity;
void main() {
  if (vOpacity <= 0.0) discard;
  vec2 uv = gl_PointCoord - vec2(0.5);
  float d = length(uv) * 2.0;
  float alpha = smoothstep(1.0, 0.0, d) * vOpacity;
  gl_FragColor = vec4(uColor, alpha);
}`;

export class ParticleSystem {
  constructor(group = null, area = { radius: 40, yMin: 0, yMax: 6 }) {
    this.group = group;
    this.area = area;
    this.poolSize = POOL_SIZE;

    const pos = new Float32Array(this.poolSize * 3);
    const size = new Float32Array(this.poolSize);
    const opacity = new Float32Array(this.poolSize);
    // per-mote private state (not attributes)
    this.phase = new Float32Array(this.poolSize);
    this.drift = new Float32Array(this.poolSize * 3);
    this.baseY = new Float32Array(this.poolSize);

    for (let i = 0; i < this.poolSize; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * area.radius;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = area.yMin + Math.random() * (area.yMax - area.yMin);
      pos[i * 3 + 2] = Math.sin(a) * r;
      size[i] = 0.05 + Math.random() * 0.05;
      opacity[i] = 0;
      this.phase[i] = Math.random() * Math.PI * 2;
      this.drift[i * 3] = (Math.random() - 0.5) * 0.15;
      this.drift[i * 3 + 1] = (Math.random() - 0.5) * 0.08;
      this.drift[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
      this.baseY[i] = pos[i * 3 + 1];
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacity, 1));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), area.radius + 4);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0.8, 0.75, 0.6) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.glowTexture = generateGlowTexture(MATERIALS.GLOW_TEXTURE_SIZE); // null headless

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    if (this.group) this.group.add(this.points);

    this.disposed = false;
  }

  /**
   * Advance the dust field.
   * @param {number} dt seconds
   * @param {THREE.Vector3|number[]} cameraPos
   * @param {Array<{x: number, y: number, z: number}>} [torchPositions] — boost opacity near torches
   */
  update(dt, cameraPos = null, torchPositions = null) {
    if (this.disposed) return;
    dt = Math.min(dt, 0.1);
    const posArr = this.geometry.attributes.position.array;
    const opArr = this.geometry.attributes.aOpacity.array;
    const t = performanceHeadlessClock();

    for (let i = 0; i < this.poolSize; i++) {
      const o = i * 3;
      // slow drift
      posArr[o] += this.drift[o] * dt;
      posArr[o + 1] = this.baseY[i] + Math.sin(t * 0.4 + this.phase[i]) * 0.3;
      posArr[o + 2] += this.drift[o + 2] * dt;
      // wrap around the area radius
      const r = Math.sqrt(posArr[o] * posArr[o] + posArr[o + 2] * posArr[o + 2]);
      if (r > this.area.radius) {
        posArr[o] = -posArr[o];
        posArr[o + 2] = -posArr[o + 2];
      }
      // base dim opacity, boosted near torches
      let op = 0.06 + 0.04 * Math.sin(t * 0.8 + this.phase[i]);
      if (torchPositions) {
        for (let k = 0; k < torchPositions.length; k++) {
          const tp = torchPositions[k];
          const dx = posArr[o] - tp.x, dy = posArr[o + 1] - tp.y, dz = posArr[o + 2] - tp.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 64) op += 0.25 * (1 - Math.sqrt(d2) / 8);
        }
      }
      opArr[i] = op;
    }

    this.geometry.attributes.position.needsUpdate = true;
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

/** Seconds-since-start clock that never throws (headless-safe Date.now). */
let _t0 = Date.now();
function performanceHeadlessClock() {
  return (Date.now() - _t0) / 1000;
}

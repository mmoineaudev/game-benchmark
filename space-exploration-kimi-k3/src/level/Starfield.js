// VOID DRIFT — Starfield.js
// Two-layer star Points: far fixed layer + bright near layer with speed streaks.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { mulberry32 } from '../utils/MathHelpers.js';

export class Starfield {
  constructor(scene) {
    this._scene = scene;
    this._stars = null;
    this._bright = null;
    this._brightVelocities = null;
  }

  init() {
    const rng = mulberry32(1337);
    const R = Constants.STARFIELD.RADIUS;

    // Far layer: dim, uniform.
    {
      const n = Constants.STARFIELD.COUNT;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = rng() * 2 - 1, phi = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        pos[i * 3] = s * Math.cos(phi) * R;
        pos[i * 3 + 1] = s * Math.sin(phi) * R;
        pos[i * 3 + 2] = u * R;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xaabbdd, size: 1.4, sizeAttenuation: false,
        transparent: true, opacity: 0.75, depthWrite: false,
      });
      this._stars = new THREE.Points(geo, mat);
      this._stars.frustumCulled = false;
      this._scene.add(this._stars);
    }

    // Bright near layer: additive, streaks with speed.
    {
      const n = Constants.STARFIELD.BRIGHT_COUNT;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = rng() * 2 - 1, phi = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        pos[i * 3] = s * Math.cos(phi) * R * 0.55;
        pos[i * 3 + 1] = s * Math.sin(phi) * R * 0.55;
        pos[i * 3 + 2] = u * R * 0.55;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color: 0xddeeff, size: 2.4, sizeAttenuation: false,
        transparent: true, opacity: 0.9, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this._bright = new THREE.Points(geo, mat);
      this._bright.frustumCulled = false;
      this._scene.add(this._bright);
    }
  }

  /** Starfield follows the ship so stars never run out; bright layer twinkles with speed. */
  update(shipPos, speedRatio) {
    if (this._stars) this._stars.position.copy(shipPos);
    if (this._bright) {
      this._bright.position.copy(shipPos);
      this._bright.material.size = 2.4 + speedRatio * 3.2;
      this._bright.material.opacity = 0.7 + speedRatio * 0.3;
    }
  }

  destroy() {
    for (const p of [this._stars, this._bright]) {
      if (p) {
        this._scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
      }
    }
    this._stars = null;
    this._bright = null;
  }
}

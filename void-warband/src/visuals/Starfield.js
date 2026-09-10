/**
 * Starfield.js — infinite backdrop of stars (3 depth layers).
 *
 * Each layer is a THREE.Points on a BufferGeometry of star positions
 * scattered in a shell around the origin, with per-star color variety
 * (mostly white, some blue / warm / red). update() recenters each layer
 * onto the ship (with per-layer wrap radii) so stars never run out, and
 * slowly rotates the far layer for a subtle sense of motion.
 */
import * as THREE from 'three';

/** Per-layer config: count, spread radius, point size, brightness. */
const LAYERS = [
  { count: 2000, radius: 1500, size: 2.2, brightness: 1.0 },
  { count: 4000, radius: 3000, size: 1.6, brightness: 0.8 },
  { count: 8000, radius: 6000, size: 1.2, brightness: 0.6 },
];

/** Star color palette: mostly white, some blue / warm / red. */
const STAR_COLORS = [
  { color: new THREE.Color(0xffffff), weight: 60 }, // white
  { color: new THREE.Color(0xbfd4ff), weight: 20 }, // blue
  { color: new THREE.Color(0xffe0b0), weight: 12 }, // warm
  { color: new THREE.Color(0xff9a8a), weight: 8 }, // red
];

function _pickColor(out) {
  const total = STAR_COLORS.reduce((a, b) => a + b.weight, 0);
  let r = Math.random() * total;
  for (const entry of STAR_COLORS) {
    r -= entry.weight;
    if (r <= 0) {
      out.copy(entry.color);
      return;
    }
  }
  out.copy(STAR_COLORS[0].color);
}

class _Starfield {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    /** @type {THREE.Points[]} */
    this._layers = [];
    /** Far-layer slow rotation speed, rad/s. */
    this._farSpin = 0.002;

    for (const cfg of LAYERS) {
      const positions = new Float32Array(cfg.count * 3);
      const colors = new Float32Array(cfg.count * 3);
      const c = new THREE.Color();
      const v = new THREE.Vector3();
      for (let i = 0; i < cfg.count; i++) {
        // Random point in a shell around the origin (uniform sphere dir,
        // radius biased toward the outer edge so the center isn't empty).
        v.randomDirection();
        const rad = cfg.radius * (0.5 + 0.5 * Math.random());
        positions[i * 3] = v.x * rad;
        positions[i * 3 + 1] = v.y * rad;
        positions[i * 3 + 2] = v.z * rad;
        _pickColor(c);
        const b = cfg.brightness * (0.6 + 0.4 * Math.random());
        colors[i * 3] = c.r * b;
        colors[i * 3 + 1] = c.g * b;
        colors[i * 3 + 2] = c.b * b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // Base colors stored for biome tinting (setTint rewrites from these).
      geo.userData = { baseColors: colors.slice() };

      const mat = new THREE.PointsMaterial({
        size: cfg.size,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.userData.radius = cfg.radius;
      points.userData.baseColors = colors.slice();
      scene.add(points);
      this._layers.push(points);
    }
  }

  /**
   * Recenter layers on the ship so stars never run out; slow-spin far layer.
   * @param {number} dt delta, s.
   * @param {THREE.Vector3|{x:number,y:number,z:number}} shipPosition
   */
  update(dt, shipPosition) {
    const sx = shipPosition.x, sy = shipPosition.y, sz = shipPosition.z;
    for (let i = 0; i < this._layers.length; i++) {
      const layer = this._layers[i];
      const r = layer.userData.radius;
      // Wrap each axis so the ship stays at the center of the shell.
      const dx = sx - layer.position.x;
      const dy = sy - layer.position.y;
      const dz = sz - layer.position.z;
      const span = r * 2;
      if (Math.abs(dx) > r) layer.position.x += Math.round(dx / span) * span;
      if (Math.abs(dy) > r) layer.position.y += Math.round(dy / span) * span;
      if (Math.abs(dz) > r) layer.position.z += Math.round(dz / span) * span;
      // Only the far layer (last) gets the slow rotation.
      if (i === this._layers.length - 1) {
        layer.rotation.y += this._farSpin * dt;
      }
    }
  }

  /**
   * Biome tint: multiply all star colors by a sector tint + brightness
   * (BiomeVisuals lerps these on sector transitions). Vertex colors are
   * precomputed — the tint is applied by rewriting the color buffer ONCE
   * per call (callers lerp, so this is not per-frame at full rate).
   * @param {THREE.Color} tint
   * @param {number} brightness
   */
  setTint(tint, brightness) {
    // Skip redundant writes (same tint+brightness as last applied).
    if (
      this._lastTint && this._lastTint.equals(tint) &&
      this._lastB === brightness
    ) return;
    this._lastTint = tint.clone();
    this._lastB = brightness;

    for (const layer of this._layers) {
      const attr = layer.geometry.getAttribute('color');
      const arr = attr.array;
      // Colors were authored as final brightness values; restore via the
      // stored base (this._baseColors) then apply tint × brightness.
      const base = layer.userData.baseColors;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i] = base[i] * tint.r * brightness;
        arr[i + 1] = base[i + 1] * tint.g * brightness;
        arr[i + 2] = base[i + 2] * tint.b * brightness;
      }
      attr.needsUpdate = true;
    }
  }
}

export { _Starfield as Starfield };
export default _Starfield;

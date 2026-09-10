/**
 * Sun.js — the system sun at the world origin (user feedback: distance needs
 * a reference point). A big emissive core sphere, additive corona sprite, and
 * an always-visible screen-space marker sprite so the sun can be seen from
 * ANY distance and used for orientation. The key directional light in
 * Game.js points from the sun's direction.
 */
import * as THREE from 'three';
import { SUN } from '../core/Constants.js';

/** Module-level scratch (no per-frame allocation). */
const _camDir = new THREE.Vector3();
const _camPos = new THREE.Vector3();

class _Sun {
  constructor(scene) {
    this.group = new THREE.Group();

    // -- Core: emissive hot sphere -------------------------------------------
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(SUN.coreRadius, 24, 16), coreMat);
    this.group.add(this.core);

    // -- Corona: additive glow sprite, big ------------------------------------
    this._coronaMat = new THREE.SpriteMaterial({
      map: _makeGlowTexture(),
      color: SUN.color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.corona = new THREE.Sprite(this._coronaMat);
    this.corona.scale.setScalar(SUN.coreRadius * 4);
    this.group.add(this.corona);

    // -- Always-visible marker: DOM overlay dot drawn per frame in update() ---
    this._marker = document.createElement('div');
    this._marker.id = 'vw-sun-marker';
    this._injectStyles();
    document.body.appendChild(this._marker);

    scene.add(this.group);

    // Scratch (no per-frame allocation).
    this._v = new THREE.Vector3();
  }

  /**
   * Per-frame: position the always-visible screen marker over the sun (only
   * when in front of the camera; hides when off-screen or behind).
   * @param {THREE.PerspectiveCamera} camera
   */
  update(camera) {
    this._v.set(0, 0, 0).project(camera); // sun = world origin
    // "Behind camera" test: projected z > 1 is unreliable at big far/near
    // ratios (float precision puts distant points at z ≈ 1.00005). Use the
    // camera-space direction instead: the sun is behind iff the vector from
    // the camera to it points against the camera's view direction.
    camera.getWorldDirection(_camDir);
    const behind = _camDir.dot(_camPos.copy(camera.position).multiplyScalar(-1)) < 0;
    const x = (this._v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this._v.y * 0.5 + 0.5) * window.innerHeight;
    const off = behind || x < -40 || x > window.innerWidth + 40 ||
      y < -40 || y > window.innerHeight + 40;
    // Marker size: grows with distance so it stays findable when far out,
    // capped so it never dwarfs the actual corona up close.
    const dist = camera.position.length();
    const size = Math.max(6, Math.min(140, (SUN.markerScreenSize * window.innerHeight * dist) / 2500));
    this._marker.style.width = `${size}px`;
    this._marker.style.height = `${size}px`;
    if (off) {
      this._marker.style.display = 'none';
    } else {
      this._marker.style.display = 'block';
      this._marker.style.left = `${x - size / 2}px`;
      this._marker.style.top = `${y - size / 2}px`;
    }
  }

  _injectStyles() {
    if (document.getElementById('vw-sun-marker-style')) return;
    const s = document.createElement('style');
    s.id = 'vw-sun-marker-style';
    s.textContent = `
  #vw-sun-marker { position: absolute; display: none; pointer-events: none;
    z-index: 440; border-radius: 50%;
    background: radial-gradient(circle, rgba(255,242,200,.95) 0%,
      rgba(255,210,122,.55) 45%, rgba(255,210,122,0) 75%);
    box-shadow: 0 0 24px rgba(255,210,122,.8); }
    `;
    document.head.appendChild(s);
  }
}

/** Radial glow texture for the corona sprite. */
function _makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.55)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { _Sun as Sun };
export default _Sun;

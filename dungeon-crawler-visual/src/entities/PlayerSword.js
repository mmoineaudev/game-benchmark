import * as THREE from 'three';
import { SWORD } from '../core/Constants.js';

// First-person sword attached to the camera. Held in a blade-up ready pose,
// clearly visible bottom-right of the view. Swing animation:
// windup (raise to top-right) -> swing (diagonal chop to bottom-left) -> recover.
// The arc is translation-driven (the grip carries the blade across the screen)
// with gentle blade rotation, so the whole sword stays on screen throughout.
export class PlayerSword {
  constructor(camera) {
    this.camera = camera;
    this.state = 'idle'; // idle | windup | swing | recover
    this.time = 0;
    this.cool = 0;
    this.group = new THREE.Group();
    this._build();
    camera.add(this.group);
    this._setRest();
  }

  _build() {
    const steel = new THREE.MeshStandardMaterial({
      color: 0xc8ccd8, roughness: 0.3, metalness: 0.9,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x4a3a28, roughness: 0.6, metalness: 0.6,
    });
    this._mats = [steel, dark];

    // Blade points UP from the guard (ready pose, tip high). Kept short enough
    // that the tip stays inside the frame during the swing arc.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.5, 0.1), steel);
    blade.position.y = 0.38;
    this.group.add(blade);

    // Guard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.032, 0.055), dark);
    guard.position.y = 0.14;
    this.group.add(guard);

    // Grip + pommel
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.18, 8), dark);
    grip.position.y = 0.02;
    this.group.add(grip);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), dark);
    pommel.position.y = -0.08;
    this.group.add(pommel);

    this.group.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  }

  _setRest() {
    // Bottom-right of the view, blade tilted toward the screen center
    this.group.position.set(0.4, -0.26, -0.8);
    this.group.rotation.set(-0.1, 0, 0.4);
  }

  // Returns true if the swing started (false if still recovering/cooldown)
  swing() {
    if (this.state !== 'idle' || this.cool > 0) return false;
    this.state = 'windup';
    this.time = 0;
    return true;
  }

  get isSwinging() {
    return this.state === 'swing';
  }

  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    if (this.state === 'idle') return;
    this.time += dt;

    const windup = SWORD.WINDUP;
    const swingEnd = windup + SWORD.SWING;
    const total = windup + SWORD.SWING + SWORD.RECOVER;
    const t = this.time;

    // State transitions drive the hit window (isSwinging)
    if (t >= windup && this.state === 'windup') this.state = 'swing';
    if (t >= swingEnd && this.state === 'swing') this.state = 'recover';
    if (t >= total) {
      this._setRest();
      this.state = 'idle';
      this.time = 0;
      this.cool = SWORD.COOLDOWN;
      return;
    }

    if (t < windup) {
      // Raise to top-right: grip up-right, blade tilts slightly right-back
      const p = t / windup;
      this.group.position.x = THREE.MathUtils.lerp(0.4, 0.46, p);
      this.group.position.y = THREE.MathUtils.lerp(-0.26, 0.02, p);
      this.group.position.z = THREE.MathUtils.lerp(-0.8, -0.75, p);
      this.group.rotation.x = THREE.MathUtils.lerp(-0.1, -0.05, p);
      this.group.rotation.z = THREE.MathUtils.lerp(0.4, -0.3, p);
    } else if (t < swingEnd) {
      // Diagonal chop: grip sweeps top-right -> bottom-left, blade swings across
      const p = (t - windup) / SWORD.SWING;
      const eased = 1 - Math.pow(1 - p, 2);
      this.group.position.x = THREE.MathUtils.lerp(0.46, -0.5, eased);
      this.group.position.y = THREE.MathUtils.lerp(0.02, -0.32, eased);
      this.group.position.z = THREE.MathUtils.lerp(-0.75, -0.8, eased);
      this.group.rotation.x = THREE.MathUtils.lerp(-0.05, 0.1, eased);
      this.group.rotation.z = THREE.MathUtils.lerp(-0.3, 0.5, eased);
    } else {
      // Recover to rest
      const p = (t - swingEnd) / SWORD.RECOVER;
      const eased = p * p;
      this.group.position.x = THREE.MathUtils.lerp(this.group.position.x, 0.4, eased);
      this.group.position.y = THREE.MathUtils.lerp(this.group.position.y, -0.26, eased);
      this.group.position.z = THREE.MathUtils.lerp(this.group.position.z, -0.8, eased);
      this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -0.1, eased);
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, 0.4, eased);
    }
  }

  dispose() {
    this.camera.remove(this.group);
    this.group.traverse((m) => {
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    for (const m of this._mats) m.dispose();
  }
}

import * as THREE from 'three';
import { SWORD } from '../core/Constants.js';

// First-person sword attached to the camera. Swing animation:
// windup (raise) -> swing (chop across) -> recover (back to rest).
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
      color: 0xb8bcc8, roughness: 0.35, metalness: 0.85,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x3a2a1a, roughness: 0.6, metalness: 0.6,
    });
    this._mats = [steel, dark];

    // Grip + pommel
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 8), dark);
    grip.position.y = 0.0;
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), dark);
    pommel.position.y = 0.09;

    // Guard
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), dark);
    guard.position.y = -0.09;

    // Blade (points down from the hand)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.62, 0.09), steel);
    blade.position.y = -0.42;

    this.group.add(grip, pommel, guard, blade);
    this.group.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  }

  _setRest() {
    // Held low-right, slightly forward
    this.group.position.set(0.42, -0.4, -0.5);
    this.group.rotation.set(-0.3, 0, 0.35);
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
      // Raise back-right
      const p = t / windup;
      this.group.rotation.x = -0.3 - 1.1 * p;
      this.group.rotation.z = 0.35 - 0.95 * p;
      this.group.position.z = -0.5 + 0.1 * p;
    } else if (t < swingEnd) {
      // Chop across front, down-left
      const p = (t - windup) / SWORD.SWING;
      const eased = 1 - Math.pow(1 - p, 2);
      this.group.rotation.x = -1.4 + 2.4 * eased;
      this.group.rotation.z = -0.6 + 1.15 * eased;
      this.group.position.z = -0.4 - 0.12 * eased;
    } else {
      // Recover to rest
      const p = (t - swingEnd) / SWORD.RECOVER;
      const eased = p * p;
      this.group.rotation.x = THREE.MathUtils.lerp(this.group.rotation.x, -0.3, eased);
      this.group.rotation.z = THREE.MathUtils.lerp(this.group.rotation.z, 0.35, eased);
      this.group.position.z = THREE.MathUtils.lerp(this.group.position.z, -0.5, eased);
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

import * as THREE from 'three';
import { SWORD } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

// First-person sword attached to the camera. Held in a blade-up ready pose,
// clearly visible bottom-right of the view. Swing animation:
// windup (raise to top-right) -> swing (diagonal chop to bottom-left) -> recover.
// The arc is translation-driven (the grip carries the blade across the screen)
// with gentle blade rotation, so the whole sword stays on screen throughout.
//
// Progression: the sword grows +10% per 10 orbs held (capped at +100%) and
// changes its base color at each size bonus. Danger glow: the blade glows when
// skeletons are close, brighter as they approach.
const SWORD_COLORS = [
  0xc8ccd8, // step 0: steel (base)
  0xb08a5a, // step 1: bronze
  0x8a9ab0, // step 2: iron-blue
  0xd8c86a, // step 3: gold
  0x6ad86a, // step 4: emerald
  0x5ac8d8, // step 5: teal
  0x5a8ad8, // step 6: sapphire
  0x9a5ad8, // step 7: amethyst
  0xd85aa0, // step 8: magenta
  0xff5544, // step 9: inferno
  0xfff4d8, // step 10: radiant
];

export class PlayerSword {
  constructor(camera) {
    this.camera = camera;
    this.state = 'idle'; // idle | windup | swing | recover
    this.time = 0;
    this.cool = 0;
    this.group = new THREE.Group();
    this._glow = 0;        // current danger glow intensity (damped)
    this._glowTarget = 0;
    this._colorStep = 0;
    this._build();
    camera.add(this.group);
    this._setRest();
  }

  _build() {
    const dark = new THREE.MeshStandardMaterial({
      color: 0x4a3a28, roughness: 0.6, metalness: 0.6,
    });
    // Separate blade material so the danger glow (emissive) can animate
    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0xc8ccd8, roughness: 0.3, metalness: 0.9,
      emissive: 0xff2211, emissiveIntensity: 0,
    });
    this._mats = [this.bladeMat, dark];

    // Blade points UP from the guard (ready pose, tip high). Kept short enough
    // that the tip stays inside the frame during the swing arc.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.5, 0.1), this.bladeMat);
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

    // Danger glow sprite wrapped around the blade (additive)
    this._glowTex = generateGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0xff3322,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this.glowSprite = new THREE.Sprite(this.glowMat);
    this.glowSprite.position.set(0, 0.45, 0);
    this.glowSprite.scale.setScalar(0.35);
    this.group.add(this.glowSprite);

    this.group.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  }

  _setRest() {
    // Bottom-right of the view, blade tilted toward the screen center
    this.group.position.set(0.4, -0.26, -0.8);
    this.group.rotation.set(-0.1, 0, 0.4);
  }

  // Grows the sword +10% per 10 orbs held (capped at +100% = 2x at 100 orbs)
  // and shifts the base color to the next palette step at each size bonus.
  setOrbCount(count) {
    const steps = Math.floor(count / 10);
    const capped = Math.min(steps, 10);
    const scale = 1 + capped * 0.1;
    this.group.scale.setScalar(scale);
    if (capped !== this._colorStep) {
      this._colorStep = capped;
      this.bladeMat.color.setHex(SWORD_COLORS[capped]);
    }
  }

  // Danger glow: 0 at >= GLOW_MAX_DIST, ramps to 1 as skeletons approach
  setDanger(nearestSkelDist, dt) {
    const glowMax = 12;
    const glowMin = 1.8;
    this._glowTarget = nearestSkelDist >= glowMax
      ? 0
      : Math.max(0, Math.min(1, 1 - (nearestSkelDist - glowMin) / (glowMax - glowMin)));
    this._glow = THREE.MathUtils.damp(this._glow, this._glowTarget, 6, dt);

    this.bladeMat.emissiveIntensity = this._glow * 1.5;
    this.glowMat.opacity = this._glow * 0.7;
    this.glowSprite.scale.setScalar(0.35 + this._glow * 0.65);
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

  update(dt, nearestSkelDist = Infinity) {
    if (this.cool > 0) this.cool -= dt;

    // Danger glow updates every frame, independent of swing state
    this.setDanger(nearestSkelDist, dt);

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
    this.glowMat.dispose();
    if (this._glowTex) this._glowTex.dispose();
  }
}

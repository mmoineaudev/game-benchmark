import * as THREE from 'three';
import { SWORD } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

// First-person sword attached to the camera. Held in a blade-up ready pose,
// clearly visible bottom-right of the view. Attack animation is a PIERCE:
// windup (pull back) -> thrust (stab forward toward the screen center) -> recover.
// Because the blade drives forward into the view, a longer sword reads as more reach.
//
// Progression: the sword grows +20% per 10 orbs held (capped at +200% = 3x at
// 100 orbs), which also extends its effective melee range. It changes base
// color at each size bonus. Danger glow: the blade glows red and casts light
// when skeletons are close. Growth light: a subtle green light on the blade,
// more intense as the sword grows.
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
    this.state = 'idle'; // idle | windup | thrust | recover
    this.time = 0;
    this.cool = 0;
    this.group = new THREE.Group();
    this._glow = 0;        // current danger glow intensity (damped)
    this._glowTarget = 0;
    this._colorStep = 0;
    this._rangeScale = 1;
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

    // Blade points UP from the guard (ready pose, tip high).
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

    // Danger light: illuminates the surroundings when enemies are close.
    // No shadows (the 8-torch shadow budget is untouched).
    this.dangerLight = new THREE.PointLight(0xff3322, 0, 7, 1.6);
    this.dangerLight.position.set(0, 0.45, 0.2);
    this.group.add(this.dangerLight);

    // Growth light: subtle green light, more intense as the sword grows.
    this.growthLight = new THREE.PointLight(0x44ff88, 0, 8, 1.6);
    this.growthLight.position.set(0, 0.5, 0.05);
    this.group.add(this.growthLight);

    // Green glow sprite around the blade (marks the growth light source)
    this.growthGlowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0x44ff88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this.growthGlow = new THREE.Sprite(this.growthGlowMat);
    this.growthGlow.position.set(0, 0.45, 0);
    this.growthGlow.scale.setScalar(0.3);
    this.group.add(this.growthGlow);

    this.group.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  }

  _setRest() {
    // Bottom-right of the view, blade tilted toward the screen center
    this.group.position.set(0.4, -0.26, -0.8);
    this.group.rotation.set(-0.1, 0, 0.4);
  }

  // Effective melee reach — grows with the sword size bonus
  get range() {
    return SWORD.RANGE * this._rangeScale;
  }

  // Grows the sword +20% per 10 orbs held (capped at +200% = 3x at 100 orbs),
  // extends melee range accordingly, shifts the base color each size bonus,
  // and intensifies the green growth light.
  setOrbCount(count) {
    const steps = Math.floor(count / 10);
    const capped = Math.min(steps, 10);
    this._rangeScale = 1 + capped * 0.2;
    this.group.scale.setScalar(this._rangeScale);
    const growth = capped / 10; // 0..1
    this.growthLight.intensity = growth * 2.8;
    this.growthGlowMat.opacity = growth * 0.35;
    this.growthGlow.scale.setScalar(0.3 + growth * 0.5);
    if (capped !== this._colorStep) {
      this._colorStep = capped;
      this.bladeMat.color.setHex(SWORD_COLORS[capped]);
    }
  }

  // Danger glow + light: 0 at >= GLOW_MAX_DIST, ramps to 1 as skeletons approach
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
    this.dangerLight.intensity = this._glow * 3.2;
  }

  // Returns true if the attack started (false if still recovering/cooldown)
  attack() {
    if (this.state !== 'idle' || this.cool > 0) return false;
    this.state = 'windup';
    this.time = 0;
    return true;
  }

  get isSwinging() {
    return this.state === 'thrust';
  }

  update(dt, nearestSkelDist = Infinity) {
    if (this.cool > 0) this.cool -= dt;

    // Danger glow updates every frame, independent of attack state
    this.setDanger(nearestSkelDist, dt);

    if (this.state === 'idle') return;
    this.time += dt;

    const windup = SWORD.WINDUP;
    const thrustEnd = windup + SWORD.SWING;
    const total = windup + SWORD.SWING + SWORD.RECOVER;
    const t = this.time;

    // State transitions drive the hit window (isSwinging)
    if (t >= windup && this.state === 'windup') this.state = 'thrust';
    if (t >= thrustEnd && this.state === 'thrust') this.state = 'recover';
    if (t >= total) {
      this._setRest();
      this.state = 'idle';
      this.time = 0;
      this.cool = SWORD.COOLDOWN;
      return;
    }

    if (t < windup) {
      // Pull back: sword retreats toward the right hip, blade cocks back
      const p = t / windup;
      this.group.position.x = THREE.MathUtils.lerp(0.4, 0.36, p);
      this.group.position.y = THREE.MathUtils.lerp(-0.26, -0.3, p);
      this.group.position.z = THREE.MathUtils.lerp(-0.8, -0.72, p);
      this.group.rotation.x = THREE.MathUtils.lerp(-0.1, -0.55, p);
      this.group.rotation.z = THREE.MathUtils.lerp(0.4, 0.55, p);
    } else if (t < thrustEnd) {
      // THRUST: drive the blade forward toward the screen center.
      // The tip extends INTO the view — a longer sword reads as more reach.
      const p = (t - windup) / SWORD.SWING;
      const eased = 1 - Math.pow(1 - p, 2);
      this.group.position.x = THREE.MathUtils.lerp(0.36, 0.02, eased);
      this.group.position.y = THREE.MathUtils.lerp(-0.3, -0.06, eased);
      this.group.position.z = THREE.MathUtils.lerp(-0.72, -1.05, eased);
      this.group.rotation.x = THREE.MathUtils.lerp(-0.55, -1.4, eased);
      this.group.rotation.z = THREE.MathUtils.lerp(0.55, 0, eased);
    } else {
      // Recover to rest
      const p = (t - thrustEnd) / SWORD.RECOVER;
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
    this.growthGlowMat.dispose();
    this.dangerLight.dispose();
    this.growthLight.dispose();
    if (this._glowTex) this._glowTex.dispose();
  }
}

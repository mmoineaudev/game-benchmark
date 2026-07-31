import * as THREE from 'three';
import { SWORD, HIT_STOP } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

// First-person sword attached to the camera. Curved two-segment blade with a
// fuller, crossguard and brass pommel. Attack = 2-hit combo:
//   WINDUP1 -> SLASH1 (R->L slash) -> RECOVER1 -> [window] -> WINDUP2 -> SLASH2
//   (overhead chop) -> RECOVER2 -> COOLDOWN -> IDLE
// Combo window: 0.35 s from RECOVER1 start (0.18 s recover + 0.17 s grace).
//
// Progression: the sword grows +20% per 10 orbs held (capped at +200% = 3x at
// 100 orbs), extends melee range, shifts base color each size bonus, and
// intensifies the green growth light. Danger glow: red emissive + light when
// skeletons are close. Trail + impact sparks + hit-stop provide feedback.
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
    this.state = 'idle'; // idle | windup1 | slash1 | recover1 | windup2 | slash2 | recover2 | cooldown
    this.time = 0;
    this.cool = 0;
    this.comboStep = 0;   // 0 | 1 | 2 (HUD)
    this.group = new THREE.Group();
    this._glow = 0;        // current danger glow intensity (damped)
    this._glowTarget = 0;
    this._colorStep = 0;
    this._rangeScale = 1;
    this._flashTimer = 0;
    this._build();
    this._buildTrail();
    this._buildSparks();
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
    this.steelMat = new THREE.MeshStandardMaterial({
      color: 0xc8ccd8, roughness: 0.3, metalness: 0.9,
    });
    this.fullerMat = new THREE.MeshStandardMaterial({
      color: 0x9a9ea8, roughness: 0.3, metalness: 0.9,
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xd8b44a, roughness: 0.4, metalness: 0.8,
    });
    this._mats = [this.bladeMat, this.steelMat, this.fullerMat, this.brassMat, dark];

    // Blade: two segments for a curved silhouette (tip leans forward)
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.35, 0.1), this.steelMat);
    lower.position.y = 0.30;
    this.group.add(lower);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.08), this.bladeMat);
    upper.position.y = 0.60;
    upper.rotation.x = -0.12; // curve: tip tips forward
    upper.castShadow = false;
    this.group.add(upper);
    this._upperBlade = upper;

    // Fuller (inset line on the blade face)
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.4, 0.005), this.fullerMat);
    fuller.position.set(0, 0.35, 0.052);
    this.group.add(fuller);

    // Crossguard with swept tips
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.05), dark);
    guard.position.y = 0.12;
    this.group.add(guard);
    for (const sx of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.06), dark);
      tip.position.set(sx * 0.13, 0.12, 0);
      tip.rotation.z = sx * 0.5;
      this.group.add(tip);
    }

    // Grip + pommel
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 8), dark);
    grip.position.y = 0.0;
    this.group.add(grip);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), this.brassMat);
    pommel.position.y = -0.11;
    this.group.add(pommel);

    // Danger glow sprite around the blade
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

    // Danger light
    this.dangerLight = new THREE.PointLight(0xff3322, 0, 7, 1.6);
    this.dangerLight.position.set(0, 0.45, 0.2);
    this.group.add(this.dangerLight);

    // Growth light + green sprite (intensity follows size bonus)
    this.growthLight = new THREE.PointLight(0x44ff88, 0, 8, 1.6);
    this.growthLight.position.set(0, 0.5, 0.05);
    this.group.add(this.growthLight);
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

  _buildTrail() {
    // 6 pooled additive glow sprites, spawned along the arc during slashes
    this.trailMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0x88ccff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this._mats.push(this.trailMat);
    this._trail = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(this.trailMat);
      s.visible = false;
      this.group.add(s);
      this._trail.push({ sprite: s, life: 0, active: false });
    }
    this._trailIdx = 0;
  }

  _spawnTrail() {
    for (let k = 0; k < 2; k++) {
      const t = this._trail[this._trailIdx];
      this._trailIdx = (this._trailIdx + 1) % this._trail.length;
      t.active = true;
      t.life = 0.15;
      t.sprite.visible = true;
      // Place along the blade (upper segment tip area)
      t.sprite.position.set(
        this.group.position.x + Math.sin(this.group.rotation.z) * 0.5,
        0.55,
        this.group.position.z,
      );
      t.sprite.scale.setScalar(0.5);
      t.sprite.material.opacity = 0.5;
    }
  }

  _updateTrail(dt) {
    for (const t of this._trail) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        t.sprite.visible = false;
        continue;
      }
      t.sprite.material.opacity = 0.5 * (t.life / 0.15);
      t.sprite.scale.multiplyScalar(1 + dt * 6);
    }
  }

  _buildSparks() {
    // 8 pooled impact spark spheres
    this.sparkGeo = new THREE.SphereGeometry(0.03, 4, 4);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcc88 });
    this._mats.push(this.sparkMat);
    this._sparks = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.visible = false;
      this.scene = this.camera; // sparks live in world space via camera parent
      this.camera.add(m);
      this._sparks.push({
        mesh: m, vel: new THREE.Vector3(), life: 0, active: false,
      });
    }
  }

  // Burst of sparks at a world position (called by Game on hit)
  burstSparks(worldPos) {
    const n = this._sparks.length;
    for (const s of this._sparks) {
      if (s.active) continue;
      s.active = true;
      s.life = 0.25;
      s.mesh.visible = true;
      s.mesh.position.copy(worldPos);
      s.vel.set(
        (Math.random() - 0.5) * 6,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 6,
      );
    }
    // (uses all 8 regardless of n)
  }

  _updateSparks(dt) {
    for (const s of this._sparks) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= 4 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
    }
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

  get scale() {
    return this._rangeScale;
  }

  // Grows the sword +20% per 10 orbs held (capped at +200% = 3x at 100 orbs),
  // extends melee range, shifts base color, intensifies the green growth light.
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
      this.steelMat.color.setHex(SWORD_COLORS[capped]);
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

  // Returns true if an attack started (false if busy/cooldown)
  attack() {
    if (this.state !== 'idle' || this.cool > 0) return false;
    this.state = 'windup1';
    this.time = 0;
    this.comboStep = 0;
    return true;
  }

  // Hit windows during slashes (Game applies damage once per slash)
  get isSwinging() {
    return this.state === 'slash1' || this.state === 'slash2';
  }

  get currentArc() {
    return this.state === 'slash2' ? SWORD.COMBO.ARC2 : SWORD.COMBO.ARC1;
  }

  get currentDamage() {
    return this.state === 'slash2' ? SWORD.COMBO.HIT2_DAMAGE : SWORD.COMBO.HIT1_DAMAGE;
  }

  update(dt, nearestSkelDist = Infinity) {
    if (this.cool > 0) this.cool -= dt;
    this.setDanger(nearestSkelDist, dt);
    this._updateTrail(dt);
    this._updateSparks(dt);
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) this.bladeMat.emissive.setHex(0xff2211);
    }

    if (this.state === 'idle') return;
    this.time += dt;
    const C = SWORD.COMBO;

    // State transitions
    if (this.state === 'windup1' && this.time >= C.WINDUP1) this._enter('slash1', C.WINDUP1);
    else if (this.state === 'slash1' && this.time >= C.SLASH1) this._enter('recover1', C.SLASH1);
    else if (this.state === 'recover1') {
      if (this.time >= C.COMBO_WINDOW) {
        this._enter('cooldown', 0);
      } else if (this.time >= C.RECOVER1 && this._comboBuffered) {
        this._comboBuffered = false;
        this._enter('windup2', C.RECOVER1);
      }
    } else if (this.state === 'windup2' && this.time >= C.WINDUP2) this._enter('slash2', C.WINDUP2);
    else if (this.state === 'slash2' && this.time >= C.SLASH2) this._enter('recover2', C.SLASH2);
    else if (this.state === 'recover2' && this.time >= C.RECOVER2) this._enter('cooldown', C.RECOVER2);
    else if (this.state === 'cooldown' && this.time >= C.COOLDOWN) {
      this._setRest();
      this.state = 'idle';
      this.time = 0;
      this.comboStep = 0;
      this.cool = 0;
      return;
    }

    this._animatePose(C);
  }

  // Buffered input: called by Game when RMB pressed during the combo window
  bufferCombo() {
    if (this.state === 'recover1' || this.state === 'slash1') {
      this._comboBuffered = true;
    }
  }

  _enter(state, resetFrom) {
    this.state = state;
    this.time -= resetFrom;
    if (state === 'slash1') this.comboStep = 1;
    if (state === 'slash2') this.comboStep = 2;
    if (state === 'slash1' || state === 'slash2') {
      this._spawnTrail();
      this.onSlash?.(this.comboStep);
    }
  }

  _animatePose(C) {
    const p = this.group.position;
    const r = this.group.rotation;
    const s = this.state;
    const t = this.time;
    const lerp = THREE.MathUtils.lerp;
    const easeOut = (x) => 1 - Math.pow(1 - x, 2);
    const easeIn = (x) => x * x;

    switch (s) {
      case 'windup1': {
        const k = easeOut(Math.min(1, t / C.WINDUP1));
        p.x = lerp(0.4, 0.36, k);
        p.y = lerp(-0.26, -0.3, k);
        p.z = lerp(-0.8, -0.72, k);
        r.x = lerp(-0.1, -0.55, k);
        r.z = lerp(0.4, 0.55, k);
        break;
      }
      case 'slash1': {
        const k = easeOut(Math.min(1, t / C.SLASH1));
        // R->L horizontal slash across the screen
        p.x = lerp(0.36, -0.42, k);
        p.y = lerp(-0.3, -0.22, k);
        p.z = lerp(-0.72, -0.85, k);
        r.x = lerp(-0.55, -0.2, k);
        r.z = lerp(0.55, -0.5, k);
        break;
      }
      case 'recover1': {
        const k = easeIn(Math.min(1, t / C.RECOVER1));
        p.x = lerp(-0.42, 0.3, k);
        p.y = lerp(-0.22, -0.24, k);
        p.z = lerp(-0.85, -0.78, k);
        r.x = lerp(-0.2, -0.1, k);
        r.z = lerp(-0.5, 0.1, k);
        break;
      }
      case 'windup2': {
        const k = easeOut(Math.min(1, t / C.WINDUP2));
        p.x = lerp(0.3, 0.1, k);
        p.y = lerp(-0.24, -0.1, k);
        p.z = lerp(-0.78, -0.7, k);
        r.x = lerp(-0.1, -1.2, k);
        r.z = lerp(0.1, 0, k);
        break;
      }
      case 'slash2': {
        const k = easeOut(Math.min(1, t / C.SLASH2));
        // Overhead chop down-center
        p.x = lerp(0.1, 0.02, k);
        p.y = lerp(-0.1, -0.06, k);
        p.z = lerp(-0.7, -1.05, k);
        r.x = lerp(-1.2, 0.9, k);
        r.z = lerp(0, 0.15, k);
        break;
      }
      case 'recover2': {
        const k = easeIn(Math.min(1, t / C.RECOVER2));
        p.x = lerp(0.02, 0.4, k);
        p.y = lerp(-0.06, -0.26, k);
        p.z = lerp(-1.05, -0.8, k);
        r.x = lerp(0.9, -0.1, k);
        r.z = lerp(0.15, 0.4, k);
        break;
      }
      case 'cooldown':
        // Hold rest pose
        break;
    }
  }

  // Blade flash on hit
  flashBlade() {
    this.bladeMat.emissive.setHex(0xffdd88);
    this.bladeMat.emissiveIntensity = 1.2;
    this._flashTimer = 0.1;
  }

  dispose() {
    this.camera.remove(this.group);
    for (const s of this._sparks) this.camera.remove(s.mesh);
    this.group.traverse((m) => {
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    if (this.sparkGeo) this.sparkGeo.dispose();
    for (const m of this._mats) m.dispose();
    this.glowMat.dispose();
    this.growthGlowMat.dispose();
    this.trailMat.dispose();
    this.dangerLight.dispose();
    this.growthLight.dispose();
    if (this._glowTex) this._glowTex.dispose();
  }
}

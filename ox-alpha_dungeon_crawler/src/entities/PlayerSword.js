// PlayerSword.js — first-person floating weapon (§9): combo state machine, per-tier
// forms, trails/sparks/smoke, evolution. Form constraints: straight blades, NO hands,
// self-lit on layer 2, never shadow casting. Tier 5 adds exactly ONE camera light.
import * as THREE from 'three';
import {
  SWORD, SWORD_COMBO, COMBO_WINDOW, COMBO_COOLDOWN,
  MAX_TIER, ARC_CHANCE, ARC_BOLTS, LIGHT_SOURCES
} from '../core/Constants.js';

export default class PlayerSword {
  constructor(camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.layers.set(2);
    // traverse-set: all children must be layer 2
    this.group.traverse(o => o.layers.set(2));
    camera.add(this.group);

    this.tier = 0;
    this.comboStep = 0;         // 0 idle; 1..3 active step
    this.phase = null;          // windup | swing | recover | cooldown
    this.phaseT = 0;
    this.windowT = 0;           // combo chain window
    this.cooldownT = 0;
    this.buffered = false;
    this.bladeFlash = 0;
    this.onDamage = null;       // (step, scale) → Game applies cone damage
    this.onLandedStrike = null; // (tier) → Game rolls electric + arc bolts

    this._formMeshes = [];
    this._t5Light = null;
    this._buildForm(0);
  }

  _clearForm() {
    for (const m of this._formMeshes) {
      this.group.remove(m);
      m.geometry?.dispose?.();
      m.material?.dispose?.();
    }
    this._formMeshes = [];
    if (this._t5Light) { this.group.remove(this._t5Light); this._t5Light = null; }
  }

  _add(mesh) {
    mesh.traverse ? mesh.traverse(o => o.layers.set(2)) : mesh.layers.set(2);
    if (mesh.isMesh) mesh.castShadow = false;
    this.group.add(mesh);
    this._formMeshes.push(mesh);
  }

  // six per-tier form builders — straight blades, distinct silhouettes/colors
  _buildForm(tier) {
    this._clearForm();
    const g = new THREE.Group();

    const bladeLen = 0.76 + tier * 0.06 * 4; // monotonic 0.76 → ~1.0 (pre-scale)
    let bladeMat, guardMat = new THREE.MeshStandardMaterial({ color: 0x6a5a34, roughness: 0.5, metalness: 0.7 });
    switch (tier) {
      case 0: bladeMat = new THREE.MeshStandardMaterial({ color: 0x777068, roughness: 0.6, metalness: 0.5 }); break;
      case 1: bladeMat = new THREE.MeshStandardMaterial({ color: 0xaab2bc, roughness: 0.3, metalness: 0.9 }); break;
      case 2: bladeMat = new THREE.MeshStandardMaterial({ color: 0x88aacc, emissive: 0x224488, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.7 }); break;
      case 3: bladeMat = new THREE.MeshStandardMaterial({ color: 0xb08cff, emissive: 0x6633cc, emissiveIntensity: 1.1, roughness: 0.25 }); break;
      case 4: bladeMat = new THREE.MeshBasicMaterial({ color: 0xffe9c8 }); break;
      default: bladeMat = new THREE.MeshBasicMaterial({ color: 0x9fefff });
    }
    this.bladeMaterial = bladeMat;

    // straight box blade (never bent)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, bladeLen, 0.012), bladeMat);
    blade.position.y = bladeLen / 2 + 0.14;
    g.add(blade);
    const tipGeo = new THREE.ConeGeometry(0.032, 0.1, 4);
    const tip = new THREE.Mesh(tipGeo, bladeMat);
    tip.position.y = blade.position.y + bladeLen / 2 + 0.05;
    g.add(tip);

    if (tier >= 1) {
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.045, 0.05), guardMat);
      guard.position.y = 0.13;
      g.add(guard);
    }
    if (tier === 2) {
      // glowing runes
      for (let i = 0; i < 3; i++) {
        const rune = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.004),
          new THREE.MeshBasicMaterial({ color: 0x88ccff }));
        rune.position.set(0, 0.35 + i * 0.18, 0.008);
        g.add(rune);
      }
    }
    if (tier === 3) {
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.09),
        new THREE.MeshBasicMaterial({ color: 0xd0aaff }));
      crystal.position.y = 0.13 + 0.02;
      g.add(crystal);
    }
    if (tier >= 4) {
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 16),
        new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
      halo.position.y = 0.13;
      halo.rotation.x = Math.PI / 2;
      g.add(halo);
    }
    if (tier === 5 && !this._t5Light) {
      // exactly ONE extra camera-attached point light at T5
      this._t5Light = new THREE.PointLight(0x9fefff, LIGHT_SOURCES.SWORD_EXTRA_T5.intensity,
        LIGHT_SOURCES.SWORD_EXTRA_T5.distance, LIGHT_SOURCES.SWORD_EXTRA_T5.decay);
      this._t5Light.layers.set(2);
      this.group.add(this._t5Light);
    }

    // grip
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.26, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c2018, roughness: 0.9 }));
    grip.position.y = 0.0;
    g.add(grip);

    // rest pose: floating low-right of view
    g.position.set(0.38, -0.42, -0.75);
    g.rotation.set(-0.35, -0.25, 0.18);
    g.userData.tipY = tip.position.y;
    this.bladeTipLocalY = g.userData.tipY;
    this._add(g);
    this.formGroup = g;
    this.bladeLength = bladeLen;
  }

  setTier(tier) {
    if (tier === this.tier) return false;
    this.tier = tier;
    this._buildForm(tier);
    return true;
  }

  attackSpeedMult(buffSpeedMult, souls) {
    return buffSpeedMult * (1 + 0.001 * souls); // buffs × souls component
  }

  // edge-press from Game: start or chain the combo
  pressAttack() {
    if (this.phase === null) { this._beginStep(this.comboStep === 0 ? 1 : Math.min(3, this.comboStep + 1)); return; }
    if ((this.phase === 'recover' || this.phase === 'swing') && this.comboStep < 3) {
      this.buffered = true; // chain inside window
    }
  }

  _beginStep(step) {
    this.comboStep = step;
    this.phase = 'windup';
    this.phaseT = 0;
  }

  get currentStepDef() { return SWORD_COMBO[Math.max(0, this.comboStep - 1)]; }

  update(dt, speedMult) {
    if (this.bladeFlash > 0) this.bladeFlash -= dt;

    if (this.phase === 'cooldown') {
      this.cooldownT -= dt;
      if (this.cooldownT <= 0) { this.phase = null; this.comboStep = 0; this.windowT = 0; }
      this._poseIdle(dt);
      return this.currentStepDef && this.phase === null ? null : null;
    }

    if (this.phase !== null) {
      const def = this.currentStepDef;
      const dur = k => k / speedMult; // speed scales duration fields only
      this.phaseT += dt;
      const wu = dur(def.windup), sw = dur(def.swing), rc = dur(def.recover);
      if (this.phase === 'windup' && this.phaseT >= wu) {
        this.phase = 'swing'; this.phaseT = 0;
        this.bladeFlash = SWORD.BLADE_FLASH;
        if (this.onDamage) this.onDamage(this.comboStep - 1);
        if (this.onLandedStrike) this.onLandedStrike();
      } else if (this.phase === 'swing' && this.phaseT >= sw) {
        this.phase = 'recover'; this.phaseT = 0;
        this.windowT = COMBO_WINDOW; // window counts from recover start
      } else if (this.phase === 'recover') {
        this.windowT -= dt;
        if (this.buffered && this.comboStep < 3) {
          this.buffered = false;
          this._beginStep(this.comboStep + 1);
          return;
        }
        if (this.phaseT >= rc) {
          if (this.comboStep >= 3 || this.windowT <= 0 && this.phaseT >= rc) {
            if (this.comboStep >= 3) { this.phase = 'cooldown'; this.cooldownT = COMBO_COOLDOWN; }
            else if (this.windowT <= 0) { this.phase = 'cooldown'; this.cooldownT = COMBO_COOLDOWN; }
          }
        }
      }
      this._poseAttack();
      return;
    }
    this._poseIdle(dt);
  }

  _poseIdle() {
    if (!this.formGroup) return;
    const t = performance.now() * 0.001;
    this.formGroup.position.set(0.38, -0.42 + Math.sin(t * 1.7) * 0.008, -0.75);
    this.formGroup.rotation.set(-0.35, -0.25, 0.18 + Math.sin(t * 1.3) * 0.02);
  }

  _poseAttack() {
    if (!this.formGroup) return;
    const def = this.currentStepDef;
    const k = Math.min(1, this.phaseT / Math.max(0.001, def.swing / 3 + 0.01));
    if (this.comboStep === 1) {
      this.formGroup.rotation.z = 0.18 - k * 1.9;
      this.formGroup.rotation.x = -0.35 + k * 0.5;
    } else if (this.comboStep === 2) {
      this.formGroup.rotation.z = -1.7 + k * 1.9;
      this.formGroup.rotation.x = -0.35 - k * 0.4;
    } else {
      // thrust
      this.formGroup.position.z = -0.75 - k * 0.55;
      this.formGroup.rotation.x = -0.35 + k * 0.55;
      this.formGroup.rotation.z = 0.18;
    }
    if (this.phase === 'recover') {
      // ease back
      this.formGroup.position.lerp(new THREE.Vector3(0.38, -0.42, -0.75), 0.1);
    }
  }
}

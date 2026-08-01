import * as THREE from 'three';
import { BRUTE, ELITE } from '../../core/Constants.js';
import { Skeleton } from '../Skeleton.js';
import { makeCloth, makeHide } from '../../core/Materials.js';
import { Proportion } from '../Proportion.js';

// Brute — heavy, telegraphed, high risk. Enlarged ENVIRONMENTALLY (proportion
// ladder, not blind group.scale) so it dwarfs the player without ever
// clipping the 4u wall height. Torn tunic, massive club. Slam damage 3
// (one-shots a full-health player). The 1.2 s club-raise windup with orange
// flash is the core counterplay. Elite (1-in-10): Ogre (yet bigger).
export class Brute extends Skeleton {
  constructor(scene, opts = {}) {
    const elite = !!opts.elite;
    super(scene, {
      isMagician: false,
      active: true,
      attackMult: opts.attackMult || 1,
      boneColor: elite ? ELITE.BRUTE.BONE : BRUTE.BONE,
      eyeColor: BRUTE.EYE,
    });
    this.type = 'BRUTE';
    this.elite = elite;
    this.hp = elite ? ELITE.BRUTE.HP : BRUTE.HP;
    this.maxHp = this.hp;
    this.attackMult = opts.attackMult || 1;
    this.speed = BRUTE.SPEED * (elite ? ELITE.BRUTE.SPEED_MULT : 1);
    this.damage = BRUTE.DMG;
    this.attackRange = BRUTE.RANGE;
    this.dropOrbs = elite ? ELITE.BRUTE.DROP : BRUTE.DROP;
    this._windup = BRUTE.WINDUP / this.attackMult;
    this._swing = BRUTE.SWING / this.attackMult;
    this._recover = BRUTE.RECOVER / this.attackMult;
    this._cooldown = BRUTE.COOLDOWN / this.attackMult;

    // Proportion ladder: expand the torso/limb WIDTH (never vertical scale),
    // so the brute is WIDE and THICK — and critically stays under the 4u wall
    // height instead of a stretched tower that clips the ceiling.
    const prop = Proportion.VARIANTS[elite ? 'OGRE' : 'BRUTE'];
    this.bones.ribcage.scale.set(prop.torsoW, 1.0, prop.torsoW);
    // A modest spine-height bump makes the brute read TALLER than a normal
    // skeleton (width + controlled height, NOT a blind tower): stays under the
    // 4u wall. Base humanoid is ~3.60u; Brute ~3.75, Ogre ~3.90.
    const heightScale = elite ? Proportion.VARIANTS.OGRE.heightScale : Proportion.VARIANTS.BRUTE.heightScale;
    this.bones.spine.scale.y = heightScale;
    // Bulk up the limb girth via shared limb width (cylinder radius stays from
    // the base rig; we widen the pelvis + clavicle span visually).
    this.bones.pelvis.scale.set(prop.limbMult, 1, prop.limbMult);
    this._proportion = prop;

    this._addTunicAndClub();
  }

  _addTunicAndClub() {
    const tunicMat = makeCloth(BRUTE.TUNIC, { seed: 53, rough: 0.9, metal: 0 });
    this._armorMats = [tunicMat];

    // Layered tunic: an under-tunic + a torn over-layer (reads as worn cloth).
    const tunic = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.5, 8, 1, true), tunicMat);
    tunic.position.set(0, 0.12, 0);
    tunic.castShadow = true;
    this.bones.pelvis.add(tunic);
    this.parts.push(tunic);
    // Torn over-layer: a shorter, flared segment offset slightly.
    const torn = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.26, 8, 1, true), tunicMat);
    torn.position.set(0, 0.34, -0.02);
    torn.rotation.x = 0.08;
    this.bones.pelvis.add(torn);
    this.parts.push(torn);

    // Massive club replaces the sword.
    this._replaceRightHandWeapon();
  }

  _replaceRightHandWeapon() {
    const arm = this.bones.forearmR;
    const toRemove = [];
    for (const child of arm.children) {
      if (child.isMesh) toRemove.push(child);
    }
    for (const m of toRemove) {
      arm.remove(m);
      const idx = this.parts.indexOf(m);
      if (idx !== -1) this.parts.splice(idx, 1);
    }
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 8), this.darkMat);
    handle.position.set(0, -0.3, 0.1);
    arm.add(handle);
    this.parts.push(handle);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), this.darkMat);
    head.position.set(0, -0.72, 0.1);
    head.scale.set(1, 1.4, 1);
    head.castShadow = true;
    arm.add(head);
    this.parts.push(head);
    // Telegraph flash material on the club head (emissive pulse in _animAttack)
    this.clubHead = head;
    this.clubHeadMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a, emissive: BRUTE.FLASH, emissiveIntensity: 0,
      roughness: 0.6, metalness: 0.2, transparent: true,
    });
    head.material = this.clubHeadMat;
    this._armorMats.push(this.clubHeadMat);
  }

  _animAttack(dt) {
    const b = this.bones;
    const t = this.animTime;
    const windup = this._windup;
    const swingEnd = windup + this._swing;
    const total = windup + this._swing + this._recover;

    if (t < windup) {
      const p = t / windup;
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, -2.6, 8, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, -0.3, 8, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0.3, 8, dt);
      this.clubHeadMat.emissiveIntensity = p * 2.2;
      b.armR.rotation.z = Math.sin(t * 40) * 0.03 * p;
    } else if (t < swingEnd) {
      const p = (t - windup) / this._swing;
      const eased = 1 - Math.pow(1 - p, 2);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 1.1, 24, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.1, 24, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, -0.25, 12, dt);
      b.root.position.z = eased * 0.3;
      this.clubHeadMat.emissiveIntensity = THREE.MathUtils.damp(this.clubHeadMat.emissiveIntensity, 0, 30, dt);
      if (!this.attackHitDone && p >= 0.4) {
        this.attackHitDone = true;
        this.onAttackHit?.();
      }
    } else {
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0, 4, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.15, 4, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0, 4, dt);
      b.root.position.z = THREE.MathUtils.damp(b.root.position.z, 0, 4, dt);
    }

    if (t >= total) {
      this.state = 'CHASE';
      this.animTime = 0;
      this.attackCooldown = this._cooldown;
    }
  }

  dispose() {
    for (const m of (this._armorMats || [])) m.dispose();
    super.dispose();
  }
}

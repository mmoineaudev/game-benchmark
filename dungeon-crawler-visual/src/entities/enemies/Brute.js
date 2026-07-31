import * as THREE from 'three';
import { BRUTE, ELITE } from '../../core/Constants.js';
import { Skeleton } from '../Skeleton.js';

// Brute — heavy, telegraphed, high risk. Enlarged skeleton with a torn tunic
// and a massive club. Slam damage 3 (one-shots a full-health player). The
// 1.2 s club-raise windup with orange flash is the core counterplay.
// Elite (1-in-10): Ogre.
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

    this.group.scale.setScalar(elite ? ELITE.BRUTE.SCALE : 1.6);
    this._addTunicAndClub();
  }

  _addTunicAndClub() {
    const tunicMat = new THREE.MeshStandardMaterial({
      color: BRUTE.TUNIC, roughness: 0.9, transparent: true,
    });
    this._armorMats = [tunicMat];

    // Torn tunic around the pelvis/spine
    const tunic = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.5, 8, 1, true), tunicMat);
    tunic.position.set(0, 0.1, 0);
    tunic.castShadow = true;
    this.bones.pelvis.add(tunic);
    this.parts.push(tunic);

    // Massive club replaces the sword
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
      // Telegraph: club raised overhead, orange flash ramps up
      const p = t / windup;
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, -2.6, 8, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, -0.3, 8, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0.3, 8, dt);
      this.clubHeadMat.emissiveIntensity = p * 2.2;
      // Tension shake
      b.armR.rotation.z = Math.sin(t * 40) * 0.03 * p;
    } else if (t < swingEnd) {
      // Slam
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

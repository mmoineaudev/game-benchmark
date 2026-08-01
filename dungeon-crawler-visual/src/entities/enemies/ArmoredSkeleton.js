import * as THREE from 'three';
import { ARMORED, ELITE } from '../../core/Constants.js';
import { Skeleton } from '../Skeleton.js';
import { makeMetal, makeCloth } from '../../core/Materials.js';
import { Proportion } from '../Proportion.js';

// Armored Skeleton — tank. Reuses the Skeleton rig with a form-fitted
// chestplate, proper kite shield, open great-helm, and a bearded heavy axe
// in the right hand. Slower, tankier, hits harder. Elite (1-in-10): Warlord
// (gold trim on the plate).
export class ArmoredSkeleton extends Skeleton {
  constructor(scene, opts = {}) {
    const elite = !!opts.elite;
    super(scene, {
      isMagician: false,
      active: true,
      attackMult: opts.attackMult || 1,
      boneColor: elite ? ELITE.ARMORED.BONE : ARMORED.BONE,
    });
    this.type = 'ARMORED';
    this.elite = elite;
    this.hp = elite ? ELITE.ARMORED.HP : ARMORED.HP;
    this.maxHp = this.hp;
    this.attackMult = opts.attackMult || 1;
    this.speed = ARMORED.SPEED * (elite ? ELITE.ARMORED.SPEED_MULT : 1);
    this.damage = ARMORED.DMG;
    this.attackRange = ARMORED.RANGE;
    this.dropOrbs = elite ? ELITE.ARMORED.DROP : ARMORED.DROP;

    this._windup = ARMORED.WINDUP / this.attackMult;
    this._swing = ARMORED.SWING / this.attackMult;
    this._recover = ARMORED.RECOVER / this.attackMult;
    this._cooldown = ARMORED.COOLDOWN / this.attackMult;

    // Slightly broader torso via the shared proportion ladder (not blind scale).
    this.bones.ribcage.scale.setScalar(Proportion.VARIANTS.ARMORED.torsoW);

    this._addArmor();
  }

  _addArmor() {
    const plateMat = makeMetal(this.elite ? 0x6a6a78 : ARMORED.PLATE, { seed: 21, rough: 0.45, metal: 0.85 });
    const trimMat = this.elite ? makeMetal(ELITE.ARMORED.TRIM, { seed: 22, rough: 0.3, metal: 0.95 }) : null;
    this._armorMats = [plateMat, ...(trimMat ? [trimMat] : [])];

    // Form-fitted chestplate: a rounded "peascod" front over the ribcage.
    const chest = this._mesh(new THREE.CylinderGeometry(0.20, 0.17, 0.34, 10), plateMat, 0, 0.10, 0, this.bones.ribcage);
    chest.rotation.x = -0.1;
    // Center ridge running down the plate
    const ridge = this._mesh(new THREE.BoxGeometry(0.015, 0.32, 0.10), plateMat, 0, 0.10, 0.17, this.bones.ribcage);
    // Pauldrons on both shoulders
    for (const side of [-1, 1]) {
      const pauldron = this._mesh(new THREE.SphereGeometry(0.09, 8, 6), plateMat, side * 0.28, -0.0, 0, this.bones.ribcage);
      pauldron.scale.set(1, 0.6, 1.1);
    }
    // Gold trim on elite (a thin band across the chest)
    if (trimMat) {
      this._mesh(new THREE.BoxGeometry(0.34, 0.03, 0.02), trimMat, 0, 0.30, 0.16, this.bones.ribcage);
    }

    // Proper kite shield on the left arm: rounded top + tapered cone tip.
    const shield = new THREE.Group();
    const shieldBody = new THREE.Mesh(new THREE.SphereGeometry(0.20, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), plateMat);
    shieldBody.scale.set(0.9, 1, 0.28);
    shieldBody.position.y = 0.06;
    shield.add(shieldBody);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.22, 8), plateMat);
    tip.position.y = -0.20;
    tip.rotation.x = Math.PI; // tip points down
    shield.add(tip);
    const boss = this._mesh(new THREE.SphereGeometry(0.05, 8, 6), trimMat || plateMat, 0, 0.0, 0.06, shield);
    shield.position.set(0, -0.12, 0);
    shield.castShadow = true;
    this.bones.armL.add(shield);
    this.parts.push(shieldBody, tip);

    // Open-faced great-helm: tapered cylinder + brow plate + cheek guards.
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.18, 0.20, 10), plateMat);
    helm.position.set(0, 0.31, -0.01);
    helm.castShadow = true;
    this.bones.head.add(helm);
    this.parts.push(helm);
    const brow = this._mesh(new THREE.BoxGeometry(0.16, 0.02, 0.06), plateMat, 0, 0.40, 0.04, this.bones.head);
    brow.rotation.x = 0.15;
    for (const sx of [-1, 1]) {
      this._mesh(new THREE.BoxGeometry(0.035, 0.12, 0.06), plateMat, sx * 0.135, 0.30, 0.03, this.bones.head);
    }

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
    // Bearded axe: handle + curved blade (two stacked boxes suggest the beard).
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), this.darkMat);
    handle.position.set(0, -0.15, 0.1);
    arm.add(handle);
    this.parts.push(handle);
    const head = this._mesh(new THREE.BoxGeometry(0.05, 0.28, 0.12), this.bladeMat, 0, -0.15, 0.22, arm);
    head.rotation.z = -0.12;
    // bearded lower hook
    const beard = this._mesh(new THREE.BoxGeometry(0.045, 0.12, 0.10), this.bladeMat, 0, -0.30, 0.24, arm);
    beard.rotation.z = 0.35;
  }

  _animAttack(dt) {
    const b = this.bones;
    const t = this.animTime;
    const windup = this._windup;
    const swingEnd = windup + this._swing;
    const total = windup + this._swing + this._recover;

    if (t < windup) {
      const p = t / windup;
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, -2.5, 8, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, -0.5, 8, dt);
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, 0.3, 8, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0.35, 8, dt);
    } else if (t < swingEnd) {
      const p = (t - windup) / this._swing;
      const eased = 1 - Math.pow(1 - p, 2);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0.9, 20, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.1, 20, dt);
      b.root.position.z = eased * 0.2;
      if (!this.attackHitDone && p >= 0.35) {
        this.attackHitDone = true;
        this.onAttackHit?.();
      }
    } else {
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0, 5, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.15, 5, dt);
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, 0, 5, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0, 5, dt);
      b.root.position.z = THREE.MathUtils.damp(b.root.position.z, 0, 5, dt);
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

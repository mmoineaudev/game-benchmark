import * as THREE from 'three';
import { ARMORED, ELITE } from '../../core/Constants.js';
import { Skeleton } from '../Skeleton.js';

// Armored Skeleton — tank. Reuses the Skeleton rig with a chestplate, kite
// shield on the left arm, open helm, and a heavy axe in the right hand.
// Slower, tankier, hits harder. Elite (1-in-10): Warlord.
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

    // Override attack cycle timing for this variant
    this._windup = ARMORED.WINDUP / this.attackMult;
    this._swing = ARMORED.SWING / this.attackMult;
    this._recover = ARMORED.RECOVER / this.attackMult;
    this._cooldown = ARMORED.COOLDOWN / this.attackMult;

    this._addArmor();
  }

  _addArmor() {
    const plateMat = new THREE.MeshStandardMaterial({
      color: this.elite ? ELITE.ARMORED.TRIM : ARMORED.PLATE,
      roughness: 0.5, metalness: 0.8, transparent: true,
    });
    this._armorMats = [plateMat];

    // Chestplate over the ribcage
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.22), plateMat);
    chest.position.set(0, 0.1, 0);
    chest.castShadow = true;
    this.bones.ribcage.add(chest);
    this.parts.push(chest);

    // Kite shield on the left arm
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, 0.06), plateMat);
    shield.position.set(0, -0.15, 0);
    shield.castShadow = true;
    this.bones.armL.add(shield);
    this.parts.push(shield);

    // Open-faced helm
    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.2, 10), plateMat);
    helm.position.set(0, 0.32, 0);
    helm.castShadow = true;
    this.bones.head.add(helm);
    this.parts.push(helm);

    // Heavy axe replaces the sword (remove sword meshes from right forearm)
    this._replaceRightHandWeapon();
  }

  _replaceRightHandWeapon() {
    // Remove the existing sword meshes attached to the right forearm
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
    // Axe: handle + blade
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 8), this.darkMat);
    handle.position.set(0, -0.15, 0.1);
    arm.add(handle);
    this.parts.push(handle);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.12), this.bladeMat);
    blade.position.set(0, -0.15, 0.22);
    blade.castShadow = true;
    arm.add(blade);
    this.parts.push(blade);
  }

  _animAttack(dt) {
    const b = this.bones;
    const t = this.animTime;
    const windup = this._windup;
    const swingEnd = windup + this._swing;
    const total = windup + this._swing + this._recover;

    if (t < windup) {
      // Telegraph: axe raised high, shield forward
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

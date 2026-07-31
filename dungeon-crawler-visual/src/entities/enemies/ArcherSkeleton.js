import * as THREE from 'three';
import { ARCHER, ELITE } from '../../core/Constants.js';
import { Skeleton } from '../Skeleton.js';

// Archer Skeleton — ranged harasser. Keeps distance, fires bone arrows.
// Reuses the Skeleton rig with a hunter hood and a shortbow in the left hand
// (the right-hand sword is removed). Elite (1-in-10): Sharpshooter (2-arrow fan).
export class ArcherSkeleton extends Skeleton {
  constructor(scene, opts = {}) {
    const elite = !!opts.elite;
    super(scene, {
      isMagician: false,
      active: true,
      attackMult: opts.attackMult || 1,
      boneColor: elite ? ELITE.ARCHER.BONE : ARCHER.BONE,
    });
    this.type = 'ARCHER';
    this.elite = elite;
    this.hp = ARCHER.HP;
    this.maxHp = this.hp;
    this.attackMult = opts.attackMult || 1;
    this.speed = ARCHER.SPEED;
    this.damage = ARCHER.DMG;
    this.attackRange = ARCHER.RANGE;
    this.dropOrbs = elite ? ELITE.ARCHER.DROP : ARCHER.DROP;
    this.prefDist = ARCHER.PREF_DIST;
    this.retreatDist = ARCHER.RETREAT_DIST;
    this.retreatSpeed = ARCHER.RETREAT_SPEED;
    this._windup = ARCHER.WINDUP / this.attackMult;
    this._swing = ARCHER.SWING / this.attackMult;
    this._recover = ARCHER.RECOVER / this.attackMult;
    this._cooldown = ARCHER.COOLDOWN / this.attackMult;
    this._arrows = []; // active arrows handled by EnemySystem; stored per-archer
    this._addHoodAndBow();
    this._removeSword();
  }

  _addHoodAndBow() {
    const hoodMat = new THREE.MeshStandardMaterial({
      color: this.elite ? ELITE.ARCHER.HOOD : ARCHER.HOOD,
      roughness: 0.9, transparent: true,
    });
    this._armorMats = [hoodMat];
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 10), hoodMat);
    hood.position.set(0, 0.24, -0.04);
    hood.rotation.x = 0.2;
    hood.castShadow = true;
    this.bones.head.add(hood);
    this.parts.push(hood);

    // Shortbow on the left arm
    const bowMat = new THREE.MeshStandardMaterial({
      color: 0x4a3a2a, roughness: 0.7, metalness: 0.2, transparent: true,
    });
    this._armorMats.push(bowMat);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 6, 8, Math.PI), bowMat);
    bow.position.set(0, -0.15, 0);
    bow.rotation.x = Math.PI / 2;
    this.bones.armL.add(bow);
    this.parts.push(bow);
    const string = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.34, 0.01), bowMat);
    string.position.set(0, -0.15, 0.01);
    this.bones.armL.add(string);
    this.parts.push(string);
  }

  _removeSword() {
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
  }

  _animAttack(dt) {
    const b = this.bones;
    const t = this.animTime;
    const windup = this._windup;
    const swingEnd = windup + this._swing;
    const total = windup + this._swing + this._recover;

    if (t < windup) {
      // Draw: left arm raises the bow, right arm pulls the string
      const p = t / windup;
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, -1.2, 8, dt);
      b.forearmL.rotation.x = THREE.MathUtils.damp(b.forearmL.rotation.x, 0.4, 8, dt);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, -0.8, 8, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.5, 8, dt);
    } else if (t < swingEnd) {
      // Release
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, -0.6, 20, dt);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0.2, 20, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.1, 20, dt);
      if (!this.attackHitDone && (t - windup) / this._swing >= 0.5) {
        this.attackHitDone = true;
        this.onAttackHit?.();
      }
    } else {
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, 0, 5, dt);
      b.forearmL.rotation.x = THREE.MathUtils.damp(b.forearmL.rotation.x, 0.15, 5, dt);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0, 5, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.15, 5, dt);
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

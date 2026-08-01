import * as THREE from 'three';
import { ARCHER, ELITE } from '../../core/Constants.js';
import { Skeleton } from '../Skeleton.js';
import { makeCloth, makeWood, makeBone } from '../../core/Materials.js';
import { Proportion } from '../Proportion.js';

// Archer Skeleton — ranged harasser. Keeps distance, fires bone arrows.
// Reuses the Skeleton rig with a hunter hood, a shortbow in the left hand
// (the right-hand sword is removed), and a quiver on the back. The bow
// STRING visibly draws back during the windup (realism win). Elite
// (1-in-10): Sharpshooter (2-arrow fan).
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
    this._arrows = [];
    // Slightly slighter build via the proportion ladder.
    this.bones.ribcage.scale.setScalar(Proportion.VARIANTS.ARCHER.torsoW);
    this._addHoodAndBow();
    this._removeSword();
  }

  _addHoodAndBow() {
    const hoodMat = makeCloth(this.elite ? ELITE.ARCHER.HOOD : ARCHER.HOOD, { seed: 37, rough: 0.9, metal: 0 });
    this._armorMats = [hoodMat];
    // Hunter hood with a slightly flared brim (two stacked cones suggest folds).
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.3, 10), hoodMat);
    hood.position.set(0, 0.24, -0.04);
    hood.rotation.x = 0.2;
    hood.castShadow = true;
    this.bones.head.add(hood);
    this.parts.push(hood);
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.1, 10, 1, true), hoodMat);
    brim.position.set(0, 0.13, -0.05);
    brim.rotation.x = 0.35;
    this.bones.head.add(brim);
    this.parts.push(brim);

    // Shortbow on the left arm (recurve: two curved limbs + grip).
    const bowMat = makeWood(0x4a3a2a, { seed: 41, rough: 0.7, metal: 0.2 });
    this._armorMats.push(bowMat);
    const bow = new THREE.Group();
    const limb = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 6, 12, Math.PI * 0.7), bowMat);
    this.bones.armL.add(bow);
    bow.add(limb);
    this.parts.push(limb);
    // Grip block in the center of the arc
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 6), bowMat);
    grip.position.y = -0.02;
    bow.add(grip);
    this.parts.push(grip);
    // String — rebuilt each windup into a drawn pose (see below).
    this._stringMat = bowMat;
    this._bowGroup = bow;

    // Quiver on the back (CylinderGeometry) + 3 visible arrow shafts.
    const quiverMat = makeCloth(0x3a3a2a, { seed: 43, rough: 0.9, metal: 0 });
    this._armorMats.push(quiverMat);
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.3, 8), quiverMat);
    quiver.position.set(-0.18, 0.42, 0.1);
    quiver.rotation.x = 0.5;
    quiver.rotation.z = -0.2;
    this.bones.ribcage.add(quiver);
    this.parts.push(quiver);
    for (let i = 0; i < 3; i++) {
      const shaftMat = makeBone(0xd8d0c0, { seed: 47 + i, rough: 0.6, metal: 0.1 });
      this._armorMats.push(shaftMat);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.24, 4), shaftMat);
      shaft.position.set(-0.18 + (i - 1) * 0.02, 0.5 + i * 0.02, 0.08 - i * 0.02);
      shaft.rotation.x = 0.45;
      shaft.rotation.z = -0.2;
      this.bones.ribcage.add(shaft);
      this.parts.push(shaft);
    }

    this._draw = 0; // 0..1 string draw progress
  }

  // Deform the bow string + nock an arrow based on current draw progress.
  _updateBowDraw() {
    const t = this._draw || 0;
    // Pull the string back along the bow's local -z (away from the archer's
    // face). Simulated by translating the string mesh and the nocked arrow.
    const b = this.bones;
    const armL = b.armL;
    if (!armL) return;
    // Find / create the string mesh on the arm.
    let string = this._stringMesh;
    if (!string) {
      string = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.32, 0.008),
        this._stringMat,
      );
      string.position.set(0, -0.02, 0.02);
      armL.add(string);
      this._stringMesh = string;
      this.parts.push(string);
    }
    string.position.z = 0.02 - t * 0.16; // pulls back as you draw
    string.scale.y = 1 - t * 0.25;       // tauter, slightly shorter
    // Nocked arrow (visible during windup as the glow telegraph)
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
      const p = t / windup;
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, -1.2, 8, dt);
      b.forearmL.rotation.x = THREE.MathUtils.damp(b.forearmL.rotation.x, 0.4, 8, dt);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, -0.8, 8, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.5, 8, dt);
      this._draw = p; // string pulls back during the draw
      this._updateBowDraw();
    } else if (t < swingEnd) {
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, -0.6, 20, dt);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0.2, 20, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.1, 20, dt);
      this._draw = 0; // release — string snaps back
      this._updateBowDraw();
      if (!this.attackHitDone && (t - windup) / this._swing >= 0.5) {
        this.attackHitDone = true;
        this.onAttackHit?.();
      }
    } else {
      b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, 0, 5, dt);
      b.forearmL.rotation.x = THREE.MathUtils.damp(b.forearmL.rotation.x, 0.15, 5, dt);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0, 5, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.15, 5, dt);
      this._draw = 0;
      this._updateBowDraw();
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

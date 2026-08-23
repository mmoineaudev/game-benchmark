// Skeleton.js — base enemy: procedural rig, pose state machine, hit/death (§15)
import * as THREE from 'three';
import { ENEMY_SPAWN } from '../core/Constants.js';

const BONE = 0xcfc7ae;

export default class Skeleton {
  // typeKey: SKELETON | MAGICIAN | ARMORED | ARCHER | RAT | BRUTE | WRAITH | BURN
  constructor(typeDef, typeKey, opts = {}) {
    this.type = typeKey;
    this.def = typeDef;
    this.isBoss = !!opts.isBoss;
    this.hp = opts.hp ?? typeDef.hp;
    this.maxHp = this.hp;
    this.speed = (opts.speedMult ?? 1) * (opts.speedOverride ?? typeDef.speed);
    this.dmg = typeDef.dmg;
    this.drops = opts.drops ?? typeDef.drops;
    this.elite = opts.elite || null;
    this.state = 'DORMANT'; // DORMANT/WAKING/CHASE/ATTACK/DEAD (+boss states)
    this.pos = new THREE.Vector3();
    this.attackT = 0;       // progress through windup/swing/recover
    this.attackPhase = null;
    this.cooldown = opts.initialCooldown ?? 0;
    this.deadTimer = -1;
    this.frozen = false;    // title screen / far-frozen
    this.burning = 0;
    this.hitFlash = 0;
    this.pathTimer = 0;
    this.pathStep = null;
    this.wakeTimer = opts.waking ? 0.8 : 0;
    if (opts.waking) { this.state = 'WAKING'; }

    this.group = this._buildRig(opts);
    this._materials = [];
    this.group.traverse(o => { if (o.material) this._materials.push(o.material); });
  }

  _mat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.05,
      transparent: true, opacity: 1, ...opts
    });
  }

  _buildRig(opts) {
    const g = new THREE.Group();
    const boneMat = this._mat(this.type === 'WRAITH' || this.type === 'BURN' ? 0x8899bb : BONE);
    const darkMat = this._mat(0x3a3a42);

    const scale = opts.scale ?? 1;
    const mk = (geo, mat) => new THREE.Mesh(geo, mat);

    if (this.type === 'RAT') {
      // small quadruped blob
      const body = mk(new THREE.CapsuleGeometry(0.16, 0.35, 4, 8), boneMat);
      body.rotation.z = Math.PI / 2; body.position.y = 0.22;
      const head = mk(new THREE.SphereGeometry(0.14, 8, 6), boneMat);
      head.position.set(0, 0.26, 0.32);
      const tail = mk(new THREE.CylinderGeometry(0.02, 0.01, 0.4), boneMat);
      tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.22, -0.45);
      g.add(body, head, tail);
      g.userData.animParts = { head };
      g.position.y = 0;
      this.radius = 0.35;
      return g;
    }

    if (this.type === 'WRAITH') {
      // floating shroud cone
      const body = mk(new THREE.ConeGeometry(0.45, 1.6, 8), this._mat(0x6677aa, { transparent: true, opacity: 0.75 }));
      body.position.y = 1.0;
      const head = mk(new THREE.SphereGeometry(0.22, 8, 6), boneMat);
      head.position.y = 1.9;
      const eyeL = mk(new THREE.SphereGeometry(0.05), new THREE.MeshBasicMaterial({ color: 0xaaffcc }));
      eyeL.position.set(-0.09, 1.95, 0.18);
      const eyeR = eyeL.clone(); eyeR.position.x = 0.09;
      g.add(body, head, eyeL, eyeR);
      g.userData.animParts = { body, head };
      this.radius = 0.35;
      this.floats = true;
      return g;
    }

    if (this.type === 'BURN') {
      const body = mk(new THREE.CapsuleGeometry(0.3, 0.9, 4, 8), this._mat(0x442211));
      body.position.y = 1.0;
      const core = mk(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff6a1e }));
      core.position.y = 1.1; core.scale.y = 1.5;
      const head = mk(new THREE.SphereGeometry(0.24, 8, 6), this._mat(0x332015));
      head.position.y = 1.85;
      g.add(body, core, head);
      g.userData.animParts = { core, head };
      this.radius = 0.35;
      return g;
    }

    // humanoid rig: root, ribcage, head, armL/R, forearmL/R, legL/R, shinL/R
    const root = new THREE.Group(); g.add(root);
    const pelvis = mk(new THREE.BoxGeometry(0.34, 0.16, 0.2), darkMat);
    pelvis.position.y = 0.9; root.add(pelvis);
    const ribcage = mk(new THREE.CapsuleGeometry(0.17, 0.34, 4, 8), boneMat);
    ribcage.position.y = 1.28; ribcage.name = 'ribcage'; root.add(ribcage);
    const head = mk(new THREE.SphereGeometry(0.17, 8, 6), boneMat);
    head.position.y = 1.72; head.name = 'head'; root.add(head);
    const eyes = new THREE.MeshBasicMaterial({ color: this.type === 'MAGICIAN' ? 0xff4444 : 0xaaffcc });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04), eyes);
      eye.position.set(s * 0.07, 1.75, 0.14);
      root.add(eye);
    }
    const limbs = {};
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const arm = mk(new THREE.CylinderGeometry(0.05, 0.05, 0.38), boneMat);
      arm.geometry.translate(0, -0.19, 0);
      arm.position.set(sx * 0.26, 1.5, 0);
      const forearm = mk(new THREE.CylinderGeometry(0.045, 0.04, 0.36), boneMat);
      forearm.geometry.translate(0, -0.18, 0);
      forearm.position.set(0, -0.38, 0);
      arm.add(forearm);
      const leg = mk(new THREE.CylinderGeometry(0.06, 0.055, 0.42), boneMat);
      leg.geometry.translate(0, -0.21, 0);
      leg.position.set(sx * 0.12, 0.86, 0);
      const shin = mk(new THREE.CylinderGeometry(0.05, 0.045, 0.4), boneMat);
      shin.geometry.translate(0, -0.2, 0);
      shin.position.set(0, -0.44, 0);
      leg.add(shin);
      root.add(arm, leg);
      limbs['arm' + side] = arm; limbs['forearm' + side] = forearm;
      limbs['leg' + side] = leg; limbs['shin' + side] = shin;
    }

    // type flavor
    if (this.type === 'ARMORED') {
      const plate = mk(new THREE.BoxGeometry(0.46, 0.5, 0.3), this._mat(0x707a86, { metalness: 0.8, roughness: 0.35 }));
      plate.position.y = 1.28; root.add(plate);
      const helm = mk(new THREE.SphereGeometry(0.19, 8, 6), this._mat(0x707a86, { metalness: 0.8, roughness: 0.35 }));
      helm.position.y = 1.76; root.add(helm);
    } else if (this.type === 'ARCHER') {
      const bow = mk(new THREE.TorusGeometry(0.35, 0.03, 6, 12, Math.PI), this._mat(0x5a3f24));
      bow.position.set(0.28, 1.2, 0.1); bow.rotation.y = Math.PI / 2;
      root.add(bow);
    } else if (this.type === 'BRUTE') {
      root.scale.setScalar(1.5);
    } else if (this.type === 'MAGICIAN') {
      const robe = mk(new THREE.ConeGeometry(0.4, 1.2, 8), this._mat(0x552233));
      robe.position.y = 0.85; robe.name = 'robe'; root.add(robe);
      const hat = mk(new THREE.ConeGeometry(0.24, 0.5, 8), this._mat(0x442233));
      hat.position.y = 1.95; root.add(hat);
    }

    if (scale !== 1) root.scale.multiplyScalar(scale);

    g.userData.animParts = { root, ribcage, head, ...limbs };
    g.position.y = 0;
    this.radius = this.isBoss ? 0.9 : 0.35;
    return g;
  }

  // ground the group so feet rest on y 0
  ground() {
    const box = new THREE.Box3().setFromObject(this.group);
    if (isFinite(box.min.y)) this.group.position.y = -box.min.y;
  }

  faceTo(x, z) {
    this.group.rotation.y = Math.atan2(x - this.pos.x, z - this.pos.z);
  }

  startAttack() {
    if (this.def.instantAttack) { this.state = 'ATTACK'; this.attackPhase = 'swing'; this.attackT = 0; return; }
    this.state = 'ATTACK';
    this.attackPhase = 'windup';
    this.attackT = 0;
  }

  updatePose(dt, moving) {
    const p = this.group.userData.animParts;
    if (!p?.root) return;
    const t = performance.now() * 0.001;
    if (this.type === 'WRAITH') {
      p.body.position.y = 1.0 + Math.sin(t * 2 + this.pos.x) * 0.1;
      return;
    }
    if (this.type === 'RAT') { p.head.rotation.y = Math.sin(t * 3) * 0.2; return; }
    // walk cycle
    const amp = moving ? 0.55 : 0.06;
    const w = t * 7 * (moving ? 1 : 0.3);
    if (p.armL) { p.armL.rotation.x = Math.sin(w) * amp; p.armR.rotation.x = -Math.sin(w) * amp * 0.5 - 0.4; }
    if (p.legL) { p.legL.rotation.x = -Math.sin(w) * amp * 0.8; p.legR.rotation.x = Math.sin(w) * amp * 0.8; }
    // attack pose overrides arms
    if (this.state === 'ATTACK' && !this.def.ranged) {
      const k = Math.sin(Math.min(1, this.attackT * 3) * Math.PI);
      if (p.armR) p.armR.rotation.x = -1.8 + k * 2.2;
    }
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const on = this.hitFlash > 0;
      for (const m of this._materials) if (m.emissive) m.emissive.setHex(on ? 0x883322 : 0x000000);
    }
  }

  beginDeath() {
    this.state = 'DEAD';
    this.deadTimer = 0;
    // hold then fade
  }

  updateDeath(dt) {
    this.deadTimer += dt;
    if (this.deadTimer > 0.5) {
      const fade = Math.max(0, 1 - (this.deadTimer - 0.5) / 0.8);
      for (const m of this._materials) { m.opacity = fade; }
      return fade <= 0; // done → dispose
    }
    return false;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

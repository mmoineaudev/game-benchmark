// Skeleton.js — base enemy: procedural rig, pose state machine, hit/death (§15)
import * as THREE from 'three';
import { ENEMY_SPAWN } from '../core/Constants.js';

const BONE = 0xcfc7ae;

// ---- shared per-type materials + geometries ------------------------------------
// Every skeleton of a type shares ONE material set and ONE geometry set so a
// mass kill frees ZERO GPU buffers (per-kill dispose churn was stalling the
// GPU process hard on a big pack). Hit-flash → scale pop; death-fade → the
// shared death-burst particles (the per-material fade is gone).
const _shared = {};
function sharedMats(typeKey) {
  if (_shared[typeKey]) return _shared[typeKey];
  const isWraith = typeKey === 'WRAITH' || typeKey === 'BURN';
  const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({
    color, roughness: 0.85, metalness: 0.05, transparent: true, opacity: 1, ...opts
  });
  const m = {
    bone: mat(isWraith ? 0x8899bb : BONE),
    dark: mat(0x3a3a42),
    eye: new THREE.MeshBasicMaterial({ color: typeKey === 'MAGICIAN' ? 0xff4444 : 0xaaffcc }),
    flame: new THREE.MeshBasicMaterial({ color: 0xff6a1e }),
    core: new THREE.MeshBasicMaterial({ color: 0xaaffcc }),
    wraithBody: mat(0x6677aa, { transparent: true, opacity: 0.75 }),
    burnBody: mat(0x442211),
    burnHead: mat(0x332015),
    plate: mat(0x707a86, { metalness: 0.8, roughness: 0.35 }),
    bow: mat(0x5a3f24),
    robe: mat(0x552233),
    hat: mat(0x442233)
  };
  _shared[typeKey] = m;
  return m;
}
const _geoCache = {};
function sharedGeo(typeKey) {
  if (_geoCache[typeKey]) return _geoCache[typeKey];
  let g = {};
  const cap = (r, len, cs, rs) => new THREE.CapsuleGeometry(r, len, cs, rs);
  const sph = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
  const cyl = (rt, rb, h) => new THREE.CylinderGeometry(rt, rb, h);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cone = (r, h, s) => new THREE.ConeGeometry(r, h, s);
  const tor = (r, t, rs, ts, arc) => new THREE.TorusGeometry(r, t, rs, ts, arc);
  if (typeKey === 'RAT') {
    g = { body: cap(0.16, 0.35, 4, 8), head: sph(0.14), tail: cyl(0.02, 0.01, 0.4) };
  } else if (typeKey === 'WRAITH') {
    g = { body: cone(0.45, 1.6, 8), head: sph(0.22), eye: sph(0.05) };
  } else if (typeKey === 'BURN') {
    g = { body: cap(0.3, 0.9, 4, 8), core: sph(0.34, 10, 8), head: sph(0.24) };
  } else {
    g = {
      pelvis: box(0.34, 0.16, 0.2), ribcage: cap(0.17, 0.34, 4, 8), head: sph(0.17),
      eye: sph(0.04), arm: cyl(0.05, 0.05, 0.38), forearm: cyl(0.045, 0.04, 0.36),
      leg: cyl(0.06, 0.055, 0.42), shin: cyl(0.05, 0.045, 0.4)
    };
    if (typeKey === 'ARMORED') { g.plate = box(0.46, 0.5, 0.3); g.helm = sph(0.19); }
    if (typeKey === 'ARCHER') { g.bow = tor(0.35, 0.03, 6, 12, Math.PI); }
    if (typeKey === 'MAGICIAN') { g.robe = cone(0.4, 1.2, 8); g.hat = cone(0.24, 0.5, 8); }
  }
  // bake the per-mesh offsets the old code applied via geometry.translate, so the
  // shared geometries can be reused as-is (translate is destructive on shared geo)
  if (typeKey !== 'RAT' && typeKey !== 'WRAITH' && typeKey !== 'BURN') {
    g.arm.translate(0, -0.19, 0); g.forearm.translate(0, -0.18, 0);
    g.leg.translate(0, -0.21, 0); g.shin.translate(0, -0.2, 0);
  }
  _geoCache[typeKey] = g;
  return g;
}

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
  }

  _buildRig(opts) {
    const g = new THREE.Group();
    const M = sharedMats(this.type);
    const G = sharedGeo(this.type);
    const scale = opts.scale ?? 1;
    const mk = (geo, mat) => new THREE.Mesh(geo, mat);

    if (this.type === 'RAT') {
      const body = mk(G.body, M.bone);
      body.rotation.z = Math.PI / 2; body.position.y = 0.22;
      const head = mk(G.head, M.bone);
      head.position.set(0, 0.26, 0.32);
      const tail = mk(G.tail, M.bone);
      tail.rotation.x = Math.PI / 2; tail.position.y = 0.22; tail.position.z = -0.45;
      g.add(body, head, tail);
      g.userData.animParts = { head };
      g.position.y = 0;
      this.radius = 0.35;
      return g;
    }

    if (this.type === 'WRAITH') {
      const body = mk(G.body, M.wraithBody);
      body.position.y = 1.0;
      const head = mk(G.head, M.bone);
      head.position.y = 1.9;
      const eyeL = mk(G.eye, M.core);
      eyeL.position.set(-0.09, 1.95, 0.18);
      const eyeR = mk(G.eye, M.core);
      eyeR.position.x = 0.09;
      g.add(body, head, eyeL, eyeR);
      g.userData.animParts = { body, head };
      this.radius = 0.35;
      this.floats = true;
      return g;
    }

    if (this.type === 'BURN') {
      const body = mk(G.body, M.burnBody);
      body.position.y = 1.0;
      const core = mk(G.core, M.flame);
      core.position.y = 1.1; core.scale.y = 1.5;
      const head = mk(G.head, M.burnHead);
      head.position.y = 1.85;
      g.add(body, core, head);
      g.userData.animParts = { core, head };
      this.radius = 0.35;
      return g;
    }

    // humanoid rig: root, ribcage, head, armL/R, forearmL/R, legL/R, shinL/R
    const root = new THREE.Group(); g.add(root);
    const pelvis = mk(G.pelvis, M.dark);
    pelvis.position.y = 0.9; root.add(pelvis);
    const ribcage = mk(G.ribcage, M.bone);
    ribcage.position.y = 1.28; ribcage.name = 'ribcage'; root.add(ribcage);
    const head = mk(G.head, M.bone);
    head.position.y = 1.72; head.name = 'head'; root.add(head);
    for (const s of [-1, 1]) {
      const eye = mk(G.eye, M.eye);
      eye.position.set(s * 0.07, 1.75, 0.14);
      root.add(eye);
    }
    const limbs = {};
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? -1 : 1;
      const arm = mk(G.arm, M.bone);
      arm.position.set(sx * 0.26, 1.5, 0);
      const forearm = mk(G.forearm, M.bone);
      forearm.position.set(0, -0.38, 0);
      arm.add(forearm);
      const leg = mk(G.leg, M.bone);
      leg.position.set(sx * 0.12, 0.86, 0);
      const shin = mk(G.shin, M.bone);
      shin.position.set(0, -0.44, 0);
      leg.add(shin);
      root.add(arm, leg);
      limbs['arm' + side] = arm; limbs['forearm' + side] = forearm;
      limbs['leg' + side] = leg; limbs['shin' + side] = shin;
    }

    // type flavor
    if (this.type === 'ARMORED') {
      const plate = mk(G.plate, M.plate);
      plate.position.y = 1.28; root.add(plate);
      const helm = mk(G.helm, M.plate);
      helm.position.y = 1.76; root.add(helm);
    } else if (this.type === 'ARCHER') {
      const bow = mk(G.bow, M.bow);
      bow.position.set(0.28, 1.2, 0.1); bow.rotation.y = Math.PI / 2;
      root.add(bow);
    } else if (this.type === 'BRUTE') {
      root.scale.setScalar(1.5);
    } else if (this.type === 'MAGICIAN') {
      const robe = mk(G.robe, M.robe);
      robe.position.y = 0.85; robe.name = 'robe'; root.add(robe);
      const hat = mk(G.hat, M.hat);
      hat.position.y = 1.95; root.add(hat);
    }

    if (scale !== 1) root.scale.multiplyScalar(scale);
    this._baseScale = root.scale.x; // BRUTE 1.5 / elite scale preserved through hit-pop

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
    if (this.type === 'RAT') { p.head.rotation.y = Math.sin(t * 3) * 0.2; }
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
    // hit flash: short scale pop (shared materials can't tint per-instance)
    let pop = 1;
    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      pop = 1 + 0.18 * Math.max(0, this.hitFlash) / 0.08;
    }
    if (p.root) p.root.scale.setScalar(this._baseScale * pop); // BRUTE/elite base scale preserved
  }

  beginDeath() {
    this.state = 'DEAD';
    this.deadTimer = 0;
    // hold then fade
  }

  updateDeath(dt) {
    this.deadTimer += dt;
    if (this.deadTimer > 0.5) {
      // shrink the corpse over the fade window (shared materials can't fade)
      const f = Math.max(0, 1 - (this.deadTimer - 0.5) / 0.8);
      const p = this.group.userData.animParts;
      if (p?.root) p.root.scale.setScalar(this._baseScale * f);
      else this.group.scale.setScalar(f);
      return f <= 0; // done → dispose
    }
    return false;
  }

  dispose(scene) {
    // geometries/materials are shared per-type (module-level) → never dispose here;
    // a mass kill must free zero GPU buffers, only drop the scene graph node.
    scene.remove(this.group);
  }
}

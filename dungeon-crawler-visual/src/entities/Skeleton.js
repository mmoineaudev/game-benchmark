import * as THREE from 'three';
import { SKELETON } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';
import { makeBone, makeMetal, makeCloth, makeLeather, makeGlow, makeSpriteGlow } from '../core/Materials.js';
import { Rig } from './Rig.js';

// Procedural skeletal warrior: rig built from primitives, animated by a
// state machine with damped transitions. No external assets.
// States: DORMANT -> WAKING -> CHASE -> ATTACK -> DEAD
// Magician variant (1 in 10): hood + glowing staff instead of a sword.
//
// Built on the shared Rig. Geometry uses the shared Materials library
// (procedural normal/roughness maps when a real canvas exists; flat colors
// under the headless test shim — so the regression scripts stay green).
export class Skeleton {
  constructor(scene, { isMagician = false, active = false, attackMult = 1, boneColor = null, eyeColor = null } = {}) {
    this.scene = scene;
    this.isMagician = isMagician;
    this.attackMult = attackMult;
    this.hp = SKELETON.HP;
    this.maxHp = this.hp;
    this.speed = SKELETON.CHASE_SPEED;
    this.damage = SKELETON.ATTACK_DAMAGE;
    this.attackRange = SKELETON.ATTACK_RANGE;
    this.dropOrbs = 1;
    this.state = active ? 'CHASE' : 'DORMANT';
    this.animTime = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.facingYaw = Math.random() * Math.PI * 2;
    this.attackHitDone = false;
    this.attackCooldown = 0;
    this.fade = 1;
    this._dead = false;
    this._removed = false;

    // Shared rig (group, bones, parts, mats) — same joint layout as before.
    // addToScene:false — this Skeleton constructor owns the single scene.add.
    this.rig = new Rig(scene, { addToScene: false });
    this.group = this.rig.group;
    this.bones = this.rig.bones;
    this.parts = this.rig.parts;
    this.mats = this.rig.mats;

    // Per-skeleton material clones so death-fade opacity is independent.
    this.boneMat = makeBone(boneColor || SKELETON.BONE_COLOR, { seed: 7, rough: 0.85, metal: 0.05 });
    this.darkMat = makeCloth(0x2a2622, { seed: 11, rough: 0.9, metal: 0.0 });
    this.eyeMat = makeGlow(eyeColor || SKELETON.EYE_GLOW, { opacity: 0.15 });
    this.bladeMat = makeMetal(0x6a6a72, { seed: 13, rough: 0.4, metal: 0.9 });
    this.rig.trackMat(this.boneMat);
    this.rig.trackMat(this.darkMat);
    this.rig.trackMat(this.eyeMat);
    this.rig.trackMat(this.bladeMat);

    // Eye glow sprite (additive) — makes eyes readable through the dark.
    this._glowTex = generateGlowTexture();
    this.eyeGlowMat = makeSpriteGlow(eyeColor || SKELETON.EYE_GLOW, this._glowTex, { opacity: 0.9 });
    this.rig.trackMat(this.eyeGlowMat);

    this._buildRig();
    scene.add(this.group);
    if (active) {
      this._setEye(1);
    } else {
      this._setPose('dormant');
    }
  }

  // ------------------------------------------------------------------ rig

  _mesh(geo, mat, x, y, z, parent) {
    return this.rig.mesh(geo, mat, x, y, z, parent);
  }

  _bone(name, x, y, z, parent) {
    return this.rig._bone(name, x, y, z, parent);
  }

  _buildRig() {
    const root = this._bone('root', 0, 0, 0, this.group);
    const pelvis = this._bone('pelvis', 0, 0.95, 0, root);
    const spine = this._bone('spine', 0, 0.45, 0, pelvis);
    const ribcage = this._bone('ribcage', 0, 0.55, 0, spine);
    const head = this._bone('head', 0, 0.35, 0, ribcage);

    // Pelvis
    this._mesh(new THREE.BoxGeometry(0.34, 0.22, 0.2), this.boneMat, 0, 0.1, 0, pelvis);

    // Spine: 3 stacked boxes with a slight forward arch
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.12), this.boneMat);
      v.position.set(0, 0.15 + i * 0.17, -0.01 * i);
      v.castShadow = true;
      v.receiveShadow = true;
      spine.add(v);
      this.parts.push(v);
    }

    // Ribcage: 4 torus arcs, scaled for an elliptical chest
    for (let i = 0; i < 4; i++) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(0.22, 0.028, 6, 12, Math.PI),
        this.boneMat,
      );
      rib.scale.set(1, 0.62, 0.85);
      rib.rotation.z = Math.PI;
      rib.position.set(0, 0.5 + i * 0.1, 0);
      rib.castShadow = true;
      rib.receiveShadow = true;
      ribcage.add(rib);
      this.parts.push(rib);
    }
    // Sternum
    this._mesh(new THREE.BoxGeometry(0.06, 0.3, 0.02), this.boneMat, 0, 0.55, 0.16, ribcage);

    // Head: skull + jaw + eye sockets + glowing eyes.
    // Refined skull: higher subdivision, flattened cheekbones, recessed
    // sockets give a sunken, readable cranium instead of a smooth ball.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), this.boneMat);
    skull.scale.set(0.92, 1.12, 0.96);       // elongated cranium, slightly narrow
    skull.position.set(0, 0.15, -0.005);      // face pulled forward a touch
    skull.castShadow = true;
    head.add(skull);
    this.parts.push(skull);

    // Brow ridge + nasal aperture suggest a real cranium (cheap shading form).
    const brow = this._mesh(new THREE.BoxGeometry(0.13, 0.02, 0.05), this.boneMat, 0, 0.21, 0.075, head);
    brow.rotation.x = -0.1;

    const jaw = this._mesh(new THREE.BoxGeometry(0.1, 0.05, 0.12), this.boneMat, 0, 0.02, 0.06, head);
    jaw.rotation.x = 0.12;
    const chin = this._mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), this.boneMat, 0, -0.005, 0.06, head);

    for (const sx of [-1, 1]) {
      // Deeper sockets: dark inset disc slightly set back, eye forward of it.
      const socket = this._mesh(new THREE.SphereGeometry(0.045, 8, 6), this.darkMat, sx * 0.06, 0.165, 0.12, head);
      socket.scale.set(1, 0.8, 0.5);
      const eye = this._mesh(new THREE.SphereGeometry(0.02, 6, 6), this.eyeMat, sx * 0.06, 0.165, 0.138, head);
      this.parts.push(eye);
    }

    // Additive glow sprite at the skull
    this.eyeGlow = new THREE.Sprite(this.eyeGlowMat);
    this.eyeGlow.position.set(0, 0.17, 0.1);
    this.eyeGlow.scale.setScalar(0.5);
    head.add(this.eyeGlow);

    // Magician: hood over the skull
    if (this.isMagician) {
      const hood = this._mesh(new THREE.ConeGeometry(0.2, 0.34, 10), this.darkMat, 0, 0.2, -0.04, head);
      hood.rotation.x = 0.25;
      this.hood = hood;
    }

    // Arms: shoulder pivot -> upper -> forearm -> hand.
    // Articulated limbs: tapered cylinders + distinct elbow joint sphere so
    // the arm reads as real bone. Bone ANCHORS are identical to the legacy
    // box rig (upper spans [0,-0.38], forearm bone at (0,-0.40,0), hand at
    // -0.36 forearm-local) so weapon anchoring is unchanged.
    const upR = 0.045, upH = 0.38, foreR = 0.04, foreH = 0.34;
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const arm = this._bone('arm' + tag, side * 0.28, 0.42, 0, ribcage);
      this._mesh(new THREE.CylinderGeometry(upR * 0.75, upR, upH, 8), this.boneMat, 0, -upH / 2, 0, arm);
      // elbow joint
      this._mesh(new THREE.SphereGeometry(upR * 0.9, 8, 6), this.boneMat, 0, -upH, 0, arm);
      const forearm = this._bone('forearm' + tag, 0, -0.4, 0, arm);
      this._mesh(new THREE.CylinderGeometry(foreR * 0.6, foreR * 0.9, foreH, 8), this.boneMat, 0, -foreH / 2, 0, forearm);
      // hand (small, slightly forward — holds the weapon)
      this._mesh(new THREE.SphereGeometry(foreR * 0.85, 8, 6), this.boneMat, 0, -0.36, 0, forearm);
      if (side > 0) {
        if (this.isMagician) this._buildStaff(forearm);
        else this._buildSword(forearm);
      }
    }

    // Legs: hip pivot -> thigh -> shin -> foot. Tapered + knee joint.
    // Bone anchors identical to legacy (thigh spans [0,-0.40], shin bone at
    // (0,-0.45,0), sfoot at -0.03 shin-local).
    const thighR = 0.055, thighH = 0.42, shinR = 0.045, shinH = 0.40;
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const leg = this._bone('leg' + tag, side * 0.12, -0.95, 0, pelvis);
      this._mesh(new THREE.CylinderGeometry(thighR * 0.7, thighR, thighH, 8), this.boneMat, 0, -thighH / 2, 0, leg);
      // knee joint
      this._mesh(new THREE.SphereGeometry(thighR * 0.85, 8, 6), this.boneMat, 0, -thighH, 0, leg);
      const shin = this._bone('shin' + tag, 0, -0.45, 0, leg);
      this._mesh(new THREE.CylinderGeometry(shinR * 0.6, shinR * 0.9, shinH, 8), this.boneMat, 0, -shinH / 2, 0, shin);
      const foot = this._mesh(new THREE.BoxGeometry(0.09, 0.07, 0.16), this.boneMat, 0, -0.03, 0.05, shin);
      foot.rotation.x = -0.15;
    }
  }

  _buildSword(hand) {
    const grip = this._mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), this.darkMat, 0, -0.08, 0.1, hand);
    const guard = this._mesh(new THREE.BoxGeometry(0.09, 0.02, 0.03), this.darkMat, 0, -0.16, 0.1, hand);
    const blade = this._mesh(new THREE.BoxGeometry(0.03, 0.5, 0.07), this.bladeMat, 0, -0.36, 0.1, hand);
    blade.rotation.x = 0.15;
  }

  _buildStaff(hand) {
    const shaft = this._mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.3, 8), this.darkMat, 0, -0.15, 0.12, hand);
    shaft.rotation.x = 0.05;
    this.staffOrb = this._mesh(new THREE.SphereGeometry(0.07, 10, 8), this.eyeMat, 0, 0.62, 0.12, hand);
    this.staffGlow = new THREE.Sprite(this.eyeGlowMat);
    this.staffGlow.position.set(0, 0.62, 0.12);
    this.staffGlow.scale.setScalar(0.4);
    hand.add(this.staffGlow);
  }

  // ------------------------------------------------------------ pose utils

  _setPose(name) {
    const b = this.bones;
    const zero = () => {
      for (const key of ['armL', 'armR', 'forearmL', 'forearmR', 'legL', 'legR', 'shinL', 'shinR']) {
        b[key].rotation.set(0, 0, 0);
      }
      b.head.rotation.set(0, 0, 0);
      b.ribcage.rotation.set(0, 0, 0);
      b.root.rotation.set(0, 0, 0);
      b.root.position.set(0, 0, 0);
    };
    zero();
    if (name === 'dormant') {
      b.root.position.y = -0.35;
      b.root.rotation.x = 0.25;
      b.legL.rotation.x = 1.2; b.legR.rotation.x = 1.2;
      b.shinL.rotation.x = -1.0; b.shinR.rotation.x = -1.0;
      b.armL.rotation.x = 0.6; b.armR.rotation.x = 0.6;
      b.head.rotation.x = 0.5;
      this.group.rotation.y = this.facingYaw;
      this._setEye(0.15);
    }
  }

  _setEye(v) {
    this.eyeMat.opacity = v;
    if (this.eyeGlow) this.eyeGlow.material.opacity = v * 0.9;
    for (const p of this.parts) {
      if (p.material === this.eyeMat) p.material.needsUpdate = true;
    }
  }

  // --------------------------------------------------------------- update

  update(dt, time) {
    if (this._removed) return;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.animTime += dt;

    switch (this.state) {
      case 'DORMANT': this._animDormant(time); break;
      case 'WAKING': this._animWaking(dt); break;
      case 'CHASE': this._animWalk(time); break;
      case 'ATTACK': this._animAttack(dt); break;
      case 'DEAD': this._animDeath(dt); break;
    }
  }

  _animDormant(time) {
    this.bones.ribcage.scale.y = 1 + Math.sin(time * 1.5 + this.phase) * 0.02;
    this.eyeMat.opacity = 0.12 + Math.sin(time * 2 + this.phase) * 0.05;
  }

  _animWaking(dt) {
    const b = this.bones;
    const damp = (obj, key, target, lambda) => {
      obj[key] = THREE.MathUtils.damp(obj[key], target, lambda, dt);
    };
    damp(b.head.rotation, 'x', 0, 10);
    damp(b.root.rotation, 'x', 0, 6);
    damp(b.root.position, 'y', 0, 6);
    damp(b.legL.rotation, 'x', 0, 5);
    damp(b.legR.rotation, 'x', 0, 5);
    damp(b.shinL.rotation, 'x', 0, 5);
    damp(b.shinR.rotation, 'x', 0, 5);
    damp(b.armL.rotation, 'x', 0, 5);
    damp(b.armR.rotation, 'x', 0, 5);
    this._setEye(Math.min(1, this.animTime * 3));
    if (this.animTime >= 0.6) {
      this.state = 'CHASE';
      this.animTime = 0;
    }
  }

  _animWalk(time) {
    const b = this.bones;
    const t = this.animTime;
    const freq = 9;
    const s = Math.sin(t * freq + this.phase);
    const so = Math.sin(t * freq + this.phase + Math.PI);

    b.legL.rotation.x = s * 0.55;
    b.legR.rotation.x = so * 0.55;
    b.shinL.rotation.x = Math.max(0, s) * 0.5;
    b.shinR.rotation.x = Math.max(0, so) * 0.5;
    b.armL.rotation.x = so * 0.4;
    b.armR.rotation.x = s * 0.4;
    b.forearmL.rotation.x = 0.15 + so * 0.1;
    b.forearmR.rotation.x = 0.15 + s * 0.1;
    b.root.position.y = Math.abs(Math.sin(t * freq + this.phase)) * 0.06;
    b.ribcage.rotation.x = Math.sin(t * freq + this.phase) * 0.03;
    b.head.rotation.y = Math.sin(t * 4 + this.phase) * 0.08;
    this._setEye(1);
    if (this.staffGlow) {
      this.staffGlow.scale.setScalar(0.35 + Math.sin(time * 5 + this.phase) * 0.08);
    }
  }

  _animAttack(dt) {
    const b = this.bones;
    const t = this.animTime;
    const windup = SKELETON.ATTACK_WINDUP / this.attackMult;
    const swingEnd = windup + SKELETON.ATTACK_SWING / this.attackMult;
    const total = windup + (SKELETON.ATTACK_SWING + SKELETON.ATTACK_RECOVER) / this.attackMult;

    if (t < windup) {
      const p = t / windup;
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, -2.4, 8, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, -0.6, 8, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0.3, 8, dt);
      b.head.rotation.x = THREE.MathUtils.damp(b.head.rotation.x, 0.2, 8, dt);
      b.armR.rotation.z = Math.sin(t * 60 + this.phase) * 0.02 * p;
      if (this.staffGlow) {
        this.staffGlow.scale.setScalar(0.35 + p * 0.5);
        this.staffGlow.material.opacity = 0.9 + p * 0.5;
      }
    } else if (t < swingEnd) {
      const p = (t - windup) / SKELETON.ATTACK_SWING;
      const eased = 1 - Math.pow(1 - p, 2);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0.8, 20, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.2, 20, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, -0.15, 12, dt);
      b.root.position.z = eased * 0.25;
      b.armR.rotation.z = 0;
      if (!this.attackHitDone && p >= 0.35) {
        this.attackHitDone = true;
        this.onAttackHit?.();
      }
    } else {
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0, 5, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.15, 5, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0, 5, dt);
      b.head.rotation.x = THREE.MathUtils.damp(b.head.rotation.x, 0, 5, dt);
      b.root.position.z = THREE.MathUtils.damp(b.root.position.z, 0, 5, dt);
    }

    if (t >= total) {
      this.state = 'CHASE';
      this.animTime = 0;
      this.attackCooldown = SKELETON.ATTACK_COOLDOWN / this.attackMult;
    }
  }

  _animDeath(dt) {
    const b = this.bones;
    const t = this.animTime;
    b.root.rotation.x = THREE.MathUtils.damp(b.root.rotation.x, -Math.PI / 2, 8, dt);
    b.root.position.y = THREE.MathUtils.damp(b.root.position.y, 0.05, 8, dt);
    b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, 0.9, 8, dt);
    b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0.9, 8, dt);
    b.legL.rotation.x = THREE.MathUtils.damp(b.legL.rotation.x, 0.5, 8, dt);
    b.legR.rotation.x = THREE.MathUtils.damp(b.legR.rotation.x, 0.5, 8, dt);

    const fadeStart = SKELETON.DEATH_HOLD - SKELETON.DEATH_FADE;
    if (t > fadeStart) {
      this.fade = Math.max(0, 1 - (t - fadeStart) / SKELETON.DEATH_FADE);
      this._applyFade(this.fade);
    }
    if (t >= SKELETON.DEATH_HOLD) {
      this.onDeathComplete?.();
    }
  }

  _applyFade(v) {
    for (const mat of [this.boneMat, this.darkMat, this.eyeMat, this.bladeMat]) {
      mat.opacity = v;
    }
    if (this.eyeGlow) this.eyeGlow.material.opacity = v * 0.9;
    if (this.staffGlow) this.staffGlow.material.opacity = v * 0.9;
  }

  setFacing(yaw) {
    this.facingYaw = yaw;
  }

  hit(damage) {
    if (this.state === 'DEAD') return false;
    this.hp -= damage;
    if (this.hp <= 0) {
      this.state = 'DEAD';
      this.animTime = 0;
      this.attackHitDone = true;
      this.onKill?.();
      return true;
    }
    return false;
  }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }

  dispose() {
    if (this._removed) return;
    this._removed = true;
    this.group.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
      }
    });
    for (const mat of [this.boneMat, this.darkMat, this.eyeMat, this.bladeMat, this.eyeGlowMat]) mat.dispose();
    if (this._glowTex) this._glowTex.dispose();
    this.scene.remove(this.group);
  }
}

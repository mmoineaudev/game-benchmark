import * as THREE from 'three';
import { SKELETON } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

// Procedural skeletal warrior: rig built from primitives, animated by a
// state machine with damped transitions. No external assets.
// States: DORMANT -> WAKING -> CHASE -> ATTACK -> DEAD
// Magician variant (1 in 10): hood + glowing staff instead of a sword.
export class Skeleton {
  constructor(scene, { isMagician = false } = {}) {
    this.scene = scene;
    this.isMagician = isMagician;
    this.hp = SKELETON.HP;
    this.state = 'DORMANT';
    this.animTime = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.facingYaw = Math.random() * Math.PI * 2;
    this.attackHitDone = false;
    this.attackCooldown = 0;
    this.fade = 1;
    this._dead = false;
    this._removed = false;

    this.group = new THREE.Group();
    this.bones = {};
    this.parts = [];

    // Per-skeleton material clones so death-fade opacity is independent
    this.boneMat = new THREE.MeshStandardMaterial({
      color: SKELETON.BONE_COLOR, roughness: 0.85, metalness: 0.05,
      transparent: true,
    });
    this.darkMat = new THREE.MeshStandardMaterial({
      color: 0x2a2622, roughness: 0.9, transparent: true,
    });
    this.eyeMat = new THREE.MeshBasicMaterial({
      color: SKELETON.EYE_GLOW, transparent: true, opacity: 0.15,
    });
    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a72, roughness: 0.4, metalness: 0.9, transparent: true,
    });
    // Eye glow sprite (additive) — makes eyes readable through the dark
    this._glowTex = generateGlowTexture();
    this.eyeGlowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: SKELETON.EYE_GLOW,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });

    this._buildRig();
    scene.add(this.group);
    this._setPose('dormant');
  }

  // ------------------------------------------------------------------ rig

  _mesh(geo, mat, x, y, z, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    this.parts.push(m);
    return m;
  }

  _bone(name, x, y, z, parent) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    this.bones[name] = g;
    return g;
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
      rib.rotation.z = Math.PI; // arc opens downward, facing forward
      rib.position.set(0, 0.5 + i * 0.1, 0);
      rib.castShadow = true;
      rib.receiveShadow = true;
      ribcage.add(rib);
      this.parts.push(rib);
    }
    // Sternum
    this._mesh(new THREE.BoxGeometry(0.06, 0.3, 0.02), this.boneMat, 0, 0.55, 0.16, ribcage);

    // Head: skull + jaw + eye sockets + glowing eyes
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), this.boneMat);
    skull.scale.set(0.9, 1.1, 0.95);
    skull.position.set(0, 0.15, 0);
    skull.castShadow = true;
    head.add(skull);
    this.parts.push(skull);

    const jaw = this._mesh(new THREE.BoxGeometry(0.1, 0.05, 0.12), this.boneMat, 0, 0.02, 0.06, head);
    jaw.rotation.x = 0.12;

    for (const sx of [-1, 1]) {
      const socket = this._mesh(new THREE.SphereGeometry(0.045, 8, 6), this.darkMat, sx * 0.06, 0.16, 0.13, head);
      socket.scale.set(1, 0.8, 0.6);
      const eye = this._mesh(new THREE.SphereGeometry(0.02, 6, 6), this.eyeMat, sx * 0.06, 0.16, 0.147, head);
      this.parts.push(eye);
    }

    // Additive glow sprite at the skull — makes the eyes pop through fog/bloom
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

    // Arms: shoulder pivot -> upper -> forearm -> hand
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const arm = this._bone('arm' + tag, side * 0.28, 0.42, 0, ribcage);
      this._mesh(new THREE.BoxGeometry(0.09, 0.38, 0.09), this.boneMat, 0, -0.19, 0, arm);
      const forearm = this._bone('forearm' + tag, 0, -0.4, 0, arm);
      this._mesh(new THREE.BoxGeometry(0.08, 0.34, 0.08), this.boneMat, 0, -0.17, 0, forearm);
      this._mesh(new THREE.SphereGeometry(0.055, 8, 6), this.boneMat, 0, -0.36, 0, forearm);
      // Right hand: sword (warrior) or staff (magician)
      if (side > 0) {
        if (this.isMagician) this._buildStaff(forearm);
        else this._buildSword(forearm);
      }
    }

    // Legs: hip pivot -> thigh -> shin -> foot
    for (const side of [-1, 1]) {
      const tag = side < 0 ? 'L' : 'R';
      const leg = this._bone('leg' + tag, side * 0.12, -0.95, 0, pelvis);
      this._mesh(new THREE.BoxGeometry(0.11, 0.42, 0.11), this.boneMat, 0, -0.21, 0, leg);
      const shin = this._bone('shin' + tag, 0, -0.45, 0, leg);
      this._mesh(new THREE.BoxGeometry(0.09, 0.4, 0.09), this.boneMat, 0, -0.2, 0, shin);
      const foot = this._mesh(new THREE.BoxGeometry(0.09, 0.07, 0.16), this.boneMat, 0, -0.03, 0.05, shin);
      foot.rotation.x = -0.15;
    }
  }

  _buildSword(hand) {
    const grip = this._mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 6), this.darkMat, 0, -0.08, 0.1, hand);
    const guard = this._mesh(new THREE.BoxGeometry(0.09, 0.02, 0.03), this.darkMat, 0, -0.16, 0.1, hand);
    const blade = this._mesh(new THREE.BoxGeometry(0.03, 0.5, 0.07), this.bladeMat, 0, -0.36, 0.1, hand);
    blade.rotation.x = 0.15; // slight tilt
  }

  _buildStaff(hand) {
    // Long wooden staff held in the right hand, glowing orb on top
    const shaft = this._mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.3, 8), this.darkMat, 0, -0.15, 0.12, hand);
    shaft.rotation.x = 0.05;
    this.staffOrb = this._mesh(new THREE.SphereGeometry(0.07, 10, 8), this.eyeMat, 0, 0.62, 0.12, hand);
    // Staff orb glow sprite (shares the eye material color)
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
      // Crouched, knees folded, head drooped, tilted
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
    // Breathing + faint eye flicker
    this.bones.ribcage.scale.y = 1 + Math.sin(time * 1.5 + this.phase) * 0.02;
    this.eyeMat.opacity = 0.12 + Math.sin(time * 2 + this.phase) * 0.05;
  }

  _animWaking(dt) {
    const b = this.bones;
    const damp = (obj, key, target, lambda) => {
      obj[key] = THREE.MathUtils.damp(obj[key], target, lambda, dt);
    };
    // Head snaps up first, then torso, then legs straighten
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
    // Magician staff orb: steady pulse
    if (this.staffGlow) {
      this.staffGlow.scale.setScalar(0.35 + Math.sin(time * 5 + this.phase) * 0.08);
    }
  }

  _animAttack(dt) {
    const b = this.bones;
    const t = this.animTime;
    const windup = SKELETON.ATTACK_WINDUP;
    const swingEnd = windup + SKELETON.ATTACK_SWING;
    const total = windup + SKELETON.ATTACK_SWING + SKELETON.ATTACK_RECOVER;

    if (t < windup) {
      // Telegraph: sword overhead-behind, torso leans back, tension shake
      const p = t / windup;
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, -2.4, 8, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, -0.6, 8, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0.3, 8, dt);
      b.head.rotation.x = THREE.MathUtils.damp(b.head.rotation.x, 0.2, 8, dt);
      b.armR.rotation.z = Math.sin(t * 60 + this.phase) * 0.02 * p;
      // Magician: staff orb charges up during windup
      if (this.staffGlow) {
        this.staffGlow.scale.setScalar(0.35 + p * 0.5);
        this.staffGlow.material.opacity = 0.9 + p * 0.5;
      }
    } else if (t < swingEnd) {
      // Chop: arm sweeps forward, torso lunges
      const p = (t - windup) / SKELETON.ATTACK_SWING;
      const eased = 1 - Math.pow(1 - p, 2);
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0.8, 20, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.2, 20, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, -0.15, 12, dt);
      b.root.position.z = eased * 0.25; // lunge forward (local -z is forward after yaw)
      b.armR.rotation.z = 0;
      if (!this.attackHitDone && p >= 0.35) {
        this.attackHitDone = true;
        this.onAttackHit?.();
      }
    } else {
      // Recover to neutral
      b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0, 5, dt);
      b.forearmR.rotation.x = THREE.MathUtils.damp(b.forearmR.rotation.x, 0.15, 5, dt);
      b.ribcage.rotation.x = THREE.MathUtils.damp(b.ribcage.rotation.x, 0, 5, dt);
      b.head.rotation.x = THREE.MathUtils.damp(b.head.rotation.x, 0, 5, dt);
      b.root.position.z = THREE.MathUtils.damp(b.root.position.z, 0, 5, dt);
    }

    if (t >= total) {
      this.state = 'CHASE';
      this.animTime = 0;
      this.attackCooldown = SKELETON.ATTACK_COOLDOWN;
    }
  }

  _animDeath(dt) {
    const b = this.bones;
    const t = this.animTime;
    // Fall forward, then fade
    b.root.rotation.x = THREE.MathUtils.damp(b.root.rotation.x, -Math.PI / 2, 6, dt);
    b.root.position.y = THREE.MathUtils.damp(b.root.position.y, 0.05, 6, dt);
    // Limbs relax
    b.armL.rotation.x = THREE.MathUtils.damp(b.armL.rotation.x, 0.9, 6, dt);
    b.armR.rotation.x = THREE.MathUtils.damp(b.armR.rotation.x, 0.9, 6, dt);
    b.legL.rotation.x = THREE.MathUtils.damp(b.legL.rotation.x, 0.5, 6, dt);
    b.legR.rotation.x = THREE.MathUtils.damp(b.legR.rotation.x, 0.5, 6, dt);

    if (t > 0.4) {
      this.fade = Math.max(0, 1 - (t - 0.4) / 0.4);
      this._applyFade(this.fade);
    }
    if (t >= 0.85) {
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

  // Called by SkeletonSystem each frame with movement direction (world yaw).
  setFacing(yaw) {
    this.facingYaw = yaw;
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

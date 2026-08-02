import * as THREE from 'three';
import { HUNTER } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';
import { circleHitsBox } from '../core/Collision.js';

// Hunter — a spectral boss companion summoned by the HUNTER buff.
// It hovers near the player (following at a short distance) and targets mobs
// ON SIGHT: every ATTACK_INTERVAL it picks the nearest enemy it can see
// (line-of-sight checked against the dungeon's collision boxes) and throws an
// energy beam at it. The beam is a visible additive cylinder that flashes from
// the hunter's core to the target and fades. It is invulnerable (HP 9999) and
// vanishes when the buff expires (Game calls dispose()).
export class Hunter {
  constructor(scene) {
    this.scene = scene;
    this.type = 'HUNTER';
    this.hp = HUNTER.HP;
    this.maxHp = this.hp;
    this.attackCooldown = 0;
    this.animTime = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this._removed = false;

    this.group = new THREE.Group();
    this._build();
    scene.add(this.group);
  }

  _build() {
    this.bodyMat = new THREE.MeshBasicMaterial({
      color: 0x88ccff, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0x66e0ff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.eyeMat = new THREE.MeshBasicMaterial({
      color: 0xccffff, transparent: true, opacity: 0.95,
    });
    this._mats = [this.bodyMat, this.coreMat, this.eyeMat];

    // Spectral apparition, boss-sized
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 12, 1, true), this.bodyMat);
    body.position.y = 1.2;
    this.group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), this.bodyMat);
    head.position.y = 2.2;
    this.group.add(head);
    // Glowing core — the beam fires from here
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), this.coreMat);
    this.core.position.y = 1.35;
    this.group.add(this.core);
    // Eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), this.eyeMat);
      eye.position.set(sx * 0.16, 2.25, 0.34);
      this.group.add(eye);
    }
    // Aura glow
    this._glowTex = generateGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0x66ccff,
      blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.35,
    });
    this._mats.push(this.glowMat);
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.setScalar(2.4);
    this.group.add(this.glow);

    // --- Energy beam (reused for every lash) ---
    this._beamGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6, 1, true);
    this._beamMat = new THREE.MeshBasicMaterial({
      color: 0x88eeff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._mats.push(this._beamMat);
    this._beam = new THREE.Mesh(this._beamGeo, this._beamMat);
    this._beam.visible = false;
    this.scene.add(this._beam);
    // Impact glow sprite at the beam's tip
    this._impactMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0x88eeff,
      blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0,
    });
    this._mats.push(this._impactMat);
    this._impact = new THREE.Sprite(this._impactMat);
    this._impact.scale.setScalar(0.9);
    this._impact.visible = false;
    this.scene.add(this._impact);
    this._beamT = 0;      // beam flash timer (>0 = animating)
    this._beamFrom = new THREE.Vector3();
    this._beamTo = new THREE.Vector3();
    this._impactPos = new THREE.Vector3();

    this.group.scale.setScalar(HUNTER.SCALE);
  }

  // Line of sight: any dungeon wall between the hunter's core and the target
  // blocks the beam (targeting on sight).
  _hasLOS(x0, z0, x1, z1, collisionBoxes) {
    if (!collisionBoxes || !collisionBoxes.length) return true;
    const d = Math.hypot(x1 - x0, z1 - z0);
    const step = 0.4;
    const steps = Math.max(1, Math.floor(d / step));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (circleHitsBox(collisionBoxes, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0.25)) return false;
    }
    return true;
  }

  // Called from Game._animate: follow the player, target mobs on sight, and
  // throw an energy beam at the target. `enemies` = live skeleton roster,
  // `onHit` applies damage, `collisionBoxes` = dungeon walls for LOS.
  // `souls` scales the attack speed: x(totalSouls/100), capped so the hunter
  // always fires at least every ~0.2s.
  update(dt, time, player, enemies, onHit, collisionBoxes, souls = 100) {
    if (this._removed) return;
    this.animTime += dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Attack interval shrinks with banked souls: 1.0s at 100 souls, 0.5s at
    // 200, 2s at 50 (attack speed x souls/100).
    const atkSpeed = Math.min(Math.max((souls || 0) / 100, 0.25), 5);
    const interval = HUNTER.ATTACK_INTERVAL / atkSpeed;

    // --- Follow the player at a short hover distance ---
    const g = this.group.position;
    const dx = player.x - g.x;
    const dz = player.z - g.z;
    const dist = Math.hypot(dx, dz);
    if (dist > HUNTER.FOLLOW_DIST) {
      const step = Math.min(HUNTER.SPEED * dt, dist - HUNTER.FOLLOW_DIST);
      g.x += (dx / dist) * step;
      g.z += (dz / dist) * step;
    }
    // Gentle spectral bobbing
    g.y = 0.6 + Math.sin(time * 3 + this.phase) * 0.15;
    this.group.rotation.y = Math.atan2(dx, dz);

    // --- Target the nearest VISIBLE mob and throw a beam at it ---
    if (this.attackCooldown <= 0 && enemies && enemies.length) {
      let target = null;
      let best = Infinity;
      const hx = g.x, hz = g.z;
      for (const s of enemies) {
        if (s.skel.state === 'DEAD' || s.type === 'HUNTER') continue;
        const d = Math.hypot(s.x - hx, s.z - hz);
        if (d < best) {
          // Target on sight: the hunter only locks onto enemies it can see.
          if (this._hasLOS(hx, hz, s.x, s.z, collisionBoxes)) { best = d; target = s; }
        }
      }
      if (target && best <= HUNTER.ATTACK_RANGE) {
        this.attackCooldown = interval;
        // Fire the beam at the target and apply damage on impact.
        this._fireBeam(target, hx, hz);
        onHit?.(target.skel, HUNTER.ATTACK_DAMAGE);
      }
    }

    // --- Animate the beam flash ---
    if (this._beamT > 0) {
      this._beamT -= dt;
      const t = Math.max(0, this._beamT / HUNTER.BEAM_TIME);
      // Grow from the hunter's core toward the target, then fade.
      const from = this._beamFrom, to = this._beamTo;
      const cur = to.clone().sub(from).multiplyScalar(1 - t).add(from);
      this._positionBeam(from, cur);
      this._beamMat.opacity = 0.9 * t;
      this._impact.position.set(this._impactPos.x, this._impactPos.y, this._impactPos.z);
      this._impactMat.opacity = 0.8 * t;
      if (this._beamT <= 0) {
        this._beam.visible = false;
        this._impact.visible = false;
      }
    }

    // Pulse the core + aura
    const pulse = 0.7 + Math.sin(time * 6 + this.phase) * 0.25;
    this.core.material.opacity = 0.7 * pulse;
    this.glow.material.opacity = 0.3 + Math.sin(time * 4 + this.phase) * 0.1;
  }

  _fireBeam(target, hx, hz) {
    // Beam from the hunter's core to the target's chest height.
    this._beamFrom.set(hx, 1.35 * HUNTER.SCALE, hz);
    this._beamTo.set(target.skel.group.position.x, 0.9, target.skel.group.position.z);
    this._impactPos.copy(this._beamTo);
    this._beamT = HUNTER.BEAM_TIME;
    this._beam.visible = true;
    this._impact.visible = true;
  }

  _positionBeam(from, to) {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    this._beam.position.copy(mid);
    const dir = to.clone().sub(from);
    const len = dir.length() || 0.001;
    this._beam.scale.set(1, len, 1);
    // Align the cylinder's Y axis with the beam direction.
    this._beam.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir.normalize(),
    );
  }

  dispose() {
    if (this._removed) return;
    this._removed = true;
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
    this._beamGeo.dispose();
    this._beamMat.dispose();
    this._impactMat.dispose();
    this.scene.remove(this._beam);
    this.scene.remove(this._impact);
    for (const m of this._mats) m.dispose();
    if (this._glowTex) this._glowTex.dispose();
    this.scene.remove(this.group);
  }
}

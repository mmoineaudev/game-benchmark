import * as THREE from 'three';
import { WRAITH, ELITE } from '../../core/Constants.js';
import { generateGlowTexture } from '../../world/Textures.js';

// Wraith — phasing threat. Translucent hooded figure that flies straight at
// the player THROUGH walls (no collision, no pathing). A real cloak
// silhouette now (lathe-flared hem + pointed hood + faint hooded head) with
// the hem oscillating for a "floating" realism. Cannot be kited behind
// corners; the counter is killing it fast. Elite (1-in-10): Banshee.
export class Wraith {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.type = 'WRAITH';
    this.elite = !!opts.elite;
    this.hp = this.elite ? ELITE.WRAITH.HP : WRAITH.HP;
    this.maxHp = this.hp;
    this.speed = WRAITH.SPEED * (this.elite ? ELITE.WRAITH.SPEED_MULT : 1);
    this.damage = WRAITH.DMG;
    this.attackRange = WRAITH.ORB_RANGE; // phantoms cast soul orbs from long range
    this.attackCooldown = 0;
    this.dropOrbs = this.elite ? ELITE.WRAITH.DROP : WRAITH.DROP;
    this.attackMult = opts.attackMult || 1;
    this._cooldown = WRAITH.COOLDOWN / this.attackMult;
    this.state = 'CHASE';
    this.animTime = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this._removed = false;

    this.group = new THREE.Group();
    this._build();
    scene.add(this.group);
  }

  _build() {
    const color = this.elite ? ELITE.WRAITH.BODY : WRAITH.BODY;
    this.bodyMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.eyeMat = new THREE.MeshBasicMaterial({
      color: WRAITH.EYE, transparent: true, opacity: 0.9,
    });
    // Slightly darker inner body for depth under the brittle cloak.
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    this._mats = [this.bodyMat, this.eyeMat, innerMat];

    // Cloak body: lathe silhouette (flared hem, narrow waist, pointed hood).
    const cloakPts = [];
    const profile = [
      [0.06, 0.0], [0.16, 0.10], [0.30, 0.30], [0.42, 0.55],
      [0.40, 0.75], [0.28, 0.85], [0.16, 0.92], [0.05, 1.06],
    ];
    for (const [r, y] of profile) cloakPts.push(new THREE.Vector2(r, y));
    const cloakGeo = new THREE.LatheGeometry(cloakPts, 10);
    const body = new THREE.Mesh(cloakGeo, this.bodyMat);
    body.position.y = 0.2;
    this.group.add(body);
    this._cloak = body;

    // Hooded head core (dark sphere peeking from the hood) + inner depth.
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), innerMat);
    inner.position.set(0, 1.06, 0);
    this.group.add(inner);

    // Two bright eyes peering from under the hood.
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), this.eyeMat);
      eye.position.set(sx * 0.07, 1.0, 0.22);
      this.group.add(eye);
    }

    // Trailing wisp glow sprites (3, following with lag)
    this._glowTex = generateGlowTexture();
    this._trail = [];
    for (let i = 0; i < 3; i++) {
      const baseOpacity = 0.25 - i * 0.06;
      const mat = new THREE.SpriteMaterial({
        map: this._glowTex, color,
        blending: THREE.AdditiveBlending, depthWrite: false,
        transparent: true, opacity: baseOpacity,
      });
      mat.userData.baseOpacity = baseOpacity;
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(0.7 - i * 0.15);
      sprite.position.set(0, -i * 0.4, 0);
      this.group.add(sprite);
      this._mats.push(mat);
      this._trail.push(sprite);
    }
  }

  setFacing(yaw) { this.facingYaw = yaw; }

  update(dt, time) {
    if (this._removed) return;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.animTime += dt;

    // DEAD: dissipate — fade out and sink, gone 2 s after death
    if (this.state === 'DEAD') {
      const fadeStart = WRAITH.DEATH_HOLD - WRAITH.DEATH_FADE;
      let f = 1;
      if (this.animTime > fadeStart) {
        f = Math.max(0, 1 - (this.animTime - fadeStart) / WRAITH.DEATH_FADE);
      }
      this.bodyMat.opacity = 0.35 * f;
      this.eyeMat.opacity = 0.9 * f;
      for (const s of this._trail) {
        s.material.opacity = s.material.userData.baseOpacity * f;
      }
      this.group.position.y -= dt * 0.4 * f;
      if (this.animTime >= WRAITH.DEATH_HOLD) this.onDeathComplete?.();
      return;
    }

    // Sine bob
    this.group.position.y = Math.sin(time * WRAITH.BOB_FREQ + this.phase) * WRAITH.BOB_AMP;
    // Eyes flicker
    this.eyeMat.opacity = 0.7 + Math.sin(time * 6 + this.phase) * 0.25;
    // Cloak hem undulates (three horizontal scale-plies on the lathe body).
    if (this._cloak) {
      const sway = Math.sin(time * 3 + this.phase) * 0.04;
      this._cloak.scale.x = 1 + sway;
      this._cloak.scale.z = 1 - sway;
    }
  }

  // Touch attack (instant)
  attack() {
    if (this.attackCooldown > 0) return false;
    this.attackCooldown = this._cooldown;
    return true;
  }

  hit(damage) {
    if (this.state === 'DEAD') return false;
    this.hp -= damage;
    if (this.hp <= 0) {
      this.state = 'DEAD';
      this.animTime = 0;
      this.onKill?.();
      return true;
    }
    return false;
  }

  dispose() {
    if (this._removed) return;
    this._removed = true;
    this.group.traverse((obj) => {
      if (obj.isMesh && obj.geometry) obj.geometry.dispose();
    });
    for (const m of this._mats) m.dispose();
    if (this._glowTex) this._glowTex.dispose();
    this.scene.remove(this.group);
  }
}

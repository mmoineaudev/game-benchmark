import * as THREE from 'three';
import { WRAITH, ELITE } from '../../core/Constants.js';
import { generateGlowTexture } from '../../world/Textures.js';

// Wraith — phasing threat. Translucent hooded figure that flies straight at
// the player THROUGH walls (no collision, no pathing). Cannot be kited behind
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
    this.attackRange = WRAITH.RANGE;
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
    this._mats = [this.bodyMat, this.eyeMat];

    // Hooded cone body
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 10, 1, true), this.bodyMat);
    body.position.y = 0.55;
    this.group.add(body);

    // Two bright eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), this.eyeMat);
      eye.position.set(sx * 0.1, 0.85, 0.3);
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
      this.animTime = 0; // death timer starts now
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

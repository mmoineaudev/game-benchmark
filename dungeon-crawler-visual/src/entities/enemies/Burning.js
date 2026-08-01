import * as THREE from 'three';
import { BURN } from '../../core/Constants.js';
import { generateGlowTexture } from '../../world/Textures.js';

// A mysterious red-and-black burning figure. Chases the player and sets the
// ground ablaze where it walks (fires Game's fire-patch hook on a timer).
// Random, at most one per level. Killed like any enemy (purple death burst).
export class Burning {
  constructor(scene) {
    this.scene = scene;
    this.type = 'BURN';
    this.hp = BURN.HP;
    this.maxHp = this.hp;
    this.speed = BURN.SPEED;
    this.damage = BURN.DMG;
    this.attackRange = BURN.RANGE;
    this.dropOrbs = BURN.DROP;
    this.attackCooldown = 0;
    this._cooldown = BURN.COOLDOWN;
    this.state = 'CHASE';
    this.animTime = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this.burnAcc = 0; // fire-leak timer
    this._removed = false;

    this.group = new THREE.Group();
    this._build();
    scene.add(this.group);
  }

  _build() {
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a0f0f, emissive: 0xaa2200, emissiveIntensity: 1.6,
      roughness: 0.8, metalness: 0.1,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xff5533, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    // Flame envelope: 3 stacked additive cones — layered, flickering fire.
    this.flameMats = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.MeshBasicMaterial({
        color: i === 0 ? 0xff6622 : (i === 1 ? 0xff8844 : 0xffaa55),
        transparent: true, opacity: 0.5 - i * 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.flameMats.push(m);
    }
    this._mats = [this.bodyMat, this.coreMat, ...this.flameMats];

    // Black burning body — humanoid taper, not a plain box.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.2, 8), this.bodyMat);
    body.position.y = 0.6;
    this.group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), this.bodyMat);
    head.position.y = 1.4;
    this.group.add(head);
    // Burning core (the heart of the flame)
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), this.coreMat);
    this.core.position.y = 0.7;
    this.group.add(this.core);
    // Eyes (red)
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3311, transparent: true, opacity: 0.95 });
    this._mats.push(this.eyeMat);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), this.eyeMat);
      eye.position.set(sx * 0.09, 1.42, 0.16);
      this.group.add(eye);
    }
    // Flame cone envelope (tall center, short sides) — flicker in update
    this.flames = [];
    const flameSpec = [
      { geo: new THREE.ConeGeometry(0.30, 1.1, 8, 1, true), y: 0.2, s: 1.0, i: 0 },
      { geo: new THREE.ConeGeometry(0.22, 0.8, 8, 1, true), y: 1.1, s: 1.25, i: 1 },
      { geo: new THREE.ConeGeometry(0.16, 0.55, 8, 1, true), y: 1.7, s: 1.5, i: 2 },
    ];
    for (const f of flameSpec) {
      const cone = new THREE.Mesh(f.geo, this.flameMats[f.i]);
      cone.position.y = f.y;
      cone.scale.setScalar(f.s);
      cone.rotation.y = Math.random() * Math.PI;
      this.group.add(cone);
      this.flames.push({ mesh: cone, baseScale: f.s, seed: Math.random() * 10 });
    }
    // Flame glow halo
    this._glowTex = generateGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0xff5522, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.5,
    });
    this._mats.push(this.glowMat);
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.setScalar(1.6);
    this.glow.position.y = 0.7;
    this.group.add(this.glow);
  }

  // Flicker the flame envelope (cones pulse in height/opacity).
  _flicker(time) {
    for (const f of this.flames) {
      const t = Math.sin(time * 9 + this.phase + f.seed * 3) * 0.18
        + Math.sin(time * 23 + f.seed) * 0.06;
      f.mesh.scale.setScalar(f.baseScale * (1 + t));
      const idx = this.flames.indexOf(f);
      if (this.flameMats[idx]) this.flameMats[idx].opacity = (0.5 - idx * 0.12) * (1 + t * 0.5);
    }
  }

  setFacing(yaw) { this.facingYaw = yaw; }

  update(dt, time) {
    if (this._removed) return;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.animTime += dt;
    // pulsing flame
    this.core.scale.setScalar(0.8 + Math.sin(time * 7 + this.phase) * 0.25);
    this.glowMat.opacity = 0.4 + Math.sin(time * 7 + this.phase) * 0.15;
    this._flicker(time);
    if (this.state === 'DEAD') {
      this.group.position.y -= dt * 0.5; // sink away
      const f = Math.max(0, 1 - this.animTime / 2);
      this.bodyMat.emissiveIntensity = 1.6 * f;
      this.coreMat.opacity = 0.95 * f;
      this.eyeMat.opacity = 0.95 * f;
      this.glowMat.opacity = 0.4 * f;
      for (const fm of this.flameMats) fm.opacity *= f;
      this.group.scale.setScalar(Math.max(0.01, f));
      if (this.animTime >= 2) this.onDeathComplete?.();
      return;
    }
  }

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
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    for (const m of this._mats) m.dispose();
    if (this._glowTex) this._glowTex.dispose();
    this.scene.remove(this.group);
  }
}

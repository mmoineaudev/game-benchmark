import * as THREE from 'three';
import { HUNTER } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

// Hunter — a spectral boss companion summoned by the HUNTER buff.
// It hovers near the player (following at a short distance) and lashes out
// at nearby mobs every ATTACK_INTERVAL seconds, dealing ATTACK_DAMAGE to
// every enemy inside ATTACK_RANGE. It is invulnerable (HP 9999), cannot be
// damaged, and vanishes when the buff expires (Game calls dispose()).
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
    // Glowing core
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

    this.group.scale.setScalar(HUNTER.SCALE);
  }

  // Called from Game._animate: follow the player, lash at nearby mobs.
  // `enemies` = this.skeletons.skeletons (live roster).
  update(dt, time, player, enemies, onHit) {
    if (this._removed) return;
    this.animTime += dt;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

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

    // --- Lash out at nearby mobs ---
    if (this.attackCooldown <= 0 && enemies && enemies.length) {
      let target = null;
      let best = Infinity;
      for (const s of enemies) {
        if (s.skel.state === 'DEAD' || s.type === 'HUNTER') continue;
        const d = Math.hypot(s.x - g.x, s.z - g.z);
        if (d < best) { best = d; target = s; }
      }
      if (target && best <= HUNTER.ATTACK_RANGE) {
        this.attackCooldown = HUNTER.ATTACK_INTERVAL;
        // Hit every mob within range of the hunter's position (AoE lash)
        const r2 = HUNTER.ATTACK_RANGE * HUNTER.ATTACK_RANGE;
        for (const s of enemies) {
          if (s.skel.state === 'DEAD') continue;
          const d2 = (s.x - g.x) ** 2 + (s.z - g.z) ** 2;
          if (d2 <= r2) onHit?.(s.skel, HUNTER.ATTACK_DAMAGE);
        }
        this.core.material.opacity = 1.0; // flash on lash
      }
    }
    // Pulse the core + aura
    const pulse = 0.7 + Math.sin(time * 6 + this.phase) * 0.25;
    this.core.material.opacity = 0.7 * pulse;
    this.glow.material.opacity = 0.3 + Math.sin(time * 4 + this.phase) * 0.1;
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

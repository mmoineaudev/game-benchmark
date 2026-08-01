import * as THREE from 'three';
import { RAT } from '../../core/Constants.js';
import { generateGlowTexture } from '../../world/Textures.js';

// Rat — fast chaff. Spawns in packs of 4-6 (1 spawn slot per pack), HP 1,
// contact damage. No elite. Drops nothing — economy pressure.
export class Rat {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.type = 'RAT';
    this.elite = false;
    this.hp = RAT.HP;
    this.maxHp = this.hp;
    this.speed = RAT.SPEED;
    this.damage = RAT.DMG;
    this.attackRange = RAT.RANGE;
    this.attackCooldown = 0;
    this.dropOrbs = RAT.DROP;
    this.attackMult = opts.attackMult || 1;
    this._cooldown = RAT.COOLDOWN / this.attackMult;
    this.state = 'CHASE';
    this.animTime = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this._removed = false;

    this.group = new THREE.Group();
    this._build();
    scene.add(this.group);
  }

  _build() {
    // Fluorescent toxic-green: emissive materials + a glow sprite so rat
    // packs read clearly against the dark dungeon floor.
    const bodyMat = new THREE.MeshStandardMaterial({
      color: RAT.BODY, emissive: 0x33ff55, emissiveIntensity: 1.5,
      roughness: 0.6, transparent: true,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: RAT.HEAD, emissive: 0x22dd44, emissiveIntensity: 1.3,
      roughness: 0.6, transparent: true,
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: RAT.EYE, transparent: true });
    this._mats = [bodyMat, headMat, eyeMat];

    // Additive glow halo (pulses in update)
    this._glowTex = generateGlowTexture();
    this._glowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0x66ff88,
      blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.5,
    });
    this._mats.push(this._glowMat);
    this._glow = new THREE.Sprite(this._glowMat);
    this._glow.scale.setScalar(0.6);
    this.group.add(this._glow);

    // Body: squashed sphere, low to the ground
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), bodyMat);
    body.scale.set(1, 0.7, 1.6);
    body.position.y = 0.1;
    body.castShadow = true;
    this.group.add(body);
    this.body = body;

    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), headMat);
    head.scale.set(0.9, 0.8, 1);
    head.position.set(0, 0.1, 0.13);
    head.castShadow = true;
    this.group.add(head);

    // Eyes (2 tiny red spheres)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4), eyeMat);
      eye.position.set(sx * 0.035, 0.12, 0.19);
      this.group.add(eye);
    }

    // Tail
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.005, 0.25, 5), headMat);
    tail.position.set(0, 0.06, -0.14);
    tail.rotation.x = 0.6;
    this.group.add(tail);
  }

  setFacing(yaw) { this.facingYaw = yaw; }

  // Scuttle animation
  update(dt) {
    if (this._removed) return;
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    this.animTime += dt;

    // DEAD: flop onto the side, hold the corpse, vanish 2 s after death
    if (this.state === 'DEAD') {
      this.body.rotation.z = Math.min(Math.PI / 2, this.body.rotation.z + dt * 14);
      this.body.rotation.x = Math.min(Math.PI / 2, this.body.rotation.x + dt * 10);
      this.group.position.y = Math.max(0.02, this.group.position.y - dt * 0.12);
      const fadeStart = RAT.DEATH_HOLD - RAT.DEATH_FADE;
      if (this.animTime > fadeStart) {
        const f = Math.max(0, 1 - (this.animTime - fadeStart) / RAT.DEATH_FADE);
        for (const m of this._mats) m.opacity = f;
      }
      if (this.animTime >= RAT.DEATH_HOLD) this.onDeathComplete?.();
      return;
    }

    const wobble = Math.sin(this.animTime * 10 + this.phase) * 0.4;
    this.body.rotation.z = wobble;
    this.group.position.y = Math.abs(Math.sin(this.animTime * 10 + this.phase)) * 0.03;
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, this.facingYaw ?? 0, 10, dt);
    // Fluorescent glow pulse
    this._glowMat.opacity = 0.45 + Math.sin(this.animTime * 5 + this.phase) * 0.12;
  }

  // Touch attack (instant, no windup)
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

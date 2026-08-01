import * as THREE from 'three';
import { RAT } from '../../core/Constants.js';
import { generateGlowTexture } from '../../world/Textures.js';
import { makeGlow } from '../../core/Materials.js';
import { Proportion } from '../Proportion.js';

// Rat — fast chaff, spawned in packs of 4-6. A proper quadruped now: low
// elongated body + 4 scuttling legs (alternate phase = a real run), ears,
// and a segmented tapering tail that whips. HP 1, contact damage, no elite,
// drops nothing (economy pressure).
// Keeps the toxic-green emissive + glow so packs read clearly in the dark.
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
    const bodyMat = new THREE.MeshStandardMaterial({
      color: RAT.BODY, emissive: 0x33ff55, emissiveIntensity: 1.5,
      roughness: 0.6, transparent: true,
    });
    const headMat = new THREE.MeshStandardMaterial({
      color: RAT.HEAD, emissive: 0x22dd44, emissiveIntensity: 1.3,
      roughness: 0.6, transparent: true,
    });
    const earMat = new THREE.MeshStandardMaterial({
      color: RAT.HEAD, emissive: 0x22dd44, emissiveIntensity: 1.1,
      roughness: 0.6, transparent: true,
    });
    const eyeMat = makeGlow(RAT.EYE, { transparent: true });
    this._mats = [bodyMat, headMat, earMat, eyeMat];

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

    // Low stretched body (capsule-ish silhouette from a scaled sphere).
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), bodyMat);
    body.scale.set(1, 0.7, 1.6);
    body.position.y = 0.1;
    body.castShadow = true;
    this.group.add(body);
    this.body = body;

    // Head (bobs on a short neck — driven in update for scuttle life)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), headMat);
    head.scale.set(0.9, 0.8, 1);
    head.position.set(0, 0.11, 0.13);
    head.castShadow = true;
    this.group.add(head);
    this._head = head;

    // Ears (2 small discs)
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 4), earMat);
      ear.scale.set(1, 0.7, 0.3);
      ear.position.set(sx * 0.05, 0.17, 0.10);
      this.group.add(ear);
    }

    // Eyes (2 tiny red spheres)
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 4, 4), eyeMat);
      eye.position.set(sx * 0.035, 0.13, 0.19);
      this.group.add(eye);
    }

    // 4 legs (thin, splayed, scuttle via leg groups defined on the body)
    this._legs = [];
    const legMat = headMat;
    for (const [side, front] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      const pivot = new THREE.Group();
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.006, 0.10, 4), legMat);
      leg.position.y = -0.05;
      pivot.add(leg);
      pivot.position.set(side * 0.08, 0.10, front ? 0.13 : -0.11);
      pivot.rotation.x = 0.2;
      this.group.add(pivot);
      this._legs.push(pivot);
    }

    // Tapered segmented tail (whips in update) — 3 short cylinders.
    this._tail = [];
    const tailMat = headMat;
    let tx = 0, ty = 0.06, tz = -0.13;
    for (let i = 0; i < 3; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.01 - i * 0.0025, 0.008 - i * 0.002, 0.10, 4), tailMat);
      seg.position.set(tx, ty, tz);
      seg.rotation.x = 0.6 + i * 0.3;
      this.group.add(seg);
      this._tail.push(seg);
      tz -= 0.09; ty -= 0.01;
    }
  }

  setFacing(yaw) { this.facingYaw = yaw; }

  // Scuttle animation: alternate leg phases (a real run), head bob, tail whip.
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

    const t = this.animTime;
    const scuttle = Math.sin(t * 16 + this.phase);
    // Legs alternate front/rear on each side (diagonal gait).
    this._legs.forEach((leg, i) => {
      const front = (i === 0 || i === 1) ? 1 : -1; // front-ish vs rear-ish
      const side = (i % 2 === 0) ? 1 : -1;
      leg.rotation.x = 0.2 + front * (scuttle * 0.35) * (side > 0 ? 1 : -1);
    });
    // Body roll + head nod.
    this.body.rotation.z = scuttle * 0.15;
    this._head.position.y = 0.11 + Math.abs(Math.sin(t * 16 + this.phase)) * 0.02;
    // Tail whips (phase lag per segment).
    this._tail.forEach((seg, i) => {
      seg.rotation.x = 0.6 + i * 0.3 + Math.sin(t * 18 + this.phase + i * 1.2) * 0.35;
    });
    this.group.position.y = Math.abs(Math.sin(t * 10 + this.phase)) * 0.03;
    this.group.rotation.y = THREE.MathUtils.damp(this.group.rotation.y, this.facingYaw ?? 0, 10, dt);
    this._glowMat.opacity = 0.45 + Math.sin(t * 5 + this.phase) * 0.12;
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

// OrbSystem.js — drop-only orb economy: instant-credit orbs (1 s visual),
// health/buff pickups, pickup rings, death bursts (§16.5/§19)
import * as THREE from 'three';
import { DROP } from '../core/Constants.js';

export default class OrbSystem {
  constructor(scene) {
    this.scene = scene;
    this.visuals = [];   // pooled orb visuals {mesh, t}
    this.pickups = [];   // health/buff pickups {mesh, kind, pos}
    this.rings = [];     // pickup rings
    this.bursts = [];    // death bursts (3, purple)
    this.onBuffCollected = null; // wired by Game each level

    const geo = new THREE.SphereGeometry(0.12, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd75a });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      scene.add(m);
      this.visuals.push({ mesh: m, t: -1 });
    }
    const ringGeo = new THREE.TorusGeometry(0.35, 0.04, 6, 20);
    for (let i = 0; i < 8; i++) {
      const ring = new THREE.Mesh(ringGeo,
        new THREE.MeshBasicMaterial({ color: 0x9ecbe0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      this.rings.push({ mesh: ring, t: -1 });
    }
    // death bursts: 3 purple particle groups (Points)
    for (let i = 0; i < 3; i++) {
      const n = 10;
      const posArr = new Float32Array(n * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({
        color: 0xaa66ff, size: 0.1, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      pts.visible = false;
      pts.frustumCulled = false;
      scene.add(pts);
      this.bursts.push({ points: pts, t: -1, vel: new Float32Array(n * 3) });
    }
    this._nextVisual = 0; this._nextRing = 0; this._nextBurst = 0;
  }

  spawnOrb(x, y, z, credit) {
    // INSTANT credit — the visual is pure feedback (~DROP.VISUAL_LIFE)
    if (credit) credit();
    let slot = null;
    for (let k = 0; k < this.visuals.length; k++) {
      const v = this.visuals[(this._nextVisual + k) % this.visuals.length];
      if (v.t < 0 || v.t >= DROP.VISUAL_LIFE * 0.7) { slot = v; break; }
    }
    if (!slot) return;
    slot.t = 0;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y + 0.6, z);
    this._nextVisual = (this._nextVisual + 1) % this.visuals.length;
    this.spawnRing(x, z);
  }

  spawnHealth(x, z) {
    const m = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22),
      new THREE.MeshStandardMaterial({ color: 0xcc3333, emissive: 0x881111, emissiveIntensity: 0.8 }));
    m.position.set(x, 0.5, z);
    this.scene.add(m);
    this.pickups.push({ mesh: m, kind: 'health', pos: new THREE.Vector3(x, 0.5, z), bob: Math.random() * 6 });
  }

  spawnBuff(x, z) {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.24),
      new THREE.MeshStandardMaterial({ color: 0x44bbdd, emissive: 0x2288aa, emissiveIntensity: 1 }));
    m.position.set(x, 0.5, z);
    this.scene.add(m);
    this.pickups.push({ mesh: m, kind: 'buff', pos: new THREE.Vector3(x, 0.5, z), bob: Math.random() * 6 });
  }

  spawnRing(x, z) {
    const r = this.rings[this._nextRing];
    this._nextRing = (this._nextRing + 1) % this.rings.length;
    r.t = 0;
    r.mesh.visible = true;
    r.mesh.position.set(x, 0.1, z);
  }

  deathBurst(x, y, z) {
    const b = this.bursts[this._nextBurst];
    this._nextBurst = (this._nextBurst + 1) % this.bursts.length;
    b.t = 0;
    b.points.visible = true;
    b.points.material.opacity = 1;
    const pos = b.points.geometry.attributes.position.array;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      b.vel[i * 3] = (Math.random() - .5) * 4;
      b.vel[i * 3 + 1] = Math.random() * 3;
      b.vel[i * 3 + 2] = (Math.random() - .5) * 4;
    }
    b.points.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, playerPos) {
    for (const v of this.visuals) {
      if (v.t < 0) continue;
      v.t += dt;
      v.mesh.position.y += dt * 0.8; // bob upward
      if (v.t >= DROP.VISUAL_LIFE) { v.t = -1; v.mesh.visible = false; }
    }
    for (const r of this.rings) {
      if (r.t < 0) continue;
      r.t += dt;
      const k = r.t / 0.45;
      r.mesh.scale.setScalar(1 + k * 2);
      r.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { r.t = -1; r.mesh.visible = false; }
    }
    // auto-collect pickups within 1.4 u
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.bob += dt * 3;
      p.mesh.position.y = 0.5 + Math.sin(p.bob) * 0.15;
      p.mesh.rotation.y += dt * 2;
      const dx = p.pos.x - playerPos.x, dz = p.pos.z - playerPos.z;
      if (dx * dx + dz * dz < DROP.PICKUP_RADIUS ** 2 && Math.abs(playerPos.y - p.pos.y) < 2.2) {
        if (p.kind === 'health' && this.onHealth) this.onHealth();
        if (p.kind === 'buff' && this.onBuffCollected) this.onBuffCollected(p.pos.x, p.pos.z);
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose(); p.mesh.material.dispose();
        this.pickups.splice(i, 1);
        this.spawnRing(p.pos.x, p.pos.z);
      }
    }
    for (const b of this.bursts) {
      if (b.t < 0) continue;
      b.t += dt;
      const pos = b.points.geometry.attributes.position.array;
      for (let i = 0; i < pos.length / 3; i++) {
        pos[i * 3 + 1] += b.vel[i * 3 + 1] * dt;
        b.vel[i * 3 + 1] -= 6 * dt;
        pos[i * 3] += b.vel[i * 3] * dt;
        pos[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.points.material.opacity = Math.max(0, 1 - b.t / 0.6);
      if (b.t > 0.6) { b.t = -1; b.points.visible = false; }
    }
  }

  dispose(scene) {
    for (const v of this.visuals) { scene.remove(v.mesh); }
    for (const r of this.rings) scene.remove(r.mesh);
    for (const b of this.bursts) scene.remove(b.points);
    for (const p of this.pickups) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    this.visuals = []; this.rings = []; this.bursts = []; this.pickups = [];
  }
}

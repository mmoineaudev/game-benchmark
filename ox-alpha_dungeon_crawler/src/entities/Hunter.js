// Hunter.js — HUNTER buff companion: follow, LOS-targeted beam (§11)
import * as THREE from 'three';
import { HUNTER } from '../core/Constants.js';

export default class Hunter {
  constructor(scene) {
    this.pos = new THREE.Vector3(0, 0, 0);
    this.attackTimer = 0;
    this.beamFlash = 0;
    const mat = new THREE.MeshStandardMaterial({
      color: 0x88aaff, emissive: 0x4466cc, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.85
    });
    this.group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.0, 8), mat);
    body.position.y = 1.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat);
    head.position.y = 1.9;
    this.group.add(body, head);
    scene.add(this.group);
    this._mat = mat;
  }

  update(dt, playerPos, enemies, losFn, onHitEnemy, souls) {
    // follow at 6.5 u/s keeping 2.5 u
    const dx = playerPos.x - this.pos.x, dz = playerPos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > HUNTER.KEEP_DIST) {
      const step = Math.min(HUNTER.FOLLOW_SPEED * dt, d - HUNTER.KEEP_DIST);
      this.pos.x += (dx / d) * step;
      this.pos.z += (dz / d) * step;
    }
    this.group.position.set(this.pos.x, 0, this.pos.z);

    // attack nearest VISIBLE enemy within 7 u; interval 1.0/clamp(souls/100, .25, 5)
    this.attackTimer -= dt;
    if (this.beamFlash > 0) this.beamFlash -= dt;
    if (this.attackTimer <= 0) {
      let best = null, bestD = HUNTER.ATTACK_RANGE;
      for (const e of enemies) {
        if (!e.alive || e.state === 'DEAD' || e.frozen) continue;
        const dd = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (dd < bestD && losFn(this.pos.x, this.pos.z, e.pos.x, e.pos.z)) { bestD = dd; best = e; }
      }
      if (best) {
        onHitEnemy(best, HUNTER.BEAM_DMG);
        this.beamFlash = HUNTER.BEAM_FLASH;
        this.attackTimer = 1.0 / Math.min(5, Math.max(0.25, souls / 100));
      }
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

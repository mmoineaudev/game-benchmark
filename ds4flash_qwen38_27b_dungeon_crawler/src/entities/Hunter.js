// Hunter.js — HUNTER buff spectral companion (§11).
// HP 9999 (invulnerable). Follows the player at 6.5 u/s keeping 2.5 u.
// Attacks the nearest VISIBLE (LOS) enemy within 7 u with a 2-damage beam;
// interval = 1.0 / clamp(collectedOrbs/100, 0.25, 5). Beam flash 0.35 s.

import * as THREE from 'three';
import { HUNTER, ENEMY } from '../core/Constants.js';
import { circleHitsBox } from '../core/Collision.js';
import { makeGlow, makeSpriteGlow } from '../core/Materials.js';

const FOLLOW_SPEED = HUNTER.FOLLOW_SPEED;       // 6.5
const FOLLOW_DIST = HUNTER.FOLLOW_DISTANCE;     // 2.5
const ATTACK_RANGE = HUNTER.ATTACK_RANGE;       // 7
const BEAM_FLASH = HUNTER.BEAM_FLASH;           // 0.35 s

export class Hunter {
  /**
   * @param {THREE.Scene|THREE.Group} scene scene root
   * @param {object} opts
   *   opts.collectedOrbs  soul count (drives attack interval)
   *   opts.playerPos      initial player position {x,z}
   */
  constructor(scene, opts = {}) {
    this.scene = scene || null;
    this.hp = HUNTER.HP;            // 9999 — invulnerable
    this.alive = true;
    this._collectedOrbs = opts.collectedOrbs ?? 0;
    this._attackCd = 0;
    this._beamT = 0;                // beam flash timer
    this._animT = 0;

    this._geometries = [];
    this._materials = [];
    this._trackGeo = (g) => { this._geometries.push(g); return g; };
    this._trackMat = (m) => { this._materials.push(m); return m; };

    // Build a small spectral wisp rig.
    this.mesh = new THREE.Group();
    this.mesh.name = 'hunter';

    const glowMat = this._trackMat(makeGlow(0x88ddff, 1.6));
    const bodyMat = this._trackMat(makeGlow(0x4488cc, 1.2));
    const spriteMat = this._trackMat(makeSpriteGlow(0x88ddff));
    this._glowMat = glowMat;

    const core = new THREE.Mesh(this._trackGeo(new THREE.SphereGeometry(0.28, 12, 10)), bodyMat);
    core.name = 'core';
    core.position.y = 0.9;
    this.mesh.add(core);
    this.core = core;

    const eye = new THREE.Mesh(this._trackGeo(new THREE.SphereGeometry(0.09, 8, 6)), glowMat);
    eye.position.set(0, 1.0, 0.18);
    this.mesh.add(eye);

    const halo = new THREE.Sprite(spriteMat);
    halo.position.y = 0.9;
    halo.scale.set(1.1, 1.1, 1);
    this.mesh.add(halo);
    this.halo = halo;

    // Beam (thin stretched box), hidden until a shot lands.
    const beam = new THREE.Mesh(this._trackGeo(new THREE.BoxGeometry(0.08, 0.08, ATTACK_RANGE)), glowMat);
    beam.name = 'beam';
    beam.visible = false;
    beam.position.set(0, 0.9, -ATTACK_RANGE / 2); // points forward (-z)
    this.mesh.add(beam);
    this.beam = beam;

    const p0 = opts.playerPos || { x: 0, z: 0 };
    this.position = new THREE.Vector3(p0.x, 0, p0.z);
    this.mesh.position.set(p0.x, 0.4, p0.z); // hover slightly
    if (this.scene && this.scene.add) this.scene.add(this.mesh);
  }

  /** Update the soul count (changes the attack interval). */
  setCollectedOrbs(n) { this._collectedOrbs = n | 0; }

  /** Attack interval = 1.0 / clamp(collectedOrbs/100, 0.25, 5). */
  attackInterval() {
    const c = Math.max(HUNTER.INTERVAL_MIN, Math.min(HUNTER.INTERVAL_MAX, this._collectedOrbs / 100));
    return HUNTER.BASE_INTERVAL / c;
  }

  /**
   * True if the line from the hunter to (tx, tz) is clear of `boxes`.
   */
  hasLOS(tx, tz, boxes, grid) {
    const p = this.position;
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const steps = Math.ceil(d / ENEMY.LOS_STEP);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = p.x + dx * t, sz = p.z + dz * t;
      if (grid ? grid.circleHits(sx, sz, ENEMY.LOS_RADIUS)
               : (boxes && boxes.length &&
                  circleHitsBox(boxes, sx, sz, ENEMY.LOS_RADIUS))) return false;
    }
    return true;
  }

  /**
   * @param {number} dt delta seconds
   * @param {{x:number,z:number}} playerPos player position
   * @param {Array} enemies living enemies (each: {position|mesh, alive})
   * @param {Array<{minX,minZ,maxX,maxZ}>} collisionBoxes
   * @param {BoxGrid|null} [grid] optional shared spatial index
   */
  update(dt, playerPos, enemies = [], collisionBoxes = [], grid = null) {
    if (!this.alive) return;
    this._animT += dt;
    const p = this.position;

    // --- Follow: keep FOLLOW_DIST behind/around the player at FOLLOW_SPEED.
    const dx = playerPos.x - p.x, dz = playerPos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > FOLLOW_DIST) {
      const nx = dx / d, nz = dz / d;
      const step = Math.min(d - FOLLOW_DIST, FOLLOW_SPEED * dt);
      p.x += nx * step;
      p.z += nz * step;
    }
    // Face the target enemy (or the player) and hover.
    let target = this._acquireTarget(enemies, collisionBoxes, grid);
    if (target) {
      this._faceTarget(target, dt);
    } else if (d > 1e-3) {
      this._face({ x: playerPos.x, z: playerPos.z }, dt);
    }
    this.mesh.position.x = p.x;
    this.mesh.position.z = p.z;
    this.mesh.position.y = 0.4 + Math.sin(this._animT * 3) * 0.05;

    // --- Attack the nearest visible enemy within range.
    this._attackCd -= dt;
    if (target && this._attackCd <= 0) {
      this._fireBeam(target);
      this._attackCd = this.attackInterval();
    }

    // --- Beam flash decay.
    if (this._beamT > 0) {
      this._beamT -= dt;
      if (this._beamT <= 0) {
        this.beam.visible = false;
        this.beam.material.opacity = 1;
      }
    }
  }

  /** Nearest living enemy within ATTACK_RANGE with LOS. */
  _acquireTarget(enemies, boxes, grid) {
    let best = null, bestD = ATTACK_RANGE;
    const p = this.position;
    for (const e of enemies) {
      if (!e || !e.alive) continue;
      const ep = e.position || (e.mesh && e.mesh.position) || null;
      if (!ep) continue;
      const d = Math.hypot(ep.x - p.x, ep.z - p.z);
      if (d > bestD) continue;
      if (!this.hasLOS(ep.x, ep.z, boxes, grid)) continue;
      bestD = d;
      best = e;
    }
    return best;
  }

  /** Damage the target with the 2-damage beam (no i-frame on the hunter). */
  _fireBeam(target) {
    this._beamT = BEAM_FLASH;
    this.beam.visible = true;
    this.beam.material.opacity = 1;
    // Apply the 2-damage beam. Hunter is invulnerable; the target may or may
    // not have an hp/hit API.
    const dmg = HUNTER.DAMAGE;
    if (target && typeof target.hit === 'function') {
      target.hit(dmg);
    }
  }

  _faceTarget(e, dt) {
    const ep = e.position || (e.mesh && e.mesh.position);
    if (!ep) return;
    this._face({ x: ep.x, z: ep.z }, dt);
  }

  _face(t, dt) {
    const p = this.position;
    const yaw = Math.atan2(t.x - p.x, t.z - p.z);
    // Snap the spectral hunter's facing (fast turn, no smooth rate limit).
    this.mesh.rotation.y = yaw;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.scene && this.mesh.parent) this.scene.remove(this.mesh);
    else if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    this._geometries.length = 0;
    this._materials.length = 0;
  }
}

export default Hunter;

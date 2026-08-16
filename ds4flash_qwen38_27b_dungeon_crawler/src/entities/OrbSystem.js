// OrbSystem (§10, §13, §19, §25, §26)
// Drop-only orb economy: orbs come ONLY from kills/breakables — none are
// placed on the map. Credit is INSTANT on drop (`collectedOrbs++` is the one
// souls counter); the orb visual bobs for DROP.VISUAL_LIFE (1 s) as feedback,
// then vanishes. Health pickups (+3 hearts, capped at max via callback) and
// buff pickups (auto-collected within ENEMY.PICKUP_RADIUS, 1.4 u) ride the
// same pool machinery.
//
// Pools (§13): pickup rings (8, TTL 0.45 s), death bursts (3, purple).
// All graphics procedural (sphere meshes + additive sprite rings + point
// bursts); every three.js call is guarded so this imports & runs headless.

import * as THREE from 'three';
import { DROP, ENEMY, POOLS } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

const RING_TTL = POOLS.PICKUP_RING_TTL;        // 0.45 s
const BURST_TTL = 0.5;
const PICKUP_RADIUS = ENEMY.PICKUP_RADIUS;      // 1.4 u auto-collect
const BURST_PARTICLES = 3;                     // §13: death bursts = 3 (perf-cut)
const BURST_SPEED = 2.2;
const ORB_BALL_Y = 0.55;
const ORB_BALL_R = 0.09;

export class OrbSystem {
  /**
   * @param {THREE.Group} scene  scene root to attach visuals to
   * @param {object} opts
   *   opts.orbValue            orbs credited per drop (default 1)
   *   Callbacks (set by Game, all optional):
   *     onOrbCollected(x, z, value)   — orbs are credited INSTANTLY on drop;
   *                                     this fires on the drop for the credit.
   *     onHealthCollected(x, z)       — Game adds DROP.HEALTH_RESTORE, capped
   *                                     at max.
   *     onBuffCollected(x, z, effect) — buff pickup auto-collected (never-
   *                                     repeat handling lives in GameState).
   *     onDeathBurst(x, y, z)         — purple particle burst on enemy death.
   */
  constructor(scene, opts = {}) {
    this.scene = scene || null;
    this.orbValue = opts.orbValue ?? 1;

    this.onOrbCollected = opts.onOrbCollected || null;
    this.onHealthCollected = opts.onHealthCollected || null;
    this.onBuffCollected = opts.onBuffCollected || null;
    this.onDeathBurst = opts.onDeathBurst || null;

    this._disposed = false;
    this._clock = 0;
    this._glowTex = generateGlowTexture(); // may be null headless (null-safe)

    this._geometries = [];
    this._materials = [];
    this._trackMat = (m) => { this._materials.push(m); return m; };
    this._trackGeo = (g) => { this._geometries.push(g); return g; };

    // Shared orb ball geometry/material (procedural sphere, additive halo).
    this._orbGeo = this._trackGeo(new THREE.SphereGeometry(ORB_BALL_R, 10, 8));
    this._orbMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0xffd24a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this._healthGeo = this._trackGeo(new THREE.SphereGeometry(ORB_BALL_R * 1.15, 10, 8));
    this._healthMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0xff5566,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    this._buffGeo = this._trackGeo(new THREE.SphereGeometry(ORB_BALL_R * 1.25, 8, 6));
    this._buffMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0x77ccff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));

    // Active orb visuals (drop feedback, credit already applied).
    this.orbs = [];

    // Health pickups (auto-collect +3 hearts within 1.4 u).
    this.healthPickups = [];

    // Buff pickups (auto-collect within 1.4 u).
    this.buffPickups = [];

    // --- pickup rings pool (8, TTL 0.45 s) ---
    this._rings = [];
    this._ringIndex = 0;
    const ringGeo = this._trackGeo(new THREE.RingGeometry(0.32, 0.46, 20));
    for (let i = 0; i < POOLS.PICKUP_RINGS; i++) {
      const mat = this._trackMat(new THREE.MeshBasicMaterial({
        color: 0xffd24a,
        map: this._glowTex,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.05;
      mesh.visible = false;
      if (this.scene && this.scene.add) this.scene.add(mesh);
      this._rings.push({ mesh, t: 0, active: false });
    }

    // --- death bursts pool (3, purple particles) ---
    this._bursts = [];
    this._burstIndex = 0;
    for (let i = 0; i < POOLS.DEATH_BURSTS; i++) {
      const mat = this._trackMat(new THREE.PointsMaterial({
        color: 0x9955ff,
        size: 0.09,
        map: this._glowTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }));
      const geo = this._trackGeo(new THREE.BufferGeometry());
      const positions = new Float32Array(BURST_PARTICLES * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const pts = new THREE.Points(geo, mat);
      pts.visible = false;
      pts.frustumCulled = false;
      if (this.scene && this.scene.add) this.scene.add(pts);
      this._bursts.push({ points: pts, mat, life: 0, active: false,
        velocities: Array.from({ length: BURST_PARTICLES }, () => new THREE.Vector3()) });
    }
  }

  // ------------------------------------------------------------- drops
  /**
   * Drop an orb (kill/breakable/sarcophagus). Credits `value` orbs to the
   * single souls counter INSTANTLY, then spawns a visual that bobs for
   * DROP.VISUAL_LIFE (1 s) and vanishes.
   */
  dropOrb(x, y, z, value = 1) {
    if (this._disposed) return;
    value = Math.max(1, Math.round(value));
    if (this.onOrbCollected) this.onOrbCollected(x, z, value); // INSTANT credit
    this.orbs.push({ x, y: Math.max(0, y || 0), z, value, life: DROP.VISUAL_LIFE, phase: Math.random() * Math.PI * 2 });
    this._spawnRing(x, z, 0xffd24a);
  }

  /** Drop a health pickup: auto-collects +3 hearts (capped at max) within 1.4 u. */
  dropHealth(x, y, z) {
    if (this._disposed) return;
    this.healthPickups.push({ x, y: Math.max(0, y || 0), z, life: 8, phase: Math.random() * Math.PI * 2 });
  }

  /** Drop a buff pickup: auto-collected within 1.4 u (onBuffCollected). */
  dropBuff(x, y, z, effect) {
    if (this._disposed) return;
    this.buffPickups.push({ x, y: Math.max(0, y || 0), z, effect, life: 8, phase: Math.random() * Math.PI * 2 });
  }

  /** Purple particle burst at an enemy death (pool 3). */
  spawnDeathBurst(x, y, z) {
    if (this._disposed) return;
    const b = this._bursts[this._burstIndex];
    this._burstIndex = (this._burstIndex + 1) % this._bursts.length;
    b.active = true;
    b.life = BURST_TTL;
    b.points.visible = true;
    b.points.position.set(x, Math.max(0.1, y), z);
    const attr = b.points.geometry.getAttribute('position');
    for (let i = 0; i < BURST_PARTICLES; i++) {
      attr.setXYZ(i, 0, 0, 0);
      const v = b.velocities[i];
      v.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
        .normalize().multiplyScalar(BURST_SPEED * (0.6 + Math.random() * 0.6));
    }
    attr.needsUpdate = true;
    b.mat.opacity = 1;
    if (this.onDeathBurst) this.onDeathBurst(x, y, z);
  }

  _spawnRing(x, z, color) {
    const r = this._rings[this._ringIndex];
    this._ringIndex = (this._ringIndex + 1) % this._rings.length;
    r.active = true;
    r.t = RING_TTL;
    r.mesh.visible = true;
    r.mesh.position.set(x, 0.05, z);
    r.mesh.material.color.setHex(color);
    r.mesh.material.opacity = 0.9;
    r.mesh.scale.setScalar(0.4);
  }

  // ------------------------------------------------------------- update
  /**
   * @param {number} dt  frame delta (s)
   * @param {{x:number, y:number, z:number}} playerPos
   */
  update(dt, playerPos) {
    if (this._disposed) return;
    this._clock += dt;
    if (!playerPos) playerPos = { x: 0, y: 0, z: 0 };

    // Orb visuals: bob for VISUAL_LIFE then vanish (credit already applied).
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i];
      o.life -= dt;
      if (o.life <= 0) {
        this.orbs.splice(i, 1);
        continue;
      }
      o.y = Math.max(0, o.y) + Math.sin(this._clock * 3 + o.phase) * 0.004;
      // fade out during the last 25% of life
      if (o.life < DROP.VISUAL_LIFE * 0.25) o.fade = o.life / (DROP.VISUAL_LIFE * 0.25);
    }
    this._syncVisuals(this.orbs, this._orbGeo, this._orbMat, ORB_BALL_Y);

    // Health pickups: bob + auto-collect within 1.4 u.
    for (let i = this.healthPickups.length - 1; i >= 0; i--) {
      const h = this.healthPickups[i];
      h.life -= dt;
      if (h.life <= 0) { this.healthPickups.splice(i, 1); continue; }
      const dx = h.x - playerPos.x, dz = h.z - playerPos.z;
      if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
        this._spawnRing(h.x, h.z, 0xff5566);
        this.healthPickups.splice(i, 1);
        if (this.onHealthCollected) this.onHealthCollected(h.x, h.z);
        continue;
      }
    }
    this._syncVisuals(this.healthPickups, this._healthGeo, this._healthMat, ORB_BALL_Y + 0.08);

    // Buff pickups: bob + auto-collect within 1.4 u.
    for (let i = this.buffPickups.length - 1; i >= 0; i--) {
      const b = this.buffPickups[i];
      b.life -= dt;
      if (b.life <= 0) { this.buffPickups.splice(i, 1); continue; }
      const dx = b.x - playerPos.x, dz = b.z - playerPos.z;
      if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
        this._spawnRing(b.x, b.z, 0x77ccff);
        this.buffPickups.splice(i, 1);
        if (this.onBuffCollected) this.onBuffCollected(b.x, b.z, b.effect);
        continue;
      }
    }
    this._syncVisuals(this.buffPickups, this._buffGeo, this._buffMat, ORB_BALL_Y + 0.16);

    // Pickup rings: expand + fade over TTL.
    for (const r of this._rings) {
      if (!r.active) continue;
      r.t -= dt;
      if (r.t <= 0) { r.active = false; r.mesh.visible = false; continue; }
      const k = 1 - r.t / RING_TTL;
      r.mesh.scale.setScalar(0.4 + k * 0.9);
      r.mesh.material.opacity = 0.9 * (r.t / RING_TTL);
    }

    // Death bursts: drift particles up, fade.
    for (const b of this._bursts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.points.visible = false; continue; }
      const attr = b.points.geometry.getAttribute('position');
      for (let i = 0; i < BURST_PARTICLES; i++) {
        const v = b.velocities[i];
        v.y -= 1.5 * dt; // slight gravity
        attr.setXYZ(i, attr.getX(i) + v.x * dt, attr.getY(i) + v.y * dt, attr.getZ(i) + v.z * dt);
      }
      attr.needsUpdate = true;
      b.mat.opacity = Math.min(1, b.life / BURST_TTL);
    }
  }

  /**
   * Keep one mesh per entry in sync with the logical list. Reuses meshes in
   * place (index-aligned) so steady-state updates do no per-frame allocation.
   */
  _syncVisuals(list, geo, mat, baseY) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e._mesh) {
        const m = new THREE.Mesh(geo, mat);
        m.visible = false;
        if (this.scene && this.scene.add) this.scene.add(m);
        e._mesh = m;
      }
      const m = e._mesh;
      m.visible = true;
      const bob = Math.sin(this._clock * 3 + e.phase) * 0.05;
      m.position.set(e.x, baseY + Math.max(0, e.y) + bob, e.z);
      m.material.opacity = (typeof e.fade === 'number' && e.fade > 0)
        ? Math.min(1, e.fade) * 0.95 : 0.95;
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    const removeMeshes = (list) => {
      for (const e of list) {
        if (e._mesh) {
          e._mesh.visible = false;
          if (this.scene && this.scene.remove) this.scene.remove(e._mesh);
          e._mesh = null;
        }
      }
    };
    removeMeshes(this.orbs);
    removeMeshes(this.healthPickups);
    removeMeshes(this.buffPickups);
    this.orbs.length = 0;
    this.healthPickups.length = 0;
    this.buffPickups.length = 0;

    for (const r of this._rings) {
      r.active = false;
      r.mesh.visible = false;
      if (this.scene && this.scene.remove) this.scene.remove(r.mesh);
    }
    for (const b of this._bursts) {
      b.active = false;
      b.points.visible = false;
      if (this.scene && this.scene.remove) this.scene.remove(b.points);
    }
    this._rings.length = 0;
    this._bursts.length = 0;

    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) m.dispose();
    if (this._glowTex) this._glowTex.dispose();
    this._geometries = [];
    this._materials = [];
  }
}

export default OrbSystem;

// OrbShooter (§10, §13, §26, §27)
// The orb weapon. ONE collected orb = ONE 3-step sequence; ONE click = ONE
// step (aimed at the click-time camera direction).
//
//   steps 1–2  normal orbs — bounce up to ORB_WEAPON.BOUNCE_MAX (3) times off
//            floor/ceiling/walls, reflecting off the DOMINANT axis, then
//            fizzle on the next surface contact.
//   step 3     explosive — detonates on its FIRST contact with anything
//            (floor, ceiling, wall, prop, enemy, or life end).
//
// Ammo: only the FIRST step of a NEW sequence costs 1 orb (via spendOrb());
// steps 2–3 of an open sequence are free. 0 orbs → `fire()` returns 'no-orbs'
// and Game shows "No orbs! Slay skeletons to gather orbs" (once per dry-fire
// stretch). Hold LMB steps every STEP_INTERVAL (0.22 s); a sequence expires
// after SEQUENCE_WINDOW (1.2 s) without a step.
//
// Explosion (step 3): AOE round(5 × orbDamageMultiplier) to every enemy
// within EXPLODE_RADIUS (2 u), only if blast y < EXPLODE_Y_GATE (2.6).
// Orbs hit break breakables (and continue); enemy projectiles are NOT
// broken by orbs (sword only).
//
// Pools (§10/§27): 48 normal slots + 6 fireball slots in ONE round-robin
// allocator that FILTERS BY SLOT TYPE — a volley never spawns an orange
// fireball mid-sequence (and vice versa). Explosion rings: pool 8 (orb) /
// 6 (fireball). Fireball slot visuals carry no shot-trace sprite and use
// reduced emissive (2.2) + shorter explosion rings (0.22 s).
//
// Fireball module singletons (§27, binding): fireball materials + glow
// texture are built ONCE at module load (getFireballShared()), reused by
// every level, NEVER disposed — their GPU programs stay compiled, so
// activating or firing the buff never hitches mid-fight.
//
// Guard: this module must import headless (three + guarded glow texture).

import * as THREE from 'three';
import {
  ORB_WEAPON,
  WORLD,
  orbDamage,
  orbExplosionDamage,
} from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

// ---------------------------------------------------------------------------
// Fireball module singletons (§27) — built once, never disposed.
// ---------------------------------------------------------------------------

let _fireballShared = null;

/**
 * Fireball materials + glow texture as module-level singletons. Built ONCE
 * at first call, reused by every level, NEVER disposed — the GPU programs
 * stay compiled so the FIREBALL buff can be activated/fired mid-fight with
 * zero hitch (same pattern as the weapon). Do NOT move into per-level
 * ownership.
 */
export function getFireballShared() {
  if (_fireballShared) return _fireballShared;
  const core = new THREE.MeshStandardMaterial({
    color: 0xffb060,
    emissive: 0xff5510,
    emissiveIntensity: ORB_WEAPON.FIREBALL_EMISSIVE, // reduced emissive (2.2)
    roughness: 0.5,
    metalness: 0.1,
  });
  const glow = new THREE.SpriteMaterial({
    color: 0xff8833,
    map: generateGlowTexture(), // may be null headless (null-safe)
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // NO shot-trace sprite on fireball slots (perf cut, §10).
  _fireballShared = {
    core, glow,
    ringMat: new THREE.MeshBasicMaterial({
      color: 0xff7722,
      map: generateGlowTexture(),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  };
  return _fireballShared;
}

// ---------------------------------------------------------------------------
// Pool geometry (shared, disposed with the shooter — NOT the singletons)
// ---------------------------------------------------------------------------

const _projGeo = new THREE.SphereGeometry(ORB_WEAPON.RADIUS, 10, 8);
const _fireballProjGeo = new THREE.SphereGeometry(ORB_WEAPON.RADIUS * 0.7, 8, 6);
const _ringGeo = new THREE.RingGeometry(0.30, 0.44, 20);

const _tmpDir = new THREE.Vector3();
const _tmpNext = new THREE.Vector3();

export class OrbShooter {
  /**
   * @param {THREE.Group} scene  scene root for projectile/ring visuals
   * @param {object} opts
   *   opts.orbs                  souls counter at construction
   *   opts.getOrbs                () => current souls (re-read at fire time)
   *   opts.walls                  () => wall AABBs [{minX,minZ,maxX,maxZ}] or []
   *   opts.props                  () => prop collision AABBs (breakables hit
   *                                 via onBreakable, non-blocking for orbs)
   *   Callbacks (Game sets these):
   *     spendOrb()                — charge 1 orb; return truthy on success
   *     onOrbHit(x, y, z, dir, damage)      — direct-hit damage = round(2×mult)
   *     onOrbExplode(x, y, z, damage)       — step-3 AOE (y-gate applied here)
   *     onBreakableHit(x, y, z, normal)     — orb broke a breakable (continues)
   *     onProjectile(x, y, z)               — enemy projectile in flight
   *     onFireballProjectile(x, y, z)       — fireball in flight
   */
  constructor(scene, opts = {}) {
    this.scene = scene || null;
    this.orbs = opts.orbs ?? 0;
    this.getOrbs = opts.getOrbs || (() => this.orbs);
    this.walls = opts.walls || (() => []);
    this.props = opts.props || (() => []);

    this.spendOrb = opts.spendOrb || null;
    this.onOrbHit = opts.onOrbHit || null;
    this.onOrbExplode = opts.onOrbExplode || null;
    this.onBreakableHit = opts.onBreakableHit || null;
    this.onProjectile = opts.onProjectile || null;
    this.onFireballProjectile = opts.onFireballProjectile || null;

    this._disposed = false;
    this._fireballShared = getFireballShared(); // singleton, never disposed
    this._ownMats = [];
    this._ownGeos = [];

    // Sequence state (one orb = one 3-step sequence).
    this.step = 0;                 // 0 = no open sequence, 1..3 = steps fired
    this._lastStepAt = -Infinity;   // seconds (external clock) of last step
    this._sequenceOpen = false;
    this._holding = false;
    this._nextStepAt = 0;
    this._fireballCooldown = 0;

    // Buff state (FIREBALL = 2 per BUFF.EFFECTS).
    this._activeBuff = 0;

    // --- projectile pool: 48 normal + 6 fireball, round-robin by type ---
    this._pools = [];
    this._rrIndex = 0;
    for (let i = 0; i < ORB_WEAPON.POOL_SIZE; i++) this._pools.push(this._makeSlot(false));
    for (let i = 0; i < ORB_WEAPON.FIREBALL_POOL_SIZE; i++) this._pools.push(this._makeSlot(true));

    // --- explosion rings: 8 (orb) / 6 (fireball, shorter 0.22 s) ---
    this._orbRings = this._makeRingPool(ORB_WEAPON.EXPLOSION_RING_POOL, 0xffaa33, 0.30);
    this._fireballRings = this._makeRingPool(ORB_WEAPON.FIREBALL_RING_POOL, 0xff7722, ORB_WEAPON.FIREBALL_RING_TIME);
    this._orbRingIndex = 0;
    this._fireballRingIndex = 0;
    this._clockNow = 0;
  }

  // ------------------------------------------------------------- slots
  _makeSlot(isFireball) {
    const shared = this._fireballShared;
    let coreMat, glowMat;
    if (isFireball) {
      coreMat = shared.core;   // shared singletons — NOT disposed in dispose()
      glowMat = shared.glow;
    } else {
      coreMat = new THREE.MeshStandardMaterial({
        color: 0xffd24a,
        emissive: 0xffaa33,
        emissiveIntensity: 1.4,
        roughness: 0.4,
        metalness: 0.1,
      });
      this._ownMats.push(coreMat);
      glowMat = new THREE.SpriteMaterial({
        color: 0xffd24a,
        map: generateGlowTexture(),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this._ownMats.push(glowMat);
    }
    const mesh = new THREE.Mesh(isFireball ? _fireballProjGeo : _projGeo, coreMat);
    mesh.visible = false;
    mesh.castShadow = false;
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(isFireball ? FIREBALL_GLOW_SCALE : ORB_RADIUS_GLOW);
    glow.visible = false;
    if (this.scene && this.scene.add) {
      this.scene.add(mesh);
      this.scene.add(glow);
    }
    return {
      isFireball, mesh, glow,
      active: false,
      life: 0,
      bounces: 0,
      explosive: false,   // step 3 / fireball: detonate on first contact
      damage: 0,
      _next: _tmpNext,    // scratch (scratch reuse is safe: single-threaded)
    };
  }

  _makeRingPool(count, color, ttl) {
    const pool = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this._ownMats.push(mat);
      const mesh = new THREE.Mesh(_ringGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.06;
      mesh.visible = false;
      if (this.scene && this.scene.add) this.scene.add(mesh);
      pool.push({ mesh, mat, t: 0, ttl, active: false });
    }
    return pool;
  }

  // ------------------------------------------------------------- firing API
  /**
   * Begin (or hold) the 3-step sequence. Edge-driven per LMB press, or called
   * repeatedly while LMB is held; steps fire no faster than STEP_INTERVAL.
   * @returns 'ok' | 'no-orbs' | 'cooldown'
   *   'no-orbs' → Game shows "No orbs! Slay skeletons to gather orbs"
   *   (once per dry-fire stretch; resets after a successful shot).
   */
  fire(direction, origin, now = 0) {
    if (this._disposed) return 'cooldown';
    if (now < this._nextStepAt) return 'cooldown';

    // Open a new sequence: cost 1 orb. Steps 2–3 of an open sequence are free.
    if (!this._sequenceOpen || this.step >= 3 || now - this._lastStepAt > ORB_WEAPON.SEQUENCE_WINDOW) {
      this._sequenceOpen = true;
      this.step = 1;
      const orbs = this.getOrbs();
      if (orbs <= 0) {
        this._sequenceOpen = false;
        this.step = 0;
        return 'no-orbs';
      }
      if (this.spendOrb) {
        const ok = this.spendOrb();
        if (!ok) {
          this._sequenceOpen = false;
          this.step = 0;
          return 'no-orbs';
        }
      }
    } else {
      // continuing: advance to next step; expire if window elapsed
      if (now - this._lastStepAt > ORB_WEAPON.SEQUENCE_WINDOW) {
        this._sequenceOpen = false;
        this.step = 0;
        return 'no-orbs'; // stale window → needs a fresh orb
      }
      this.step = Math.min(3, this.step + 1);
    }

    const step = this.step;
    const explosive = (step === 3);
    const direct = orbDamage(this.getOrbs());
    const aoe = orbExplosionDamage(this.getOrbs());

    const slot = this._alloc(false);
    if (!slot) return 'cooldown'; // pool exhausted — retry next frame
    this._launch(slot, origin, direction, explosive, direct, aoe);

    this._lastStepAt = now;
    this._nextStepAt = now + ORB_WEAPON.STEP_INTERVAL;
    // sequence closes after step 3 fires
    if (step === 3) { this._sequenceOpen = false; this.step = 0; }
    return 'ok';
  }

  /**
   * FIREBALL buff (RMB): free fiery projectile, explodes on FIRST contact.
   * No ammo cost. Cooldown FIREBALL_COOLDOWN (0.35 s) while the buff is held.
   */
  fireFireball(direction, origin, now = 0) {
    if (this._disposed) return false;
    if (this._activeBuff !== 2) return false; // only while FIREBALL active
    if (now < this._fireballCooldown) return false;
    const slot = this._alloc(true);
    if (!slot) return false;
    this._launch(slot, origin, direction, true,
      orbDamage(this.getOrbs()), orbExplosionDamage(this.getOrbs()));
    this._fireballCooldown = now + ORB_WEAPON.FIREBALL_COOLDOWN;
    return true;
  }

  /** Buff state (0 none, 1 BRIGHT, 2 FIREBALL, 3 EMPOWERED, 4 GODSPEED, 5 HUNTER). */
  setActiveBuff(buff) {
    this._activeBuff = buff || 0;
    if (this._activeBuff !== 2) this._fireballCooldown = 0;
  }

  /** Round-robin allocator FILTERED BY SLOT TYPE (§27): a volley never
   *  spawns an orange fireball mid-sequence (or vice versa). */
  _alloc(isFireball) {
    const n = this._pools.length;
    for (let i = 0; i < n; i++) {
      const idx = (this._rrIndex + i) % n;
      const slot = this._pools[idx];
      if (slot.isFireball !== isFireball) continue; // FILTER by slot type
      if (!slot.active) {
        this._rrIndex = (idx + 1) % n;
        return slot;
      }
    }
    return null;
  }

  _launch(slot, origin, direction, explosive, direct, aoe) {
    const dir = _tmpDir.copy(direction);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
    dir.normalize();
    const mesh = slot.mesh;
    mesh.visible = true;
    mesh.position.copy(origin).addScaledVector(dir, 0.6); // spawn just ahead
    slot.glow.visible = true;
    slot.glow.position.copy(mesh.position);
    slot.active = true;
    slot.explosive = explosive;
    slot.life = ORB_WEAPON.LIFETIME;
    slot.bounces = 0;
    slot.damage = direct;
    slot._aoe = aoe;
    slot._dir = dir.clone();
    if (slot.isFireball) {
      if (this.onFireballProjectile) this.onFireballProjectile(
        mesh.position.x, mesh.position.y, mesh.position.z);
    } else {
      if (this.onProjectile) this.onProjectile(
        mesh.position.x, mesh.position.y, mesh.position.z);
    }
  }

  // ------------------------------------------------------------- update
  /**
   * @param {number} dt        frame delta (s)
   * @param {THREE.Vector3|{x,y,z}} origin  shooter origin (camera/eye)
   * @param {THREE.Vector3|{x,y,z}} forward aim direction (for API symmetry;
   *                                 steps are aimed at click time)
   */
  update(dt, origin, forward) {
    if (this._disposed) return;
    if (dt <= 0) {
      this._ageRings(this._orbRings, 0);
      this._ageRings(this._fireballRings, 0);
      return;
    }
    this._clockNow += dt;

    // Sequence expiry (1.2 s without a step closes the sequence).
    if (this._sequenceOpen && this.step < 3 &&
        (this._clockNow - this._lastStepAt) > ORB_WEAPON.SEQUENCE_WINDOW) {
      this._sequenceOpen = false;
      this.step = 0;
    }

    const speed = ORB_WEAPON.SPEED;
    for (const slot of this._pools) {
      if (!slot.active) continue;
      slot.life -= dt;
      const mesh = slot.mesh;
      const p = mesh.position;
      const dir = slot._dir;

      // substep to reduce tunneling (speed 12.4 × dt)
      const stepDist = speed * dt;
      const substeps = Math.max(1, Math.ceil(stepDist / 0.25));
      const sub = stepDist / substeps;
      let contact = null; // 'floor' | 'ceiling' | 'wall' | 'enemy' | 'prop' | 'life'

      for (let s = 0; s < substeps && !contact; s++) {
        _tmpNext.copy(p).addScaledVector(dir, sub);
        p.copy(_tmpNext);
        contact = this._checkContact(slot, p);
      }
      if (!contact) contact = slot.life <= 0 ? 'life' : null;
      if (!contact) {
        slot.glow.position.copy(p);
        continue;
      }

      // Resolve contact.
      if (slot.explosive) {
        // Step 3 / fireball: detonate on FIRST contact with anything.
        this._explode(slot);
      } else if (slot.bounces < ORB_WEAPON.BOUNCE_MAX) {
        // Normal orb: reflect off the DOMINANT axis.
        const ok = this._bounce(slot, contact);
        if (!ok) this._fizzle(slot);
      } else {
        // Bounce budget spent: fizzle on the next surface contact.
        this._fizzle(slot);
      }
    }

    this._ageRings(this._orbRings, dt);
    this._ageRings(this._fireballRings, dt);
  }

  /** Classify what the projectile head just touched (or null). */
  _checkContact(slot, p) {
    // floor
    if (p.y <= WORLD.FLOOR_Y + 0.001) return 'floor';
    // ceiling (wall-height ceiling plane)
    const ceilY = (this._ceilingY != null) ? this._ceilingY : 20;
    if (p.y >= ceilY) return 'ceiling';
    // walls (AABBs)
    const walls = this.walls();
    for (let i = 0; i < walls.length; i++) {
      const b = walls[i];
      const r = ORB_WEAPON.RADIUS;
      if (p.x - r < b.maxX && p.x + r > b.minX &&
          p.z - r < b.maxZ && p.z + r > b.minZ) return 'wall';
    }
    // props / breakables (orbs break them AND continue — non-blocking)
    const props = this.props();
    for (let i = 0; i < props.length; i++) {
      const b = props[i];
      const r = ORB_WEAPON.RADIUS;
      if (p.x - r < b.maxX && p.x + r > b.minX &&
          p.z - r < b.maxZ && p.z + r > b.minZ) {
        if (this.onBreakableHit) this.onBreakableHit(p.x, p.y, p.z);
        // continue (do NOT stop); still counts as a contact for step 3
        return 'prop';
      }
    }
    return null;
  }

  /**
   * Reflect off the dominant axis of the contact. Returns true if the bounce
   * was applied (projectile continues), false if it should fizzle.
   */
  _bounce(slot, contact) {
    const dir = slot._dir;
    let reflected = false;
    if (contact === 'floor' || contact === 'ceiling') {
      dir.y = -dir.y;
      if (contact === 'floor') slot.mesh.position.y = WORLD.FLOOR_Y + 0.01;
      reflected = true;
    } else if (contact === 'wall') {
      // reflect off the dominant horizontal axis (the one the velocity is
      // most aligned with)
      const adx = Math.abs(dir.x), adz = Math.abs(dir.z);
      if (adx >= adz) dir.x = -dir.x; else dir.z = -dir.z;
      reflected = true;
    }
    // 'enemy' / 'prop' on a normal orb: direct-hit damage, then continue.
    if (contact === 'enemy' && this.onOrbHit) {
      const p = slot.mesh.position;
      this.onOrbHit(p.x, p.y, p.z, dir.clone(), slot.damage);
    }
    slot.bounces += (contact === 'floor' || contact === 'ceiling' || contact === 'wall') ? 1 : 0;
    return reflected && slot.bounces <= ORB_WEAPON.BOUNCE_MAX;
  }

  _fizzle(slot) {
    slot.active = false;
    slot.mesh.visible = false;
    slot.glow.visible = false;
  }

  _explode(slot) {
    const p = slot.mesh.position;
    const aoe = slot._aoe ?? slot.damage;
    // Explosion height gate (§26): AOE only when blast point y < 2.6.
    if (p.y < ORB_WEAPON.EXPLODE_Y_GATE && this.onOrbExplode) {
      this.onOrbExplode(p.x, p.y, p.z, aoe);
    }
    this._spawnExplosionRing(p.x, p.y, p.z, slot.isFireball);
    slot.active = false;
    slot.mesh.visible = false;
    slot.glow.visible = false;
  }

  _spawnExplosionRing(x, y, z, isFireball) {
    const pool = isFireball ? this._fireballRings : this._orbRings;
    const idx = isFireball
      ? (this._fireballRingIndex = (this._fireballRingIndex + 1) % pool.length)
      : (this._orbRingIndex = (this._orbRingIndex + 1) % pool.length);
    const r = pool[idx];
    r.active = true;
    r.t = r.ttl;
    r.mesh.visible = true;
    r.mesh.position.set(x, Math.max(0.06, y), z);
    r.mesh.scale.setScalar(0.4);
    r.mat.opacity = 0.9;
  }

  _ageRings(pool, dt) {
    for (const r of pool) {
      if (!r.active) continue;
      r.t -= dt;
      if (r.t <= 0) { r.active = false; r.mesh.visible = false; continue; }
      const k = 1 - r.t / r.ttl;
      r.mesh.scale.setScalar(0.4 + k * (r.ttl === ORB_WEAPON.FIREBALL_RING_TIME ? 1.2 : 1.8));
      r.mat.opacity = 0.9 * (r.t / r.ttl);
    }
  }

  // ------------------------------------------------------------- dispose
  /**
   * Dispose projectile meshes/geometries we OWN (per-level). The fireball
   * singletons (core/glow materials + their glow textures) are NEVER
   * disposed — they are module-level and must stay compiled across levels
   * (§27).
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    for (const slot of this._pools) {
      slot.active = false;
      slot.mesh.visible = false;
      slot.glow.visible = false;
      if (slot.isFireball) continue; // shared — do NOT dispose
      // per-level normal slot materials (geometry is module-shared)
      for (const m of [slot.mesh.material, slot.glow.material]) {
        if (m && m.dispose) m.dispose();
      }
      if (this.scene && this.scene.remove) {
        this.scene.remove(slot.mesh);
        this.scene.remove(slot.glow);
      }
    }
    for (const pool of [this._orbRings, this._fireballRings]) {
      for (const r of pool) {
        r.active = false;
        r.mesh.visible = false;
        r.mat.dispose();
        if (this.scene && this.scene.remove) this.scene.remove(r.mesh);
      }
    }
    for (const m of this._ownMats) if (m.dispose) m.dispose();
    this._ownMats = [];
    this._ownGeos = [];
    // NOTE: this._fireballShared is intentionally NOT disposed (§27).
  }
}

// Glow sprite scale (fireball slots use reduced footprint, §10).
const ORB_RADIUS_GLOW = ORB_WEAPON.RADIUS * 2.2;
const FIREBALL_GLOW_SCALE = ORB_WEAPON.RADIUS * 1.6;

export default OrbShooter;

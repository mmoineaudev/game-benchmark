// Skeleton.js — BASE enemy: procedural skeleton rig + shared AI state machine (§15, §16.2).
//
// Also used for Magician (type 'MAGICIAN') with a red-orb ranged variant.
// All variants (Armored/Archer/Rat/Brute/Wraith) extend this class; spawning
// is done through the static factory `Skeleton.forType(type, scene, opts)`.
//
// Rig: named bones root / ribcage / head / armL / armR / forearmL / forearmR /
// legL / legR / shinL / shinR as a THREE.Group hierarchy of thin box/cylinder
// segments. Pose keyframes are driven by a state machine DORMANT/WAKING/CHASE/ATTACK/DEAD.
//
// FRAGILE: WAKING pose only keys head/armL/armR. forearmL/R, legL/R, shinL/R keep
// bind-pose rotations during the 0.9 s wake transition. If the state machine stalls
// in WAKING, those limbs appear missing/static. See _applyPose() and §6 below.
//
// Movement: sub-stepped at ≤0.08 u per step, resolved against collision AABBs.
// Phasing types (Wraith) skip collision and pathing and fly straight.
//
// Attack cycle: windup → swing → recover → cooldown. Hit lands at swing progress ≥ 0.35
// via `this.onAttackHit(this)` (Game resolves damage, i-frames). Ranged types fire
// a projectile via `this.onProjectile` at the same moment.
//
// Death: hp ≤ 0 → alive=false, state=DEAD → corpse hold 0.15 s → fade 0.45 s →
// mesh.visible=false → dispose(). `this.onDeath` fires IMMEDIATELY at the moment
// hp hits 0 (not at fade end). _deathFired guard ensures it fires exactly once.
//
// CALLBACK CONTRACT: onDeath/onAttackHit/onProjectile are set by _spawnMob() and
// MUST NOT be overwritten. If a system needs to observe kills, wrap the existing
// callback rather than replacing it.
//
// FIXED 2026-08-21: _updateDeath() previously set _disposed=true before dispose(),
// which short-circuited dispose()'s guard and left meshes in the scene. dispose()
// now runs first; its internal guard handles idempotency.
//
// §6 Fragility register
// - DEAD pose assumes all 12 bone groups exist. A subclass that removes a bone must
//   also prune POSES[DEAD] or _applyPose() will skip that bone silently (no crash).
// - _updateDeath fades ALL tracked materials. If a subclass adds a non-fadeable
//   material, it will be dimmed too. Track fadeable materials separately to fix.
// - hit() sets _deathFired=true BEFORE calling onDeath. If onDeath ever becomes
//   async, the guard must be rethought.

import * as THREE from 'three';
import { ENEMY } from '../core/Constants.js';
import { resolveCircleCollisions, circleHitsBox } from '../core/Collision.js';
import { makeBone, makeGlow, makeSpriteGlow } from '../core/Materials.js';

// NOTE: variant modules (enemies/*) are imported at the BOTTOM of this file,
// after the Skeleton class is fully initialized, to avoid a circular-import
// TDZ error (the variants `extends Skeleton` and import it back).

const STEP = ENEMY.STEP_SLIVER;            // 0.08 u sub-step
const RADIUS = ENEMY.RADIUS;               // 0.35 circle
const SWING_HIT = ENEMY.SWING_HIT_PROGRESS; // 0.35
const LOS_STEP = ENEMY.LOS_STEP;           // 0.4
const LOS_RADIUS = ENEMY.LOS_RADIUS;       // 0.25
const PATH_REEVAL = ENEMY.PATH_REEVAL_MS / 1000; // 0.3 s
const LOS_REEVAL = 0.15;                  // LOS raycast re-check interval (perf)
const DEATH_HOLD = 0.15;
const DEATH_FADE = 0.45;                   // hold + fade ≈ 0.6 s
const FLEE_SPEED_MULT = 1.15;

// Pose state names
const DORMANT = 'DORMANT';
const WAKING = 'WAKING';
const CHASE = 'CHASE';
const ATTACK = 'ATTACK';
const DEAD = 'DEAD';

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Pose keyframes: {phase, bone: rotation} with bone = {x,y,z} euler angles.
// Legs swing in x (pitch), arms swing in z (lateral swing) + x for raises.
// ---------------------------------------------------------------------------
const POSES = {
  [DORMANT]: {
    phase: 1.6, // slow idle sway
    bones: {
      armL:  { x: -0.06, z: 0.12 },
      armR:  { x: -0.06, z: -0.12 },
      legL:  { x: 0.03 },
      legR:  { x: -0.03 },
    },
  },
  [WAKING]: {
    phase: 0.9,
    bones: {
      head:  { x: -0.25 }, // head up, noticing
      armL:  { x: -0.2, z: 0.2 },
      armR:  { x: -0.2, z: -0.2 },
    },
  },
  [CHASE]: {
    phase: 0.55, // walk cadence
    bones: {
      armL:  { x: 0.5, z: 0.14 },
      armR:  { x: -0.5, z: -0.14 },
      forearmL: { x: -0.3 },
      forearmR: { x: -0.3 },
      legL:  { x: -0.6 },
      legR:  { x: 0.6 },
      head:  { x: -0.08 },
    },
  },
  [ATTACK]: {
    // keyframe progress t ∈ [0,1]: 0 = windup (arms back), 0.5 = full swing
    // (arms forward), 1 = recover (arms settle).
    bones: {
      armL:  { x: -1.9 },
      armR:  { x: -1.9 },
      forearmL: { x: -0.4 },
      forearmR: { x: -0.4 },
      head:  { x: -0.2 },
    },
  },
  [DEAD]: {
    bones: {
      head:  { x: 0.9 },
      ribcage: { x: 0.5 },
      armL:  { x: 0.8, z: 0.6 },
      armR:  { x: 0.8, z: -0.6 },
      forearmL: { x: 1.0 },
      forearmR: { x: 1.0 },
      legL:  { x: 0.9 },
      legR:  { x: 0.7 },
      shinL: { x: 0.4 },
      shinR: { x: 0.4 },
      root:  { y: 0.4 }, // topple
    },
  },
};

/**
 * Lerp two bone-pose tables; `t` is 0..1. Returns {bone: {x,y,z}}.
 */
function mixPose(a, b, t) {
  const out = {};
  const keys = new Set([...Object.keys(a.bones), ...Object.keys(b.bones)]);
  for (const k of keys) {
    const A = a.bones[k] || { x: 0, y: 0, z: 0 };
    const B = b.bones[k] || { x: 0, y: 0, z: 0 };
    out[k] = {
      x: A.x + (B.x - A.x) * t,
      y: A.y + (B.y - A.y) * t,
      z: A.z + (B.z - A.z) * t,
    };
  }
  return out;
}

// Perf: precomputed per-state bone key lists + the CHASE↔ATTACK union, so the
// per-frame _applyPose() never allocates (no Object.entries / Set / closures).
const POSE_KEYS = {};
for (const s of Object.keys(POSES)) POSE_KEYS[s] = Object.keys(POSES[s].bones);
const MIX_KEYS_CHASE_ATTACK = [...new Set([...POSE_KEYS[CHASE], ...POSE_KEYS[ATTACK]])];
const POSE_STATES = Object.keys(POSES);
const ZERO_ROT = { x: 0, y: 0, z: 0 };
// Counter-swing pairs in fixed order (armL↔armR, legL↔legR).
const COUNTER_KEYS = ['armL', 'armR', 'legL', 'legR'];
const COUNTER_OTHER = ['armR', 'armL', 'legR', 'legL'];

export class Skeleton {
  /**
   * @param {THREE.Scene|THREE.Group} scene scene root to attach the rig to
   * @param {object} opts
   *   type            'SKELETON' | 'MAGICIAN' (base rig handles both)
   *   hp, speed, damage, range
   *   cycle           {windup, swing, recover, cooldown}
   *   elite           boolean
   *   attackSpeedMult multiplier on cycle durations (÷ shorter = faster)
   *   moveSpeedMult   multiplier on speed
   *   colors          {body, glow} optional tints
   *   scale           optional rig scale (Ogre ×1.9)
   * Callbacks (Game sets, all optional):
   *   onDeath(enemy)             — credit orbs + 15% health roll + burst
   *   onAttackHit(enemy)         — melee hit landed (swing progress ≥ 0.35)
   *   onProjectile(opts)         — ranged fire: {x,z,dx,dz,life,speed,radius,damage,kind}
   */
  constructor(scene, opts = {}) {
    this.scene = scene || null;
    this.type = opts.type || 'SKELETON';
    this.isElite = !!opts.elite;
    this.facing = 0; // yaw facing (radians)
    this.radius = RADIUS;
    this.alive = true;
    this.state = DORMANT;
    this.wakeTimer = 0;      // dormant→waking delay
    this.fleeing = false;    // set true by Game while BRIGHT is active

    const cycle = opts.cycle || { windup: 0.35, swing: 0.25, recover: 0.4, cooldown: 1.2 };
    const asMult = opts.attackSpeedMult || 1;
    this.cycle = {
      windup: cycle.windup / asMult,
      swing: cycle.swing / asMult,
      recover: cycle.recover / asMult,
      cooldown: cycle.cooldown / asMult,
    };
    this.moveSpeedMult = opts.moveSpeedMult || 1;
    this.speed = (opts.speed || 2.6) * this.moveSpeedMult;
    this.damage = opts.damage ?? 1;
    this.range = opts.range ?? 1.6;
    this.cooldown = 0;
    this.drops = opts.drops ?? 1;

    this.hp = Math.max(1, Math.ceil(opts.hp ?? 2));
    this.maxHp = this.hp;

    this.onDeath = null;
    this.onAttackHit = null;
    this.onProjectile = null;

    // Attack cycle bookkeeping
    this._phase = 'cd';      // 'cd' | 'windup' | 'swing' | 'recover'
    this._phaseT = 0;
    this._hitFired = false;
    this._fired = false;

    // Pathing bookkeeping
    this._path = [];
    this._pathT = 0;         // time since last path eval
    this._stuckT = 0;        // time spent without progress

    // Death bookkeeping
    this._deathT = 0;
    this._deathFired = false;

    // Pose animation
    this._animT = Math.random() * 10;
    // LOS time-gating (hasLOS): re-evaluate the sightline at most every
    // LOS_REEVAL s; between checks reuse `_losVerdict`.
    this._losNext = 0;
    this._losVerdict = true;
    this._spawnTimer = 0;     // invincible + no-collision grace after spawn

    // Ranged config (magician / archer variants override)
    this.projectileKind = null;   // 'orb' | 'arrow'
    this.projectileCfg = null;    // {speed, life, radius, damage, stopDistance}
    this.fanCount = 1;
    this.fanHalfAngle = 0;

    // Phasing types: straight flight, no pathing/LOS/wall block
    this.phases = !!opts.phases;

    this._materials = [];
    this._geometries = [];
    this._trackMat = (m) => { this._materials.push(m); return m; };
    this._trackGeo = (g) => { this._geometries.push(g); return g; };

    // ------------------------------------------------------------------
    // Build the procedural rig
    // ------------------------------------------------------------------
    this.mesh = new THREE.Group();
    this.mesh.name = `enemy-${this.type}`;

    const colors = opts.colors || {};
    const boneMat = this._trackMat(makeBone(11));
    boneMat.color.set(colors.body ?? 0xd8d2c0);
    const glowMat = this._trackMat(makeGlow(colors.glow ?? 0xffd24a, 1.2));
    const spriteMat = this._trackMat(makeSpriteGlow(colors.glow ?? 0xffd24a));
    this._boneMat = boneMat;
    this._glowMat = glowMat;
    // Hit-flash feedback: white emissive pop on the bone material the instant a
    // hit lands. makeBone returns a FRESH material per skeleton, so mutating
    // its emissive is per-instance (no cross-enemy bleed). Base emissive is 0.
    this._hitFlashT = 0;
    this._HIT_FLASH_MAX = 0.12;

    const box = (w, h, d) => {
      const g = this._trackGeo(new THREE.BoxGeometry(w, h, d));
      return new THREE.Mesh(g, boneMat);
    };
    const cyl = (r1, r2, h, seg = 6) => {
      const g = this._trackGeo(new THREE.CylinderGeometry(r1, r2, h, seg));
      return new THREE.Mesh(g, boneMat);
    };

    const root = new THREE.Group();
    root.name = 'root';
    this.mesh.add(root);

    // --- ribcage (torso): spine cylinder + 4 thin rib boxes ---
    const ribcage = new THREE.Group();
    ribcage.name = 'ribcage';
    ribcage.position.y = 0.62;
    root.add(ribcage);

    const spine = cyl(0.05, 0.06, 0.55, 5);
    spine.name = 'spine';
    spine.position.y = 0.2;
    ribcage.add(spine);
    for (let i = 0; i < 4; i++) {
      const rib = box(0.34 - i * 0.03, 0.03, 0.045);
      rib.position.y = 0.05 + i * 0.11;
      rib.rotation.y = 0.08 * (i - 1.5); // slight twist
      ribcage.add(rib);
    }
    const sternum = box(0.04, 0.3, 0.04);
    sternum.position.set(0, 0.2, 0.16);
    ribcage.add(sternum);

    // --- head: skull (box) + eye glow ---
    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = 0.56;
    ribcage.add(head);

    const skull = box(0.22, 0.2, 0.2);
    skull.position.y = 0.1;
    head.add(skull);
    const jaw = box(0.18, 0.05, 0.05);
    jaw.position.set(0, -0.02, 0.06);
    head.add(jaw);
    const eyeL = new THREE.Mesh(this._trackGeo(new THREE.BoxGeometry(0.04, 0.04, 0.02)), glowMat);
    eyeL.position.set(-0.055, 0.11, 0.105);
    head.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.055;
    head.add(eyeR);

    // --- arms: upper arm + forearm (shoulders on ribcage) ---
    const makeArm = (side) => {
      const arm = new THREE.Group();
      arm.name = side === 'L' ? 'armL' : 'armR';
      arm.position.set(0.22 * (side === 'L' ? 1 : -1), 0.42, 0);
      ribcage.add(arm);
      const upper = cyl(0.04, 0.035, 0.3, 5);
      upper.position.y = -0.15;
      arm.add(upper);
      const forearm = new THREE.Group();
      forearm.name = side === 'L' ? 'forearmL' : 'forearmR';
      forearm.position.y = -0.3;
      arm.add(forearm);
      const fore = cyl(0.032, 0.025, 0.26, 5);
      fore.position.y = -0.13;
      forearm.add(fore);
      const hand = box(0.07, 0.09, 0.07);
      hand.position.y = -0.3;
      forearm.add(hand);
      return { arm, forearm };
    };
    const { arm: armL, forearm: forearmL } = makeArm('L');
    const { arm: armR, forearm: forearmR } = makeArm('R');

    // --- legs: thigh + shin (hips on root) ---
    const makeLeg = (side) => {
      const leg = new THREE.Group();
      leg.name = side === 'L' ? 'legL' : 'legR';
      leg.position.set(0.12 * (side === 'L' ? 1 : -1), 0.02, 0);
      root.add(leg);
      const thigh = cyl(0.05, 0.04, 0.28, 5);
      thigh.position.y = -0.14;
      leg.add(thigh);
      const shin = new THREE.Group();
      shin.name = side === 'L' ? 'shinL' : 'shinR';
      shin.position.y = -0.28;
      leg.add(shin);
      const sh = cyl(0.035, 0.025, 0.26, 5);
      sh.position.y = -0.13;
      shin.add(sh);
      const foot = box(0.09, 0.04, 0.16);
      foot.position.set(0, -0.28, 0.04);
      shin.add(foot);
      return { leg, shin };
    };
    const { leg: legL, shin: shinL } = makeLeg('L');
    const { leg: legR, shin: shinR } = makeLeg('R');

    // --- spectral halo (additive sprite, fade-friendly) ---
    const halo = new THREE.Sprite(spriteMat);
    halo.name = 'halo';
    halo.position.y = 0.9;
    halo.scale.set(0.9, 0.9, 1);
    this.mesh.add(halo);

    this.bones = {
      root, ribcage, head,
      armL, armR, forearmL, forearmR,
      legL, legR, shinL, shinR,
    };
    // Store baseline (bind) rotations — all groups are built un-rotated.
    this._boneBases = {};
    for (const [name, node] of Object.entries(this.bones)) {
      this._boneBases[name] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
    }
    this.halo = halo;

    // --- HP bar sprite (hidden by default, shown on hit) ---
    this._hpBarSprite = null;
    this._hpBarCanvas = null;
    this._hpBarCtx = null;
    this._hpBarDirty = true;
    this._hpBarVisible = false;
    this._lastHpFrac = 1;

    const scale = opts.scale || 1;
    this.mesh.scale.setScalar(scale);

    // Position + Box3 grounding: feet rest at y 0.
    const pos = opts.position || { x: 0, z: 0 };
    this.mesh.position.set(pos.x, 0, pos.z);
    if (this.scene && this.scene.add) this.scene.add(this.mesh);
    // Compute the grounding offset ONCE while the mesh is at the origin
    // (bind pose, feet at local -0.58). ground() re-applies this constant
    // afterwards — idempotent, no per-call Box3, no per-call sink.
    const bindBox = new THREE.Box3().setFromObject(this.mesh);
    this._groundOffset = -bindBox.min.y;
    this.mesh.position.y = this._groundOffset;
    this.facing = opts.facing || 0;
    this.mesh.rotation.y = this.facing;
    this.position = new THREE.Vector3(pos.x, this._groundOffset, pos.z);
  }

  // -----------------------------------------------------------------
  // Factory: construct the right variant class by type name.
  // -----------------------------------------------------------------
  static forType(type, scene, opts = {}) {
    const t = String(type).toUpperCase();
    switch (t) {
      case 'SKELETON':
      case 'MAGICIAN': {
        const b = { ...opts, type: t, ...Skeleton._typeOpts(t) };
        const inst = new Skeleton(scene, b);
        if (t === 'MAGICIAN') {
          // Magician: red-orb ranged variant (no elite).
          inst.projectileKind = 'orb';
          inst.configureRanged({
            speed: 6.2, life: 4, radius: 0.3, damage: 1,
            stopDistance: 9 * 0.6, // stops at 0.6 × cast range
          });
          inst.kiteStop = 9 * 0.6;   // hold cast distance
          inst.kiteRetreatUnder = 9 * 0.45;
          inst.retreatSpeed = 2.0;
          inst.dormantWakeRange = 12;
        }
        return inst;
      }
      case 'ARMORED':
      case 'ARCHER':
      case 'RAT':
      case 'BRUTE':
      case 'WRAITH':
      case 'BURN':
        return Skeleton._dynamicType(t, scene, opts);
      default:
        return new Skeleton(scene, { ...opts, type: t, ...Skeleton._typeOpts(t) });
    }
  }

  /** Per-variant class registry; populated by variant modules at import time. */
  static _variantClasses = {};

  static registerVariant(type, klass) {
    Skeleton._variantClasses[String(type).toUpperCase()] = klass;
  }

  static _dynamicType(t, scene, opts) {
    const klass = Skeleton._variantClasses[t];
    if (klass) return new klass(scene, opts);
    // Unknown type: fall back to a plain Skeleton (defensive).
    return new Skeleton(scene, { ...opts, type: t, ...Skeleton._typeOpts(t) });
  }

  /**
   * Base stats for the plain base types (Skeleton/Magician). Variant classes
   * carry their own stats; this only covers the base rig types.
   */
  static _typeOpts(t) {
    if (t === 'MAGICIAN') {
      return {
        hp: 2, speed: 2.6, damage: 1, range: 9,
        cycle: { windup: 0.35, swing: 0.25, recover: 0.4, cooldown: 1.2 },
        drops: 1,
      };
    }
    return {
      hp: 2, speed: 2.6, damage: 1, range: 1.6,
      cycle: { windup: 0.35, swing: 0.25, recover: 0.4, cooldown: 1.2 },
      drops: 1,
    };
  }

  // -----------------------------------------------------------------
  // Positioning / grounding
  // -----------------------------------------------------------------

  /** Set xz position and keep the rig grounded (feet at y 0). */
  setPosition(x, z) {
    this.mesh.position.x = x;
    this.mesh.position.z = z;
    if (this.position) this.position.x = x, this.position.z = z;
    this.ground();
  }

  /**
   * Idempotent grounding: re-apply the bind-time offset so the feet rest on
   * y 0 (§15). The offset is computed ONCE at construction (bind pose, mesh
   * at origin) — re-measuring a Box3 of the already-lifted group each call
   * is what made the old version non-idempotent and let enemies sink into
   * the floor. O(1), no allocation.
   */
  ground() {
    const off = this._groundOffset;
    if (off === undefined) return;
    this.mesh.position.y = off;
    if (this.position) this.position.y = off;
  }

  // -----------------------------------------------------------------
  // Per-frame configuration hooks (set by Game)
  // -----------------------------------------------------------------

  setFrozen(v) { this.frozen = !!v; }
  setFleeing(v) { this.fleeing = !!v; }
  setCollectedOrbs(n) { this._collectedOrbs = n | 0; } // used by some variants

  /**
   * Ranged fire configuration (archer/magician):
   * {speed, life, radius, damage, stopDistance} and optional fan.
   */
  configureRanged(cfg) {
    this.projectileCfg = cfg || null;
    this.fanCount = cfg?.fanCount || 1;
    this.fanHalfAngle = cfg?.fanHalfAngle || 0;
  }

  // -----------------------------------------------------------------
  // Damage / death
  // -----------------------------------------------------------------

  /**
   * Apply damage. Returns true if this hit killed the enemy.
   */
  hit(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    // Hit feedback: any landed hit pops a brief white emissive flash on the
    // bone material (decayed in update() via _updateHitFlash).
    this._hitFlashT = this._HIT_FLASH_MAX;
    // Any damage wakes it.
    if (this.state === DORMANT) this.state = WAKING;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.state = DEAD;
      this._deathT = 0;
      this._deathFired = false;
      if (this.onDeath && !this._deathFired) {
        this._deathFired = true;
        this.onDeath(this);
      }
      return true;
    }
    this.showHpBar();
    return false;
  }

  /** Start (or reset) the death sequence. */
  _beginDeath() {
    this.state = DEAD;
    this._deathT = 0;
  }

  /** Decay the hit-flash: ramp the bone material's emissive white up on hit,
   *  then ease it back to 0. Runs for both live and dying skeletons. */
  _updateHitFlash(dt) {
    if (this._hitFlashT <= 0) return;
    this._hitFlashT = Math.max(0, this._hitFlashT - dt);
    const k = this._hitFlashT / this._HIT_FLASH_MAX;   // 1 → 0
    const b = this._boneMat;
    if (b) {
      b.emissive.setRGB(1, 1, 1);
      b.emissiveIntensity = 0.9 * k;
    }
    if (this._hitFlashT <= 0 && b) b.emissiveIntensity = 0;
  }

  _updateDeath(dt) {
    this._deathT += dt;
    const t = this._deathT;
    if (t < DEATH_HOLD) return;
    const fade = Math.min(1, (t - DEATH_HOLD) / DEATH_FADE);
    for (const m of this._materials) {
      if (m) m.opacity = Math.max(0, 1 - fade);
    }
    if (this.halo && this.halo.material) {
      this.halo.material.opacity = Math.max(0, 0.8 * (1 - fade));
    }
    if (this._hpBarSprite && this._hpBarSprite.material) {
      this._hpBarSprite.material.opacity = Math.max(0, 1 - fade);
    }
    if (t >= DEATH_HOLD + DEATH_FADE && !this._disposed) {
      this.mesh.visible = false;
      this.dispose();
    }
  }

  /** Remove the rig from the scene and free all tracked GPU resources. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.scene && this.mesh.parent) this.scene.remove(this.mesh);
    else if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    if (this._hpBarSprite && this._hpBarSprite.parent) this._hpBarSprite.parent.remove(this._hpBarSprite);
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    if (this._hpBarCanvas) {
      this._hpBarCanvas.width = 0;
      this._hpBarCanvas = null;
      this._hpBarCtx = null;
    }
    this._geometries.length = 0;
    this._materials.length = 0;
  }

  // -----------------------------------------------------------------
  // Pose application
  // -----------------------------------------------------------------

  _applyPose() {
    const b = this.bones;
    const bases = this._boneBases;

    if (this.state === DEAD) {
      const dead = POSES[DEAD].bones;
      for (const name of POSE_KEYS[DEAD]) {
        const node = b[name], base = bases[name], r = dead[name];
        node.rotation.x = base.x + r.x;
        node.rotation.y = base.y + (r.y || 0);
        node.rotation.z = base.z + (r.z || 0);
      }
      return;
    }

    if (this.state === ATTACK) {
      // Interpolate windup→swing→recover through the ATTACK keyframe.
      const c = this.cycle;
      const t = this._phaseT;
      const { windup, recover } = c;
      const from = POSES[CHASE].bones, to = POSES[ATTACK].bones;
      if (this._phase === 'windup') {
        const k = Math.min(1, t / Math.max(1e-6, windup));
        for (const name of MIX_KEYS_CHASE_ATTACK) {
          const A = from[name] || ZERO_ROT, B = to[name] || ZERO_ROT;
          const node = b[name], base = bases[name];
          if (node) {
            node.rotation.x = base.x + A.x + (B.x - A.x) * k;
            node.rotation.y = base.y + (A.y + (B.y - A.y) * k);
            node.rotation.z = base.z + (A.z || 0) + ((B.z || 0) - (A.z || 0)) * k;
          }
        }
      } else if (this._phase === 'swing') {
        // snap to the attack keyframe
        for (const name of POSE_KEYS[ATTACK]) {
          const node = b[name], base = bases[name], r = to[name];
          node.rotation.x = base.x + r.x;
          node.rotation.y = base.y + (r.y || 0);
          node.rotation.z = base.z + (r.z || 0);
        }
      } else {
        const k = Math.min(1, t / Math.max(1e-6, recover));
        for (const name of MIX_KEYS_CHASE_ATTACK) {
          const B = from[name] || ZERO_ROT, A = to[name] || ZERO_ROT;
          const node = b[name], base = bases[name];
          if (node) {
            node.rotation.x = base.x + A.x + (B.x - A.x) * k;
            node.rotation.y = base.y + (A.y + (B.y - A.y) * k);
            node.rotation.z = base.z + (A.z || 0) + ((B.z || 0) - (A.z || 0)) * k;
          }
        }
      }
      // Legs held mid-stride during an attack.
      const ll = b['legL'], rr = b['legR'];
      if (ll && bases['legL']) { ll.rotation.x = bases['legL'].x - 0.2; ll.rotation.y = bases['legL'].y; ll.rotation.z = bases['legL'].z; }
      if (rr && bases['legR']) { rr.rotation.x = bases['legR'].x + 0.2; rr.rotation.y = bases['legR'].y; rr.rotation.z = bases['legR'].z; }
      return;
    }

    // Idle / waking / chase: sine-driven oscillation around the pose keyframe.
    const pose = POSES[this.state] || POSES[DORMANT];
    const ph = this._animT / pose.phase * Math.PI * 2;
    const s = Math.sin(ph);
    for (const name of POSE_KEYS[this.state] || POSE_KEYS[DORMANT]) {
      const rot = pose.bones[name];
      if (!rot) continue;
      const node = b[name], base = bases[name];
      if (!node) continue;
      // Oscillate limbs about the keyframe; arms/legs swing, torso sways.
      const amp = (name === 'armL' || name === 'legR') ? 1 : -1;
      node.rotation.x = base.x + rot.x + s * 0.25 * amp;
      node.rotation.y = base.y + (rot.y || 0);
      node.rotation.z = base.z + (rot.z || 0) + s * 0.04 * amp;
    }
    // Counter-swing the other limb for a natural walk (fixed key order).
    for (let i = 0; i < 4; i++) {
      const name = COUNTER_KEYS[i];
      const other = COUNTER_OTHER[i];
      const rot = pose.bones[name];
      if (!rot || !pose.bones[other]) continue;
      const node = b[name], base = bases[name];
      if (!node) continue;
      node.rotation.x = base.x + rot.x - s * 0.25;
      node.rotation.y = base.y + (rot.y || 0);
      node.rotation.z = base.z + (rot.z || 0) - s * 0.04;
    }
  }

  // -----------------------------------------------------------------
  // Movement helpers
  // -----------------------------------------------------------------

  /** True if there are any wall boxes to test against. */
  _hasBoxes(boxes) {
    return !!(this._grid || (boxes && boxes.length));
  }

  /**
   * Collision resolution against the level's wall boxes. Uses the shared
   * BoxGrid (O(cells)) when the SkeletonSystem provided one, else the
   * linear scan. Same contract as resolveCircleCollisions(boxes, p, r).
   */
  _resolve(p) {
    const grid = this._grid;
    if (grid && this._spawnTimer > 0) return; // spawn grace: no pushes
    if (grid) { grid.resolve(p, RADIUS); return; }
    const boxes = this._boxes;
    if (boxes && boxes.length) resolveCircleCollisions(boxes, p, RADIUS);
  }

  /** Circle-vs-boxes hit test (grid accelerated when available). */
  _hits(x, z, r) {
    const grid = this._grid;
    if (grid && this._spawnTimer > 0) return false; // spawn grace: no blockers
    const boxes = this._boxes;
    return boxes && boxes.length && circleHitsBox(boxes, x, z, r);
  }

  /**
   * Move the enemy toward (tx, tz) by up to `dist` units this frame.
   * Sub-stepped at ≤0.08 u; each step resolved against `boxes`
   * (resolveCircleCollisions, radius 0.35). Phasing enemies skip boxes.
   * Returns total distance actually moved.
   */
  _moveToward(tx, tz, dist, dt, boxes, opts = {}) {
    if (dist <= 0) return 0;
    const p = this.position;
    let dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return 0;
    const nx = dx / d, nz = dz / d;
    const targetYaw = Math.atan2(nx, nz);
    this._face(targetYaw, opts.turnSpeed || 8, dt);

    const phases = this.phases && !opts.noPhase;
    const doResolve = !phases && this._hasBoxes(boxes);
    let remaining = dist;
    let moved = 0;
    while (remaining > 1e-6) {
      const step = Math.min(STEP, remaining);
      p.x += nx * step;
      p.z += nz * step;
      if (doResolve) this._resolve(p);
      remaining -= step;
      moved += step;
    }
    this._syncMesh();
    return moved;
  }

  /** Smoothly turn `facing` toward `yaw` (radians). */
  _face(yaw, rate, dt) {
    let diff = yaw - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = rate * dt;
    if (Math.abs(diff) <= maxTurn) this.facing = yaw;
    else this.facing += Math.sign(diff) * maxTurn;
    this.mesh.rotation.y = this.facing;
  }

  /** Show the HP bar, draw it for the current hp fraction, and keep it synced. */
  showHpBar() {
    if (!this.scene) return;
    if (!this._hpBarSprite) this._buildHpBar();
    this._hpBarVisible = true;
    if (this._hpBarSprite) this._hpBarSprite.visible = true;
    this._drawHpBar(this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0);
  }

  /** Update HP bar visibility/opacity. Call from per-frame enemy update. */
  _updateHpBar(dt) {
    if (!this._hpBarVisible) return;
    if (!this.alive) {
      this._hideHpBar();
      return;
    }
    const frac = this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
    this._drawHpBar(frac);
    const s = this.mesh;
    if (s && this._hpBarSprite) {
      this._hpBarSprite.position.copy(s.position);
      this._hpBarSprite.position.y += 1.9;
    }
  }

  _hideHpBar() {
    this._hpBarVisible = false;
    if (this._hpBarSprite) this._hpBarSprite.visible = false;
  }

  _buildHpBar() {
    const W = 128, H = 14;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    this._hpBarCanvas = c;
    this._hpBarCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    const mat = this._trackMat(new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      map: tex,
    }));
    const sp = new THREE.Sprite(mat);
    sp.name = 'hp-bar';
    sp.scale.set(0.7, 0.08, 1);
    sp.renderOrder = 9;
    this.mesh.add(sp);
    this._hpBarSprite = sp;
    this._hpBarTex = tex;
    this._drawHpBar(this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0);
  }

  _drawHpBar(frac) {
    if (!this._hpBarCtx) return;
    const q = Math.max(0, Math.min(1, frac));
    if (q === this._lastHpFrac) return;
    this._lastHpFrac = q;
    const ctx = this._hpBarCtx;
    const W = this._hpBarCanvas.width;
    const H = this._hpBarCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,8,8,0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#7f1f1f';
    ctx.fillRect(2, 2, W - 4, H - 4);
    ctx.fillStyle = '#d42a2a';
    ctx.fillRect(2, 2, (W - 4) * q, H - 4);
    if (this._hpBarTex) this._hpBarTex.needsUpdate = true;
  }

  _syncMesh() {
    const p = this.position;
    this.mesh.position.x = p.x;
    this.mesh.position.z = p.z;
    if (this.position.y !== undefined) this.mesh.position.y = this.position.y;
  }

  /**
   * Grid pathing step: follow `path` waypoints; re-evaluate every 300 ms
   * when blocked. Greedy 4-neighbor step toward the player when the direct
   * line is blocked. Returns true if the enemy advanced.
   */
  _pathTowardPlayer(px, pz, dt, boxes) {
    this._pathT -= dt;
    if (this._pathT <= 0) {
      this._pathT = PATH_REEVAL;
      this._rebuildPath(px, pz, boxes);
    }
    // Advance along the current path.
    while (this._path.length) {
      const wp = this._path[0];
      const dx = wp.x - this.position.x;
      const dz = wp.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.2) { this._path.shift(); continue; }
      // Move one sub-step toward the waypoint (bounded by the frame budget).
      const nx = dx / d, nz = dz / d;
      this._face(Math.atan2(nx, nz), 8, dt);
      const p = this.position;
      const step = STEP;
      p.x += nx * step;
      p.z += nz * step;
      if (this._hasBoxes(boxes)) this._resolve(p);
      this._syncMesh();
      return true;
    }
    // Path exhausted (or none): greedy 4-neighbor nudge.
    this._greedyStep(px, pz, dt, boxes);
    return true;
  }

  _greedyStep(px, pz, dt, boxes) {
    const p = this.position;
    // Perf: no per-call allocations — fixed inline dir order, scalar test point.
    // Prefer the axis with the largest error by picking the dir order inline.
    const ax = Math.abs(px - p.x), az = Math.abs(pz - p.z);
    const preferX = ax >= az;
    // Four candidate unit steps (dx, dz) in preference order.
    if (preferX) {
      if (this._tryGreedyDir(px, pz, dt, boxes, Math.sign(ax) || 1, 0)) return;
      if (this._tryGreedyDir(px, pz, dt, boxes, 0, Math.sign(az) || 1)) return;
      if (this._tryGreedyDir(px, pz, dt, boxes, -(Math.sign(ax) || 1), 0)) return;
      if (this._tryGreedyDir(px, pz, dt, boxes, 0, -(Math.sign(az) || 1))) return;
    } else {
      if (this._tryGreedyDir(px, pz, dt, boxes, 0, Math.sign(az) || 1)) return;
      if (this._tryGreedyDir(px, pz, dt, boxes, Math.sign(ax) || 1, 0)) return;
      if (this._tryGreedyDir(px, pz, dt, boxes, 0, -(Math.sign(az) || 1))) return;
      if (this._tryGreedyDir(px, pz, dt, boxes, -(Math.sign(ax) || 1), 0)) return;
    }
  }

  /** Try one greedy step along (sx, sz) ∈ {±1,0}. Returns true if it moved. */
  _tryGreedyDir(px, pz, dt, boxes, sx, sz) {
    const p = this.position;
    const tx = p.x + sx * STEP;
    const tz = p.z + sz * STEP;
    if (this._hits(tx, tz, RADIUS)) return false;
    this._face(Math.atan2(sx, sz), 8, dt);
    p.x = tx;
    p.z = tz;
    if (this._hasBoxes(boxes)) this._resolve(p);
    this._syncMesh();
    return true;
  }

  _rebuildPath(px, pz, boxes) {
    const p = this.position;
    const cell = 1.0; // coarse nav cell
    const cx0 = Math.round(p.x / cell), cz0 = Math.round(p.z / cell);
    const cx1 = Math.round(px / cell), cz1 = Math.round(pz / cell);
    const path = [];
    let x = cx0, z = cz0;
    let guard = 0;
    while ((x !== cx1 || z !== cz1) && guard++ < 512) {
      const dx = cx1 - x, dz = cz1 - z;
      // Prefer the axis with the bigger error; fall back to the other.
      const tryAxis = Math.abs(dx) >= Math.abs(dz)
        ? [[Math.sign(dx), 0], [0, Math.sign(dz)]]
        : [[0, Math.sign(dz)], [Math.sign(dx), 0]];
      let stepped = false;
      for (const [mx, mz] of tryAxis) {
        const nx = x + mx, nz = z + mz;
        const wx = nx * cell, wz = nz * cell;
        if (boxes && boxes.length && circleHitsBox(boxes, wx, wz, RADIUS + 0.1)) continue;
        x = nx; z = nz;
        path.push({ x: wx, z: wz });
        stepped = true;
        break;
      }
      if (!stepped) {
        // Blocked on the preferred axis: try the other axis only.
        const alt = Math.abs(dx) >= Math.abs(dz) ? [0, Math.sign(dz)] : [Math.sign(dx), 0];
        const nx = x + alt[0], nz = z + alt[1];
        x = nx; z = nz;
        path.push({ x: nx * cell, z: nz * cell });
      }
    }
    this._path = path;
  }

  // -----------------------------------------------------------------
  // LOS / attack
  // -----------------------------------------------------------------

  /** Line-of-sight raycast (0.4 u steps) against collision boxes.
   *  Perf: time-gated — the sightline only flips when geometry crosses it,
   *  which is slow at a few u/s, so re-checking at most every LOS_REEVAL s is
   *  indistinguishable in gameplay but removes the per-frame
   *  O(steps × boxes) raycast (the top per-enemy cost at high level). */
  hasLOS(px, pz, boxes) {
    if (this.phases) return true;
    const p = this.position;
    const dx = px - p.x, dz = pz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    // Re-evaluate on a timer driven by _animT (advanced by dt in update()).
    if (this._animT < this._losNext) return this._losVerdict;
    this._losNext = this._animT + LOS_REEVAL;
    const grid = this._grid;
    if (boxes && boxes.length) {
      const steps = Math.ceil(d / LOS_STEP);
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const sx = p.x + dx * t, sz = p.z + dz * t;
        if (grid ? grid.circleHits(sx, sz, LOS_RADIUS)
                : circleHitsBox(boxes, sx, sz, LOS_RADIUS)) {
          this._losVerdict = false;
          return false;
        }
      }
    }
    this._losVerdict = true;
    return true;
  }

  /**
   * Run the attack cycle. Called when in range & cooldown ready (or by
   * ranged overrides). Advances windup→swing→recover→cooldown; fires the
   * hit at swing progress ≥ 0.35. The cooldown ticks down while the enemy
   * stays in range; the state machine returns to CHASE once it is ready.
   */
  _runAttackCycle(dt, px, pz) {
    const c = this.cycle;
    // Zero-phase (instant) cycle: no windup/swing/recover. The hit is
    // governed purely by the cooldown; fire immediately.
    if (c.windup <= 0 && c.swing <= 0 && c.recover <= 0) {
      if (this._phase === 'cd') {
        if (this.cooldown > 0) {
          this.cooldown -= dt;
          if (this.cooldown <= 0) {
            this._fireHit(px, pz);
            this.cooldown = c.cooldown;
          }
          return;
        }
        this._fireHit(px, pz);
        this.cooldown = c.cooldown;
        return;
      }
    }
    if (this._phase === 'windup') {
      this._phaseT += dt;
      if (this._phaseT >= c.windup) { this._phase = 'swing'; this._phaseT = 0; }
    } else if (this._phase === 'swing') {
      this._phaseT += dt;
      const prog = Math.min(1, this._phaseT / Math.max(1e-6, c.swing));
      if (prog >= SWING_HIT && !this._hitFired) {
        this._hitFired = true;
        this._fireHit(px, pz);
      }
      if (this._phaseT >= c.swing) { this._phase = 'recover'; this._phaseT = 0; }
    } else if (this._phase === 'recover') {
      this._phaseT += dt;
      if (this._phaseT >= c.recover) {
        this._phase = 'cd';
        this.cooldown = c.cooldown;
      }
    } else if (this._phase === 'cd') {
      // Cooldown: tick down while in range; return to CHASE when ready so
      // the update() CHASE path can move/attack again (it re-enters the
      // attack immediately if still in range).
      if (this.cooldown > 0) {
        this.cooldown -= dt;
        if (this.cooldown <= 0) {
          this._phase = 'windup';
          this._phaseT = 0;
          this._hitFired = false;
          this._fired = false;
          this.state = ATTACK;
        }
      } else {
        this.state = CHASE;
      }
    }
  }

  isRanged() {
    return !!this.projectileCfg;
  }

  /** Resolve the landed hit: ranged fires a projectile, melee calls onAttackHit. */
  _fireHit(px, pz) {
    if (this.isRanged()) this._fireProjectile(px, pz);
    else if (this.onAttackHit) this.onAttackHit(this);
  }

  _fireProjectile(px, pz) {
    if (!this.projectileCfg || !this.onProjectile) return;
    const p = this.position;
    const dx = px - p.x, dz = pz - p.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const baseYaw = Math.atan2(dx, dz) - this.facing;
    const n = this.fanCount || 1;
    const half = this.fanHalfAngle || 0;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i / Math.max(1, n - 1) - 0.5) * 2 * half;
      const yaw = baseYaw + off;
      this.onProjectile({
        x: p.x,
        z: p.z,
        yaw,
        speed: this.projectileCfg.speed,
        life: this.projectileCfg.life,
        radius: this.projectileCfg.radius,
        damage: this.projectileCfg.damage,
        stopDistance: this.projectileCfg.stopDistance || null,
        kind: this.projectileKind || 'orb',
        source: this,
      });
    }
  }

  // -----------------------------------------------------------------
  // Main update — drives the state machine + movement.
  // -----------------------------------------------------------------

  /**
   * @param {number} dt delta seconds
   * @param {{x:number,z:number}} player player position
   * @param {Array<{minX,minZ,maxX,maxZ}>} collisionBoxes
   * @param {object} [opts]
   *   opts.frozen     mobs > FROZEN_DIST (idle, no AI)
   *   opts.fleeing    BRIGHT active — flee, no attacks
   * @returns {boolean} false once the corpse has been disposed
   */
  update(dt, player, collisionBoxes = [], opts = {}) {
    if (this._disposed) return false;
    this._animT += dt;
    // Hit-flash decay — runs in every state (live, frozen, fleeing, dying) so
    // a flash triggered by a hit always animates out, even mid-death-fade.
    this._updateHitFlash(dt);
    this._updateHpBar(dt);
    // Perf: cache the per-update collision source (shared BoxGrid when
    // SkeletonSystem provides one, else the raw box array) so the movement
    // helpers avoid re-deriving it.
    this._boxes = collisionBoxes;
    this._grid = opts.grid || null;

    if (this.state === DEAD) {
      // Corpse animation runs while alive===false (after the killing hit).
      this._updateDeath(dt);
      return this._disposed === false;
    }
    if (!this.alive) return false;

    if (opts.frozen) {
      this._applyPose();
      return true;
    }

    const p = this.position;
    const px = player.x, pz = player.z;
    const dx = px - p.x, dz = pz - p.z;
    const dist = Math.hypot(dx, dz);
    const fleeing = opts.fleeing || this.fleeing;

    // --- state transitions -------------------------------------------
    if (this.state === DORMANT) {
      this.wakeTimer -= dt;
      if (this.wakeTimer <= 0 && dist < this.wakeRange()) this.state = WAKING;
    } else if (this.state === WAKING) {
      this.state = CHASE;
    }

    // --- FLEE (BRIGHT): run away at scaled speed, no attacks -----------
    if (fleeing && this.state === CHASE) {
      const fdx = -dx / (dist || 1e-6), fdz = -dz / (dist || 1e-6);
      this._moveToward(p.x + fdx * 10, p.z + fdz * 10, this.speed * FLEE_SPEED_MULT * dt, dt,
                       collisionBoxes, { noPhase: !this.phases });
      this._applyPose();
      return true;
    }

    if (this.state === CHASE || this.state === ATTACK) {
      if (this.state === ATTACK) {
        // In the middle of an attack: advance the cycle; ranged keeps aiming.
        this._runAttackCycle(dt, px, pz);
        this._applyPose();
        return true;
      }

      const inRange = dist <= this.range;
      const hasLOS = this.hasLOS(px, pz, collisionBoxes);
      const canAct = this.isRanged() || hasLOS;

      // Start an attack when in range, LOS, and cooldown ready.
      const c = this.cycle;
      const instant = c.windup <= 0 && c.swing <= 0 && c.recover <= 0;
      if (inRange && canAct && this._phase === 'cd' && this.cooldown <= 0) {
        if (instant) {
          this._fireHit(px, pz);
          this.cooldown = c.cooldown;
        } else {
          this.state = ATTACK;
          this._phase = 'windup';
          this._phaseT = 0;
          this._hitFired = false;
          this._fired = false;
        }
      }

      if (this._phase === 'cd') {
        // Movement.
        const distBudget = this.speed * dt;
        const forcePathfind = !!opts.forcePathfind;
        if (this.isRanged()) {
          this._rangedMovement(dt, px, pz, dist, collisionBoxes, distBudget);
        } else if (this.phases) {
          // Straight flight, no pathing/LOS.
          this._moveToward(px, pz, distBudget, dt, collisionBoxes, { noPhase: false });
        } else if (forcePathfind || !hasLOS) {
          this._pathTowardPlayer(px, pz, dt, collisionBoxes);
        } else {
          this._moveToward(px, pz, distBudget, dt, collisionBoxes);
        }
      }
      this._applyPose();
    }

    return true;
  }

  /** Ranged movement: kiter behavior (archer) or keep cast distance. */
  _rangedMovement(dt, px, pz, dist, boxes, distBudget) {
    // Default: hold the stop distance; retreat if too close.
    const stop = this.kiteStop ?? (this.range * 0.7);
    const retreatUnder = this.kiteRetreatUnder ?? (stop * 0.4);
    if (dist < retreatUnder) {
      // Retreat.
      const rx = this.position.x - (px - this.position.x) * 0; // (keep simple)
      const rx2 = this.position.x, rz2 = this.position.z;
      const fdx = (this.position.x - px), fdz = (this.position.z - pz);
      const fd = Math.hypot(fdx, fdz) || 1e-6;
      this._moveToward(rx2 + (fdx / fd) * 10, rz2 + (fdz / fd) * 10,
                       (this.retreatSpeed || 2.0) * dt, dt, boxes);
    } else if (dist > stop) {
      this._moveToward(px, pz, distBudget, dt, boxes);
    } else {
      // In the kite band: hold position (strafe idle).
    }
  }

  /** Distance at which the enemy wakes from DORMANT. */
  wakeRange() {
    return this.dormantWakeRange ?? 6;
  }

  // -----------------------------------------------------------------
  // Convenience for Game: spawn helpers
  // -----------------------------------------------------------------

  /** Apply level/bossKills scaling to speed & damage (Game may call). */
  applyScaling(speedMult, attackMult) {
    this.speed = (this.baseSpeed || this.speed) * speedMult;
    this.damage = (this.baseDamage || this.damage) * attackMult;
    return this;
  }
}

// Default dormant wake range for the base types.
Skeleton.prototype.dormantWakeRange = 6;

// Expose state names for external code (optional).
Skeleton.STATES = { DORMANT, WAKING, CHASE, ATTACK, DEAD };



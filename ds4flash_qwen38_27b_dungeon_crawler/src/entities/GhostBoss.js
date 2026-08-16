// GhostBoss.js — the Spectral Lord boss (§17, §25, §26).
//
// A standalone (non-Skeleton) spectral boss spawned on every 7th level at the
// exit cell. Seven visual variants (look/scale/label differ, AI identical):
//   SKELETON → BONE LORD · ARMORED → IRON GHOUL · ARCHER → SPECTRAL HUNTER ·
//   BRUTE → ASH TITAN · WRAITH → SPECTRAL LORD · RAT → VERMIN KING ·
//   MAGICIAN → LICH ARCHMAGE
//
// HP formula (§17, binding):
//   ceil(4 × BOSS.HP_MULT × (1 + 3·ngPlus) × (1 + floor(level/10))
//        × (1 + ((1 + 0.25·floor(souls/50)) · 1.1^heartsExtra − 1)/2))
//   heartsExtra = max(0, maxHealth − 3)
//
// AI states: CHASE / CHARGING / BLINKING / DEAD.
//   • Drift toward the player at BOSS.DRIFT_SPEED beyond BOSS.DRIFT_DISTANCE.
//   • CHARGE: within CHARGE_RANGE, off cooldown, wall-free path → dash at
//     CHARGE_SPEED for CHARGE_TIME along a locked direction; one contact hit
//     of CHARGE_DMG within CHARGE_CONTACT_RADIUS per charge; CD CHARGE_CD
//     (first ×CHARGE_FIRST_CD_MULT). Sub-stepped at 0.08 u.
//   • SUMMON: every SUMMON_INTERVAL s, a pack of floor(3 × 1.5^heartsExtra)
//     wraiths via opts.onSummon(x, z); at most BOSS.MAX_MINIONS living.
//   • BLINK: CD BLINK_CD (first ×BLINK_FIRST_CD_MULT); teleport ONTO the
//     player through walls, freeze in BLINKING while charging BLINK_TELEGRAPH
//     (spark ring + BLINK_SPARKS sparks), then detonate BLINK_DMG within
//     BLINK_RADIUS via this.onBlinkHit(x, z, radius, damage).
//   • SMOKE: CD SMOKE_CD (first ×SMOKE_FIRST_CD_MULT); a homing cloud
//     (SMOKE_FLIGHT at SMOKE_SPEED) lingers SMOKE_DURATION (radius
//     SMOKE_RADIUS); DoT (SMOKE_DMG/s) is ticked by SkeletonSystem via
//     this.smokeClouds. Fires alongside any state. Clouds disposed on boss
//     dispose (§26).
//
// Defeat: hp ≤ 0 → DEAD → ~1 s dissipation fade → dispose(). this.onDeath
// fires immediately (Game handles bossKills++, buff, heart, souls, portal).

import * as THREE from 'three';
import { BOSS, ENEMY } from '../core/Constants.js';
import { resolveCircleCollisions, circleHitsBox } from '../core/Collision.js';
import { makeBone, makeGlow, makeSpriteGlow, canvasCapable } from '../core/Materials.js';

// Guard: everything below is safe headless (THREE core has no DOM access at
// import time; canvas sprite work is gated at runtime below).

const STEP = 0.08;                    // 0.08 u sub-step (boss charge)
const BARS = 7;

// Variant visuals: label index matches BOSS.VARIANT_TYPES order.
const VARIANT_LOOKS = {
  SKELETON:  { scale: 2.5, body: 0xd8d2c0, glow: 0x9fd8ff },
  ARMORED:   { scale: 2.7, body: 0x8a8f96, glow: 0x7fa0c8 },
  ARCHER:    { scale: 2.4, body: 0x7080a0, glow: 0xa0e0b0 },
  BRUTE:     { scale: 3.0, body: 0x9a8468, glow: 0xffb040 },
  WRAITH:    { scale: 2.6, body: 0x6a6a8a, glow: 0xc8a0ff },
  RAT:       { scale: 2.3, body: 0x8a6a50, glow: 0xd0c090 },
  MAGICIAN:  { scale: 2.6, body: 0x5a4a7a, glow: 0xff5050 },
};

const CHARGE = 'CHARGING';
const BLINKING = 'BLINKING';
const DEAD = 'DEAD';
const CHASE = 'CHASE';

const DEATH_FADE = 1.0;                // ~1 s dissipation

/**
 * Boss HP — the §17 formula (wealth × hearts stack, combined excess halved).
 * Exported separately so the verification suite can check it directly.
 */
export function bossMaxHp({ level, ngPlus, souls, maxHealth }) {
  const heartsExtra = Math.max(0, (maxHealth ?? 3) - 3);
  const wealth = (1 + BOSS.SOULS_HP_BONUS * Math.floor((souls ?? 0) / 50))
    * Math.pow(1.1, BOSS.HEARTS_MULT_EXP * heartsExtra);
  const stack = (wealth - 1) / 2;
  return Math.ceil(
    BOSS.BASE_HP_FACTOR * BOSS.HP_MULT *
    (1 + 3 * (ngPlus ?? 0)) *
    (1 + Math.floor((level ?? 1) / 10)) *
    (1 + stack)
  );
}

export class GhostBoss {
  /**
   * @param {THREE.Scene|THREE.Group|null} scene
   * @param {object} opts
   *   level, ngPlus, souls, maxHealth, bossKills
   *   position  {x,z}  (exit cell center)
   *   variant   optional forced variant type; random of 7 otherwise
   * Callbacks (Game sets; may also be passed per-frame via update opts):
   *   onSummon(x, z)      spawn one summoned wraith
   *   onBlinkHit(x, z, radius, damage)  nova detonation
   *   onDeath(boss)       defeat — Game: bossKills++, buff, heart, souls, portal
   */
  constructor(scene, opts = {}) {
    this.scene = scene || null;
    this.level = opts.level ?? 1;
    this.ngPlus = opts.ngPlus ?? 0;
    this.souls = opts.souls ?? 0;
    this.maxHealth = opts.maxHealth ?? 3;
    this.bossKills = opts.bossKills ?? 0;
    this.heartsExtra = Math.max(0, (opts.maxHealth ?? 3) - 3);

    // --- variant pick (identical AI, different look/scale/label) ---
    const types = BOSS.VARIANT_TYPES;
    this.variant = opts.variant ?
      String(opts.variant).toUpperCase() :
      types[Math.floor(Math.random() * types.length)];
    if (!VARIANT_LOOKS[this.variant]) this.variant = types[4]; // WRAITH fallback
    this.label = BOSS.VARIANT_LABELS[types.indexOf(this.variant)] || 'SPECTRAL LORD';
    const look = VARIANT_LOOKS[this.variant];

    // --- HP (§17 formula) ---
    this.maxHp = bossMaxHp(opts);
    this.hp = this.maxHp;
    this.bossBarUpdated = true;        // set whenever hp changes → Game HUD

    // --- identity / exposed state ---
    this.radius = BOSS.RADIUS;         // 0.9
    this.alive = true;
    this.state = CHASE;
    this.position = new THREE.Vector3(
      (opts.position || {}).x || 0, 0, (opts.position || {}).z || 0
    );

    // --- attack bookkeeping ---
    this._chargeCd = BOSS.CHARGE_CD * BOSS.CHARGE_FIRST_CD_MULT; // first ×0.6
    this._chargeT = 0;
    this._chargeDir = null;            // locked direction during CHARGE
    this._chargeHit = false;
    this._blinkCd = BOSS.BLINK_CD * BOSS.BLINK_FIRST_CD_MULT;    // first ×0.5
    this._blinkT = 0;
    this._summonCd = BOSS.SUMMON_INTERVAL;
    this._smokeCd = BOSS.SMOKE_CD * BOSS.SMOKE_FIRST_CD_MULT;    // first ×0.7
    this._deathT = 0;
    this._deathFired = false;
    this._animT = Math.random() * 10;

    // Summoned wraiths are tracked here for the MAX_MINIONS cap (§17).
    this.summonedWraiths = [];
    this._summonedSet = new Set();

    // Smoke clouds — SkeletonSystem ticks the DoT from this array (§26).
    // Each: {x, z, radius, timeLeft, active, phase, tx, tz, mesh, mat}
    this.smokeClouds = [];

    // Callbacks (per-frame opts override these).
    this.onSummon = null;
    this.onBlinkHit = null;
    this.onDeath = null;

    // --- visuals ---
    this._materials = [];
    this._geometries = [];
    this._trackMat = (m) => { this._materials.push(m); return m; };
    this._trackGeo = (g) => { this._geometries.push(g); return g; };

    this._buildMesh(look);
    this._buildBarSprite();
    this._buildBlinkFx();

    const pos = opts.position || { x: 0, z: 0 };
    this.mesh.position.set(pos.x, 0, pos.z);
    if (this.scene && this.scene.add) this.scene.add(this.mesh);
    this._syncMesh();
  }

  // -----------------------------------------------------------------
  // Rig: a 2.5x-scaled spectral skeleton-ish build (big lord).
  // -----------------------------------------------------------------
  _buildMesh(look) {
    this.mesh = new THREE.Group();
    this.mesh.name = `boss-${this.variant}`;

    const bodyMat = this._trackMat(makeBone(21));
    bodyMat.color.set(look.body);
    const glowMat = this._trackMat(makeGlow(look.glow, 1.6));
    const spriteMat = this._trackMat(makeSpriteGlow(look.glow));
    this._glowMat = glowMat;

    const box = (w, h, d) => {
      const g = this._trackGeo(new THREE.BoxGeometry(w, h, d));
      return new THREE.Mesh(g, bodyMat);
    };
    const cyl = (r1, r2, h, seg = 6) => {
      const g = this._trackGeo(new THREE.CylinderGeometry(r1, r2, h, seg));
      return new THREE.Mesh(g, bodyMat);
    };

    const root = new THREE.Group();
    root.name = 'root';
    this.mesh.add(root);

    // Torso: spine + ribcage (bigger than mob skeletons).
    const ribcage = new THREE.Group();
    ribcage.name = 'ribcage';
    ribcage.position.y = 0.8;
    root.add(ribcage);

    const spine = cyl(0.07, 0.08, 0.7, 5);
    spine.position.y = 0.25;
    ribcage.add(spine);
    for (let i = 0; i < 4; i++) {
      const rib = box(0.42 - i * 0.03, 0.04, 0.05);
      rib.position.y = 0.05 + i * 0.13;
      ribcage.add(rib);
    }
    const sternum = box(0.05, 0.38, 0.05);
    sternum.position.set(0, 0.25, 0.2);
    ribcage.add(sternum);
    // Shoulder plates (lordly bulk).
    const padL = box(0.22, 0.14, 0.2); padL.position.set(-0.3, 0.5, 0); ribcage.add(padL);
    const padR = box(0.22, 0.14, 0.2); padR.position.set(0.3, 0.5, 0); ribcage.add(padR);

    // Head: skull + horns.
    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = 0.7;
    ribcage.add(head);
    const skull = box(0.28, 0.26, 0.26);
    skull.position.y = 0.13;
    head.add(skull);
    const jaw = box(0.22, 0.06, 0.06);
    jaw.position.set(0, -0.05, 0.08);
    head.add(jaw);
    const eyeL = new THREE.Mesh(this._trackGeo(new THREE.BoxGeometry(0.05, 0.05, 0.02)), glowMat);
    eyeL.position.set(-0.07, 0.14, 0.14);
    head.add(eyeL);
    const eyeR = eyeL.clone(); eyeR.position.x = 0.07; head.add(eyeR);
    const hornL = cyl(0.005, 0.03, 0.3, 4);
    hornL.position.set(-0.17, 0.3, 0); hornL.rotation.z = 0.4;
    head.add(hornL);
    const hornR = cyl(0.005, 0.03, 0.3, 4);
    hornR.position.set(0.17, 0.3, 0); hornR.rotation.z = -0.4;
    head.add(hornR);

    // Arms: upper + forearm + big hands.
    const makeArm = (side) => {
      const arm = new THREE.Group();
      arm.position.set(0.3 * (side === 'L' ? 1 : -1), 0.5, 0);
      ribcage.add(arm);
      const upper = cyl(0.05, 0.045, 0.4, 5);
      upper.position.y = -0.2;
      arm.add(upper);
      const forearm = new THREE.Group();
      forearm.position.y = -0.4;
      arm.add(forearm);
      const fore = cyl(0.04, 0.035, 0.34, 5);
      fore.position.y = -0.17;
      forearm.add(fore);
      const hand = box(0.1, 0.12, 0.1);
      hand.position.y = -0.36;
      forearm.add(hand);
      return { arm, forearm };
    };
    const { arm: armL, forearm: forearmL } = makeArm('L');
    const { arm: armR, forearm: forearmR } = makeArm('R');
    this._armL = armL; this._armR = armR;
    this._foreL = forearmL; this._foreR = forearmR;

    // Legs.
    const makeLeg = (side) => {
      const leg = new THREE.Group();
      leg.position.set(0.16 * (side === 'L' ? 1 : -1), 0.02, 0);
      root.add(leg);
      const thigh = cyl(0.06, 0.05, 0.36, 5);
      thigh.position.y = -0.18;
      leg.add(thigh);
      const shin = new THREE.Group();
      shin.position.y = -0.36;
      leg.add(shin);
      const sh = cyl(0.045, 0.035, 0.34, 5);
      sh.position.y = -0.17;
      shin.add(sh);
      const foot = box(0.12, 0.05, 0.2);
      foot.position.set(0, -0.36, 0.05);
      shin.add(foot);
      return { leg, shin };
    };
    const { leg: legL } = makeLeg('L');
    const { leg: legR } = makeLeg('R');
    this._legL = legL; this._legR = legR;
    this._ribcage = ribcage;

    // Spectral halo.
    const halo = new THREE.Sprite(spriteMat);
    halo.name = 'halo';
    halo.position.y = 1.25;
    halo.scale.set(1.2, 1.2, 1);
    this.mesh.add(halo);
    this.halo = halo;

    this.mesh.scale.setScalar(look.scale); // ~2.5x a skeleton

    // Grounding: feet at y 0 via Box3.
    const b = new THREE.Box3().setFromObject(this.mesh);
    this.mesh.position.y = -b.min.y;
    this.position.y = this.mesh.position.y;
  }

  /** Canvas sprite hovering above the boss: red HP bar, redrawn per frame. */
  _buildBarSprite() {
    const W = 256, H = 32;
    this._barW = W; this._barH = H;
    this._barCtx = null;
    this._barTexture = null;
    if (canvasCapable()) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      this._barCanvas = c;
      this._barCtx = c.getContext('2d');
      this._barTexture = new THREE.CanvasTexture(c);
    }
    const mat = this._trackMat(new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
    }));
    if (this._barTexture) mat.map = this._barTexture;
    const sp = new THREE.Sprite(mat);
    sp.name = 'boss-bar';
    sp.position.y = 2.4;
    sp.scale.set(2.2, 0.3, 1);
    sp.renderOrder = 10;
    this.mesh.add(sp);
    this.barSprite = sp;
    this._drawBar(1);
  }

  _drawBar(frac) {
    const ctx = this._barCtx;
    if (!ctx) return;
    const W = this._barW, H = this._barH;
    ctx.clearRect(0, 0, W, H);
    // Frame
    ctx.fillStyle = 'rgba(10,10,16,0.85)';
    ctx.fillRect(2, 2, W - 4, H - 4);
    // Track
    ctx.fillStyle = 'rgba(60,10,10,0.9)';
    ctx.fillRect(5, 5, W - 10, H - 10);
    // Fill (red)
    ctx.fillStyle = '#d42a2a';
    ctx.fillRect(5, 5, (W - 10) * Math.max(0, Math.min(1, frac)), H - 10);
    // Border
    ctx.strokeStyle = '#8a8f96';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    if (this._barTexture) this._barTexture.needsUpdate = true;
  }

  /** Blink telegraph FX: expanding spark ring + BLINK_SPARKS sparks. */
  _buildBlinkFx() {
    const ringMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0xc8a0ff, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    }));
    const ringGeo = this._trackGeo(new THREE.RingGeometry(0.3, 0.42, 24));
    this._blinkRing = new THREE.Mesh(ringGeo, ringMat);
    this._blinkRing.rotation.x = -Math.PI / 2;
    this._blinkRing.position.y = 0.1;
    this._blinkRing.visible = false;
    this._blinkRing.userData.noGround = true;
    this.mesh.add(this._blinkRing);

    const sMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0xe8c0ff, transparent: true, opacity: 0.9,
      depthWrite: false,
    }));
    const sGeo = this._trackGeo(new THREE.BoxGeometry(0.08, 0.08, 0.08));
    this._blinkSparks = [];
    for (let i = 0; i < BOSS.BLINK_SPARKS; i++) {
      const m = new THREE.Mesh(sGeo, sMat);
      m.visible = false;
      m.userData.noGround = true;
      this.mesh.add(m);
      this._blinkSparks.push(m);
    }
  }

  // -----------------------------------------------------------------
  // Damage / death
  // -----------------------------------------------------------------

  /**
   * Apply damage. Returns true if this hit killed the boss.
   */
  hit(dmg) {
    if (!this.alive) return false;
    // A hit stops any in-flight blink telegraph: back to CHASE (or DEAD).
    this.state = CHASE;
    if (this._blinkRing) this._blinkRing.visible = false;
    if (this._blinkSparks) for (const s of this._blinkSparks) s.visible = false;
    this.hp -= dmg;
    this.bossBarUpdated = true;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.state = DEAD;
      this._deathT = 0;
      this.bossBarUpdated = true;
      if (this.onDeath && !this._deathFired) {
        this._deathFired = true;
        this.onDeath(this);
      }
      return true;
    }
    return false;
  }

  _updateDeath(dt) {
    this._deathT += dt;
    const fade = Math.min(1, this._deathT / DEATH_FADE);
    for (const m of this._materials) {
      if (m && m.isSpriteMaterial) m.opacity = Math.max(0, (m._baseOpacity ?? 1) * (1 - fade));
      else if (m) m.opacity = Math.max(0, (m._baseOpacity ?? 1) * (1 - fade));
    }
    if (this.barSprite && this.barSprite.material) {
      this.barSprite.material.opacity = Math.max(0, 1 - fade);
    }
    // Fade smoke cloud visuals too.
    for (const c of this.smokeClouds) {
      if (c.mat) c.mat.opacity = Math.max(0, (c._baseOpacity ?? 0.5) * (1 - fade));
    }
    if (this._deathT >= DEATH_FADE) {
      this._disposed = true; // mark first so dispose() doesn't early-return
      this.dispose();
    }
  }

  // -----------------------------------------------------------------
  // Summon / BLINK / SMOKE
  // -----------------------------------------------------------------

  _liveSummoned() {
    let n = 0;
    for (const w of this.summonedWraiths) {
      if (typeof w.alive === 'undefined' || w.alive) n++;
    }
    return n;
  }

  _trySummon(dt, opts) {
    this._summonCd -= dt;
    if (this._summonCd > 0) return;
    const count = Math.floor(
      BOSS.SUMMON_BASE_COUNT * Math.pow(BOSS.SUMMON_HEARTS_MULT, this.heartsExtra)
    );
    const room = BOSS.MAX_MINIONS - this._liveSummoned();
    const n = Math.min(count, Math.max(0, room));
    if (n <= 0) {
      // Cap reached: still reset the timer, retry next interval.
      this._summonCd = BOSS.SUMMON_INTERVAL;
      return;
    }
    const onSummon = opts.onSummon || this.onSummon;
    if (onSummon) {
      for (let i = 0; i < n; i++) {
        onSummon(this.position.x, this.position.z, i);
        const w = onSummon.__lastSpawn || {};
        this.summonedWraiths.push(w);
      }
    }
    this._summonCd = BOSS.SUMMON_INTERVAL;
  }

  _tryBlink(dt, px, pz, dist) {
    if (this._blinkCd > 0) return;
    this._blinkCd = BOSS.BLINK_CD;
    this._blinkT = 0;
    this.state = BLINKING;
    // Teleport ONTO the player — through walls, the anti-kiting tool (§26).
    this.position.x = px;
    this.position.z = pz;
    this._syncMesh();
    this._blinkRing.visible = true;
    for (const s of this._blinkSparks) s.visible = true;
  }

  _updateBlink(dt, px, pz, opts) {
    this._blinkT += dt;
    const t = this._blinkT / BOSS.BLINK_TELEGRAPH;
    // Expanding spark ring + orbiting sparks (the dodge window).
    const r = 0.4 + t * (BOSS.BLINK_RADIUS - 0.4);
    this._blinkRing.scale.setScalar(Math.max(0.001, r / 0.42));
    this._blinkRing.material.opacity = 0.7 * (1 - t * 0.5);
    for (let i = 0; i < this._blinkSparks.length; i++) {
      const s = this._blinkSparks[i];
      const a = (i / this._blinkSparks.length) * Math.PI * 2 + this._animT * 3;
      s.position.set(Math.cos(a) * r, 0.3 + Math.sin(this._animT * 8 + i) * 0.15, Math.sin(a) * r);
    }
    if (this._blinkT >= BOSS.BLINK_TELEGRAPH) {
      // Detonate: BLINK_DMG within BLINK_RADIUS (player is the only
      // damageable entity on a boss level — Game resolves i-frames).
      this._blinkRing.visible = false;
      for (const s of this._blinkSparks) s.visible = false;
      this._blinkRing.material.opacity = 0;
      const cb = opts.onBlinkHit || this.onBlinkHit;
      if (cb) cb(this.position.x, this.position.z, BOSS.BLINK_RADIUS, BOSS.BLINK_DMG);
      this.state = CHASE;
    }
  }

  _trySmoke(dt, px, pz) {
    this._smokeCd -= dt;
    if (this._smokeCd > 0) return;
    this._smokeCd = BOSS.SMOKE_CD;
    // Hurl a homing cloud toward the player.
    const dx = px - this.position.x, dz = pz - this.position.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    const mat = this._trackMat(new THREE.SpriteMaterial({
      color: 0x607068, transparent: true, opacity: 0.5, depthWrite: false,
    }));
    mat._baseOpacity = 0.5;
    const mesh = new THREE.Sprite(mat);
    mesh.position.set(this.position.x, 0.8, this.position.z);
    mesh.scale.set(1.6, 1.6, 1);
    if (this.scene && this.scene.add) this.scene.add(mesh);
    this._smokeMeshes = this._smokeMeshes || [];
    this._smokeMeshes.push(mesh);
    this.smokeClouds.push({
      x: this.position.x,
      z: this.position.z,
      radius: BOSS.SMOKE_RADIUS,
      timeLeft: BOSS.SMOKE_DURATION + BOSS.SMOKE_FLIGHT,
      linger: BOSS.SMOKE_DURATION,
      active: true,
      phase: 'flight',
      tx: px, tz: pz,
      dx: dx / d, dz: dz / d,
      mesh, mat,
    });
  }

  _updateSmokeClouds(dt) {
    for (const c of this.smokeClouds) {
      if (!c.active) continue;
      c.timeLeft -= dt;
      if (c.timeLeft <= 0) {
        c.active = false;
        c.timeLeft = 0;
        if (c.mesh) {
          if (this.scene && this.scene.remove) this.scene.remove(c.mesh);
          c.mat.dispose();
          c.mesh = null; c.mat = null;
        }
        continue;
      }
      if (c.phase === 'flight') {
        // Homing flight: SMOKE_SPEED for SMOKE_FLIGHT.
        c.x += c.dx * BOSS.SMOKE_SPEED * dt;
        c.z += c.dz * BOSS.SMOKE_SPEED * dt;
        if (c.timeLeft <= BOSS.SMOKE_DURATION) {
          c.phase = 'linger';
          c.timeLeft = Math.min(c.timeLeft, c.linger);
        }
        if (c.mesh) c.mesh.position.set(c.x, 0.8, c.z);
      }
      // 'linger': stays put; SkeletonSystem ticks the DoT from timeLeft.
    }
    this.smokeClouds = this.smokeClouds.filter((c) => c.active);
  }

  // -----------------------------------------------------------------
  // Movement / LOS
  // -----------------------------------------------------------------

  /** Wall-free straight line from the boss to (px,pz)? (charge gate, §26). */
  _wallFree(px, pz, boxes) {
    const p = this.position;
    const dx = px - p.x, dz = pz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const steps = Math.ceil(d / 0.4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (boxes && boxes.length &&
          circleHitsBox(boxes, p.x + dx * t, p.z + dz * t, 0.45)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Move by up to `dist` toward (tx,tz), sub-stepped at ≤0.08 u, each step
   * resolved against collision boxes (boss radius 0.9).
   */
  _move(tx, tz, dist, dt, boxes) {
    if (dist <= 0) return;
    const p = this.position;
    let dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return;
    const nx = dx / d, nz = dz / d;
    this._face(Math.atan2(nx, nz), 6, dt);
    let remaining = dist;
    while (remaining > 1e-6) {
      const step = Math.min(STEP, remaining);
      p.x += nx * step;
      p.z += nz * step;
      if (boxes && boxes.length) resolveCircleCollisions(boxes, p, this.radius);
      remaining -= step;
    }
    this._syncMesh();
  }

  /**
   * Grid pathing fallback (greedy 4-neighbor) when a wall blocks the line:
   * prefer the axis with the biggest error, step one nav cell if it is
   * wall-free, otherwise try the other axis.
   */
  _greedyStep(px, pz, dt, boxes) {
    const p = this.position;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (Math.abs(px - p.x) >= Math.abs(pz - p.z)) dirs.reverse();
    for (const [dx, dz] of dirs) {
      const tx = p.x + dx * STEP * 3;
      const tz = p.z + dz * STEP * 3;
      const probeX = p.x + dx * 0.6, probeZ = p.z + dz * 0.6;
      if (boxes && boxes.length && circleHitsBox(boxes, probeX, probeZ, this.radius)) continue;
      this._face(Math.atan2(dx, dz), 6, dt);
      this._move(tx, tz, STEP, dt, boxes);
      return;
    }
  }

  _face(yaw, rate, dt) {
    let diff = yaw - (this.facing || 0);
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = rate * dt;
    if (Math.abs(diff) <= maxTurn) this.facing = yaw;
    else this.facing += Math.sign(diff) * maxTurn;
    this.mesh.rotation.y = this.facing || 0;
  }

  _syncMesh() {
    const p = this.position;
    this.mesh.position.x = p.x;
    this.mesh.position.z = p.z;
  }

  // -----------------------------------------------------------------
  // Main update
  // -----------------------------------------------------------------

  /**
   * @param {number} dt delta seconds
   * @param {{x:number,z:number}} player player position
   * @param {object} dungeon unused grid handle (kept for API symmetry)
   * @param {object} [opts]
   *   playerCell     {x,z} player grid cell (optional)
   *   collisionBoxes wall AABBs (or a path helper; boxes drive collision/LOS)
   *   onSummon(x,z,i)    spawn a summoned wraith (tracked here, cap 25)
   *   onBlinkHit(x,z,r,d) nova detonation
   *   onDeath(boss)      defeat
   * @returns {boolean} false once disposed
   */
  update(dt, player, dungeon = null, opts = {}) {
    if (this._disposed) return false;
    this._animT += dt;

    if (this.state === DEAD) {
      this._updateDeath(dt);
      this._updateSmokeClouds(dt);
      return !this._disposed;
    }
    if (!this.alive) return false;

    const p = this.position;
    const px = player.x, pz = player.z;
    const dx = px - p.x, dz = pz - p.z;
    const dist = Math.hypot(dx, dz);
    const boxes = opts.collisionBoxes || [];

    // --- BLINKING: frozen while charging the nova (§26) ---
    if (this.state === BLINKING) {
      this._updateBlink(dt, px, pz, opts);
      this._updateSmokeClouds(dt);
      this._drawBar(this.hp / this.maxHp);
      this._bob(dt);
      return true;
    }

    // --- CHARGING: dash along the locked direction ---
    if (this.state === CHARGE) {
      this._chargeT += dt;
      this._move(
        p.x + (this._chargeDir.x) * 100,
        p.z + (this._chargeDir.z) * 100,
        BOSS.CHARGE_SPEED * dt, dt, boxes
      );
      // Contact: within CHARGE_CONTACT_RADIUS deals CHARGE_DMG once.
      if (!this._chargeHit && dist <= BOSS.CHARGE_CONTACT_RADIUS) {
        this._chargeHit = true;
        const cb = opts.onChargeHit || this.onChargeHit;
        if (cb) cb(this);
      }
      if (this._chargeT >= BOSS.CHARGE_TIME) {
        this.state = CHASE;
        this._chargeCd = BOSS.CHARGE_CD;
        this._chargeDir = null;
      }
      this._updateSmokeClouds(dt);
      this._drawBar(this.hp / this.maxHp);
      this._bob(dt);
      return true;
    }

    // --- CHASE: drift, summon, blink, smoke ---
    if (this._chargeCd > 0) this._chargeCd -= dt;
    if (this._blinkCd > 0) this._blinkCd -= dt;

    // Summon (fires alongside any state, not in DEAD).
    this._trySummon(dt, opts);

    // Smoke: fires alongside any other attack (doesn't change state, §17).
    this._trySmoke(dt, px, pz);
    this._updateSmokeClouds(dt);

    // Charge: off cooldown, in range, AND wall-free path only (§26 stuck fix).
    if (this._chargeCd <= 0 && dist <= BOSS.CHARGE_RANGE && this._wallFree(px, pz, boxes)) {
      this.state = CHARGE;
      this._chargeT = 0;
      this._chargeHit = false;
      this._chargeDir = { x: dx / (dist || 1e-6), z: dz / (dist || 1e-6) };
      this._chargeCd = BOSS.CHARGE_CD; // consumed; full CD after this charge
      this._updateSmokeClouds(dt);
      this._drawBar(this.hp / this.maxHp);
      return true;
    }

    // Blink: teleport-nova, off cooldown.
    if (this._blinkCd <= 0) {
      this._tryBlink(dt, px, pz, opts);
      this._updateSmokeClouds(dt);
      this._drawBar(this.hp / this.maxHp);
      return true;
    }

    // Drift toward the player beyond DRIFT_DISTANCE (grid pathing when
    // a wall blocks the line).
    if (dist > BOSS.DRIFT_DISTANCE) {
      if (this._wallFree(px, pz, boxes)) {
        this._move(px, pz, BOSS.DRIFT_SPEED * dt, dt, boxes);
      } else {
        this._greedyStep(px, pz, dt, boxes);
      }
    }

    this._drawBar(this.hp / this.maxHp);
    this._bob(dt);
    return true;
  }

  /** Gentle spectral hover bob (visual only). */
  _bob(dt) {
    const y = this.mesh.position.y;
    // (base y is the grounded value; add a small sine on top via userData)
    const base = this._baseY ?? (this._baseY = y);
    this.mesh.position.y = base + Math.sin(this._animT * 1.4) * 0.06;
  }

  // -----------------------------------------------------------------
  // Disposal
  // -----------------------------------------------------------------

  /** Remove from scene, dispose geometry/materials/sprites/clouds. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    // Clear smoke clouds first (§26: clouds disposed with the boss).
    for (const c of this.smokeClouds) {
      if (c.mesh) {
        if (this.scene && this.scene.remove) this.scene.remove(c.mesh);
        else if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
      }
      if (c.mat) c.mat.dispose();
    }
    this.smokeClouds.length = 0;
    for (const m of this._smokeMeshes || []) {
      if (this.scene && this.scene.remove) this.scene.remove(m);
      else if (m.parent) m.parent.remove(m);
    }
    this._smokeMeshes = [];
    if (this.scene && this.mesh.parent) this.scene.remove(this.mesh);
    else if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) {
      if (m.map && m.map.dispose) m.map.dispose();
      m.dispose();
    }
    this._geometries.length = 0;
    this._materials.length = 0;
    this.summonedWraiths.length = 0;
  }
}

export default GhostBoss;

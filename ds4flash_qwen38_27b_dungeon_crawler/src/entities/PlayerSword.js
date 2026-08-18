// PlayerSword (§9, §13, §15, §27)
// First-person weapon: camera child on layer 2 (the layer-0 headlight NEVER
// lights it — it is self-lit, casts no shadows). Built from six per-tier forms
// (straight per-segment geometry only; the blade floats — no hands).
//
// Combo state machine (§9.1): windup → swing → recover → (chain window) →
// next step, with a final cooldown between combos. Game resolves hits; the
// sword provides the cone geometry (origin, direction, range, halfAngle).
//
// Guard: this module must import headless (three + a guarded glow texture).

import * as THREE from 'three';
import {
  SWORD,
  swordHitDamage,
  swordSizeScale,
  MAX_TOTAL_SCALE,
  attackSpeedFromSouls,
  HIT_STOP,
} from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

export const LAYER_SWORD = 2;

// Blade lengths per tier — monotonic, ~0.76 (T0) → ~1.0 (T5).
const BLADE_LENGTHS = [0.76, 0.81, 0.86, 0.90, 0.95, 1.0];

// Arc-bolt target array is supplied by Game every frame (this.arcTargets).
// Bolt homing: speed SWORD.ARC_SPEED u/s, life SWORD.ARC_LIFE s.

export class PlayerSword {
  /**
   * @param {object} camera  Camera the sword is attached to (layer 2 child).
   * @param {object} opts
   *   opts.souls          collectedOrbs (souls counter) — drives attack speed & orb damage
   *   opts.level         current level (drives damageMult level part)
   *   opts.attackSpeedMult  buff component (EMPOWERED 1.2 / GODSPEED 1.5 / none 1.0)
   *   opts.lengthMult     1.0 normal, 1.5 under EMPOWERED
   *   Callbacks: onSwingHit, onHitStop, onElectricChain, onEvolution, arcTargets
   */
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.souls = opts.souls ?? 0;
    this.level = opts.level ?? 1;
    this.buffAttackSpeedMult = opts.attackSpeedMult ?? 1.0;
    this.lengthMult = opts.lengthMult ?? 1.0;

    // Game-supplied per-frame arc-bolt target array (objects with .position/.alive).
    this.arcTargets = opts.arcTargets || (() => []);

    // Callbacks (Game sets these).
    this.onSwingHit = opts.onSwingHit || null;   // (step, cone) — Game applies damage
    this.onHitStop = opts.onHitStop || null;     // (seconds)
    this.onElectricChain = opts.onElectricChain || null; // { damage, range }
    this.onBoltHit = opts.onBoltHit || null;     // (target, damage) — Game applies damage
    this.onEvolution = opts.onEvolution || null; // (tier)

    this._disposed = false;

    // --- sword root (camera child, layer 2) ---
    this.group = new THREE.Group();
    if (this.group.layers) this.group.layers.set(LAYER_SWORD);
    if (camera && camera.add) camera.add(this.group);
    // First-person placement (floating weapon, no hands).
    this.group.position.set(0.35, -0.32, -0.55);

    this._materials = [];   // all materials to dispose
    this._geometries = [];  // all geometries to dispose
    this._textures = [];    // glow textures we own

    this._glowTex = generateGlowTexture(); // may be null headless

    // --- evolution forms ---
    this.tier = 0;
    this._formMeshes = {};
    this._buildAllForms();
    this._showForm(0);
    this.bladeLength = BLADE_LENGTHS[0];

    // --- combo state ---
    this.comboStep = 0;       // 0 = idle, 1..3 = current step
    this._phase = 'idle';     // idle | windup | swing | recover | cooldown
    this._phaseT = 0;
    this._chainWindowEnd = 0; // seconds (performance clock basis from `now`)
    this._cooldownEnd = 0;
    this._bufferedPress = false;
    this._swingFired = false;
    this.isAttacking = false;
    this.canChain = false;

    // --- blade flash ---
    this._flashT = 0;

    // --- swing animation pose (group is the animated root; idle pose = home) ---
    this._anim = { p: 0, rotZ: 0, rotX: 0, posZ: 0, to: {} };

    // --- trails / sparks / smoke (§13 pools) ---
    this._trails = this._makeSpritePool(3);      // slash1 / slash2 / thrust
    this._trailIndex = 0;
    this._sparks = this._makeSpritePool(1);      // impact
    this._sparkIndex = 0;
    this._smoke = this._makeSpritePool(1, 0x111111); // dark wrap
    this._smokeIndex = 0;
    this._crackles = this._makeSpritePool(3);    // T5 blade crackle
    this._crackleIndex = 0;
    this._crackleTimer = 0;

    // --- arc bolts (§9.3): pool 8, max 6 in flight ---
    this._bolts = [];
    for (let i = 0; i < SWORD.ARC_POOL; i++) {
      const mat = this._trackMat(new THREE.SpriteMaterial({
        color: 0x99eeff,
        map: this._glowTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const sprite = new THREE.Sprite(mat);
      sprite.scale.setScalar(0.35);
      sprite.visible = false;
      sprite.position.set(0, 0, -100);
      if (camera && camera.add) camera.add(sprite);
      this._bolts.push({ sprite, active: false, target: null, life: 0, damage: 0, lastPos: new THREE.Vector3() });
    }
    this._boltIndex = 0;

    // --- T5: exactly ONE extra camera-attached point light (layer 2) ---
    this._t5Light = null;
  }

  // ------------------------------------------------------------------ forms
  _trackMat(m) { this._materials.push(m); return m; }
  _trackGeo(g) { this._geometries.push(g); return g; }

  _std(color, emissive = 0x000000, emissiveIntensity = 0) {
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity,
      roughness: 0.55,
      metalness: 0.5,
    });
    return this._trackMat(m);
  }

  /** Straight per-segment blade: grip → blade → tip. No Torus/TorusKnot, no bends. */
  _bladeGroup({ bladeLen, bladeMat, gripLen = 0.22, gripMat, crossguard = null, tip = null, extra = null }) {
    const g = new THREE.Group();
    const bladeGeo = this._trackGeo(new THREE.BoxGeometry(0.05, bladeLen, 0.02));
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.y = bladeLen / 2;
    g.add(blade);
    if (tip) g.add(tip);
    if (crossguard) {
      const cg = this._trackGeo(new THREE.BoxGeometry(0.14, 0.03, 0.05));
      const cm = new THREE.Mesh(cg, crossguard);
      cm.position.y = 0.02;
      g.add(cm);
    }
    const gripGeo = this._trackGeo(new THREE.CylinderGeometry(0.018, 0.022, gripLen, 6));
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.y = -gripLen / 2;
    g.add(grip);
    if (extra) g.add(extra);
    return g;
  }

  _buildAllForms() {
    // Tier 0 — Dagger (crude executioner's blade).
    {
      const g = new THREE.Group();
      const bladeMat = this._std(0x8a8a8f, 0x111111, 0.2);
      const gripMat = this._std(0x4a3b2a);
      const b = this._bladeGroup({
        bladeLen: BLADE_LENGTHS[0], bladeMat, gripLen: 0.16, gripMat,
        crossguard: this._std(0x3a3a3a),
      });
      g.add(b);
      this._formMeshes[0] = g;
    }
    // Tier 1 — Knight's arming sword with crossguard.
    {
      const g = new THREE.Group();
      const b = this._bladeGroup({
        bladeLen: BLADE_LENGTHS[1],
        bladeMat: this._std(0xb8bcc4, 0x222233, 0.15),
        gripLen: 0.2,
        gripMat: this._std(0x5a4632),
        crossguard: this._std(0xc9a227, 0x332200, 0.3),
      });
      g.add(b);
      this._formMeshes[1] = g;
    }
    // Tier 2 — Runic greatsword (glowing runes).
    {
      const g = new THREE.Group();
      const b = this._bladeGroup({
        bladeLen: BLADE_LENGTHS[2],
        bladeMat: this._std(0x9aa2ad, 0x224488, 0.4),
        gripLen: 0.24,
        gripMat: this._std(0x3d3226),
        crossguard: this._std(0x777788, 0x113355, 0.3),
      });
      // glowing rune strip down the blade
      const runeMat = this._trackMat(new THREE.MeshBasicMaterial({
        color: 0x66ccff, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const runeGeo = this._trackGeo(new THREE.BoxGeometry(0.012, BLADE_LENGTHS[2] * 0.7, 0.024));
      const rune = new THREE.Mesh(runeGeo, runeMat);
      rune.position.y = BLADE_LENGTHS[2] * 0.5;
      b.add(rune);
      g.add(b);
      this._formMeshes[2] = g;
    }
    // Tier 3 — Crystal soulblade (faceted crystal).
    // Color identity stops following the orb-size ladder at tier 3+ — the form owns its look.
    {
      const g = new THREE.Group();
      const bladeMat = this._std(0x77ddff, 0x33aaff, 1.2);
      const b = this._bladeGroup({
        bladeLen: BLADE_LENGTHS[3],
        bladeMat,
        gripLen: 0.26,
        gripMat: this._std(0x223344, 0x113355, 0.5),
        crossguard: this._std(0x8899bb, 0x224488, 0.6),
        tip: (() => {
          const tg = this._trackGeo(new THREE.ConeGeometry(0.03, 0.06, 4));
          const t = new THREE.Mesh(tg, bladeMat);
          t.position.y = BLADE_LENGTHS[3] + 0.03;
          return t;
        })(),
      });
      g.add(b);
      this._formMeshes[3] = g;
    }
    // Tier 4 — White-hot soulfire greatblade.
    {
      const g = new THREE.Group();
      const bladeMat = this._std(0xffe9c9, 0xffaa44, 1.8);
      const b = this._bladeGroup({
        bladeLen: BLADE_LENGTHS[4],
        bladeMat,
        gripLen: 0.28,
        gripMat: this._std(0x2a1f14, 0x662200, 0.6),
        crossguard: this._std(0xffbb66, 0xff7722, 0.8),
        tip: (() => {
          const tg = this._trackGeo(new THREE.ConeGeometry(0.035, 0.07, 4));
          const t = new THREE.Mesh(tg, bladeMat);
          t.position.y = BLADE_LENGTHS[4] + 0.035;
          return t;
        })(),
      });
      g.add(b);
      this._formMeshes[4] = g;
    }
    // Tier 5 — Lightsaber (emitting electric arcs / crackle).
    {
      const g = new THREE.Group();
      const bladeMat = this._std(0xeaffff, 0xaaffff, 2.5);
      const b = this._bladeGroup({
        bladeLen: BLADE_LENGTHS[5],
        bladeMat,
        gripLen: 0.3,
        gripMat: this._std(0x222222, 0x00aaff, 0.8),
        crossguard: this._std(0x88ddff, 0x44ccff, 1.0),
        tip: (() => {
          const tg = this._trackGeo(new THREE.ConeGeometry(0.035, 0.07, 4));
          const t = new THREE.Mesh(tg, bladeMat);
          t.position.y = BLADE_LENGTHS[5] + 0.035;
          return t;
        })(),
      });
      g.add(b);
      this._formMeshes[5] = g;
    }

    // Attach every prebuilt tier form to the sword root. _showForm() only
    // toggles .visibility, so forms not parented into this.group are orphans
    // outside the scene graph and never render, regardless of camera layers.
    for (const g of Object.values(this._formMeshes)) this.group.add(g);
  }

  /**
   * Set the weapon tier (ceiling — only upgrades in-run). Rebuilds nothing;
   * all six forms are prebuilt. Fires onEvolution(tier) + evolution hit-stop.
   */
  setTier(tier) {
    tier = Math.max(0, Math.min(5, Math.floor(tier)));
    if (tier <= this.tier) {
      // Still ensure the form is shown (idempotent).
      this._showForm(tier);
      return;
    }
    const prev = this.tier;
    this.tier = tier;
    this.bladeLength = BLADE_LENGTHS[tier];
    this._showForm(tier);
    this._flashT = SWORD.BLADE_FLASH;
    // T5: exactly ONE extra camera-attached point light.
    if (tier >= 5 && !this._t5Light) {
      const light = new THREE.PointLight(0xaaddff, 1.5, 8, 2);
      if (light.layers) light.layers.set(LAYER_SWORD);
      light.position.set(0.35, -0.32, -0.55);
      if (this.camera && this.camera.add) this.camera.add(light);
      this._t5Light = light;
    }
    if (this.onEvolution) this.onEvolution(tier, prev);
    if (this.onHitStop) this.onHitStop(HIT_STOP.EVOLUTION);
  }

  _showForm(tier) {
    for (let i = 0; i <= 5; i++) {
      const m = this._formMeshes[i];
      if (m) m.visible = (i === tier);
    }
    // Self-lit: no shadow casting (gotcha §27).
    const form = this._formMeshes[tier];
    if (form) {
      form.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    }
  }

  // ------------------------------------------------------------- attack API
  /** Current scale: min(swordSizeScale(tier) × lengthMult, 5.0). */
  get scale() {
    return Math.min(swordSizeScale(this.tier) * this.lengthMult, MAX_TOTAL_SCALE);
  }

  /** Total attack-speed multiplier (buffs × souls component). Durations only. */
  get attackSpeed() {
    return this.buffAttackSpeedMult * attackSpeedFromSouls(this.souls);
  }

  /** Swing reach: SWORD.RANGE × scale × (1 + 0.04·tier); thrust ×1.25. */
  _rangeForStep(step) {
    let r = SWORD.RANGE * this.scale * (1 + SWORD.TIER_REACH_BONUS * this.tier);
    if (step === 3) r *= SWORD.THRUST_RANGE_MULT;
    return r;
  }

  /**
   * Damage for a step at the given tier, with external damage multiplier.
   * damage = swordHitDamage(step, tier) × damageMult.
   */
  damage(step, tier, damageMult) {
    return swordHitDamage(step, tier) * damageMult;
  }

  /**
   * Edge-triggered by the consumer (Game) on RMB press. Starts/extends the combo.
   */
  attack() {
    if (this._disposed) return;
    const now = this._now;
    if (this._phase === 'idle' || this._phase === 'cooldown') {
      if (now < this._cooldownEnd) return; // still in inter-combo cooldown
      this._startStep(1, now);
      return;
    }
    if (this._phase === 'recover' && this.canChain && this.comboStep < 3) {
      // Chain into the next step (or buffered press).
      // `comboStep < 3` guard: step 3 is the final thrust — chaining past it
      // would set comboStep=4, and SWORD.COMBO has no key 4 → `SWORD.COMBO[4]`
      // is undefined and the next update() throws on `.windup`. (Mirrors the
      // guard in update()'s recover branch.)
      this._startStep(this.comboStep + 1, now);
      return;
    }
    if (this._phase === 'swing' || this._phase === 'windup') {
      // Press buffered — chains when the recover window opens.
      this._bufferedPress = true;
    }
  }

  _startStep(step, now) {
    this.comboStep = step;
    this._phase = 'windup';
    this._phaseT = 0;
    this._swingFired = false;
    this._bufferedPress = false;
    this.isAttacking = true;
    this.canChain = false;
    // Per-step swing pose targets (Z = arc side-swing, X = overhead, Z-forward
    // lunge = thrust). Step 3 is a forward piercing thrust, no lateral arc.
    const a = this._anim;
    if (step === 1) { a.to.rotZ = 0.95; a.to.rotX = -0.35; a.to.posZ = 0.06; }
    else if (step === 2) { a.to.rotZ = -0.95; a.to.rotX = -0.35; a.to.posZ = 0.06; }
    else { a.to.rotZ = 0; a.to.rotX = 0.55; a.to.posZ = 0.34; }
    a.to.p = 1;
  }

  /**
   * Per-frame update.
   * @param {number} dt   frame delta (seconds)
   * @param {number} playerYaw  (reserved for aim assist / cone origin tuning)
   * @param {number} now  monotonically increasing seconds (performance clock)
   */
  update(dt, playerYaw = 0, now = 0) {
    if (this._disposed) return;
    this._now = now;

    // --- combo state machine ---
    const speed = this.attackSpeed;
    if (this._phase === 'idle') {
      this.isAttacking = false;
      this.canChain = false;
    } else if (this._phase === 'windup') {
      this.isAttacking = true;
      this.canChain = false;
      this._phaseT += dt;
      const dur = SWORD.COMBO[this.comboStep].windup / speed; // speed scales duration only
      if (this._phaseT >= dur) { this._phase = 'swing'; this._phaseT = 0; }
    } else if (this._phase === 'swing') {
      this.isAttacking = true;
      this.canChain = false;
      this._phaseT += dt;
      const stepDef = SWORD.COMBO[this.comboStep];
      const dur = stepDef.swing / speed;
      if (!this._swingFired) {
        this._swingFired = true;
        this._fireSwingHit(this.comboStep);
      }
      if (this._phaseT >= dur) {
        this._phase = 'recover';
        this._phaseT = 0;
        this._chainWindowEnd = now + SWORD.COMBO_WINDOW / 1; // window in world-time; chain input is buffered via attack()
        if (this.comboStep === 3) {
          // final step: cooldown between combos after recover.
        }
      }
    } else if (this._phase === 'recover') {
      this.isAttacking = true;
      this._phaseT += dt;
      const dur = SWORD.COMBO[this.comboStep].recover / speed;
      this.canChain = now < this._chainWindowEnd;
      if (this._bufferedPress && this.canChain && this.comboStep < 3) {
        this._startStep(this.comboStep + 1, now);
        return;
      }
      if (this._phaseT >= dur) {
        if (this.comboStep >= 3) {
          this._phase = 'cooldown';
          this._phaseT = 0;
          this._cooldownEnd = now + SWORD.COMBO_COOLDOWN;
          this.comboStep = 0;
          this.isAttacking = false;
          this.canChain = false;
        } else {
          // recover done but outside the chain window → combo ends early.
          this._phase = 'cooldown';
          this._phaseT = 0;
          this._cooldownEnd = now + SWORD.COMBO_COOLDOWN;
          this.comboStep = 0;
          this.isAttacking = false;
          this.canChain = false;
        }
      }
    } else if (this._phase === 'cooldown') {
      this.isAttacking = false;
      this.canChain = false;
      if (now >= this._cooldownEnd) {
        this._phase = 'idle';
        this.comboStep = 0;
      }
    }

    // --- swing pose (group transform): windup pulls back, swing extends
    //     through the strike, recover returns to the floating home pose.
    //     p in [0,1] is the strike extension; windup runs it 0→1 with the
    //     target direction negated (pull-back), recover eases 1→0. ---
    {
      const a = this._anim;
      const stepDef = SWORD.COMBO[this.comboStep] || null;
      if (this._phase === 'windup' && stepDef) {
        a.p = Math.min(1, this._phaseT / stepDef.windup);
      } else if (this._phase === 'swing' && stepDef) {
        a.p = 1;
      } else if (this._phase === 'recover' && stepDef) {
        a.p = Math.max(0, 1 - this._phaseT / stepDef.recover);
      } else {
        a.p = 0;
      }
      const dir = (this._phase === 'windup') ? -1 : 1;
      const p = a.p * dir;
      a.rotZ = a.to.rotZ * p;
      a.rotX = a.to.rotX * p;
      a.posZ = a.to.posZ * p;
      if (this.group) {
        this.group.rotation.z = a.rotZ;
        this.group.rotation.x = a.rotX;
        this.group.position.z = -0.55 + a.posZ;
      }
    }

    // --- blade flash decay ---
    if (this._flashT > 0) this._flashT = Math.max(0, this._flashT - dt);

    // --- trail sprites fade (1 per pool × 3 pools) ---
    this._ageSprites(this._trails, dt, 0.18);
    // sparks
    this._ageSprites(this._sparks, dt, 0.10);
    // smoke (dark wrap)
    this._ageSprites(this._smoke, dt, 0.5);
    // T5 blade crackle (pool 3)
    if (this.tier === 5) {
      this._crackleTimer += dt;
      if (this._crackleTimer >= 0.12) {
        this._crackleTimer = 0;
        this._spawnCrackle();
      }
    }
    this._ageSprites(this._crackles, dt, 0.12);

    // --- arc bolts: home toward target, fizzle at life end ---
    const targets = this.arcTargets ? this.arcTargets() : [];
    for (const b of this._bolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (b.life <= 0) { b.active = false; b.sprite.visible = false; b.target = null; continue; }
      // re-target on target death
      if (b.target && !b.target.alive) b.target = null;
      if (!b.target) {
        b.target = this._nearestAliveTarget(targets, b.lastPos, SWORD.ARC_TARGET_RANGE);
        if (!b.target) { b.active = false; b.sprite.visible = false; continue; }
      }
      const to = _tmpA.copy(b.target.position).sub(b.sprite.position);
      const dist = to.length();
      if (dist < 0.4) {
        // landed: deal the frozen-at-fire-time orb damage (Game resolves
        // death / orbs / burst via hitSkeleton).
        const hitTarget = b.target;
        const dmg = b.damage;
        b.active = false; b.sprite.visible = false; b.target = null;
        if (this.onBoltHit && hitTarget) this.onBoltHit(hitTarget, dmg);
        continue;
      }
      to.normalize();
      b.sprite.position.addScaledVector(to, SWORD.ARC_SPEED * dt);
      b.lastPos.copy(b.sprite.position);
    }
  }

  /** Nearest alive target within range of `from`. */
  _nearestAliveTarget(targets, from, maxDist) {
    let best = null, bestD = maxDist;
    for (const t of targets) {
      if (!t || !t.alive || !t.position) continue;
      const d = from.distanceTo(t.position);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  // ------------------------------------------------------------- swing hit
  /** Provide cone geometry to Game and roll procs. */
  _fireSwingHit(step) {
    const stepDef = SWORD.COMBO[step];
    const range = this._rangeForStep(step);
    const cone = {
      origin: new THREE.Vector3(),          // Game offsets this by player position if needed
      direction: new THREE.Vector3(0, 0, -1), // local camera forward; Game applies yaw
      range,
      halfAngle: stepDef.arc,
      step,
    };
    if (this.onSwingHit) this.onSwingHit(step, cone);
    // hit-stop on any sword hit
    if (this.onHitStop) this.onHitStop(HIT_STOP.SWORD);
    this._flashT = SWORD.BLADE_FLASH;
    this._spawnTrail(step);
    this._spawnSpark();
    this._spawnSmoke();
    this._rollProcs(step);
  }

  /** Electric proc (all tiers) + arc bolts (tiers 3–5). */
  _rollProcs(step) {
    // Electric chain: SWORD.ELECTRIC_CHANCE at SWORD top level (§27 hoist).
    if (Math.random() < SWORD.ELECTRIC_CHANCE) {
      if (this.onHitStop) this.onHitStop(HIT_STOP.ELECTRIC);
      if (this.onElectricChain) {
        this.onElectricChain({
          damage: SWORD.ELECTRIC_DAMAGE_MULT * this.orbDamage,
          range: SWORD.ELECTRIC_RANGE,
        });
      }
    }
    // Arc bolts (T3+).
    if (this.tier >= 3) {
      const chance = SWORD.ARC_CHANCE[this.tier];
      if (Math.random() < chance) {
        const count = SWORD.ARC_BOLTS[this.tier];
        for (let i = 0; i < count; i++) this._spawnBolt();
      }
    }
  }

  /** orb damage frozen at fire time: Math.round(orbDamage(souls)); orbDamage = 1 + 0.02·orbs. */
  get orbDamage() {
    return 1 + 0.02 * this.souls;
  }

  _spawnBolt() {
    const targets = this.arcTargets ? this.arcTargets() : [];
    const origin = _tmpB.set(0.35, -0.32, -1.0); // sword tip, world-ish local
    // in-flight cap
    let inFlight = 0;
    for (const b of this._bolts) if (b.active) inFlight++;
    if (inFlight >= SWORD.ARC_MAX_IN_FLIGHT) return;
    // nearest alive enemy within 20u
    const target = this._nearestAliveTarget(targets, origin, SWORD.ARC_TARGET_RANGE);
    if (!target) return;
    const b = this._bolts[this._boltIndex];
    this._boltIndex = (this._boltIndex + 1) % this._bolts.length;
    b.active = true;
    b.target = target;
    b.life = SWORD.ARC_LIFE;
    b.damage = Math.round(this.orbDamage); // frozen at fire time
    b.sprite.visible = true;
    b.sprite.position.copy(target.position).addScaledVector(
      _tmpC.copy(origin).sub(target.position).normalize(), 2.0
    );
    b.lastPos.copy(b.sprite.position);
  }

  // ------------------------------------------------------------- sprites
  _makeSpritePool(count, color = 0xffffff) {
    const pool = [];
    for (let i = 0; i < count; i++) {
      const mat = this._trackMat(new THREE.SpriteMaterial({
        color,
        map: this._glowTex, // null-safe: null map on a SpriteMaterial is valid
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.position.set(0, 0, -100);
      s.userData.t = 0;
      if (this.camera && this.camera.add) this.camera.add(s);
      pool.push(s);
    }
    return pool;
  }

  _nextSprite(pool, index) {
    const s = pool[index % pool.length];
    return s;
  }

  _spawnTrail(step) {
    const idx = this._trailIndex = (this._trailIndex + 1) % this._trails.length;
    const s = this._trails[idx];
    s.visible = true;
    s.userData.t = 1;
    s.position.set(0.3, -0.3, -1.2);
    s.scale.setScalar(step === 3 ? 0.25 : 0.5);
  }

  _spawnSpark() {
    const s = this._sparks[0];
    s.visible = true;
    s.userData.t = 1;
    s.position.set(0.35, -0.3, -1.4);
    s.scale.setScalar(0.3);
  }

  _spawnSmoke() {
    const s = this._smoke[0];
    s.visible = true;
    s.userData.t = 1;
    s.position.set(0.35, -0.3, -1.4);
    s.scale.setScalar(0.4);
  }

  _spawnCrackle() {
    const idx = this._crackleIndex = (this._crackleIndex + 1) % this._crackles.length;
    const s = this._crackles[idx];
    s.visible = true;
    s.userData.t = 1;
    s.position.set(0.35 + (Math.random() - 0.5) * 0.2, -0.3 + (Math.random() - 0.5) * 0.2, -1.2);
    s.scale.setScalar(0.18);
  }

  /** Age pooled sprites: fade opacity, hide at t=0. */
  _ageSprites(pool, dt, ttl) {
    for (const s of pool) {
      if (!s.visible) continue;
      s.userData.t -= dt / ttl;
      if (s.userData.t <= 0) {
        s.visible = false;
        s.material.opacity = 0;
      } else {
        s.material.opacity = s.userData.t;
      }
    }
  }

  // ------------------------------------------------------------- dispose
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // T5 light
    if (this._t5Light) {
      if (this.camera && this.camera.remove) this.camera.remove(this._t5Light);
      this._t5Light.dispose();
      this._t5Light = null;
    }
    // arc bolt sprites
    for (const b of this._bolts) {
      b.active = false;
      b.target = null;
      b.sprite.visible = false;
      if (this.camera && this.camera.remove) this.camera.remove(b.sprite);
      b.sprite.material.dispose();
    }
    // trail / spark / smoke / crackle sprites
    for (const pool of [this._trails, this._sparks, this._smoke, this._crackles]) {
      for (const s of pool) {
        s.visible = false;
        if (this.camera && this.camera.remove) this.camera.remove(s);
        s.material.dispose();
      }
    }
    // form meshes
    for (let i = 0; i <= 5; i++) {
      const m = this._formMeshes[i];
      if (m) m.visible = false;
    }
    // detach group
    if (this.camera && this.camera.remove) this.camera.remove(this.group);

    // geometries & materials (guarded: double dispose is safe)
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) m.dispose();
    for (const t of this._textures) if (t) t.dispose();
    this._formMeshes = {};
    this._geometries = [];
    this._materials = [];
    this._textures = [];
  }
}

// scratch vectors (module-level, zero per-frame allocation)
const _tmpA = new THREE.Vector3();
const _tmpB = new THREE.Vector3();
const _tmpC = new THREE.Vector3();

export default PlayerSword;

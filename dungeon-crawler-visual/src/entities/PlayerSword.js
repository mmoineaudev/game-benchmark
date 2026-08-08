import * as THREE from 'three';
import { SWORD, EVOLUTION, swordHitDamage, orbPowerMultiplier } from '../core/Constants.js';
import { generateGlowTexture } from '../world/Textures.js';

// First-person DAGGER attached to the camera: a short, tapered double-edged
// blade with a blood groove, small quillon crossguard, wrapped grip and brass
// pommel. The ready pose holds it close, point aimed at the enemy; the
// attack is a 3-step combo:
//   WINDUP1 -> SLASH1 (rising diagonal "/") -> RECOVER1 -> [window]
//   -> WINDUP2 -> SLASH2 (falling diagonal "\", crossing to an X)
//   -> RECOVER2 -> [window] -> WINDUP3 -> THRUST3 (piercing stab forward)
//   -> RECOVER3 -> COOLDOWN -> IDLE
// Combo window: 0.34 s from each RECOVER start (0.14 s recover + 0.20 s grace).
// Every strike PIVOTS AT THE POMBEL: the hand stays anchored (a small drift
// at most) while the short blade fans ±1.15 rad (~66°) around it, so the tip
// — not the handle — sweeps the visible arc. The blade leans forward
// (rot.x ≈ -0.2) so the tip stays low through the arc. Only the thrust is
// translation-driven (a stab drives the whole dagger forward). Each strike
// leaves a visible movement trace: pooled additive sprites spawned at the
// blade tip in camera space while the blade is moving, so the arc path
// lingers after the dagger has moved on (icy blue "/", gold "\", white-hot
// thrust).
//
// Progression: the dagger grows +20% per 10 orbs held (capped at +200% = 3x
// at 100 orbs), extends melee range, shifts base color each size bonus, and
// intensifies the green growth light. Danger glow: red emissive + light when
// skeletons are close. Trail + impact sparks + hit-stop provide feedback.
const BLADE_COLORS = [
  0x3a3e46, // step 0: black gunmetal steel (base — black & silver look)
  0xb08a5a, // step 1: bronze
  0x8a9ab0, // step 2: iron-blue
  0xd8c86a, // step 3: gold
  0x6ad86a, // step 4: emerald
  0x5ac8d8, // step 5: teal
  0x5a8ad8, // step 6: sapphire
  0x9a5ad8, // step 7: amethyst
  0xd85aa0, // step 8: magenta
  0xff5544, // step 9: inferno
  0xfff4d8, // step 10: radiant
];

// Blade tip in group-local space (pointed apex of the executioner blade).
const TIP_LOCAL = new THREE.Vector3(0, 0.60, 0.02);
// Grip-bottom / pommel pivot probe (no crossguard — repurposed for tests).
const POMMEL_LOCAL = new THREE.Vector3(0, -0.21, 0);
// Grip-top reference (what the legacy 'guard' probe points at now).
const GRIP_LOCAL = new THREE.Vector3(0, 0.0, 0.03);

export class PlayerSword {
  constructor(camera) {
    this.camera = camera;
    // idle | windup1 | slash1 | recover1 | windup2 | slash2 | recover2 | windup3 | thrust3 | recover3 | cooldown
    this.state = 'idle';
    this.time = 0;
    this.cool = 0;
    this.comboStep = 0;   // 0 | 1 | 2 | 3 (HUD)
    this.group = new THREE.Group();
    this._glow = 0;        // current danger glow intensity (damped)
    this._glowTarget = 0;
    this._colorStep = 0;
    this._rangeScale = 1;
    this.tier = 0;         // weapon evolution tier (0..5) — WEAPON_EVOLUTION_PLAN §3
    this._formMeshes = [[], [], [], [], [], []]; // per-tier mesh sets (§4.3 Arsenal of Ascension)
    this._tipLocal = new THREE.Vector3(0, 0.60, 0.02); // blade tip (tier-scaled by _applyForm)
    this.lengthMult = 1;   // temporary length boost (EMPOWERED buff)
    this.attackSpeedMult = 1; // temporary attack-speed boost (EMPOWERED buff)
    this._flashTimer = 0;
    this._orbSmokeFactor = 0; // 0..1, ~ shared with orb count (capped at 500)
    this._smokeAcc = 0;
    this._build();
    this._buildTrails();
    this._buildSparks();
    this._buildSmoke();
    camera.add(this.group);
    this._setRest();
  }

  _build() {
    const dark = new THREE.MeshStandardMaterial({
      color: 0x3a2f24, roughness: 0.6, metalness: 0.6,
      emissive: 0x2a241e, emissiveIntensity: 0.8, // self-lit (see _freezeLighting)
    });
    // Separate blade material so the danger glow (emissive) can animate.
    // Base is BLACK steel with a cool (NOT red) self-lit tint — red is reserved
    // for the enemy-presence danger sprite/light, so the idle blade reads as
    // black & silver, never as a false "enemy nearby" signal.
    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0x2a2d33, roughness: 0.3, metalness: 0.95,
      emissive: 0x14181f, emissiveIntensity: 0.8, // cool gunmetal self-lit
    });
    this.steelMat = new THREE.MeshStandardMaterial({
      color: 0x9aa0aa, roughness: 0.25, metalness: 0.95,
      emissive: 0x20242c, emissiveIntensity: 0.6, // silver, cool self-lit
    });
    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xd8b44a, roughness: 0.4, metalness: 0.8,
      emissive: 0x6a552c, emissiveIntensity: 0.75,
    });
    this._darkMat = dark;
    this._mats = [this.bladeMat, this.steelMat, this.brassMat, dark];
    // The dagger must NOT catch the ×10 player headlight: put every sword
    // mesh on layer 2, which the layer-0 headlight never lights. Emissive
    // above keeps the blade readable on its own.
    this.group.traverse((o) => { if (o.isMesh) o.layers.set(2); });

    // ------------------------------------------------------------------
    // Executioner's sword: ONE long broad straight blade with a pointed
    // tip, NO crossguard, single-edged (sharpened on the front side only —
    // a fuller runs near the back edge, mirroring a real executioner
    // sword's asymmetric grind). No bend anywhere.
    // Group origin sits at the grip; blade points up (+y), flat faces ±z.

    // Ricasso/blade base: broad flat steel slab from the grip upward.
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.08), this.bladeMat);
    blade.position.y = 0.21;
    this.group.add(blade);
    this._upperBlade = blade;

    // Pointed tip: a tapered, flattened wedge that comes to a clean point.
    // (cone with 4 radial segs = a diamond cross-section; flattened in x.)
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.34, 4), this.bladeMat);
    tip.position.y = 0.56;
    tip.rotation.y = Math.PI / 4;        // align the flat faces to ±z
    tip.scale.set(0.6, 1, 1);            // flatten x -> broad, flat blade point
    this.group.add(tip);
    this._tip = tip;

    // Fuller (blood groove) near the BACK edge — signals a single-edged
    // grind with the sharpened edge on the front (camera-facing) side.
    const fullerMat = new THREE.MeshStandardMaterial({
      color: 0xd8dce2, roughness: 0.3, metalness: 0.92, // bright silver edge
      emissive: 0x4a5058, emissiveIntensity: 0.5,
    });
    this._mats.push(fullerMat);
    this._fullerMat = fullerMat;
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.4, 0.006), fullerMat);
    fuller.position.set(0, 0.21, 0.033); // toward the +z (back) face
    this.group.add(fuller);
    this._fuller = fuller;

    // Wrapped grip directly below the blade — no crossguard between them.
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.18, 8), dark);
    grip.position.y = -0.09;
    this.group.add(grip);
    this._grip = grip;
    // Grip collar (where blade seats into the grip).
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.03, 8), dark);
    collar.position.y = 0.0;
    this.group.add(collar);
    this._collar = collar;

    // Brass pommel at the very bottom (the pivot the combos swing around).
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), this.brassMat);
    pommel.position.y = -0.21;
    this.group.add(pommel);
    this._pommel = pommel;

    // Danger glow sprite around the blade
    this._glowTex = generateGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0xff3322,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this.glowSprite = new THREE.Sprite(this.glowMat);
    this.glowSprite.position.set(0, 0.3, 0);
    this.glowSprite.scale.setScalar(0.28);
    this.group.add(this.glowSprite);

    // Danger light
    this.dangerLight = new THREE.PointLight(0xff3322, 0, 7, 1.6);
    this.dangerLight.position.set(0, 0.3, 0.15);
    this.group.add(this.dangerLight);

    // Growth light + green sprite (intensity follows size bonus)
    this.growthLight = new THREE.PointLight(0x44ff88, 0, 8, 1.6);
    this.growthLight.position.set(0, 0.32, 0.05);
    this.group.add(this.growthLight);
    this.growthGlowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0x44ff88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0,
    });
    this.growthGlow = new THREE.Sprite(this.growthGlowMat);
    this.growthGlow.position.set(0, 0.3, 0);
    this.growthGlow.scale.setScalar(0.26);
    this.group.add(this.growthGlow);

    this.group.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.layers.set(2); } });
  }

  // Movement strike traces: pooled additive sprites, one pool per strike so
  // each slash/thrust gets its own color. Sprites are CAMERA children (not
  // group children) — they linger in space while the sword moves on, tracing
  // the blade tip's arc across the screen.
  _buildTrails() {
    this._trailPools = [
      { color: 0x88ccff, life: 0.18, size: 0.34, sprites: [], idx: 0 }, // slash 1: icy
      { color: 0xffcc66, life: 0.18, size: 0.34, sprites: [], idx: 0 }, // slash 2: gold
      { color: 0xfff0c0, life: 0.20, size: 0.40, sprites: [], idx: 0 }, // thrust: white-hot
    ];
    for (const pool of this._trailPools) {
      pool.mat = new THREE.SpriteMaterial({
        map: this._glowTex,
        color: pool.color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0,
      });
      this._mats.push(pool.mat);
      for (let i = 0; i < 1; i++) {  // ~90% cut from 4 — minimal strike-trace particles
        const s = new THREE.Sprite(pool.mat);
        s.visible = false;
        this.camera.add(s);
        pool.sprites.push({ sprite: s, life: 0, active: false });
      }
    }
  }

  // Blade tip position in camera space (the sword group is a camera child).
  _tipCamSpace() {
    return this._tipLocal.clone().applyEuler(this.group.rotation).add(this.group.position);
  }

  _spawnTrail(pool, burst = false) {
    const n = burst ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const t = pool.sprites[pool.idx];
      pool.idx = (pool.idx + 1) % pool.sprites.length;
      t.active = true;
      t.life = pool.life * (0.8 + Math.random() * 0.4);
      t.sprite.visible = true;
      // Small jitter around the blade tip so the trace reads as a glowing arc
      const p = this._tipCamSpace();
      p.x += (Math.random() - 0.5) * 0.04;
      p.y += (Math.random() - 0.5) * 0.04;
      p.z += (Math.random() - 0.5) * 0.02;
      t.sprite.position.copy(p);
      t.sprite.scale.setScalar(pool.size * (0.8 + Math.random() * 0.5));
      t.sprite.material.opacity = 0.55;
    }
  }

  _updateTrails(dt) {
    for (const pool of this._trailPools) {
      for (const t of pool.sprites) {
        if (!t.active) continue;
        t.life -= dt;
        if (t.life <= 0) {
          t.active = false;
          t.sprite.visible = false;
          continue;
        }
        t.sprite.material.opacity = 0.55 * (t.life / pool.life);
        t.sprite.scale.multiplyScalar(1 + dt * 5);
      }
    }
  }

  _buildSparks() {
    // 8 pooled impact spark spheres (camera children; burstSparks converts
    // the world hit position into camera space)
    this.sparkGeo = new THREE.SphereGeometry(0.03, 4, 4);
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffcc88 });
    this._mats.push(this.sparkMat);
    this._sparks = [];
    for (let i = 0; i < 1; i++) {  // ~90% cut from 4 — minimal impact-spark particles
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.visible = false;
      this.camera.add(m);
      this._sparks.push({
        mesh: m, vel: new THREE.Vector3(), life: 0, active: false,
      });
    }
  }

  // Burst of sparks at a world position (called by Game on hit)
  burstSparks(worldPos) {
    // Convert the world hit position to camera space: the spark meshes are
    // camera children, so they need local coordinates to appear at the hit.
    this.camera.updateMatrixWorld(true);
    const local = worldPos.clone().applyMatrix4(this.camera.matrixWorldInverse);
    for (const s of this._sparks) {
      if (s.active) continue;
      s.active = true;
      s.life = 0.25;
      s.mesh.visible = true;
      s.mesh.position.copy(local);
      s.vel.set(
        (Math.random() - 0.5) * 6,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 6,
      );
    }
  }

  _updateSparks(dt) {
    for (const s of this._sparks) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      s.vel.y -= 4 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
    }
  }

  // Black smoke coiling around the blade. Uses NORMAL blending (additive black
  // would be invisible) with a dark color, and bleeds off the whole blade
  // length so it "wraps" the weapon rather than just the tip.
  _buildSmoke() {
    this._smokeSprites = [];
    this._smokeIdx = 0;
    for (let i = 0; i < 1; i++) {  // ~90% cut from 14 — minimal sword-smoke particles
      const mat = new THREE.SpriteMaterial({
        map: this._glowTex, color: 0x08090b,
        blending: THREE.NormalBlending, depthWrite: false,
        transparent: true, opacity: 0,
      });
      this._mats.push(mat);
      const s = new THREE.Sprite(mat);
      s.visible = false;
      this.camera.add(s);
      this._smokeSprites.push({
        sprite: s, vel: new THREE.Vector3(), life: 0, maxLife: 0.9, active: false,
      });
    }
  }

  // Emit from a random point along the blade length (pommel -> tip), so the
  // smoke swirls up and wraps the whole weapon.
  _emitSmoke() {
    // sample a point along the blade (local y between -0.18 grip and 0.60 tip)
    const along = -0.18 + Math.random() * 0.78;
    const local = new THREE.Vector3((Math.random() - 0.5) * 0.06, along, (Math.random() - 0.5) * 0.05)
      .applyEuler(this.group.rotation).add(this.group.position);
    for (let k = 0; k < 2; k++) {
      const s = this._smokeSprites[this._smokeIdx];
      this._smokeIdx = (this._smokeIdx + 1) % this._smokeSprites.length;
      s.active = true;
      s.life = s.maxLife * (0.6 + Math.random() * 0.7);
      s.sprite.visible = true;
      s.sprite.position.copy(local);
      s.sprite.scale.setScalar(0.16 + Math.random() * 0.12);
      s.sprite.material.opacity = 0.5 + Math.random() * 0.2;
      s.vel.set(
        (Math.random() - 0.5) * 0.5,
        0.4 + Math.random() * 0.5,
        (Math.random() - 0.5) * 0.3,
      );
    }
  }

  // Called every frame from Game. Emission rate scales with orbs, and each
  // wisp rises / drifts / expands / fades (dark smoke wraps the blade).
  updateSmoke(dt) {
    // Always emit a baseline (independent of orb count) so the black smoke
    // wrap is always visible.
    this._smokeAcc += dt * (0.1 + this._orbSmokeFactor * 0.1);  // emission ~90% cut
    while (this._smokeAcc >= 1) {
      this._emitSmoke();
      this._smokeAcc -= 1;
    }
    for (const s of this._smokeSprites) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        s.sprite.visible = false;
        continue;
      }
      const f = s.life / s.maxLife;
      s.sprite.material.opacity = (0.5 + 0.2 * f) * f; // fade out over life
      s.sprite.scale.addScalar(dt * 0.6);
      s.sprite.position.addScaledVector(s.vel, dt);
    }
  }

  // Ready pose: hand anchored bottom-right (well right of the crosshair),
  // dagger held close, point aimed at the enemy — the short blade and small
  // guard never cover the aim point, even at maximum size.
  _setRest() {
    // Sword held clearly to the RIGHT of the crosshair (positive x = screen right)
    this.group.position.set(0.80, -0.22, -0.80);
    this.group.rotation.set(-0.15, 0, 0.38);
  }

  // Effective melee reach — grows with the sword size bonus AND the evolution
  // tier (+4% per tier, WEAPON_EVOLUTION_PLAN §3).
  get range() {
    return SWORD.RANGE * this._rangeScale * (1 + EVOLUTION.RANGE_PER_TIER * this.tier);
  }

  get scale() {
    return this._rangeScale;
  }

  // Set the evolution tier: +1 damage per hit, +4% reach per tier, and a new
  // visual form (built in _applyForm — B2/B3/B4). Called by Game on threshold
  // crossing and level start.
  setTier(tier) {
    this.tier = Math.max(0, Math.min(EVOLUTION.MAX_TIER, tier | 0));
    if (this._applyForm) this._applyForm(this.tier);
  }

  // ----------------------------------------------------------------------
  // Arsenal of Ascension (WEAPON_EVOLUTION_PLAN §4): every tier is a DIFFERENT
  // weapon, not a trim of the same dagger. Builders are idempotent — each
  // creates its meshes once into this.group and records them in
  // _formMeshes[tier]; _applyForm hides every other tier's set and shows the
  // current one. TIP_LOCAL follows the tip so trails/hit arcs need no changes.
  // T0/T5 are visually unchanged from the pre-redesign game.
  // ----------------------------------------------------------------------

  _ensureForms() {
    if (this._formsBuilt) return;
    this._formsBuilt = true;
    this._formCleaver();
    this._formArmingSword();
    this._formRunicGreatsword();
    this._formCrystalSoulblade();
    this._formSoulfireGreatblade();
    this._formLightsaber();
    // Shared blade glow sprite (tuned per tier in _applyForm; T3 subtle, T4+ strong)
    this._bladeGlowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0x66eeff,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    });
    this._bladeGlow = new THREE.Sprite(this._bladeGlowMat);
    this.group.add(this._bladeGlow);
    this._mats.push(this._bladeGlowMat);
  }

  _tagFormMeshes(tier, meshes) {
    for (const m of meshes) {
      m.layers.set(2);
      m.castShadow = false;
      this.group.add(m);
      this._formMeshes[tier].push(m);
    }
  }

  // T0 — Executioner's Cleaver (byte-identical: meshes built in _build()).
  _formCleaver() {
    this._formMeshes[0] = [
      this._upperBlade, this._tip, this._fuller,
      this._grip, this._collar, this._pommel,
    ];
  }

  // T1 — Knight's Arming Sword: classic crossguard + central fuller.
  _formArmingSword() {
    const meshes = [];
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.40, 0.012), this.steelMat);
    blade.position.y = 0.20;
    meshes.push(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.30, 4), this.steelMat);
    tip.position.y = 0.62;
    tip.rotation.y = Math.PI / 4;
    tip.scale.set(0.55, 1, 1);
    meshes.push(tip);
    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.34, 0.004), this._fullerMat);
    fuller.position.set(0, 0.20, 0.024);
    meshes.push(fuller);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.05), this.brassMat);
    guard.position.y = 0;
    meshes.push(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.16, 8), this._darkMat);
    grip.position.y = -0.08;
    meshes.push(grip);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), this.brassMat);
    pommel.position.y = -0.18;
    meshes.push(pommel);
    this._tagFormMeshes(1, meshes);
  }

  // T2 — Runic Greatsword: long two-hand grip, wide blade, 3 glowing runes
  // (replaces the old stripe planes + torus hilt band — no curved primitives).
  _formRunicGreatsword() {
    const meshes = [];
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.44, 0.014), this.steelMat);
    blade.position.y = 0.22;
    meshes.push(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.32, 4), this.steelMat);
    tip.position.y = 0.68;
    tip.rotation.y = Math.PI / 4;
    tip.scale.set(0.5, 1, 1);
    meshes.push(tip);
    const runeMat = new THREE.MeshBasicMaterial({ color: 0x4ac8ff });
    this._mats.push(runeMat);
    // Real runic glyphs: angular shapes built from thin luminous segments
    // lying flat on the blade face (no curved primitives — straight blades).
    // Each glyph is a list of [x1, y1, x2, y2] segments in blade-local space.
    const glyphs = [
      // ᚠ fehu: vertical + two descending branches
      [[0, -0.045, 0, 0.045], [0, 0.045, 0.034, 0.02], [0.034, 0.02, 0, -0.012]],
      // ᚢ uruz: vertical + long descending branch from the top
      [[0, -0.045, 0, 0.045], [0, 0.045, -0.03, -0.02]],
      // ᚦ thurisaz: vertical + two angled spurs at the top
      [[0, -0.045, 0, 0.045], [0, 0.045, 0.028, 0.028], [0.028, 0.028, 0.028, 0.0]],
    ];
    const runeYs = [0.16, 0.28, 0.40];
    for (let g = 0; g < glyphs.length; g++) {
      for (const [x1, y1, x2, y2] of glyphs[g]) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 0.001;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0055, 0.002), runeMat);
        seg.position.set((x1 + x2) / 2, runeYs[g] + (y1 + y2) / 2, 0.026);
        seg.rotation.z = Math.atan2(dy, dx);
        meshes.push(seg);
      }
    }
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.06), this.bladeMat);
    guard.position.y = 0;
    meshes.push(guard);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.22, 8), this._darkMat);
    grip.position.y = -0.11;
    meshes.push(grip);
    const pommel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 8), this.brassMat);
    pommel.position.y = -0.24;
    meshes.push(pommel);
    this._tagFormMeshes(2, meshes);
  }

  // T3 — Crystal Soulblade: faceted violet crystal shards on a straight white
  // core (form OWNS the blade color from here on; BLADE_COLORS stops applying).
  _formCrystalSoulblade() {
    this._crystalMat = new THREE.MeshStandardMaterial({
      color: 0xcc88ff, emissive: 0xcc66ff, emissiveIntensity: 1.4,
      transparent: true, opacity: 0.8, roughness: 0.2,
    });
    this._mats.push(this._crystalMat);
    const meshes = [];
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.52, 0.025), this._crystalMat);
    spine.position.y = 0.26;
    meshes.push(spine);
    for (const fy of [0.12, 0.28, 0.44, 0.60]) {
      const h = 0.22 + Math.random() * 0.08;
      const facet = new THREE.Mesh(new THREE.ConeGeometry(0.035, h, 5), this._crystalMat);
      facet.position.set((Math.random() - 0.5) * 0.03, fy, 0);
      facet.rotation.z = (Math.random() - 0.5) * 0.2;
      meshes.push(facet);
    }
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    this._mats.push(coreMat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.90, 6), coreMat);
    core.position.y = 0.45;
    meshes.push(core);
    this._crystalCore = core;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.16, 8), this._darkMat);
    grip.position.y = -0.08;
    meshes.push(grip);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.03, 8), this._darkMat);
    collar.position.y = 0;
    meshes.push(collar);
    this._tagFormMeshes(3, meshes);
  }

  // T4 — Soulfire Greatblade: smooth white-hot energy blade, vented emitter.
  _formSoulfireGreatblade() {
    this._soulfireMat = new THREE.MeshBasicMaterial({
      color: 0xddddff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._mats.push(this._soulfireMat);
    const meshes = [];
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.92, 8), this._soulfireMat);
    blade.position.y = 0.46;
    meshes.push(blade);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    this._mats.push(coreMat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.88, 6), coreMat);
    core.position.y = 0.44;
    meshes.push(core);
    this._soulfireCore = core;
    for (const [sx, rz] of [[0.035, -0.35], [-0.035, 0.35]]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), this.bladeMat);
      fin.position.set(sx, 0.02, 0);
      fin.rotation.z = rz;
      meshes.push(fin);
    }
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.14, 8), this._darkMat);
    hilt.position.y = -0.07;
    meshes.push(hilt);
    this._tagFormMeshes(4, meshes);
  }

  // T5 — Lightsaber: perfect straight energy cylinder, white core, blade
  // light (layer 0, camera-attached) + idle crackle pool.
  _formLightsaber() {
    this._energyBladeMat = new THREE.MeshBasicMaterial({
      color: 0x88ffff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._mats.push(this._energyBladeMat);
    const meshes = [];
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 1.0, 8), this._energyBladeMat);
    blade.position.y = 0.5;
    meshes.push(blade);
    this._energyBlade = blade;
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
    this._mats.push(coreMat);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.92, 6), coreMat);
    core.position.y = 0.46;
    meshes.push(core);
    this._energyCore = core;
    // Emitter collar + pommel at the base of the energy blade
    const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.04, 0.07, 8), this._darkMat);
    emitter.position.y = -0.035;
    meshes.push(emitter);
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), this.brassMat);
    pommel.position.y = -0.095;
    meshes.push(pommel);
    this._tagFormMeshes(5, meshes);
    // Blade point light — layer 0, camera-attached: lights the WORLD around
    // the player in cyan (the sword itself stays layer-2 self-lit, §4).
    this.bladeLight = new THREE.PointLight(
      EVOLUTION.T5_BLADE_LIGHT.color, EVOLUTION.T5_BLADE_LIGHT.intensity,
      EVOLUTION.T5_BLADE_LIGHT.distance, EVOLUTION.T5_BLADE_LIGHT.decay,
    );
    this.bladeLight.position.set(0, 0.45, 0.1);
    this.bladeLight.castShadow = false;
    this.group.add(this.bladeLight);
    // Idle crackle pool (≤ 3 pooled additive arc sprites, cosmetic, §5)
    this._crackleSprites = [];
    const crackleMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: 0x88ffff,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    });
    this._mats.push(crackleMat);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(crackleMat);
      s.visible = false;
      this.group.add(s);
      this._crackleSprites.push({ sprite: s, life: 0, active: false, y: 0 });
    }
  }

  // Dispatch: show exactly one tier's mesh set; tune shared extras per tier.
  _applyForm(tier) {
    this._ensureForms();
    const L = EVOLUTION.BLADE_LENGTH[tier] ?? EVOLUTION.BLADE_LENGTH[0];
    this._tipLocal.set(0, L * 0.79, 0.02);
    for (let t = 0; t <= EVOLUTION.MAX_TIER; t++) {
      for (const m of this._formMeshes[t]) m.visible = (t === tier);
    }
    // Shared blade glow: T3 subtle, T4+ strong; color follows the form
    const glow = this._bladeGlow;
    glow.position.y = L * 0.5;
    if (tier === 3) {
      this._bladeGlowMat.color.setHex(0xcc66ff);
      this._bladeGlowMat.opacity = 0;
      glow.scale.setScalar(0.3);
    } else if (tier === 4) {
      this._bladeGlowMat.color.setHex(0xddddff);
      this._bladeGlowMat.opacity = 0.35;
      glow.scale.setScalar(0.5);
    } else if (tier === 5) {
      this._bladeGlowMat.color.setHex(0x88ffff);
      this._bladeGlowMat.opacity = 0.35;
      glow.scale.setScalar(0.5);
    } else {
      this._bladeGlowMat.opacity = 0;
    }
    if (this.bladeLight) this.bladeLight.visible = tier === 5;
    for (const c of this._crackleSprites || []) c.sprite.visible = tier === 5 && c.active;
  }

  // T5 idle crackle: tiny pooled arcs flickering along the blade (cosmetic).
  _emitCrackle() {
    if (!this._crackleSprites) return;
    const len = EVOLUTION.BLADE_LENGTH[this.tier];
    const c = this._crackleSprites.find((x) => !x.active);
    if (!c) return;
    c.active = true;
    c.life = 0.15 + Math.random() * 0.15;
    c.y = 0.1 + Math.random() * (len - 0.15);
    c.sprite.visible = true;
    c.sprite.position.set((Math.random() - 0.5) * 0.03, c.y, (Math.random() - 0.5) * 0.03);
    c.sprite.scale.setScalar(0.08 + Math.random() * 0.06);
    c.sprite.material.opacity = 0.9;
  }

  _updateCrackle(dt) {
    if (!this._crackleSprites || this.tier < 5) return;
    this._crackleAcc = (this._crackleAcc || 0) + dt * 6;
    while (this._crackleAcc >= 1) {
      this._crackleAcc -= 1;
      this._emitCrackle();
    }
    for (const c of this._crackleSprites) {
      if (!c.active) continue;
      c.life -= dt;
      if (c.life <= 0) {
        c.active = false;
        c.sprite.visible = false;
        continue;
      }
      c.sprite.material.opacity = 0.9 * (c.life / 0.3);
      c.sprite.position.y += dt * 1.5;
    }
  }

  // Grows the dagger +20% per 10 orbs held (capped at +200% = 3x at 100
  // orbs), extends melee range, shifts base color, intensifies the green
  // growth light.
  setOrbCount(count) {
    // Orb-power scale (sword size only — enemy spawns use their own
    // (level + souls)/10 formula); lengthMult stacks on top (EMPOWERED buff:
    // +50% longer). Clamped at
    // MAX_TOTAL_SCALE so the ready pose never covers the crosshair (§3, §10).
    this._rangeScale = Math.min(
      orbPowerMultiplier(count) * this.lengthMult,
      EVOLUTION.MAX_TOTAL_SCALE,
    );
    this.group.scale.setScalar(this._rangeScale);
    // Blue smoke bleeds off the blade proportional to orbs (capped at 500)
    this._orbSmokeFactor = Math.min(count, 500) / 500;
    const capped = Math.min(Math.floor(count / 10), 10);
    const growth = capped / 10; // 0..1
    this.growthLight.intensity = growth * 2.8;
    this.growthGlowMat.opacity = growth * 0.35;
    this.growthGlow.scale.setScalar(0.26 + growth * 0.4);
    if (capped !== this._colorStep) {
      this._colorStep = capped;
      // Evolution form OWNS blade color from tier 3 (energy blade) — the orb
      // size ladder keeps tinting the steel blade only below tier 3 (§4).
      if (this.tier < 3) {
        this.bladeMat.color.setHex(BLADE_COLORS[capped]);
        this.steelMat.color.setHex(BLADE_COLORS[capped]);
      }
    }
  }

  // Danger glow + light: 0 at >= GLOW_MAX_DIST, ramps to 1 as skeletons approach
  setDanger(nearestSkelDist, dt) {
    const glowMax = 12;
    const glowMin = 1.8;
    this._glowTarget = nearestSkelDist >= glowMax
      ? 0
      : Math.max(0, Math.min(1, 1 - (nearestSkelDist - glowMin) / (glowMax - glowMin)));
    this._glow = THREE.MathUtils.damp(this._glow, this._glowTarget, 6, dt);
    // base ember (0.35) + danger glow ramps on top
    this.bladeMat.emissiveIntensity = 0.35 + this._glow * 1.5;
    this.glowMat.opacity = this._glow * 0.7;
    this.glowSprite.scale.setScalar(0.28 + this._glow * 0.5);
    this.dangerLight.intensity = this._glow * 3.2;
  }

  // Returns true if an attack started (false if busy/cooldown)
  attack() {
    if (this.state !== 'idle' || this.cool > 0) return false;
    this.state = 'windup1';
    this.time = 0;
    this.comboStep = 0;
    return true;
  }

  // Hit windows during strikes (Game applies damage once per strike)
  get isSwinging() {
    return this.state === 'slash1' || this.state === 'slash2' || this.state === 'thrust3';
  }

  get currentArc() {
    if (this.state === 'slash2') return SWORD.COMBO.ARC2;
    if (this.state === 'thrust3') return SWORD.COMBO.ARC3;
    return SWORD.COMBO.ARC1;
  }

  // Sword damage scales with the size bonus: +50% of the size-buff amount.
  // At 3x size (buff +200%) damage is doubled; at 4.5x (EMPOWERED) ×2.75.
  get damageMult() {
    return 1 + (this._rangeScale - 1) * 0.5;
  }

  // Sword damage = (base per-hit + evolution tier) × size multiplier.
  // Base per-hit from swordHitDamage (2/2/3 + tier → 7/7/8 at tier 5).
  get currentDamage() {
    const step = this.state === 'slash2' ? 2
      : this.state === 'thrust3' ? 3 : 1;
    return swordHitDamage(step, this.tier) * this.damageMult;
  }

  // The piercing thrust lunges further than the slashes.
  get currentRange() {
    return this.state === 'thrust3'
      ? this.range * SWORD.COMBO.RANGE3
      : this.range;
  }

  update(dt, nearestSkelDist = Infinity) {
    if (this.cool > 0) this.cool -= dt;
    this.setDanger(nearestSkelDist, dt);
    this._updateTrails(dt);
    this._updateSparks(dt);
    if (this._flashTimer > 0) {
      this._flashTimer -= dt;
      if (this._flashTimer <= 0) {
        const t = this.tier;
        if (t === 3 && this._crystalMat) this._crystalMat.color.setHex(0xcc88ff);
        else if (t === 4 && this._soulfireMat) this._soulfireMat.color.setHex(0xddddff);
        else if (t === 5 && this._energyBladeMat) this._energyBladeMat.color.setHex(0x88ffff);
        else this.bladeMat.emissive.setHex(0x14181f); // neutral reset
      }
    }
    // Tier 4 hum: soulfire core length pulses ±5% at 3 Hz (§4)
    if (this.tier === 4 && this._soulfireCore && this._soulfireCore.visible) {
      this._humPhase = (this._humPhase || 0) + dt;
      this._soulfireCore.scale.y = 1 + Math.sin(this._humPhase * 3) * 0.05;
      if (this._bladeGlow) {
        this._bladeGlow.scale.setScalar(0.5 * (1 + Math.sin(this._humPhase * 3) * 0.05));
      }
    }
    // Tier 5 idle crackle (cosmetic arcs along the blade)
    this._updateCrackle(dt);

    if (this.state === 'idle') return;
    this.time += dt;
    // Attack speed: scale the duration fields (windups/slashes/recoveries/
    // windows/cooldown) by 1/attackSpeedMult; arcs and damage stay as-is.
    let C = SWORD.COMBO;
    if (this.attackSpeedMult !== 1) {
      const scaled = {};
      for (const k of Object.keys(C)) {
        scaled[k] = /^(WINDUP|SLASH|RECOVER|COMBO_WINDOW|COOLDOWN)/.test(k)
          ? C[k] / this.attackSpeedMult : C[k];
      }
      C = scaled;
    }

    // State transitions (explicit — pose math alone never flips the state)
    if (this.state === 'windup1' && this.time >= C.WINDUP1) this._enter('slash1');
    else if (this.state === 'slash1' && this.time >= C.SLASH1) this._enter('recover1');
    else if (this.state === 'recover1') {
      if (this.time >= C.COMBO_WINDOW) {
        this._enter('cooldown');
      } else if (this.time >= C.RECOVER1 && this._comboBuffered) {
        this._comboBuffered = false;
        this._enter('windup2');
      }
    } else if (this.state === 'windup2' && this.time >= C.WINDUP2) this._enter('slash2');
    else if (this.state === 'slash2' && this.time >= C.SLASH2) this._enter('recover2');
    else if (this.state === 'recover2') {
      if (this.time >= C.COMBO_WINDOW) {
        this._enter('cooldown');
      } else if (this.time >= C.RECOVER2 && this._comboBuffered) {
        this._comboBuffered = false;
        this._enter('windup3');
      }
    } else if (this.state === 'windup3' && this.time >= C.WINDUP3) this._enter('thrust3');
    else if (this.state === 'thrust3' && this.time >= C.THRUST3) this._enter('recover3');
    else if (this.state === 'recover3' && this.time >= C.RECOVER3) this._enter('cooldown');
    else if (this.state === 'cooldown' && this.time >= C.COOLDOWN) {
      this._setRest();
      this.state = 'idle';
      this.time = 0;
      this.comboStep = 0;
      this.cool = 0;
      return;
    }

    this._animatePose(C);

    // Movement strike traces: while the blade is moving, spawn tip sprites so
    // the arc path lingers behind the swing.
    if (this.state === 'slash1') this._spawnTrail(this._trailPools[0]);
    else if (this.state === 'slash2') this._spawnTrail(this._trailPools[1]);
    else if (this.state === 'thrust3') this._spawnTrail(this._trailPools[2]);
  }

  // Buffered input: called by Game when RMB pressed during a combo window
  bufferCombo() {
    if (this.state === 'slash1' || this.state === 'recover1'
      || this.state === 'slash2' || this.state === 'recover2') {
      this._comboBuffered = true;
    }
  }

  // Enter a new state with a FRESH clock (time = 0). Every state's k=0
  // keyframe equals the previous state's k=1 keyframe, so transitions are
  // perfectly continuous — no pose jump, and the first rendered frame of a
  // slash really is the start of the arc (hit window, trail burst).
  _enter(state) {
    this.state = state;
    this.time = 0;
    if (state === 'slash1') this.comboStep = 1;
    if (state === 'slash2') this.comboStep = 2;
    if (state === 'thrust3') this.comboStep = 3;
    if (state === 'slash1' || state === 'slash2' || state === 'thrust3') {
      // Initial flash burst along the arc, then re-arm the damage window
      const pool = state === 'slash1' ? this._trailPools[0]
        : state === 'slash2' ? this._trailPools[1] : this._trailPools[2];
      this._spawnTrail(pool, true);
      this.onSlash?.(this.comboStep);
    }
  }

  _animatePose(C) {
    const p = this.group.position;
    const r = this.group.rotation;
    const s = this.state;
    const t = this.time;
    const lerp = THREE.MathUtils.lerp;
    const easeOut = (x) => 1 - Math.pow(1 - x, 2);
    const easeIn = (x) => x * x;

    switch (s) {
      case 'windup1': {
        // Cock right: blade forward, rolled right (rz) — tip out to the right.
        const k = easeOut(Math.min(1, t / C.WINDUP1));
        p.x = lerp(0.68, 0.05, k);
        p.y = lerp(-0.22, -0.10, k);
        p.z = lerp(-0.70, -0.80, k);
        r.x = lerp(-0.15, -1.35, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(0.35, 1.45, k);
        break;
      }
      case 'slash1': {
        // Horizontal cut right -> left ACROSS the aim line: the group stays
        // anchored while the forward blade spins around its axis (rz), so the
        // TIP sweeps a wide flat arc through the screen center and the pommel
        // (near the spin axis) barely moves.
        const k = easeOut(Math.min(1, t / C.SLASH1));
        p.x = lerp(0.0, 0.0, k);
        p.y = lerp(-0.10, -0.10, k);
        p.z = lerp(-0.80, -0.80, k);
        r.x = lerp(-1.35, -1.35, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(1.45, -1.45, k);
        break;
      }
      case 'recover1': {
        const k = easeIn(Math.min(1, t / C.RECOVER1));
        p.x = lerp(0.0, 0.0, k);
        p.y = lerp(-0.10, -0.10, k);
        p.z = lerp(-0.80, -0.78, k);
        r.x = lerp(-1.35, -1.35, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(-1.45, -1.1, k);
        break;
      }
      case 'windup2': {
        // Cock left: blade forward, rolled left (rz).
        const k = easeOut(Math.min(1, t / C.WINDUP2));
        p.x = lerp(0.0, 0.0, k);
        p.y = lerp(-0.10, -0.10, k);
        p.z = lerp(-0.78, -0.80, k);
        r.x = lerp(-1.35, -1.35, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(-1.1, -1.45, k);
        break;
      }
      case 'slash2': {
        // Horizontal back-cut left -> right ACROSS the aim line (mirror).
        const k = easeOut(Math.min(1, t / C.SLASH2));
        p.x = lerp(0.0, 0.0, k);
        p.y = lerp(-0.10, -0.10, k);
        p.z = lerp(-0.80, -0.80, k);
        r.x = lerp(-1.35, -1.35, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(-1.45, 1.45, k);
        break;
      }
      case 'recover2': {
        const k = easeIn(Math.min(1, t / C.RECOVER2));
        p.x = lerp(0.05, 0.12, k);
        p.y = lerp(-0.10, -0.06, k);
        p.z = lerp(-0.80, -0.62, k);
        r.x = lerp(-1.35, -1.50, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(1.2, 0.05, k);
        break;
      }
      case 'windup3': {
        // Thrust cock: blade rotated to point FORWARD (rx ~ -PI/2), and the
        // group already positioned so the tip sits ON the crosshair — the
        // upcoming stab only needs to push straight in along the aim axis.
        const k = easeOut(Math.min(1, t / C.WINDUP3));
        p.x = lerp(0.12, 0.0, k);
        p.y = lerp(-0.06, -0.05, k);
        p.z = lerp(-0.62, -0.52, k);
        r.x = lerp(-1.50, -1.57, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(0.05, 0, k);
        break;
      }
      case 'thrust3': {
        // Piercing thrust: p.x / p.y stay pinned so the tip HOLDS the
        // crosshair — only p.z pushes the blade forward along the aim axis.
        const k = easeOut(Math.min(1, t / C.THRUST3));
        p.x = 0.0;
        p.y = -0.05;
        p.z = lerp(-0.52, -0.95, k);
        r.x = lerp(-1.57, -1.57, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(0, 0, k);
        break;
      }
      case 'recover3': {
        const k = easeIn(Math.min(1, t / C.RECOVER3));
        p.x = lerp(0.0, 0.68, k);
        p.y = lerp(-0.05, -0.22, k);
        p.z = lerp(-0.95, -0.70, k);
        r.x = lerp(-1.57, -0.15, k);
        r.y = lerp(0, 0, k);
        r.z = lerp(0, 0.35, k);
        break;
      }
      case 'cooldown':
        // Hold rest pose
        break;
    }
  }

  // Blade flash on hit (energy-aware — T3/T4/T5 forms are MeshBasic and flash
  // their material color; steel forms flash emissive). (§4)
  flashBlade() {
    const t = this.tier;
    if (t === 3 && this._crystalMat) this._crystalMat.color.setHex(0xffdd88);
    else if (t === 4 && this._soulfireMat) this._soulfireMat.color.setHex(0xffdd88);
    else if (t === 5 && this._energyBladeMat) this._energyBladeMat.color.setHex(0xffdd88);
    else {
      this.bladeMat.emissive.setHex(0xffdd88);
      this.bladeMat.emissiveIntensity = 1.2;
    }
    this._flashTimer = 0.1;
  }

  dispose() {
    this.camera.remove(this.group);
    for (const s of this._sparks) this.camera.remove(s.mesh);
    for (const pool of this._trailPools) {
      for (const t of pool.sprites) this.camera.remove(t.sprite);
    }
    for (const s of this._smokeSprites) this.camera.remove(s.sprite);
    this.group.traverse((m) => {
      if (m.isMesh && m.geometry) m.geometry.dispose();
    });
    if (this.sparkGeo) this.sparkGeo.dispose();
    for (const m of this._mats) m.dispose();
    this.glowMat.dispose();
    this.growthGlowMat.dispose();
    this.dangerLight.dispose();
    this.growthLight.dispose();
    if (this.bladeLight) this.bladeLight.dispose();
    if (this._glowTex) this._glowTex.dispose();
  }
}

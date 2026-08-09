import * as THREE from 'three';
import { BOSS } from '../../core/Constants.js';
import { generateGlowTexture } from '../../world/Textures.js';

// Ghost Boss — a huge spectral apparition. Four attacks on timers:
//  - CHARGE: telegraphs (flares bright) then dashes at the player.
//  - SUMMON: calls a pack of small wraiths that shoot projectiles (the
//    wraiths themselves are managed by SkeletonSystem; the boss only emits
//    a summon request via onSummon).
//  - BLINK (teleport-nova): teleports ONTO the player, charges a spell with
//    spark effects for 1 s (BLINK_TELEGRAPH), then detonates — 3 hearts of
//    damage to anything within 3 u (BLINK_DMG / BLINK_RADIUS, user ruling).
//  - SMOKE: hurls a smoke cloud toward the player that homes in flight and
//    lingers; standing inside costs 1 heart per second (SMOKE_DMG, user
//    ruling). DoT is ticked by SkeletonSystem._tickBossSmoke.
// HP is BOSS.HP_MULT x a base enemy. The AI is fully self-contained in
// update(); movement + collision run here, combat contact via onChargeHit /
// onBlinkHit / onSummon hooks. One boss per enemy type — all share the
// charge+summon+blink+smoke AI but look and size differently, so each reads
// as its own boss. On a boss level one random variant spawns.
const BOSS_VARIANTS = {
  SKELETON:  { color: 0xcfd6e6, accent: 0x66e0ff, scale: 1.0, label: 'BONE LORD', deco: 'HORNS' },
  ARMORED:   { color: 0x8aa8cc, accent: 0x66ccff, scale: 1.25, label: 'IRON GHOUL', deco: 'CROWN' },
  ARCHER:    { color: 0xaad4a0, accent: 0x66ff88, scale: 0.9, label: 'SPECTRAL HUNTER', deco: 'HOOD' },
  BRUTE:     { color: 0xcc8866, accent: 0xff8844, scale: 1.4, label: 'ASH TITAN', deco: 'BROAD' },
  WRAITH:    { color: 0x9fd8ff, accent: 0x66e0ff, scale: 1.0, label: 'SPECTRAL LORD', deco: 'HOOD2' },
  RAT:       { color: 0xd8b07a, accent: 0xffaa66, scale: 0.75, label: 'VERMIN KING', deco: 'FANGS' },
  MAGICIAN:  { color: 0xb08ae0, accent: 0xcc88ff, scale: 1.05, label: 'LICH ARCHMAGE', deco: 'CROWN2' },
};

export class GhostBoss {
  constructor(scene, baseHp, variant = 'WRAITH', souls = 0, heartsExtra = 0) {
    this.scene = scene;
    this.type = 'BOSS';
    this.variant = BOSS_VARIANTS[variant] ? variant : 'WRAITH';
    const v = BOSS_VARIANTS[this.variant];
    this.variantLabel = v.label;
    // HP = base x HP_MULT, scaled by the player's wealth AND permanent hearts
    // (user ruling): the souls bonus (+SOULS_HP_BONUS per SOULS_HP_PER souls
    // held) stacks with +HEARTS_HP_BONUS per permanent heart past 3, and the
    // combined excess of the stack is HALVED — a rich, heart-heavy player
    // faces a tougher lord, but not double-dipped to absurdity:
    //   mult = 1 + ((1 + soulsBonus) · (1 + heartsBonus)^hearts − 1) / 2
    const soulsBonus = BOSS.SOULS_HP_BONUS * Math.floor((souls || 0) / BOSS.SOULS_HP_PER);
    // ×1.1 per permanent heart past 3 (multiplicative, per the ruling) —
    // (1 + HEARTS_HP_BONUS)^hearts.
    const stack = (1 + soulsBonus)
      * Math.pow(1 + BOSS.HEARTS_HP_BONUS, Math.max(0, heartsExtra || 0));
    this.hp = Math.ceil(baseHp * BOSS.HP_MULT * (1 + (stack - 1) / 2));
    this.maxHp = this.hp;
    this.state = 'CHASE'; // CHASE | CHARGING | BLINKING | DEAD
    this.animTime = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this._chargeCd = BOSS.CHARGE_COOLDOWN * 0.6; // first charge comes quickly
    this._summonCd = BOSS.SUMMON_COOLDOWN;
    this._blinkCd = BOSS.BLINK_COOLDOWN * 0.5;   // first nova comes quickly
    this._smokeCd = BOSS.SMOKE_COOLDOWN * 0.7;   // first smoke comes early
    this._chargeT = 0;
    this._chargeDirX = 0;
    this._chargeDirZ = 0;
    this._chargeHitDone = false;
    this._blinkT = 0;
    this._sparkT = 0;
    this._burstT = 0;
    this.smokeClouds = []; // live smoke clouds ({phase: FLY|LINGER|FADE, ...})
    this._removed = false;
    this._scale = v.scale;

    this.group = new THREE.Group();
    this._build(v);
    scene.add(this.group);
  }

  _build(v) {
    this.bodyMat = new THREE.MeshBasicMaterial({
      color: v.color, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: v.accent, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._mats = [this.bodyMat, this.coreMat];
    this._buildHealthBar(v);

    // Large spectral apparition
    const body = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.0, 14, 1, true), this.bodyMat);
    body.position.y = 1.5;
    this.group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), this.bodyMat);
    head.position.y = 2.7;
    this.group.add(head);
    // Glowing core (the "heart")
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), this.coreMat);
    this.core.position.y = 1.7;
    this.group.add(this.core);
    // Eyes
    this.eyeMat = new THREE.MeshBasicMaterial({ color: v.accent, transparent: true, opacity: 0.95 });
    this._mats.push(this.eyeMat);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), this.eyeMat);
      eye.position.set(sx * 0.2, 2.75, 0.4);
      this.group.add(eye);
    }
    // Spectral glow halo
    this._glowTex = generateGlowTexture();
    this.glowMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: v.accent, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.4,
    });
    this._mats.push(this.glowMat);
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.setScalar(3.5);
    this.glow.position.y = 1.6;
    this.group.add(this.glow);

    if (this._scale !== 1) this.group.scale.setScalar(this._scale);

    // Per-variant silhouette decoration so each boss reads as its own entity.
    this._addDeco(v);
    this._buildBlinkFX(v);
    this._buildSmokeBase();
  }

  // Teleport-nova telegraph: a ground ring + orbiting spark sprites that
  // charge up over the 1 s blink window. Hidden while idle (the ring is the
  // blast radius read — scale = world radius, so the player sees exactly
  // where the nova will pop).
  _buildBlinkFX(v) {
    this._ringMat = new THREE.MeshBasicMaterial({
      color: v.accent, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this._mats.push(this._ringMat);
    this._ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), this._ringMat);
    this._ring.rotation.x = -Math.PI / 2;
    this._ring.position.y = 0.06;
    this._ring.visible = false;
    this.group.add(this._ring);

    this._sparkMat = new THREE.SpriteMaterial({
      map: this._glowTex, color: v.accent, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0,
    });
    this._mats.push(this._sparkMat);
    this._sparks = [];
    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Sprite(this._sparkMat);
      sp.userData = {
        a: (i / 12) * Math.PI * 2 + Math.random() * 0.4,
        r: 0.7 + Math.random() * 0.5,
        h: 0.4 + Math.random() * 1.4,
        ph: Math.random() * Math.PI * 2,
      };
      sp.visible = false;
      this.group.add(sp);
      this._sparks.push(sp);
    }
  }

  // Smoke cloud base: a soft-edged dark puff texture + material. Each thrown
  // cloud CLONES this material (so clouds fade independently); the texture is
  // shared and disposed with the boss.
  _buildSmokeBase() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this._smokeTex = new THREE.CanvasTexture(c);
    this._smokeMat = new THREE.SpriteMaterial({
      map: this._smokeTex, color: 0x4a4a5a, transparent: true,
      opacity: 0.5, depthWrite: false,
    });
    this._mats.push(this._smokeMat);
  }

  // One distinct head/crown accent per boss variant (all reuse the bodyMat so
  // they stay spectrally coherent and fade together on death).
  _addDeco(v) {
    const d = v.deco;
    const mk = (geo, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, this.bodyMat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      this.group.add(m);
      return m;
    };
    if (d === 'HORNS') {
      // Bone Lord: antler horns radiating from the head
      for (const side of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 6), this.bodyMat);
        horn.position.set(side * 0.24, 3.0, 0.0);
        horn.rotation.z = side * -0.6;
        this.group.add(horn);
      }
    } else if (d === 'CROWN') {
      // Iron Ghoul: a jagged spectral crown
      for (let i = 0; i < 5; i++) {
        mk(new THREE.ConeGeometry(0.045, 0.22, 5), (i - 2) * 0.09, 3.05, 0);
      }
    } else if (d === 'HOOD') {
      // Spectral Hunter: high pointed hood cone
      mk(new THREE.ConeGeometry(0.34, 0.9, 8), 0, 2.9, -0.1);
    } else if (d === 'BROAD') {
      // Ash Titan: broad shoulder discs
      for (const side of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), this.bodyMat);
        s.scale.set(1, 0.6, 1.4);
        s.position.set(side * 0.55, 2.2, 0);
        this.group.add(s);
      }
    } else if (d === 'HOOD2') {
      // Spectral Lord: pointed shroud over the head
      mk(new THREE.ConeGeometry(0.3, 0.8, 8), 0, 2.95, -0.05);
      this.core.position.y = 1.9; // raise core toward the shroud
    } else if (d === 'FANGS') {
      // Vermin King: jutting fangs under a broad snout
      for (const side of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 5), this.bodyMat);
        f.position.set(side * 0.1, 2.5, 0.35);
        f.rotation.x = 0.6;
        this.group.add(f);
      }
    } else if (d === 'CROWN2') {
      // Lich Archmage: twin spires (crossed crown)
      for (const side of [-1, 1]) {
        const s = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.35, 5), this.bodyMat);
        s.position.set(side * 0.12, 3.0, -0.04);
        s.rotation.z = side * 0.3;
        this.group.add(s);
      }
    }
  }

  setFacing(yaw) { this.facingYaw = yaw; }

  // Throw a smoke cloud toward the player. It homes in flight (FLY), settles
  // and lingers (LINGER — SkeletonSystem ticks 1 heart/s while the player
  // stands inside), then fades out (FADE) and is removed.
  _throwSmoke(player) {
    const cloud = {
      phase: 'FLY', t: 0, tickAcc: 0,
      x: this.group.position.x, z: this.group.position.z,
      radius: BOSS.SMOKE_RADIUS,
    };
    const mat = this._smokeMat.clone();
    cloud.mats = [mat];
    const group = new THREE.Group();
    group.position.set(cloud.x, 0, cloud.z);
    cloud.group = group;
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Sprite(mat);
      p.userData = {
        ox: (Math.random() - 0.5) * 1.6,
        oz: (Math.random() - 0.5) * 1.6,
        oh: 0.4 + Math.random() * 1.2,
        s: 0.8 + Math.random() * 1.0,
        ph: Math.random() * Math.PI * 2,
        bob: 0.3 + Math.random() * 0.5,
      };
      p.position.set(p.userData.ox, p.userData.oh, p.userData.oz);
      p.scale.setScalar(p.userData.s);
      group.add(p);
    }
    this.scene.add(group);
    this.smokeClouds.push(cloud);
  }

  _updateClouds(dt, player) {
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const c = this.smokeClouds[i];
      c.t += dt;
      if (c.phase === 'FLY') {
        // Home toward the player while airborne, then settle.
        if (player) {
          const dx = player.x - c.group.position.x;
          const dz = player.z - c.group.position.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.5) {
            c.group.position.x += (dx / d) * BOSS.SMOKE_SPEED * dt;
            c.group.position.z += (dz / d) * BOSS.SMOKE_SPEED * dt;
          }
        }
        if (c.t >= BOSS.SMOKE_FLIGHT) {
          c.phase = 'LINGER';
          c.t = 0;
        }
      } else if (c.phase === 'LINGER') {
        // Slow roll + gentle expansion while the cloud sits.
        c.group.rotation.y += dt * 0.25;
        c.group.scale.setScalar(1 + 0.12 * Math.min(1, c.t / 2));
        if (c.t >= BOSS.SMOKE_DURATION) c.phase = 'FADE';
      } else if (c.phase === 'FADE') {
        for (const m of c.mats) m.opacity = Math.max(0, m.opacity - dt / 0.8);
        if (c.t >= BOSS.SMOKE_DURATION + 0.8) this._removeCloud(i);
      }
    }
  }

  _removeCloud(i) {
    const c = this.smokeClouds[i];
    this.scene.remove(c.group);
    for (const m of c.mats) m.dispose();
    this.smokeClouds.splice(i, 1);
  }

  // Spark charge-up: ring (scale = blast radius) + orbiting sparks intensify
  // over the telegraph window, accelerating into the detonation.
  _animateBlink(dt) {
    const p = Math.min(1, this._sparkT / BOSS.BLINK_TELEGRAPH);
    const ease = p * p;
    const rad = 0.6 + ease * (BOSS.BLINK_RADIUS - 0.6);
    this._ring.visible = true;
    this._ring.scale.setScalar(rad);
    this._ringMat.opacity = 0.25 + 0.6 * p;
    const flick = 0.5 + 0.5 * Math.sin(this._sparkT * 24 + this.phase);
    this._sparkMat.opacity = (0.4 + 0.6 * p) * flick;
    for (const sp of this._sparks) {
      sp.visible = true;
      sp.userData.a += dt * (4 + 8 * p);
      const sr = rad * sp.userData.r;
      sp.position.set(Math.cos(sp.userData.a) * sr, sp.userData.h, Math.sin(sp.userData.a) * sr);
      sp.scale.setScalar((0.25 + 0.2 * Math.sin(this._sparkT * 16 + sp.userData.ph)) * (0.6 + p));
    }
    this.core.scale.setScalar(1 + 0.6 * p + 0.3 * Math.sin(this._sparkT * 20));
  }

  _hideBlinkFX() {
    this._ring.visible = false;
    this._ringMat.opacity = 0;
    this._sparkMat.opacity = 0;
    for (const sp of this._sparks) sp.visible = false;
  }

  // Expanding ring flash right after the nova pops.
  _burst(dt) {
    this._burstT -= dt;
    const f = Math.max(0, this._burstT / 0.4);
    this._ring.visible = true;
    this._ring.scale.setScalar(BOSS.BLINK_RADIUS + (1 - f) * 4);
    this._ringMat.opacity = 0.9 * f;
    this._sparkMat.opacity = 0.6 * f;
    if (this._burstT <= 0) this._hideBlinkFX();
  }

  // Hovering boss health bar: a small canvas drawn into a Sprite above the
  // boss (Sprites always face the camera). Redrawn each frame from hp/maxHp.
  _buildHealthBar(v) {
    this._barCanvas = document.createElement('canvas');
    this._barCanvas.width = 128;
    this._barCanvas.height = 14;
    this._barCtx = this._barCanvas.getContext('2d');
    this._barTex = new THREE.CanvasTexture(this._barCanvas);
    this.barMat = new THREE.SpriteMaterial({
      map: this._barTex, transparent: true, depthTest: false, depthWrite: false,
    });
    this._mats.push(this.barMat);
    this.bar = new THREE.Sprite(this.barMat);
    this.bar.scale.set(2.6 * this._scale, 0.3 * this._scale, 1);
    this.bar.position.y = 3.4 * this._scale;
    this.group.add(this.bar);
    this._drawBar();
  }

  _drawBar() {
    const ctx = this._barCtx;
    const w = this._barCanvas.width;
    const h = this._barCanvas.height;
    const frac = this.maxHp > 0 ? Math.max(0, Math.min(1, this.hp / this.maxHp)) : 0;
    // Dark backing + border frame
    ctx.fillStyle = 'rgba(8,6,4,0.82)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5a4a30';
    ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, h - 1, w, 1);
    ctx.fillRect(0, 0, 1, h); ctx.fillRect(w - 1, 0, 1, h);
    // Red fill
    const fw = Math.max(0, Math.round((w - 4) * frac));
    ctx.fillStyle = '#ee4433';
    ctx.fillRect(2, 2, fw, h - 4);
    this._barTex.needsUpdate = true;
  }

  hit(damage) {
    if (this.state === 'DEAD') return false;
    this.hp -= damage;
    if (this.hp <= 0) {
      this.hp = 0;
      this.state = 'DEAD';
      this.animTime = 0;
      this.onKill?.();
      return true;
    }
    return false;
  }

  // dt-driven AI. player = {x,z}; collisionBoxes for movement. stepDir = a
  // unit direction from the caller's grid pathing when a wall blocks the
  // straight line to the player (null when it's clear) — the stuck-boss fix.
  // Returns nothing; fires onSummon / onChargeHit hooks managed by
  // SkeletonSystem.
  update(dt, time, player, collisionBoxes, resolveCircleCollisions, stepDir = null) {
    if (this._removed) return;
    this.animTime += dt;
    if (this._chargeCd > 0) this._chargeCd -= dt;
    if (this._summonCd > 0) this._summonCd -= dt;
    if (this._blinkCd > 0) this._blinkCd -= dt;
    if (this._smokeCd > 0) this._smokeCd -= dt;

    if (this.state === 'DEAD') {
      // Dissipate upward
      const f = Math.max(0, 1 - this.animTime / 2);
      this.bodyMat.opacity = 0.4 * f;
      this.coreMat.opacity = 0.9 * f;
      this.eyeMat.opacity = 0.95 * f;
      this.glowMat.opacity = 0.4 * f;
      this.barMat.opacity = f; // health bar fades out with the boss
      this.group.position.y += dt * 0.6 * f;
      if (this.animTime >= 2) this.onDeathComplete?.();
      return;
    }

    this._drawBar(); // keep the hovering health bar in sync

    // Safe-spawn / title screen: SkeletonSystem calls update(dt, time) with
    // NO player so mobs idle in place — bosses must idle too, not crash.
    if (!player) return;

    const dx = player.x - this.group.position.x;
    const dz = player.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    this.setFacing(Math.atan2(dx, dz));
    this.group.rotation.y = this.facingYaw;

    // Bob + core pulse
    this.group.position.y = Math.sin(time * 1.6 + this.phase) * 0.15;
    const pulse = 0.8 + Math.sin(time * 5 + this.phase) * 0.2;
    this.core.scale.setScalar(pulse);

    // Smoke clouds animate every frame (they outlive the state machine);
    // the nova's post-detonation ring flash too.
    this._updateClouds(dt, player);
    if (this._burstT > 0) this._burst(dt);

    if (this.state === 'CHARGING') {
      // Dash straight along the locked direction
      this._chargeT -= dt;
      this.group.position.x += this._chargeDirX * BOSS.CHARGE_SPEED * dt;
      this.group.position.z += this._chargeDirZ * BOSS.CHARGE_SPEED * dt;
      resolveCircleCollisions(collisionBoxes, this.group.position, 0.9);
      // Contact damage (once per charge)
      if (!this._chargeHitDone && dist < 1.4) {
        this._chargeHitDone = true;
        this.onChargeHit?.();
      }
      if (this._chargeT <= 0) {
        this.state = 'CHASE';
        this._chargeCd = BOSS.CHARGE_COOLDOWN;
      }
    } else if (this.state === 'BLINKING') {
      // Teleport-nova: frozen in place while sparks charge up over the
      // telegraph window, then detonate — 3 hearts to anything within 3 u
      // (the onBlinkHit hook; SkeletonSystem checks the player's distance).
      this._blinkT -= dt;
      this._sparkT += dt;
      this._animateBlink(dt);
      if (this._blinkT <= 0) {
        this.onBlinkHit?.();
        this.state = 'CHASE';
        this._blinkCd = BOSS.BLINK_COOLDOWN;
        this._burstT = 0.4;
        this._burst(dt);
      }
    } else {
      // Drift toward the player (slow hover), following the caller's grid
      // pathing when the straight line is blocked — no more grinding into
      // walls/pillars (stuck-boss fix).
      const speed = 2.2 * dt;
      if (dist > 2.5) {
        let mx = dx / dist, mz = dz / dist;
        if (stepDir) { mx = stepDir.x; mz = stepDir.z; }
        this.group.position.x += mx * speed;
        this.group.position.z += mz * speed;
        resolveCircleCollisions(collisionBoxes, this.group.position, 0.9);
      }
      // Teleport-nova FIRST: blinks straight onto the player through walls —
      // the anti-kiting tool. The 1 s spark window is the dodge (sprint out
      // of the 3 u blast ring).
      if (this._blinkCd <= 0) {
        this.group.position.x = player.x;
        this.group.position.z = player.z;
        resolveCircleCollisions(collisionBoxes, this.group.position, 0.9);
        this.state = 'BLINKING';
        this._blinkT = BOSS.BLINK_TELEGRAPH;
        this._sparkT = 0;
      } else if (this._chargeCd <= 0 && dist < 14 && !stepDir) {
        // Telegraph + charge — ONLY when the dash path is wall-free. A charge
        // through a wall/pillar is exactly what wedged the boss into geometry.
        this.state = 'CHARGING';
        this._chargeT = BOSS.CHARGE_TIME;
        this._chargeHitDone = false;
        const d = dist || 1;
        this._chargeDirX = dx / d;
        this._chargeDirZ = dz / d;
      }
      // Smoke throw: fires alongside any other attack (doesn't change state).
      if (this._smokeCd <= 0) {
        this._smokeCd = BOSS.SMOKE_COOLDOWN;
        this._throwSmoke(player);
      }
    }

    // Summon wraith minions
    if (this._summonCd <= 0) {
      this._summonCd = BOSS.SUMMON_COOLDOWN;
      this.onSummon?.();
    }
  }

  dispose() {
    if (this._removed) return;
    this._removed = true;
    // Clear any lingering smoke clouds (their groups live in the scene,
    // separate from the boss group).
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) this._removeCloud(i);
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    for (const m of this._mats) m.dispose();
    if (this._glowTex) this._glowTex.dispose();
    if (this._barTex) this._barTex.dispose();
    if (this._smokeTex) this._smokeTex.dispose();
    this.scene.remove(this.group);
  }
}

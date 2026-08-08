import * as THREE from 'three';
import { BOSS } from '../../core/Constants.js';
import { generateGlowTexture } from '../../world/Textures.js';

// Ghost Boss — a huge spectral apparition. Two attacks on a timer:
//  - CHARGE: telegraphs (flares bright) then dashes at the player.
//  - SUMMON: calls a pack of small wraiths that shoot projectiles (the
//    wraiths themselves are managed by SkeletonSystem; the boss only emits
//    a summon request via onSummon).
// HP is BOSS.HP_MULT x a base enemy. The AI is fully self-contained in
// update(); movement + collision run here, combat contact via onChargeHit.
// One boss per enemy type — all share the charge+summon AI but look and
// size differently, so each reads as its own boss. On a boss level one
// random variant spawns.
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
  constructor(scene, baseHp, variant = 'WRAITH', souls = 0) {
    this.scene = scene;
    this.type = 'BOSS';
    this.variant = BOSS_VARIANTS[variant] ? variant : 'WRAITH';
    const v = BOSS_VARIANTS[this.variant];
    this.variantLabel = v.label;
    // HP = base x HP_MULT, scaled up by the player's wealth: +SOULS_HP_BONUS
    // per SOULS_HP_PER souls held (a rich player faces a tougher lord).
    this.hp = Math.ceil(baseHp * BOSS.HP_MULT
      * (1 + BOSS.SOULS_HP_BONUS * Math.floor((souls || 0) / BOSS.SOULS_HP_PER)));
    this.maxHp = this.hp;
    this.state = 'CHASE'; // CHASE | CHARGING | DEAD
    this.animTime = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this._chargeCd = BOSS.CHARGE_COOLDOWN * 0.6; // first charge comes quickly
    this._summonCd = BOSS.SUMMON_COOLDOWN;
    this._chargeT = 0;
    this._chargeDirX = 0;
    this._chargeDirZ = 0;
    this._chargeHitDone = false;
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

  // dt-driven AI. player = {x,z}; collisionBoxes for movement. Returns nothing;
  // fires onSummon / onChargeHit hooks managed by SkeletonSystem.
  update(dt, time, player, collisionBoxes, resolveCircleCollisions) {
    if (this._removed) return;
    this.animTime += dt;
    if (this._chargeCd > 0) this._chargeCd -= dt;
    if (this._summonCd > 0) this._summonCd -= dt;

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
    } else {
      // Drift toward the player (slow hover)
      const speed = 2.2 * dt;
      if (dist > 2.5) {
        this.group.position.x += (dx / dist) * speed;
        this.group.position.z += (dz / dist) * speed;
        resolveCircleCollisions(collisionBoxes, this.group.position, 0.9);
      }
      // Telegraph + charge
      if (this._chargeCd <= 0 && dist < 14) {
        this.state = 'CHARGING';
        this._chargeT = BOSS.CHARGE_TIME;
        this._chargeHitDone = false;
        const d = dist || 1;
        this._chargeDirX = dx / d;
        this._chargeDirZ = dz / d;
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
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    for (const m of this._mats) m.dispose();
    if (this._glowTex) this._glowTex.dispose();
    if (this._barTex) this._barTex.dispose();
    this.scene.remove(this.group);
  }
}

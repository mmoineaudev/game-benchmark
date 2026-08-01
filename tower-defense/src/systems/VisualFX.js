import * as THREE from 'three';

const EL = document.getElementById('visualFX');
const W = () => window.innerWidth;
const H = () => window.innerHeight;

function project(pos, camera) {
  const v = pos.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * W(),
    y: (-v.y * 0.5 + 0.5) * H(),
    visible: v.z < 1,
  };
}

/** Shared radial-gradient sprite texture (white core -> transparent). */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export default class VisualFX {
  constructor(camera) {
    this.camera = camera;
    this.scene = null;
    this._healthBars = new Map();
    this._fx = [];
    this._tex = makeGlowTexture();
    this._ringGeo = new THREE.TorusGeometry(1, 0.06, 8, 32);
    this._MAX_FX = 420;
  }

  bind(scene) { this.scene = scene; }

  // ── primitives ────────────────────────────────────────────────────────
  _sprite(color, scale, opacity = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this._tex,
      color: new THREE.Color(color),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    s.scale.setScalar(scale);
    return s;
  }

  _addFx(fx) {
    if (this._fx.length >= this._MAX_FX) { fx.dispose(); return; }
    this._fx.push(fx);
  }

  /** Expanding, fading glow sprite at a point. */
  flash(pos, color, scale = 0.6, life = 0.22) {
    const scene = this.scene;
    if (!scene) return;
    const s = this._sprite(color, scale);
    s.position.copy(pos);
    scene.add(s);
    const fx = {
      t: 0, life,
      update(dt) {
        this.t += dt;
        const k = this.t / this.life;
        s.material.opacity = 1 - k;
        s.scale.setScalar(scale * (1 + k * 1.2));
        return this.t < this.life;
      },
      dispose() { scene.remove(s); s.material.dispose(); },
    };
    this._addFx(fx);
  }

  /** Expanding flat ring (top-down visible). */
  ring(pos, color, radius, life = 0.4) {
    const scene = this.scene;
    if (!scene) return;
    const m = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.position.y = 0.08;
    scene.add(m);
    const fx = {
      t: 0, life,
      update(dt) {
        this.t += dt;
        const k = this.t / this.life;
        m.scale.setScalar(radius * (0.15 + 0.85 * k));
        m.material.opacity = 0.85 * (1 - k);
        return this.t < this.life;
      },
      dispose() { scene.remove(m); m.material.dispose(); },
    };
    this._addFx(fx);
  }

  /** Quick bright muzzle flash at a tower. */
  muzzle(pos, color, scale = 0.45) {
    this.flash(pos, color, scale, 0.16);
  }

  /** Big double-ring shockwave (Doom Cannon). */
  shockwave(pos, color, radius) {
    this.ring(pos, color, radius, 0.5);
    this.ring(pos.clone().setY(0.05), '#ffffff', radius * 0.8, 0.35);
    this.flash(pos, '#ffffff', 0.8, 0.2);
  }

  /** Colored additive sparks with gravity. */
  sparks(pos, color, count = 8, speed = 3) {
    const scene = this.scene;
    if (!scene) return;
    for (let i = 0; i < count; i++) {
      const s = this._sprite(color, 0.18 + Math.random() * 0.14);
      s.position.copy(pos);
      scene.add(s);
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2,
        Math.random() * 1.2,
        (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      const fx = {
        t: 0, life: 0.3 + Math.random() * 0.25,
        update(dt) {
          this.t += dt;
          const k = this.t / this.life;
          s.position.addScaledVector(dir, dt);
          dir.y -= 5 * dt;
          s.material.opacity = 1 - k;
          s.scale.setScalar(Math.max(0.01, (1 - k) * 0.3));
          return this.t < this.life;
        },
        dispose() { scene.remove(s); s.material.dispose(); },
      };
      this._addFx(fx);
    }
  }

  /** AoE hit: ring + flash + sparks in the tower's color. */
  splash(pos, color, radius = 1.5) {
    this.ring(pos, color, radius, 0.45);
    this.flash(pos, color, Math.min(1.2, radius * 0.6), 0.25);
    this.sparks(pos, color, Math.min(14, Math.floor(radius * 8)), 3.5);
  }

  /** Gravity well: double pulse ring. */
  gravityPulse(pos, color, radius = 3) {
    this.ring(pos, '#ffffff', radius, 0.55);
    this.ring(pos, color, radius * 0.7, 0.45);
    this.sparks(pos, color, 10, 2);
  }

  /** Thin bright line from -> to (railgun tracers). */
  tracer(from, to, color, life = 0.09) {
    const scene = this.scene;
    if (!scene) return;
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    scene.add(line);
    const fx = {
      t: 0, life,
      update(dt) {
        this.t += dt;
        line.material.opacity = 0.9 * (1 - this.t / this.life);
        return this.t < this.life;
      },
      dispose() { scene.remove(line); line.geometry.dispose(); line.material.dispose(); },
    };
    this._addFx(fx);
  }

  /** Jagged lightning arc from -> to. */
  arc(from, to, color, life = 0.16) {
    const scene = this.scene;
    if (!scene) return;
    const segs = 9;
    const pts = [];
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.01) return;
    dir.normalize();
    const perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const p = from.clone().lerp(to, k);
      if (i > 0 && i < segs) {
        p.addScaledVector(perp, (Math.random() - 0.5) * 0.4);
        p.y += (Math.random() - 0.5) * 0.25;
      }
      pts.push(p);
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    scene.add(line);
    const glow = this._sprite(color, 0.55);
    glow.position.copy(to);
    scene.add(glow);
    const fx = {
      t: 0, life,
      update(dt) {
        this.t += dt;
        const k = 1 - this.t / this.life;
        line.material.opacity = k;
        glow.material.opacity = k * 0.9;
        return this.t < this.life;
      },
      dispose() {
        scene.remove(line); line.geometry.dispose(); line.material.dispose();
        scene.remove(glow); glow.material.dispose();
      },
    };
    this._addFx(fx);
  }

  /** Flat glowing beam quad from -> to (reads well from the top-down camera). */
  beam(from, to, color, life = 0.12, width = 0.16) {
    const scene = this.scene;
    if (!scene) return;
    const len = from.distanceTo(to);
    if (len < 0.01) return;
    const w = width / 2;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, -w, 0, 0, len + 0.15, 0, 0, w, 0, 0, len + 0.15,
    ], 3));
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(from.x, 0.5, from.z);
    mesh.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    scene.add(mesh);
    const impact = this._sprite(color, 0.5);
    impact.position.copy(to);
    impact.position.y = 0.5;
    scene.add(impact);
    const fx = {
      t: 0, life,
      update(dt) {
        this.t += dt;
        const k = 1 - this.t / this.life;
        mat.opacity = 0.65 * k;
        impact.material.opacity = k;
        return this.t < this.life;
      },
      dispose() {
        scene.remove(mesh); mesh.geometry.dispose(); mat.dispose();
        scene.remove(impact); impact.material.dispose();
      },
    };
    this._addFx(fx);
  }

  /** Small colored hit effect on an enemy. */
  hitSpark(pos, color) {
    this.flash(pos, color, 0.35, 0.15);
    this.sparks(pos, color, 4, 2.5);
  }

  /** Slow effect: cold blue shimmer. */
  slowFlash(pos) {
    this.flash(pos, '#7df9ff', 0.5, 0.3);
    this.sparks(pos, '#7df9ff', 3, 1.5);
  }

  /** Periodic faint aura ring (Chrono Prism). */
  auraPulse(pos, color, radius) {
    this.ring(pos, color, radius, 0.8);
  }

  update(dt) {
    for (let i = this._fx.length - 1; i >= 0; i--) {
      const fx = this._fx[i];
      if (!fx.update(dt)) {
        try { fx.dispose(); } catch (err) { /* never let a cleanup failure stall the loop */ }
        this._fx.splice(i, 1);
      }
    }
  }

  // ── DOM health bars ────────────────────────────────────────────────────
  setHealthBars(enemies) {
    const seen = new Set();
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      seen.add(enemy.id);
      const screen = project(enemy.mesh.position, this.camera);
      if (!screen.visible) continue;

      let entry = this._healthBars.get(enemy.id);
      if (!entry) {
        const outer = document.createElement('div');
        outer.style.cssText = 'position:absolute;width:36px;height:4px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);border-radius:2px;transform:translate(-50%,0);';
        const bar = document.createElement('div');
        bar.style.cssText = 'height:100%;background:#22ff88;border-radius:2px;';
        outer.appendChild(bar);
        EL.appendChild(outer);
        entry = { el: outer, bar, enemy };
        this._healthBars.set(enemy.id, entry);
      }

      const pct = Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100));
      entry.bar.style.width = pct + '%';
      if (pct > 50) entry.bar.style.background = '#22ff88';
      else if (pct > 25) entry.bar.style.background = '#ffcc00';
      else entry.bar.style.background = '#ff4444';

      entry.el.style.left = screen.x + 'px';
      entry.el.style.top = (screen.y - 14) + 'px';
      entry.el.style.display = '';
    }
    for (const [id, entry] of this._healthBars) {
      if (!seen.has(id)) { entry.el.remove(); this._healthBars.delete(id); }
    }
  }

  clearHealthBars() {
    for (const [, entry] of this._healthBars) entry.el.remove();
    this._healthBars.clear();
  }

  reset() {
    this.clearHealthBars();
    for (const fx of this._fx) fx.dispose();
    this._fx = [];
  }
}

import * as THREE from 'three';
import EventBus from '../core/EventBus.js';
import { COLORS } from '../core/Constants.js';

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
const _glowTex = makeGlowTexture();

export default class ProjectileSystem {
  constructor(scene, audio) { this.objs = []; this._beams = []; this.scene = scene || null; this.audio = audio || null; }
  reset() {
    this.objs.forEach(p => this._remove(p));
    this.objs = [];
    this._beams.forEach(b => { if (this.scene && b.line) { this.scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); } });
    this._beams = [];
  }
  bind(scene, audio) { this.scene = scene; this.audio = audio; }

  spawn({ pos, dir, damage, speed, color, splash, slow, dot, gravity, parallel, chain }) {
    const col = new THREE.Color(color || '#ffffff');
    const group = new THREE.Group();
    // bright core
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), new THREE.MeshBasicMaterial({ color: col }));
    // colored glow halo — big enough to read from the top-down camera
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _glowTex,
      color: col,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false, // never hidden behind ground clutter
    }));
    glow.scale.setScalar(1.35);
    // hot white center for extra brightness
    const hot = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }));
    hot.scale.setScalar(0.7);
    group.add(core, glow, hot);
    group.position.copy(pos);

    // ── shot trace: flat additive streak trailing the projectile ─────────
    const w = 0.35;
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -w, 0, -1,  w, 0, -1,  -w, 0, 0,
      w, 0, -1,   w, 0, 0,   -w, 0, 0,
    ], 3));
    // brighten the trace color toward white so it reads as a hot tracer
    const trailCol = col.clone().lerp(new THREE.Color(0xffffff), 0.35);
    const tMat = new THREE.MeshBasicMaterial({
      color: trailCol,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const trail = new THREE.Mesh(tGeo, tMat);
    trail.position.copy(pos);
    trail.rotation.y = Math.atan2(dir.x, dir.z);

    if (this.scene) { this.scene.add(group); this.scene.add(trail); }
    const p = {
      mesh: group, trail, _trailPos: pos.clone(),
      dir: dir.clone(), damage, speed: speed || 10, life: 4,
      splash: splash || 0, slow: slow || 0, dot: !!dot, gravity: !!gravity,
      chain: chain || 0, color: color || '#ffffff',
    };
    this.objs.push(p);
    if (this.audio) this.audio.playFire();
    return p;
  }

  spawnBeam(from, to) {
    // Legacy thin beam — kept for compatibility; game uses VisualFX.beam now.
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: COLORS.towerEmissive, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    if (this.scene) this.scene.add(line);
    this._beams.push({ line, life: 0.12 });
  }

  _remove(p) {
    const i = this.objs.indexOf(p);
    if (i >= 0) {
      if (this.scene && p.mesh) {
        this.scene.remove(p.mesh);
        p.mesh.traverse(ch => {
          if (ch.geometry) ch.geometry.dispose();
          if (ch.material) ch.material.dispose();
        });
        this.scene.remove(p.trail);
        p.trail.geometry.dispose();
        p.trail.material.dispose();
      }
      this.objs.splice(i, 1);
    }
  }

  update(dt, enemies, state) {
    for (let i = this.objs.length - 1; i >= 0; i--) {
      const p = this.objs[i];
      p._trailPos.copy(p.mesh.position);
      p.mesh.position.addScaledVector(p.dir, p.speed * dt);

      // pulse the glow halos
      const pulse = 0.85 + Math.sin(performance.now() * 0.02) * 0.15;
      if (p.mesh.children[1] && p.mesh.children[1].material) p.mesh.children[1].material.opacity = pulse;
      if (p.mesh.children[2] && p.mesh.children[2].material) p.mesh.children[2].material.opacity = 0.75 + Math.sin(performance.now() * 0.03) * 0.2;

      // shot trace follows the projectile, stretched along its direction
      p.trail.position.copy(p.mesh.position);
      p.trail.rotation.y = Math.atan2(p.dir.x, p.dir.z);
      p.trail.scale.set(1, 1, 2.2 + p.speed * 0.02);

      p.life -= dt;
      // Kill projectiles that flew off the map (missed target died mid-flight)
      if (p.mesh.position.x < -3 || p.mesh.position.x > 59 || p.mesh.position.z < -3 || p.mesh.position.z > 43) {
        this._remove(p);
        continue;
      }
      if (p.life <= 0) this._remove(p);
    }
    for (let i = this._beams.length - 1; i >= 0; i--) {
      this._beams[i].life -= dt;
      if (this._beams[i].life <= 0) {
        if (this.scene) this.scene.remove(this._beams[i].line);
        this._beams.splice(i, 1);
      }
    }
  }
}

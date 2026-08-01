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
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: col }));
    // additive glow halo
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: _glowTex,
      color: col,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    glow.scale.setScalar(0.55);
    group.add(core, glow);
    group.position.copy(pos);

    // trail line (previous pos -> current pos), additive
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.Float32BufferAttribute([pos.x, pos.y, pos.z, pos.x, pos.y, pos.z], 3));
    const tMat = new THREE.LineBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trail = new THREE.Line(tGeo, tMat);

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

      // pulse the glow halo
      const glow = p.mesh.children[1];
      if (glow && glow.material) {
        glow.material.opacity = 0.7 + Math.sin(performance.now() * 0.02) * 0.2;
      }
      // update trail line (prev -> new)
      const arr = p.trail.geometry.attributes.position.array;
      arr[0] = p._trailPos.x; arr[1] = p._trailPos.y; arr[2] = p._trailPos.z;
      arr[3] = p.mesh.position.x; arr[4] = p.mesh.position.y; arr[5] = p.mesh.position.z;
      p.trail.geometry.attributes.position.needsUpdate = true;

      p.life -= dt;
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

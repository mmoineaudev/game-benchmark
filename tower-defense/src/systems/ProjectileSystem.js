import * as THREE from 'three';
import EventBus from '../core/EventBus.js';
import { COLORS } from '../core/Constants.js';

export default class ProjectileSystem {
  constructor(scene, audio) { this.objs = []; this._beams = []; this.scene = scene || null; this.audio = audio || null; }
  reset() {
    this.objs.forEach(p => { if (this.scene && p.mesh) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); } });
    this.objs = [];
    this._beams.forEach(b => { if (this.scene && b.line) { this.scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); } });
    this._beams = [];
  }
  bind(scene, audio) { this.scene = scene; this.audio = audio; }
  spawn({ pos, dir, damage, speed, color, splash, slow, dot, gravity, parallel, chain }) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }));
    mesh.position.copy(pos);
    if (this.scene) this.scene.add(mesh);
    const p = { mesh, dir, damage, speed: speed || 10, life: 4, splash: splash||0, slow: slow||0, dot: !!dot, gravity: !!gravity, chain: chain||0 };
    this.objs.push(p);
    if (this.audio) this.audio.playFire();
    return p;
  }
  spawnBeam(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({ color: COLORS.towerEmissive, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    if (this.scene) this.scene.add(line);
    this._beams.push({ line, life: 0.12 });
  }
  _remove(p) {
    const i = this.objs.indexOf(p);
    if (i >= 0) {
      if (this.scene && p.mesh) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
      this.objs.splice(i, 1);
    }
  }
  update(dt, enemies, state) {
    for (let i = this.objs.length - 1; i >= 0; i--) {
      const p = this.objs[i];
      p.mesh.position.addScaledVector(p.dir, p.speed * dt);
      p.life -= dt;
      if (p.life <= 0) {
        if (this.scene && p.mesh) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
        this.objs.splice(i, 1);
      }
    }
    for (let i = this._beams.length - 1; i >= 0; i--) {
      this._beams[i].life -= dt;
      if (this._beams[i].life <= 0) { if (this.scene) this.scene.remove(this._beams[i].line); this._beams.splice(i, 1); }
    }
  }
}

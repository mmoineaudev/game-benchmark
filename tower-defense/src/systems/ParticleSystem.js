import * as THREE from 'three';
import { COLORS } from '../core/Constants.js';

export default class ParticleSystem {
  constructor(scene) { this.scene = scene; this.particles = []; }
  reset() { this.particles.forEach(p=> this.scene.remove(p.mesh)); this.particles = []; }
  spark(pos) {
    const geo = new THREE.SphereGeometry(0.07, 5, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff5c2, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos); this.scene.add(mesh);
    const dir = new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random()*2);
    this.particles.push({ mesh, life: 0.45, velocity: dir });
  }
  explosion(pos, count, scale) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.09, 5, 5);
      const color = new THREE.Color().setHSL(Math.random()*0.15+0.55, 0.9, 0.6);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos); this.scene.add(mesh);
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(1.5 + Math.random() * 2.5 * scale);
      this.particles.push({ mesh, life: 0.6 + Math.random() * 0.4, velocity: dir });
    }
  }
  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); this.particles.splice(i,1); continue; }
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.scale.setScalar(Math.max(0, p.life) * 2);
      p.velocity.y -= dt * 1.6;
    }
  }
}

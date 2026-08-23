// ParticleSystem.js — ambient dust motes (30 GPU points, torch-adjacent opacity)
import * as THREE from 'three';
import { AMBIENT_DUST } from '../core/Constants.js';

export default class ParticleSystem {
  constructor(scene, torchPositions = []) {
    const count = this.count = AMBIENT_DUST.PARTICLES;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      if (torchPositions.length) {
        const t = torchPositions[(Math.random() * torchPositions.length) | 0];
        this.positions[i * 3] = t.x + (Math.random() - .5) * 4;
        this.positions[i * 3 + 1] = 0.5 + Math.random() * 3.5;
        this.positions[i * 3 + 2] = t.z + (Math.random() - .5) * 4;
      } else {
        this.positions[i * 3] = (Math.random() - .5) * 40;
        this.positions[i * 3 + 1] = Math.random() * 4;
        this.positions[i * 3 + 2] = (Math.random() - .5) * 40;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xc8b888, size: 0.045, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._t = 0;
  }

  update(dt, playerPos) {
    this._t += dt;
    // gentle drift; cheap per-frame attribute write over 30 points
    const pos = this.points.geometry.attributes.position.array;
    for (let i = 0; i < this.count; i++) {
      pos[i * 3 + 1] += Math.sin(this._t * 0.7 + i) * 0.0015;
      pos[i * 3] += Math.cos(this._t * 0.4 + i * 1.7) * 0.0012;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
  }
}

import * as THREE from 'three';
import { LIGHTING } from '../core/Constants.js';

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.count = 300;      // halved from 600 — ambient particles cut 50%
    this.particles = null;
    this.positions = null;
  }

  init() {
    // Soft circle texture
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.15, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(0.5, 'rgba(255,220,180,0.3)');
    gradient.addColorStop(1, 'rgba(255,200,150,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.count * 3);
    const sizes = new Float32Array(this.count);

    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * 16;
      this.positions[i * 3 + 1] = Math.random() * 3.5;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
      sizes[i] = 0.02 + Math.random() * 0.04;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.35,
      color: LIGHTING.TORCH_COLOR,
      size: 0.06,
      sizeAttenuation: true,
    });

    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  update(dt, playerPos, torches) {
    if (!this.particles || !this.positions) return;

    const px = playerPos.x;
    const pz = playerPos.z;
    const spread = 8;

    for (let i = 0; i < this.count; i++) {
      const idx = i * 3;
      let x = this.positions[idx];
      let y = this.positions[idx + 1];
      let z = this.positions[idx + 2];

      // Slow upward drift
      y += dt * 0.15;
      if (y > 3.8) y = 0.1;

      // Slight horizontal drift
      x += (Math.sin(i * 0.7 + performance.now() * 0.0003) * dt * 0.3);
      z += (Math.cos(i * 0.7 + performance.now() * 0.0003) * dt * 0.3);

      // Wrap around camera if too far
      if (Math.abs(x - px) > spread) x = px + (Math.random() - 0.5) * spread * 2;
      if (Math.abs(z - pz) > spread) z = pz + (Math.random() - 0.5) * spread * 2;

      this.positions[idx] = x;
      this.positions[idx + 1] = y;
      this.positions[idx + 2] = z;
    }

    this.particles.geometry.attributes.position.needsUpdate = true;

    // Opacity scales with distance to nearest torch (particles invisible in darkness)
    const nearestDist = this._nearestTorchDist(playerPos, torches);
    const opacity = Math.max(0, Math.min(0.35, 1 - nearestDist / 12));
    this.particles.material.opacity = opacity;
  }

  _nearestTorchDist(playerPos, torches) {
    let min = Infinity;
    for (const t of torches) {
      const d = Math.sqrt(
        (t.x - playerPos.x) ** 2 + (t.z - playerPos.z) ** 2,
      );
      if (d < min) min = d;
    }
    return min;
  }

  dispose() {
    if (this.particles) {
      this.particles.geometry.dispose();
      if (this.particles.material.map) this.particles.material.map.dispose();
      this.particles.material.dispose();
      this.scene.remove(this.particles);
      this.particles = null;
    }
  }
}

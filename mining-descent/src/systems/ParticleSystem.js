import * as THREE from 'three';

// Simple particle effects
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
  }

  // Dust burst when digging
  emitDigDust(worldPos) {
    const count = 8;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    const colors = new Float32Array(count * 3);

    const color = new THREE.Color(0x8B5E3C);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = worldPos.x + (Math.random() - 0.5) * 0.3;
      positions[i * 3 + 1] = worldPos.y + 0.3;
      positions[i * 3 + 2] = worldPos.z + (Math.random() - 0.5) * 0.3;
      velocities.push(
        (Math.random() - 0.5) * 2,
        Math.random() * 2 + 0.5,
        (Math.random() - 0.5) * 2,
      );
      const c = color.clone().multiplyScalar(0.5 + Math.random() * 0.5);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.08, vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.particles.push({ points, velocities, life: 1.0 });
  }

  // Sparkle burst on ore collect
  emitOreSparkle(worldPos, colorHex) {
    const count = 6;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];
    const colors = new Float32Array(count * 3);

    const color = new THREE.Color(colorHex || 0xff8844);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = worldPos.x + (Math.random() - 0.5) * 0.2;
      positions[i * 3 + 1] = worldPos.y + 0.3;
      positions[i * 3 + 2] = worldPos.z + (Math.random() - 0.5) * 0.2;
      velocities.push(
        (Math.random() - 0.5) * 3,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 3,
      );
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 0.06, vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.particles.push({ points, velocities, life: 0.6 });
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;

      const pos = p.points.geometry.attributes.position;
      const array = pos.array;
      for (let j = 0; j < array.length / 3; j++) {
        array[j * 3] += p.velocities[j * 3] * dt;
        array[j * 3 + 1] += p.velocities[j * 3 + 1] * dt;
        array[j * 3 + 2] += p.velocities[j * 3 + 2] * dt;
        p.velocities[j * 3 + 1] -= 4 * dt; // gravity
      }
      pos.needsUpdate = true;

      p.points.material.opacity = Math.max(0, p.life / 1.0);

      if (p.life <= 0) {
        this.scene.remove(p.points);
        p.points.geometry.dispose();
        p.points.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  clear() {
    for (const p of this.particles) {
      this.scene.remove(p.points);
      p.points.geometry.dispose();
      p.points.material.dispose();
    }
    this.particles = [];
  }
}

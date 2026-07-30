// =============================================================================
// ParticleSystem — drill dust, ore sparkle, engine exhaust (pooled sprites).
// =============================================================================

import * as THREE from 'three';
import { DUST } from '../core/Constants.js';
import { Logger } from '../core/Logger.js';

const MAX_PARTICLES = 200;

class Particle {
  constructor() {
    this.alive = false;
    this.life = 0;
    this.maxLife = 0;
    this.sprite = null; // assigned from pool
  }
}

export class ParticleSystem {
  constructor(scene) {
    this._scene = scene;
    this._pool = [];
    this._texture = null;

    // Create a small white circle texture programmatically
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
    this._texture = new THREE.CanvasTexture(canvas);

    // Pre-allocate particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._texture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this._scene.add(sprite);

      this._pool.push({
        alive: false,
        life: 0,
        maxLife: 0,
        sprite,
        velocity: new THREE.Vector3(),
      });
    }
    Logger.info('Particles', `pool of ${MAX_PARTICLES} ready`);
  }

  /** Spawn drill dust at a world position. */
  burstDrill(worldX, worldY, worldZ, count = DUST.COUNT) {
    count = Math.min(count, MAX_PARTICLES);
    const color = 0x8b7355; // brown dust
    this._spawnBurst(worldX, worldY, worldZ, count, DUST.LIFETIME, color, DUST.SPREAD);
  }

  /** Spawn ore sparkle at a world position. */
  burstOre(worldX, worldY, worldZ, color) {
    this._spawnBurst(worldX, worldY, worldZ, 6, 0.8, color, 0.2);
  }

  _spawnBurst(x, y, z, count, lifetime, color, spread) {
    let spawned = 0;
    for (const p of this._pool) {
      if (p.alive) continue;
      p.alive = true;
      p.life = lifetime;
      p.maxLife = lifetime;
      p.sprite.position.set(x, y, z);
      p.sprite.visible = true;
      p.sprite.material.color.setHex(color);
      p.sprite.material.opacity = 1;
      p.sprite.scale.set(0.15, 0.15, 1);
      p.velocity.set(
        (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * spread + 0.2, // slight upward bias
        (Math.random() - 0.5) * spread,
      );
      spawned++;
      if (spawned >= count) break;
    }
  }

  update(dt) {
    for (const p of this._pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }

      const t = p.life / p.maxLife;
      p.sprite.material.opacity = t;
      p.sprite.scale.setScalar(0.15 * t);
      p.sprite.position.x += p.velocity.x * dt;
      p.sprite.position.y += p.velocity.y * dt;
      p.sprite.position.z += p.velocity.z * dt;
      p.velocity.y -= 0.5 * dt; // gravity
    }
  }

  dispose() {
    for (const p of this._pool) {
      p.sprite.material.dispose();
      this._scene.remove(p.sprite);
    }
    if (this._texture) this._texture.dispose();
    this._pool = [];
    Logger.info('Particles', 'disposed');
  }
}

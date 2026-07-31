import * as THREE from 'three';
import { ORB_WEAPON } from '../core/Constants.js';
import { circleHitsBox } from '../core/Collision.js';

export class OrbShooter {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = []; // pooled, round-robin reuse
    this._next = 0;
    this._tex = null;
  }

  init() {
    // Soft glow texture for projectile sprites
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(120,200,255,1)');
    grad.addColorStop(0.4, 'rgba(68,170,255,0.5)');
    grad.addColorStop(1, 'rgba(68,170,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    this._tex = new THREE.CanvasTexture(canvas);

    const meshGeo = new THREE.SphereGeometry(0.22, 12, 12);
    const meshMat = new THREE.MeshStandardMaterial({
      color: 0x44aaff, emissive: 0x44aaff, emissiveIntensity: 2.5,
      roughness: 0.15, metalness: 0.4,
    });
    const glowMat = new THREE.SpriteMaterial({
      map: this._tex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.8,
    });

    const POOL = 24;
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(meshGeo, meshMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(1.6, 1.6, 1);
      mesh.visible = false;
      glow.visible = false;
      this.scene.add(mesh);
      this.scene.add(glow);
      this.projectiles.push({ mesh, glow, dirX: 0, dirZ: 0, life: 0, active: false });
    }
  }

  // Fire along the camera look direction (yaw + pitch) so the crosshair is the aim.
  fire(x, y, z, yaw, pitch = 0) {
    const p = this.projectiles[this._next];
    this._next = (this._next + 1) % this.projectiles.length;
    p.active = true;
    p.mesh.visible = true;
    p.glow.visible = true;
    p.mesh.position.set(x, y, z);
    p.glow.position.set(x, y, z);
    // Camera look vector (matches Game._updateCamera)
    p.dirX = -Math.sin(yaw) * Math.cos(pitch);
    p.dirY = Math.sin(pitch);
    p.dirZ = -Math.cos(yaw) * Math.cos(pitch);
    p.life = ORB_WEAPON.LIFETIME;
    return p;
  }

  update(dt, collisionBoxes, skeletons) {
    const speed = ORB_WEAPON.SPEED;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      p.mesh.position.x += p.dirX * speed * dt;
      p.mesh.position.y += p.dirY * speed * dt;
      p.mesh.position.z += p.dirZ * speed * dt;
      p.glow.position.copy(p.mesh.position);
      p.life -= dt;

      // Floor / ceiling fizzle (walls are checked in 2D below — full height)
      if (p.mesh.position.y < 0.15 || p.mesh.position.y > 3.85) {
        this._deactivate(p);
        continue;
      }

      // Wall hit
      if (circleHitsBox(collisionBoxes, p.mesh.position.x, p.mesh.position.z, ORB_WEAPON.RADIUS)) {
        this._deactivate(p);
        continue;
      }

      // Breakable prop hit (optional hook from Game)
      if (this.onHitProp?.(p.mesh.position.x, p.mesh.position.z)) {
        this._deactivate(p);
        continue;
      }

      // Skeleton hit
      let hit = false;
      for (const s of skeletons) {
        if (s.skel.state === 'DEAD') continue;
        const dx = p.mesh.position.x - s.x;
        const dz = p.mesh.position.z - s.z;
        // 2D proximity + height band (skeleton body ~0.2-2.2u) so aimed shots connect
        if (dx * dx + dz * dz < 1.0 && p.mesh.position.y > 0.15 && p.mesh.position.y < 2.4) {
          this.hitSkeleton?.(s.skel);
          hit = true;
          break;
        }
      }
      if (hit) {
        this._deactivate(p);
        continue;
      }

      if (p.life <= 0) this._deactivate(p);
    }
  }

  _deactivate(p) {
    p.active = false;
    p.mesh.visible = false;
    p.glow.visible = false;
  }

  dispose() {
    for (const p of this.projectiles) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      p.glow.material.dispose();
      this.scene.remove(p.mesh);
      this.scene.remove(p.glow);
    }
    if (this._tex) this._tex.dispose();
    this.projectiles = [];
  }
}

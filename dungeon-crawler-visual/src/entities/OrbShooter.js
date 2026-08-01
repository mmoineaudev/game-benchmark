import * as THREE from 'three';
import { ORB_WEAPON } from '../core/Constants.js';
import { circleHitsBox } from '../core/Collision.js';

// Orb economy: 1 collected orb = ONE SEQUENCE of VOLLEY steps, and ONE
// CLICK = ONE STEP. The player builds the sequence across clicks:
//   - step 1 and step 2 are normal orbs: 1 damage on a direct hit and one
//     BOUNCE off walls / floor / ceiling, then fizzle on the next contact.
//   - step 3 (the last) is explosive: it detonates on its first contact and
//     deals EXPLODE_DAMAGE to every enemy within EXPLODE_RADIUS (handled by
//     Game via onExplode).
// Each step is aimed individually (current camera direction at click time).
// The sequence stays open for SEQUENCE_WINDOW after the last step; the first
// step of a new sequence costs an orb (Game charges it via the startingNew
// flag), steps 2-3 of an open sequence are free.
export class OrbShooter {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = []; // pooled, round-robin reuse
    this._next = 0;
    this._tex = null;
    this.step = 0;       // 0 = no open sequence | 1..VOLLEY = steps fired so far
    this.window = 0;     // seconds remaining before the sequence expires
    this.onExplode = null; // (x, y, z) -> Game applies AOE damage
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

    const meshGeo = new THREE.SphereGeometry(0.16, 10, 8); // smaller orbs
    const meshMat = new THREE.MeshStandardMaterial({
      color: 0x44aaff, emissive: 0x44aaff, emissiveIntensity: 2.5,
      roughness: 0.15, metalness: 0.4,
    });
    const glowMat = new THREE.SpriteMaterial({
      map: this._tex, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.8,
    });

    // Sized for the sustained rate: 5.5 shots/s x 3 orbs x 2.5 s life ≈ 41
    const POOL = 48;
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(meshGeo, meshMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(1.2, 1.2, 1);
      mesh.visible = false;
      glow.visible = false;
      this.scene.add(mesh);
      this.scene.add(glow);
      this.projectiles.push({
        mesh, glow, dirX: 0, dirY: 0, dirZ: 0, life: 0,
        active: false, bounces: 0, explode: false, fireball: false,
      });
    }

    // Fireball slots (temporary buff weapon): same pool/loop, fiery visuals.
    // Fired via fireFireball() — always explodes on contact, no ammo cost.
    const fireGeo = new THREE.SphereGeometry(0.19, 10, 8);
    const fireMat = new THREE.MeshStandardMaterial({
      color: 0xff8830, emissive: 0xff5522, emissiveIntensity: 3.0,
      roughness: 0.2, metalness: 0.1,
    });
    const fireGlowMat = new THREE.SpriteMaterial({
      map: this._tex, color: 0xff8844,
      blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.9,
    });
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(fireGeo, fireMat);
      const glow = new THREE.Sprite(fireGlowMat);
      glow.scale.set(1.5, 1.5, 1);
      mesh.visible = false;
      glow.visible = false;
      this.scene.add(mesh);
      this.scene.add(glow);
      this.projectiles.push({
        mesh, glow, dirX: 0, dirY: 0, dirZ: 0, life: 0,
        active: false, bounces: 0, explode: true, fireball: true,
        isFireballSlot: true,
      });
    }
    this._fireMat = fireMat;
    this._fireGlowMat = fireGlowMat;

    // Pooled explosion rings (additive) — no per-event allocation
    this._boomGeo = new THREE.TorusGeometry(0.5, 0.06, 6, 20);
    this._boomMat = new THREE.MeshBasicMaterial({
      color: 0x66ddff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._booms = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(this._boomGeo, this._boomMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this._booms.push({ mesh: m, life: 0, active: false });
    }

    // Fiery rings for fireball explosions
    this._boomFireMat = new THREE.MeshBasicMaterial({
      color: 0xff8830, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._boomFires = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(this._boomGeo, this._boomFireMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      this._boomFires.push({ mesh: m, life: 0, active: false });
    }
  }

  // Fire ONE STEP along the current camera look direction (yaw + pitch).
  // Advances the open sequence (or starts a new one). Returns the step
  // result so Game can charge the orb only for the first step of a sequence.
  fire(x, y, z, yaw, pitch = 0) {
    const startingNew = this.step === 0 || this.window <= 0;
    if (startingNew) this.step = 0;
    this.step++; // 1..VOLLEY
    const firedStep = this.step;
    const isExplosive = firedStep === ORB_WEAPON.VOLLEY;
    // The last step COMPLETES the sequence — the next click opens a new one
    if (isExplosive) { this.step = 0; this.window = 0; }
    else this.window = ORB_WEAPON.SEQUENCE_WINDOW;

    const p = this._nextSlot(false); // blue orb slot (never a fireball slot)
    if (!p) return { step: firedStep, startingNew, projectile: null };
    p.active = true;
    p.mesh.visible = true;
    p.glow.visible = true;
    p.mesh.position.set(x, y, z);
    p.glow.position.set(x, y, z);
    // Camera look vector (matches Game._updateCamera)
    p.dirX = -Math.sin(yaw) * Math.cos(pitch);
    p.dirY = Math.sin(pitch);
    p.dirZ = -Math.cos(yaw) * Math.cos(pitch);
    const len = Math.hypot(p.dirX, p.dirY, p.dirZ) || 1;
    p.dirX /= len; p.dirY /= len; p.dirZ /= len;
    p.life = ORB_WEAPON.LIFETIME;
    p.bounces = 0;
    // The LAST step of the sequence is the explosive one
    p.explode = isExplosive;
    return { step: firedStep, startingNew, projectile: p };
  }

  // Fire a free fireball (temporary buff weapon): a fiery projectile that
  // explodes on its first contact. No sequence, no ammo cost.
  fireFireball(x, y, z, yaw, pitch = 0) {
    const p = this._nextSlot(true); // fireball slot only
    if (!p) return null;
    p.active = true;
    p.mesh.visible = true;
    p.glow.visible = true;
    p.mesh.position.set(x, y, z);
    p.glow.position.set(x, y, z);
    p.dirX = -Math.sin(yaw) * Math.cos(pitch);
    p.dirY = Math.sin(pitch);
    p.dirZ = -Math.cos(yaw) * Math.cos(pitch);
    const len = Math.hypot(p.dirX, p.dirY, p.dirZ) || 1;
    p.dirX /= len; p.dirY /= len; p.dirZ /= len;
    p.life = ORB_WEAPON.LIFETIME;
    p.bounces = 0;
    p.explode = true;
    return p;
  }

  // Round-robin pool allocation, filtered by slot type (fireball slots stay
  // fireball slots so the volley never spawns an orange orb mid-sequence).
  _nextSlot(wantFireball) {
    for (let tries = 0; tries < this.projectiles.length; tries++) {
      const cand = this.projectiles[this._next];
      this._next = (this._next + 1) % this.projectiles.length;
      if (!!cand.isFireballSlot === wantFireball) return cand;
    }
    return null;
  }

  update(dt, collisionBoxes, skeletons) {
    // Sequence expiry: a pause longer than SEQUENCE_WINDOW resets it
    if (this.window > 0) {
      this.window -= dt;
      if (this.window <= 0) this.step = 0;
    }
    const speed = ORB_WEAPON.SPEED;
    for (const p of this.projectiles) {
      if (!p.active) continue;
      const prevX = p.mesh.position.x;
      const prevZ = p.mesh.position.z;
      p.mesh.position.x += p.dirX * speed * dt;
      p.mesh.position.y += p.dirY * speed * dt;
      p.mesh.position.z += p.dirZ * speed * dt;
      p.glow.position.copy(p.mesh.position);
      p.life -= dt;

      // Floor contact
      if (p.mesh.position.y < 0.15) {
        if (p.explode) { this._explode(p); continue; }
        if (p.bounces < ORB_WEAPON.BOUNCES) {
          p.mesh.position.y = 0.15;
          p.dirY = Math.abs(p.dirY);
          p.bounces++;
          continue;
        }
        this._deactivate(p);
        continue;
      }

      // Ceiling contact
      if (p.mesh.position.y > 3.85) {
        if (p.explode) { this._explode(p); continue; }
        if (p.bounces < ORB_WEAPON.BOUNCES) {
          p.mesh.position.y = 3.85;
          p.dirY = -Math.abs(p.dirY);
          p.bounces++;
          continue;
        }
        this._deactivate(p);
        continue;
      }

      // Wall contact (2D, full-height)
      if (circleHitsBox(collisionBoxes, p.mesh.position.x, p.mesh.position.z, ORB_WEAPON.RADIUS)) {
        if (p.explode) { this._explode(p); continue; }
        if (p.bounces < ORB_WEAPON.BOUNCES) {
          const axis = this._wallHitAxis(collisionBoxes, p.mesh.position.x, p.mesh.position.z, prevX, prevZ);
          // Revert to the pre-step position (outside the box), then head off
          // in the reflected direction.
          p.mesh.position.x = prevX;
          p.mesh.position.z = prevZ;
          if (axis === 'x') p.dirX = -p.dirX;
          else p.dirZ = -p.dirZ;
          p.bounces++;
          p.glow.position.copy(p.mesh.position);
          continue;
        }
        this._deactivate(p);
        continue;
      }

      // Breakable prop hit (optional hook from Game)
      if (this.onHitProp?.(p.mesh.position.x, p.mesh.position.z)) {
        if (p.explode) { this._explode(p); continue; }
        this._deactivate(p);
        continue;
      }

      // Enemy hit
      let hit = false;
      for (const s of skeletons) {
        if (s.skel.state === 'DEAD') continue;
        const dx = p.mesh.position.x - s.x;
        const dz = p.mesh.position.z - s.z;
        // 2D proximity + height band (enemy body ~0.2-2.2u) so aimed shots connect
        if (dx * dx + dz * dz < 1.0 && p.mesh.position.y > 0.15 && p.mesh.position.y < 2.4) {
          if (p.explode) {
            this._explode(p);
          } else {
            this.hitSkeleton?.(s.skel);
            this._deactivate(p);
          }
          hit = true;
          break;
        }
      }
      if (hit) continue;

      if (p.life <= 0) this._deactivate(p);
    }

    // Explosion rings (orb + fireball pools)
    this._tickBooms(this._booms, dt);
    this._tickBooms(this._boomFires, dt);
  }

  _tickBooms(booms, dt) {
    for (const b of booms) {
      if (!b.active) continue;
      b.life -= dt;
      const t = 1 - Math.max(0, b.life / 0.3);
      b.mesh.scale.setScalar(0.4 + t * 2.2);
      b.mesh.material.opacity = 0.7 * (1 - t);
      if (b.life <= 0) { b.active = false; b.mesh.visible = false; }
    }
  }

  // Dominant axis ('x' | 'z') to reflect when the orb meets a wall box.
  _wallHitAxis(boxes, x, z, prevX, prevZ) {
    for (const box of boxes) {
      const cx = Math.max(box.minX, Math.min(x, box.maxX));
      const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < ORB_WEAPON.RADIUS * ORB_WEAPON.RADIUS) {
        if (Math.abs(dx) > 0.02 || Math.abs(dz) > 0.02) {
          return Math.abs(dx) > Math.abs(dz) ? 'x' : 'z';
        }
        // Center inside the box (tunnelled): reflect along the dominant motion
        return Math.abs(x - prevX) > Math.abs(z - prevZ) ? 'x' : 'z';
      }
    }
    return 'z';
  }

  _explode(p) {
    const { x, y, z } = p.mesh.position;
    // AOE damage + visual ring, then the orb is gone
    this.onExplode?.(x, y, z);
    const pool = p.fireball ? this._boomFires : this._booms;
    const b = pool.find((b) => !b.active) || pool[0];
    b.active = true;
    b.life = 0.3;
    b.mesh.visible = true;
    b.mesh.position.set(x, y + 0.1, z);
    b.mesh.scale.setScalar(0.4);
    this._deactivate(p);
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
    if (this._boomGeo) {
      this._boomGeo.dispose();
      this._boomMat.dispose();
      this._boomFireMat.dispose();
      for (const b of this._booms) this.scene.remove(b.mesh);
      for (const b of this._boomFires) this.scene.remove(b.mesh);
    }
    this.projectiles = [];
    this._booms = [];
    this._boomFires = [];
  }
}

import * as THREE from 'three';
import { ORB_WEAPON } from '../core/Constants.js';
import { circleHitsBox } from '../core/Collision.js';

// Orb economy: 1 collected orb = ONE CLICK = one SEQUENCE of VOLLEY smaller
// orbs, fired one after another (SEQUENCE_GAP apart):
//   - orbs 1..VOLLEY-1 are normal: they deal 1 damage on a direct hit and
//     BOUNCE once off walls / floor / ceiling, then fizzle on the next
//     surface contact — ricochets keep pressure in corridors.
//   - the last orb is explosive: it detonates on its first contact (enemy,
//     wall, floor, ceiling) and deals EXPLODE_DAMAGE to every enemy within
//     EXPLODE_RADIUS (handled by Game via onExplode).
// The trigger is locked for SEQUENCE_LOCK seconds (Game gates clicks), so
// each orb spent buys exactly one full sequence — up to VOLLEY hits against
// 2 HP skeletons makes ranged play sustainable.
export class OrbShooter {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = []; // pooled, round-robin reuse
    this._scheduled = [];  // sequence orbs waiting for their slot
    this._next = 0;
    this._tex = null;
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
        active: false, bounces: 0, explode: false,
      });
    }

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
  }

  // Start a SEQUENCE along the camera look direction (yaw + pitch) so the
  // crosshair is the aim. The first orb fires immediately; the rest release
  // in update() at SEQUENCE_GAP intervals. Returns the array of handles.
  fire(x, y, z, yaw, pitch = 0) {
    // Defensive: a new sequence replaces any unfinished one (Game's
    // SEQUENCE_LOCK cooldown normally prevents overlap).
    for (const p of this._scheduled) {
      p.scheduled = false;
      p.active = false;
      p.mesh.visible = false;
      p.glow.visible = false;
    }
    this._scheduled.length = 0;

    const baseX = -Math.sin(yaw) * Math.cos(pitch);
    const baseY = Math.sin(pitch);
    const baseZ = -Math.cos(yaw) * Math.cos(pitch);
    const fired = [];
    for (let i = 0; i < ORB_WEAPON.VOLLEY; i++) {
      const p = this.projectiles[this._next];
      this._next = (this._next + 1) % this.projectiles.length;
      // Slight fan so sequence orbs don't stack on one point
      const off = (i - (ORB_WEAPON.VOLLEY - 1) / 2) * ORB_WEAPON.SPREAD;
      const cosOff = Math.cos(off);
      const sinOff = Math.sin(off);
      p.dirX = baseX * cosOff - baseZ * sinOff;
      p.dirZ = baseX * sinOff + baseZ * cosOff;
      p.dirY = baseY;
      const len = Math.hypot(p.dirX, p.dirY, p.dirZ) || 1;
      p.dirX /= len; p.dirY /= len; p.dirZ /= len;
      p.life = ORB_WEAPON.LIFETIME;
      p.bounces = 0;
      // The LAST orb of the sequence is the explosive one
      p.explode = i === ORB_WEAPON.VOLLEY - 1;
      p.spawnX = x; p.spawnY = y; p.spawnZ = z;
      p.delay = i * ORB_WEAPON.SEQUENCE_GAP;
      p.scheduled = true;
      p.active = false;
      p.mesh.visible = false;
      p.glow.visible = false;
      if (i === 0) this._activate(p); // first orb fires immediately
      else this._scheduled.push(p);
      fired.push(p);
    }
    return fired;
  }

  _activate(p) {
    p.scheduled = false;
    p.active = true;
    p.mesh.visible = true;
    p.glow.visible = true;
    p.mesh.position.set(p.spawnX, p.spawnY, p.spawnZ);
    p.glow.position.set(p.spawnX, p.spawnY, p.spawnZ);
  }

  update(dt, collisionBoxes, skeletons) {
    // Release sequence orbs when their slot comes due
    for (let i = this._scheduled.length - 1; i >= 0; i--) {
      const p = this._scheduled[i];
      p.delay -= dt;
      if (p.delay <= 0) {
        this._scheduled.splice(i, 1);
        this._activate(p);
      }
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

    // Explosion rings
    for (const b of this._booms) {
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
    const b = this._booms.find((b) => !b.active) || this._booms[0];
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
      for (const b of this._booms) this.scene.remove(b.mesh);
    }
    this.projectiles = [];
    this._booms = [];
  }
}

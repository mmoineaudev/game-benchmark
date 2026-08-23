// OrbShooter.js — the orb weapon: pooled projectiles (48 normal + 6 fireball slots),
// 3-step sequence, bounces, explosions, fireball variant (§10)
import * as THREE from 'three';
import { ORB_WEAPON } from '../core/Constants.js';

// Fireball module singletons — built ONCE at module load, NEVER disposed (§27 gotcha).
let _fb = null;
function getFireballShared() {
  if (!_fb) {
    _fb = {
      mat: new THREE.MeshBasicMaterial({ color: 0xff7a2a }),
      glow: (() => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,180,80,1)');
        g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
      })()
    };
  }
  return _fb;
}

export default class OrbShooter {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.explosionRingsNormal = [];
    this.explosionRingsFire = [];
    this._ringIdxN = 0; this._ringIdxF = 0;

    // 48 normal slots + 6 fireball slots — round-robin allocator MUST filter by type
    for (let i = 0; i < ORB_WEAPON.POOL_NORMAL + ORB_WEAPON.POOL_FIREBALL; i++) {
      const isFire = i >= ORB_WEAPON.POOL_NORMAL;
      const mesh = isFire
        ? new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), getFireballShared().mat.clone())
        : new THREE.Mesh(new THREE.SphereGeometry(ORB_WEAPON.RADIUS, 10, 8),
            new THREE.MeshBasicMaterial({ color: 0x66ddff }));
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({
        type: isFire ? 'fireball' : 'orb',
        mesh, vel: new THREE.Vector3(), life: 0,
        active: false, step: 0, bounces: 0
      });
    }
    this.nextNormal = 0;
    this.nextFire = ORB_WEAPON.POOL_NORMAL;
    // explosion rings: 8 normal / 6 fire additive torus rings
    for (let i = 0; i < 8; i++) this.explosionRingsNormal.push(this._makeRing(0x66ddff));
    for (let i = 0; i < 6; i++) this.explosionRingsFire.push(this._makeRing(0xff7a2a));
    this.onExplode = null;   // (x,y,z,damage,radius) → Game applies AOE
    this.onHitEnemy = null;  // (enemy, damage)
    this.onHitProp = null;   // (breakable)
    this.enemiesRef = () => [];
    this.collisionBoxesRef = () => [];
  }

  _makeRing(color) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.06, 6, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.visible = false;
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    return { mesh: ring, t: -1 };
  }

  fire(origin, dir, step, orbs, isFireball = false) {
    // pick a free slot filtered by type (round-robin)
    let slot = null;
    const start = isFireball ? this.nextFire : this.nextNormal;
    const count = isFireball ? ORB_WEAPON.POOL_FIREBALL : ORB_WEAPON.POOL_NORMAL;
    for (let k = 0; k < count; k++) {
      const idx = isFireball
        ? ORB_WEAPON.POOL_NORMAL + ((start - ORB_WEAPON.POOL_NORMAL + k) % count)
        : (start + k) % count;
      const s = this.pool[idx];
      if (!s.active) { slot = s; break; }
    }
    if (!slot) return null;
    slot.active = true;
    slot.step = step;
    slot.bounces = 0;
    slot.life = ORB_WEAPON.LIFE;
    slot.mesh.position.copy(origin);
    slot.vel.copy(dir).normalize().multiplyScalar(ORB_WEAPON.SPEED);
    slot.mesh.visible = true;
    if (!isFireball) this.nextNormal = (this.pool.indexOf(slot) + 1) % ORB_WEAPON.POOL_NORMAL;
    else this.nextFire = ORB_WEAPON.POOL_NORMAL + (((this.pool.indexOf(slot) - ORB_WEAPON.POOL_NORMAL) + 1) % ORB_WEAPON.POOL_FIREBALL);
    return slot;
  }

  explode(x, y, z, damage) {
    // AOE to every enemy within EXPLODE_RADIUS if blast y < 2.6 (blasts through walls — accepted)
    if (y < ORB_WEAPON.EXPLODE_Y_GATE && this.onExplode) {
      this.onExplode(x, y, z, damage, ORB_WEAPON.EXPLODE_RADIUS);
    }
    // visual ring
    const isFire = damage > 100 ? false : false; // rings picked by caller type below
  }

  spawnRing(x, y, z, isFireball) {
    const pool = isFireball ? this.explosionRingsFire : this.explosionRingsNormal;
    const idx = isFireball ? this._ringIdxF : this._ringIdxN;
    const ring = pool[idx];
    if (isFireball) this._ringIdxF = (this._ringIdxF + 1) % pool.length;
    else this._ringIdxN = (this._ringIdxN + 1) % pool.length;
    ring.t = 0;
    ring.mesh.visible = true;
    ring.mesh.position.set(x, Math.max(0.2, y), z);
    ring.mesh.scale.setScalar(0.5);
    ring.mesh.material.opacity = 0.9;
  }

  update(dt, enemies) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      const m = p.mesh;
      const prevX = m.position.x, prevY = m.position.y, prevZ = m.position.z;
      m.position.addScaledVector(p.vel, dt);

      // enemy hit?
      let hitEnemy = null;
      for (const e of enemies) {
        if (!e.alive || e.state === 'DEAD' || e.frozen) continue;
        const dx = e.pos.x - m.position.x, dz = e.pos.z - m.position.z;
        const dy = (e.group.position.y + 1) - m.position.y;
        if (dx * dx + dz * dz < 0.45 && Math.abs(dy) < 1.6) { hitEnemy = e; break; }
      }
      if (hitEnemy && this.onHitEnemy) {
        this.onHitEnemy(hitEnemy, p.damage);
        if (p.step === 3 || p.type === 'fireball') { this._detonate(p); }
        else { this._kill(p); }
        continue;
      }

      // surface contact?
      let contact = null;
      const boxes = this.collisionBoxesRef();
      for (const b of boxes) {
        if (m.position.x > b.minX - 0.15 && m.position.x < b.maxX + 0.15 &&
            m.position.z > b.minZ - 0.15 && m.position.z < b.maxZ + 0.15 &&
            m.position.y < 20) {
          // find dominant axis of penetration using previous position
          const fromLeft = prevX <= b.minX, fromRight = prevX >= b.maxX;
          const fromNear = prevZ <= b.minZ, fromFar = prevZ >= b.maxZ;
          contact = { axis: fromLeft || fromRight ? 'x' : (fromNear || fromFar ? 'z' : 'y'), b, fromLeft, fromRight, fromNear, fromFar };
          break;
        }
      }
      if (m.position.y <= ORB_WEAPON.RADIUS) contact = { axis: 'floor' };
      else if (m.position.y >= 20 - ORB_WEAPON.RADIUS) contact = { axis: 'ceiling' };

      if (contact) {
        if (p.step === 3 || p.type === 'fireball') { this._detonate(p); continue; }
        // bounce up to 3 times off floor/ceiling/walls reflecting dominant axis, then fizzle
        if (p.bounces >= ORB_WEAPON.BOUNCES) { this.spawnRing(m.position.x, m.position.y, m.position.z, p.type === 'fireball'); this._kill(p); continue; }
        p.bounces++;
        if (contact.axis === 'floor') { m.position.y = ORB_WEAPON.RADIUS; p.vel.y = Math.abs(p.vel.y); }
        else if (contact.axis === 'ceiling') { m.position.y = 20 - ORB_WEAPON.RADIUS; p.vel.y = -Math.abs(p.vel.y); }
        else if (contact.axis === 'x') {
          p.vel.x *= -1;
          m.position.x = contact.fromLeft ? contact.b.minX - 0.16 : contact.b.maxX + 0.16;
        } else {
          p.vel.z *= -1;
          m.position.z = contact.fromNear ? contact.b.minZ - 0.16 : contact.b.maxZ + 0.16;
        }
      }

      if (p.life <= 0) {
        if (p.step === 3 || p.type === 'fireball') this._detonate(p);
        else this._kill(p);
      }
    }

    // rings animate
    for (const set of [this.explosionRingsNormal, this.explosionRingsFire]) {
      for (const r of set) {
        if (r.t < 0) continue;
        r.t += dt;
        const ttl = r.mesh.material.color.getHex() === 0xff7a2a ? 0.22 : 0.35;
        const k = r.t / ttl;
        r.mesh.scale.setScalar(0.5 + k * 3);
        r.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
        if (k >= 1) { r.t = -1; r.mesh.visible = false; }
      }
    }
  }

  _detonate(p) {
    const dmg = p.damage ?? 5;
    this.explode(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, dmg);
    this.spawnRing(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, p.type === 'fireball');
    this._kill(p);
  }

  _kill(p) {
    p.active = false;
    p.mesh.visible = false;
  }

  dispose(scene) {
    for (const p of this.pool) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    for (const r of [...this.explosionRingsNormal, ...this.explosionRingsFire]) {
      scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose();
    }
    this.pool = []; this.explosionRingsNormal = []; this.explosionRingsFire = [];
  }
}

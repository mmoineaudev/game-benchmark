import * as THREE from 'three';
import { DROP, PLAYER } from '../core/Constants.js';

// Shared resources created once at init — no per-pickup GPU allocations.
const RING_POOL_SIZE = 8;
const RING_TTL = 0.45;

export class OrbSystem {
  constructor(scene, dungeonData, state) {
    this.scene = scene;
    this.data = dungeonData;
    this.state = state;
    this.orbs = [];
    this.rings = []; // pickup feedback rings (pooled)
    this.drops = []; // skeleton death drops (auto-collect)
    this._ringPool = []; // reusable rings
    this._ringIdx = 0;
    this._ringGeo = null;
    this._dropGeo = null;
    this._dropGlowGeo = null;
    this._dropMat = null;
    this._dropGlowMat = null;
  }

  init() {
    // --- Shared pickup-ring resources (pooled to avoid per-pickup allocation) ---
    this._ringGeo = new THREE.TorusGeometry(0.5, 0.04, 8, 24);
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x66ccff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._ringGeo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this._ringPool.push({ mesh, active: false });
    }

    // --- Shared drop resources (one geometry/material for all skeleton drops) ---
    this._dropGeo = new THREE.SphereGeometry(0.18, 12, 10);
    this._dropGlowGeo = new THREE.SphereGeometry(0.4, 10, 8);
    this._dropMat = new THREE.MeshStandardMaterial({
      color: 0x44aaff, emissive: 0x44aaff, emissiveIntensity: 2.5,
      roughness: 0.15, metalness: 0.4,
    });
    this._dropGlowMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // --- Shared health-reset pickup resources (red medical cross) ---
    this._healthGeoA = new THREE.BoxGeometry(0.09, 0.3, 0.05);  // vertical bar
    this._healthGeoB = new THREE.BoxGeometry(0.3, 0.09, 0.05);  // horizontal bar
    this._healthMat = new THREE.MeshStandardMaterial({
      color: 0xff3355, emissive: 0xff3355, emissiveIntensity: 1.4,
      roughness: 0.3, metalness: 0.2,
    });
    this._healthGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff4466, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // --- Shared buff pickup resources (golden mystery octahedron) ---
    this._buffGeo = new THREE.OctahedronGeometry(0.22);
    this._buffMat = new THREE.MeshStandardMaterial({
      color: 0xffd76a, emissive: 0xffb040, emissiveIntensity: 1.6,
      roughness: 0.2, metalness: 0.6,
    });
    this._buffGlowMat = new THREE.MeshBasicMaterial({
      color: 0xffc860, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });

    // --- Purple death-burst pool (enemies turn purple + pop into particles) ---
    this._burstGeo = new THREE.SphereGeometry(0.12, 6, 6);
    this._burstMat = new THREE.MeshBasicMaterial({
      color: 0xb44fff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._bursts = [];
    for (let i = 0; i < 3; i++) {  // ~90% cut from 30 — death-burst particles near-none
      const m = new THREE.Mesh(this._burstGeo, this._burstMat);
      m.visible = false;
      this.scene.add(m);
      this._bursts.push({
        mesh: m, sx: 0, sy: 0, sz: 0, vx: 0, vy: 0, vz: 0,
        start: 0, dur: 0.6, active: false,
      });
    }
    this._burstIdx = 0;

    // No orbs are placed on the map — they only come from skeleton drops.
    this.state.totalOrbs = 0;
  }

  update(time, playerPos) {
    const p = playerPos;

    // Animate pickup rings (pooled, time-based fade)
    for (const ring of this._ringPool) {
      if (!ring.active) continue;
      const t = (time - ring.start) / RING_TTL;
      if (t >= 1) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }
      ring.mesh.scale.setScalar(0.3 + t * 2.5);
      ring.mesh.material.opacity = 0.8 * (1 - t);
      ring.mesh.rotation.x += 0.02;
    }

    // Purple death bursts: particles fly outward and shrink away
    for (const b of this._bursts) {
      if (!b.active) continue;
      const e = time - b.start;
      if (e >= b.dur) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      b.mesh.position.set(b.sx + b.vx * e, b.sy + b.vy * e, b.sz + b.vz * e);
      b.mesh.scale.setScalar(Math.max(0.05, 0.7 * (1 - e / b.dur)));
    }

    // Skeleton drops: bob + auto-collect on proximity
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      if (drop.kind === 'health' || drop.kind === 'buff') {
        drop.group.position.y = drop.y + Math.sin(time * 2.5 + drop.phase) * 0.12;
        drop.group.rotation.y += 0.02;
      } else {
        drop.mesh.position.y = drop.y + Math.sin(time * 2.5 + drop.phase) * 0.1;
        drop.mesh.rotation.y += 0.03;
        drop.glow.position.copy(drop.mesh.position);
      }
      const dx = p.x - drop.x;
      const dz = p.z - drop.z;
      if (dx * dx + dz * dz < DROP.RADIUS * DROP.RADIUS) {
        if (drop.kind === 'health') {
          // Health pickup: fills ALL empty hearts (full restore)
          this.state.health = this.state.maxHealth || PLAYER.MAX_HEALTH;
          this._spawnPickupRing(drop.x, drop.y, drop.z, time);
          this.scene.remove(drop.group);
        } else if (drop.kind === 'buff') {
          // Temporary buff: Game picks the random effect
          this.onBuffCollected?.(drop.x, drop.z);
          this._spawnPickupRing(drop.x, drop.y, drop.z, time);
          this.scene.remove(drop.group);
        } else {
          this.state.collectedOrbs++;
          // Lifetime souls counter (monotonic — the weapon-evolution tier
          // source). Incremented ONLY on orb pickups, never health/buff drops.
          this.state.soulsEarned = (this.state.soulsEarned || 0) + 1;
          this._spawnPickupRing(drop.x, drop.y, drop.z, time);
          this.scene.remove(drop.mesh);
          this.scene.remove(drop.glow);
        }
        this.drops.splice(i, 1);
      }
    }
  }

  // Spawn one or more auto-collect orbs at a kill position (drop-on-kill).
  // Uses shared geometry/material — no allocation per drop.
  spawnDrop(x, z, count = 1) {
    const y = DROP.Y;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this._dropGeo, this._dropMat);
      const ox = (Math.random() - 0.5) * 0.8;
      const oz = (Math.random() - 0.5) * 0.8;
      mesh.position.set(x + ox, y, z + oz);
      this.scene.add(mesh);
      const glow = new THREE.Mesh(this._dropGlowGeo, this._dropGlowMat);
      glow.position.copy(mesh.position);
      this.scene.add(glow);
      this.drops.push({ mesh, glow, x: x + ox, z: z + oz, y, phase: Math.random() * Math.PI * 2 });
    }
  }

  // Spawn a health-reset pickup (red medical cross) at a kill position.
  // Auto-collect on proximity -> full heal. Shared geometry/material.
  spawnHealth(x, z) {
    const y = DROP.HEALTH_Y;
    const group = new THREE.Group();
    const barA = new THREE.Mesh(this._healthGeoA, this._healthMat);
    const barB = new THREE.Mesh(this._healthGeoB, this._healthMat);
    const glow = new THREE.Mesh(this._dropGlowGeo, this._healthGlowMat);
    group.add(barA, barB, glow);
    const ox = (Math.random() - 0.5) * 0.8;
    const oz = (Math.random() - 0.5) * 0.8;
    group.position.set(x + ox, y, z + oz);
    this.scene.add(group);
    this.drops.push({
      group, x: x + ox, z: z + oz, y,
      phase: Math.random() * Math.PI * 2, kind: 'health',
    });
  }

  // Spawn a buff pickup (golden mystery octahedron) at a breakable's
  // position. Auto-collect -> Game applies a random 15s effect.
  spawnBuff(x, z) {
    const y = DROP.HEALTH_Y;
    const group = new THREE.Group();
    const gem = new THREE.Mesh(this._buffGeo, this._buffMat);
    const glow = new THREE.Mesh(this._dropGlowGeo, this._buffGlowMat);
    group.add(gem, glow);
    const ox = (Math.random() - 0.5) * 0.8;
    const oz = (Math.random() - 0.5) * 0.8;
    group.position.set(x + ox, y, z + oz);
    this.scene.add(group);
    this.drops.push({
      group, x: x + ox, z: z + oz, y,
      phase: Math.random() * Math.PI * 2, kind: 'buff',
    });
  }

  // Purple burst when an enemy dies: particles fly outward and shrink away
  spawnPurpleBurst(x, z, time) {
    for (let k = 0; k < 7; k++) {
      const b = this._bursts[this._burstIdx];
      this._burstIdx = (this._burstIdx + 1) % this._bursts.length;
      const a = Math.random() * Math.PI * 2;
      b.active = true;
      b.mesh.visible = true;
      b.mesh.scale.setScalar(0.7);
      b.sx = x; b.sy = 0.4; b.sz = z;
      b.vx = Math.cos(a) * (1.2 + Math.random() * 1.4);
      b.vz = Math.sin(a) * (1.2 + Math.random() * 1.4);
      b.vy = 0.8 + Math.random() * 1.2;
      b.start = time;
      b.dur = 0.6;
    }
  }

  // Reuse a pooled ring — no geometry/material creation at pickup time
  _spawnPickupRing(x, y, z, time) {
    const ring = this._ringPool[this._ringIdx];
    this._ringIdx = (this._ringIdx + 1) % this._ringPool.length;
    ring.active = true;
    ring.start = time;
    ring.mesh.visible = true;
    ring.mesh.scale.setScalar(0.3);
    ring.mesh.material.opacity = 0.8;
    ring.mesh.rotation.x = Math.PI / 2;
    ring.mesh.position.set(x, y, z);
  }

  nearestOrbDist() {
    return Infinity; // no map orbs — orbs only come from drops
  }

  dispose() {
    // Dispose pooled ring resources once
    if (this._ringGeo) this._ringGeo.dispose();
    for (const ring of this._ringPool) {
      ring.mesh.material.dispose();
      this.scene.remove(ring.mesh);
    }
    // Dispose shared drop resources once
    if (this._dropGeo) this._dropGeo.dispose();
    if (this._dropGlowGeo) this._dropGlowGeo.dispose();
    if (this._dropMat) this._dropMat.dispose();
    if (this._dropGlowMat) this._dropGlowMat.dispose();
    // Dispose shared health-pickup resources once
    if (this._healthGeoA) this._healthGeoA.dispose();
    if (this._healthGeoB) this._healthGeoB.dispose();
    if (this._healthMat) this._healthMat.dispose();
    if (this._healthGlowMat) this._healthGlowMat.dispose();
    // Dispose shared buff-pickup resources once
    if (this._buffGeo) this._buffGeo.dispose();
    if (this._buffMat) this._buffMat.dispose();
    if (this._buffGlowMat) this._buffGlowMat.dispose();
    // Dispose purple-death-burst resources once
    if (this._burstGeo) this._burstGeo.dispose();
    if (this._burstMat) this._burstMat.dispose();
    for (const b of this._bursts) this.scene.remove(b.mesh);
    this._bursts = [];
    this._ringPool = [];
    this.drops = [];
    this.orbs = [];
  }
}

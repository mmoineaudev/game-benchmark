import * as THREE from 'three';
import { DROP } from '../core/Constants.js';

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

    // Skeleton drops: bob + auto-collect on proximity
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.mesh.position.y = drop.y + Math.sin(time * 2.5 + drop.phase) * 0.1;
      drop.mesh.rotation.y += 0.03;
      drop.glow.position.copy(drop.mesh.position);
      const dx = p.x - drop.x;
      const dz = p.z - drop.z;
      if (dx * dx + dz * dz < DROP.RADIUS * DROP.RADIUS) {
        this.state.collectedOrbs++;
        this._spawnPickupRing(drop.x, drop.y, drop.z, time);
        this.scene.remove(drop.mesh);
        this.scene.remove(drop.glow);
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
    this._ringPool = [];
    this.drops = [];
    this.orbs = [];
  }
}

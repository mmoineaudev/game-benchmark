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

    const vaultCells = [];
    const otherCells = [];
    const gs = this.data.gridSize;
    const cs = this.data.cellSize;

    for (let cz = 0; cz < gs; cz++) {
      for (let cx = 0; cx < gs; cx++) {
        const meta = this.data.metadata[cz][cx];
        if (meta.type === 'room') {
          if (meta.roomType === 'VAULT') vaultCells.push({ cx, cz });
          else otherCells.push({ cx, cz });
        }
      }
    }

    const orbMat = new THREE.MeshStandardMaterial({
      color: 0x44aaff, emissive: 0x44aaff, emissiveIntensity: 2.5,
      roughness: 0.15, metalness: 0.4,
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.15, depthWrite: false,
    });
    const glowGeo = new THREE.SphereGeometry(0.45, 16, 16);

    const cells = [...vaultCells, ...otherCells].sort(() => Math.random() - 0.5);
    const chosen = cells.slice(0, Math.min(5, cells.length));

    for (const { cx, cz } of chosen) {
      const x = cx * cs + cs / 2 + (Math.random() - 0.5) * (cs * 0.4);
      const z = cz * cs + cs / 2 + (Math.random() - 0.5) * (cs * 0.4);
      const y = 1.2;

      const orbGeo = new THREE.SphereGeometry(0.25, 32, 32);
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(x, y, z);
      this.scene.add(glow);

      // Point light on orb for visibility
      const orbLight = new THREE.PointLight(0x44aaff, 2, 8, 1.5);
      orbLight.position.set(x, y, z);
      this.scene.add(orbLight);

      const particles = this._createOrbParticles(x, y, z);

      this.orbs.push({ mesh, glow, light: orbLight, particles, x, y, z, collected: false, baseY: y });
    }

    this.state.totalOrbs = this.orbs.length;
  }

  _createOrbParticles(x, y, z) {
    const count = 12;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x88ccff, size: 0.04, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.7,
    });
    const points = new THREE.Points(geo, mat);
    points.userData = { basePositions: new Float32Array(positions) };
    this.scene.add(points);
    return points;
  }

  update(time, playerPos) {
    const p = playerPos;

    for (const orb of this.orbs) {
      if (orb.collected) continue;

      orb.mesh.position.y = orb.baseY + Math.sin(time * 2.5) * 0.12;
      orb.mesh.rotation.y += 0.015;
      orb.mesh.rotation.x += 0.008;
      orb.glow.position.copy(orb.mesh.position);
      orb.glow.scale.setScalar(1 + Math.sin(time * 3) * 0.1);

      // Orbit particles around orb
      if (orb.particles && orb.particles.userData.basePositions) {
        orb.particles.position.copy(orb.mesh.position);
        orb.particles.rotation.y += 0.02;
        orb.particles.rotation.x += 0.01;
      }

      const dx = p.x - orb.x;
      const dz = p.z - orb.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 1.5) {
        orb.collected = true;
        this.state.collectedOrbs++;
        this._spawnPickupRing(orb.x, orb.y, orb.z, time);
        orb.mesh.scale.set(0, 0, 0);
        orb.glow.scale.set(0, 0, 0);
        orb.light.intensity = 0;
        this.scene.remove(orb.mesh);
        this.scene.remove(orb.glow);
        this.scene.remove(orb.light);
        if (orb.particles) {
          orb.particles.geometry.dispose();
          orb.particles.material.dispose();
          this.scene.remove(orb.particles);
        }
        orb.mesh.geometry.dispose();
        orb.glow.geometry.dispose();
      }
    }

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

  // Spawn an auto-collect orb at a skeleton's death position.
  // Uses shared geometry/material — no allocation per drop.
  spawnDrop(x, z) {
    const y = DROP.Y;
    const mesh = new THREE.Mesh(this._dropGeo, this._dropMat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const glow = new THREE.Mesh(this._dropGlowGeo, this._dropGlowMat);
    glow.position.set(x, y, z);
    this.scene.add(glow);
    this.drops.push({ mesh, glow, x, z, y, phase: Math.random() * Math.PI * 2 });
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

  nearestOrbDist(playerPos) {
    let min = Infinity;
    for (const orb of this.orbs) {
      if (orb.collected) continue;
      const dx = playerPos.x - orb.x;
      const dz = playerPos.z - orb.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < min) min = d;
    }
    return min;
  }

  dispose() {
    for (const orb of this.orbs) {
      if (!orb.collected) {
        orb.mesh.geometry.dispose();
        orb.glow.geometry.dispose();
        orb.light.dispose?.();
        this.scene.remove(orb.mesh);
        this.scene.remove(orb.glow);
        this.scene.remove(orb.light);
        if (orb.particles) {
          orb.particles.geometry.dispose();
          orb.particles.material.dispose();
          this.scene.remove(orb.particles);
        }
      }
    }
    // Dispose shared materials
    if (this.orbs.length > 0) {
      const m0 = this.orbs[0].mesh.material;
      if (m0 && !m0._disposed) { m0.dispose(); m0._disposed = true; }
      const g0 = this.orbs[0].glow.material;
      if (g0 && !g0._disposed) { g0.dispose(); g0._disposed = true; }
    }
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

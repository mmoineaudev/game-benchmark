import * as THREE from 'three';
import { WORLD } from '../core/Constants.js';

export class OrbSystem {
  constructor(scene, dungeonData, state) {
    this.scene = scene;
    this.data = dungeonData;
    this.state = state;
    this.orbs = []; // { mesh, x, y, z, collected }
  }

  init() {
    // Place 5 orbs in random rooms, preferring vaults
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
      color: 0x44aaff,
      emissive: 0x44aaff,
      emissiveIntensity: 2.5,
      roughness: 0.2,
      metalness: 0.3,
    });

    // Place at least 1 in vault, spread rest randomly
    const cells = [...vaultCells, ...otherCells].sort(() => Math.random() - 0.5);
    const chosen = cells.slice(0, Math.min(5, cells.length));

    for (const { cx, cz } of chosen) {
      const x = cx * cs + cs / 2 + (Math.random() - 0.5) * (cs * 0.5);
      const z = cz * cs + cs / 2 + (Math.random() - 0.5) * (cs * 0.5);
      const y = 1.2;

      const orbGeo = new THREE.SphereGeometry(0.25, 32, 32);
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);

      this.orbs.push({ mesh, x, y, z, collected: false, baseY: y });
    }

    this.state.totalOrbs = this.orbs.length;
  }

  update(time, playerPos, isPressedE, wasPressedE) {
    const p = playerPos;
    let collectedThisFrame = false;

    for (const orb of this.orbs) {
      if (orb.collected) continue;

      // Bobbing animation
      orb.mesh.position.y = orb.baseY + Math.sin(time * 3) * 0.15;
      orb.mesh.rotation.y += 0.01;

      // Collection check
      const dx = p.x - orb.x;
      const dz = p.z - orb.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 1.5 && isPressedE && !wasPressedE) {
        orb.collected = true;
        this.state.collectedOrbs++;
        collectedThisFrame = true;

        // Shrink and remove animation
        orb.mesh.scale.set(0, 0, 0);
        this.scene.remove(orb.mesh);
      }
    }

    return collectedThisFrame;
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

  allCollected() {
    return this.state.collectedOrbs >= this.state.totalOrbs && this.state.totalOrbs > 0;
  }

  dispose() {
    // Dispose shared material once
    for (const orb of this.orbs) {
      if (!orb.collected) {
        orb.mesh.geometry.dispose();
        this.scene.remove(orb.mesh);
      }
    }
    // Find and dispose material from any mesh
    if (this.orbs.length > 0) {
      const m = this.orbs[0].mesh.material;
      if (m && !m._disposed) { m.dispose(); m._disposed = true; }
    }
    this.orbs = [];
  }
}

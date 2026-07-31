// ============================================================
// CollectibleSystem — Pickups in chunks
// ============================================================
import * as THREE from 'three';
import GameState from '../core/GameState.js';

class CollectibleSystem {
  constructor(scene) {
    this.scene = scene;
    this._collectibles = [];
    this._dummy = new THREE.Object3D();
  }

  init() {
    return this._collectibles;
  }

  /**
   * spawn dropdowns for one chunk
   */
  spawnCrystals(center, count, rng) {
    const geo = new THREE.OctahedronGeometry(0.35, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 0.4,
      roughness: 0.2,
      metalness: 0.6,
    });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = true;
      mesh.position.set(
        center.x + (rng() - 0.5) * 160,
        center.y + (rng() - 0.5) * 160,
        center.z + (rng() - 0.5) * 160
      );
      mesh.userData.collectible = true;
      mesh.userData.value = 50;
      this.scene.add(mesh);
      this._collectibles.push(mesh);
    }
  }

  /**
   * spawn salvage ruins: harmless ancient fragments
   */
  spawnRuins(center, count, rng) {
    const geo = new THREE.TetrahedronGeometry(0.6, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x887766,
      roughness: 0.9,
      metalness: 0.3,
      flatShading: true,
    });

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.position.set(
        center.x + (rng() - 0.5) * 180,
        center.y + (rng() - 0.5) * 180,
        center.z + (rng() - 0.5) * 180
      );
      mesh.visible = false;
      mesh.userData.collectible = true;
      mesh.userData.value = 20;
      this.scene.add(mesh);
      this._collectibles.push(mesh);
    }
  }

  /**
   * update collection distance checks each frame
   */
  update(shipPos) {
    const reach = 3.5;
    for (let i = this._collectibles.length - 1; i >= 0; i--) {
      const c = this._collectibles[i];
      if (!c || !c.visible) continue;
      if (!shipPos) continue;
      if (c.position.distanceTo(shipPos) < reach) {
        c.visible = false;
        c.userData.collected = true;
        GameState.addScore(c.userData.value);
      }
    }
  }

  /**
   * Remove all collectibles and dispose
   */
  clear() {
    for (const c of this._collectibles) {
      this.scene.remove(c);
      c.geometry?.dispose();
      c.material?.dispose();
    }
    this._collectibles = [];
  }
}

export default CollectibleSystem;

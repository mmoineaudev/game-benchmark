// VOID DRIFT — DebrisSystem.js
// Instanced micro-debris. Per-instance collidables → hittable for 1 pt.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

let _debrisId = 0;

export class DebrisSystem {
  constructor(scene) {
    this._scene = scene;
    this._geo = new THREE.IcosahedronGeometry(1, 0);
    this._mat = new THREE.MeshStandardMaterial({ color: 0x777d88, metalness: 0.4, roughness: 0.6 });
    this._meshes = [];
    this._tmpMatrix = new THREE.Matrix4();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpScale = new THREE.Vector3();
    this._tmpPos = new THREE.Vector3();
  }

  generateChunk(center, rng, count, isSafe) {
    if (isSafe || count <= 0) return;
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        x: center.x + (rng() - 0.5) * Constants.CHUNK.SIZE,
        y: center.y + (rng() - 0.5) * Constants.CHUNK.SIZE,
        z: center.z + (rng() - 0.5) * Constants.CHUNK.SIZE,
        size: 0.1 + rng() * 0.2,
      });
    }
    const mesh = new THREE.InstancedMesh(this._geo, this._mat, items.length);
    const collidables = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      this._tmpPos.set(it.x, it.y, it.z);
      this._tmpQuat.setFromEuler(new THREE.Euler(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI));
      this._tmpScale.setScalar(it.size);
      this._tmpMatrix.compose(this._tmpPos, this._tmpQuat, this._tmpScale);
      mesh.setMatrixAt(i, this._tmpMatrix);
      collidables.push({
        uid: `deb_${++_debrisId}`,
        instanceId: i,
        position: new THREE.Vector3(it.x, it.y, it.z),
        size: it.size,
        radius: Math.max(it.size, 0.35),   // slightly forgiving hitbox
        alive: true,
        tier: 'debris',
        mesh,
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData = { isChunkObject: true, isInstanced: true, _collidables: collidables, tier: 'debris' };
    mesh.isInstanced = true;
    this._scene.add(mesh);
    this._meshes.push(mesh);
  }

  killInstance(mesh, instanceId) {
    this._tmpScale.setScalar(0.0001);
    this._tmpQuat.identity();
    this._tmpMatrix.compose(new THREE.Vector3(0, -99999, 0), this._tmpQuat, this._tmpScale);
    mesh.setMatrixAt(instanceId, this._tmpMatrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  clearChunk(chunkKey) {
    for (let i = this._meshes.length - 1; i >= 0; i--) {
      if (this._meshes[i].userData.chunkKey === chunkKey) {
        this._scene.remove(this._meshes[i]);
        this._meshes.splice(i, 1);
      }
    }
  }

  tagChunk(chunkKey) {
    for (const m of this._meshes) {
      if (m.userData.chunkKey == null) m.userData.chunkKey = chunkKey;
    }
  }

  clearAll() {
    for (const m of this._meshes) this._scene.remove(m);
    this._meshes = [];
  }

  destroy() {
    this.clearAll();
    this._geo.dispose();
    this._mat.dispose();
  }
}

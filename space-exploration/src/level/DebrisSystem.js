// ============================================================
// DebrisSystem — Floating debris, destructible objects
// ============================================================
import * as THREE from 'three';
import { randomInCylinder, randomRange } from '../utils/MathHelpers.js';

class DebrisSystem {
  constructor(scene) {
    this.scene = scene;
    this._debris = [];
    this._instancedMeshes = [];
  }

  init() {
    return this._debris;
  }

  /**
   * Create debris objects for a chunk
   */
  createDebris(chunkCenter, count, rng) {
    const debris = [];
    const actualCount = Math.floor(count * 0.3);

    // Mix of debris types: boxes (shards), cylinders (space junk)
    const boxCount = Math.floor(actualCount * 0.6);
    const junkCount = actualCount - boxCount;

    // Individual debris pieces
    for (let i = 0; i < boxCount; i++) {
      const piece = this._createDebrisPiece(chunkCenter, rng);
      this.scene.add(piece);
      this._debris.push(piece);
    }

    // Instanced space junk for performance
    if (junkCount > 0) {
      const mesh = this._createJunkInstanced(chunkCenter, junkCount, rng);
      this.scene.add(mesh);
      this._instancedMeshes.push(mesh);
    }

    return debris;
  }

  _createDebrisPiece(center, rng) {
    // Random shape
    let geo;
    const shape = rng();
    if (shape < 0.5) {
      // Box shard
      const sx = 0.05 + rng() * 0.2;
      const sy = 0.05 + rng() * 0.2;
      const sz = 0.05 + rng() * 0.15;
      geo = new THREE.BoxGeometry(sx, sy, sz);
    } else if (shape < 0.8) {
      // Cylinder junk
      geo = new THREE.CylinderGeometry(0.03 + rng() * 0.05, 0.03 + rng() * 0.05, 0.2 + rng() * 0.3, 6);
    } else {
      // Octahedron rock
      geo = new THREE.OctahedronGeometry(0.05 + rng() * 0.1);
    }

    const color = new THREE.Color().setHSL(
      0.1 + rng() * 0.15,
      0.1 + rng() * 0.2,
      0.15 + rng() * 0.2
    );

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.9,
      metalness: 0.2 + rng() * 0.3,
    });

    const mesh = new THREE.Mesh(geo, mat);
    const offset = randomInCylinder(50, 30);
    mesh.position.set(center.x + offset.x, center.y + offset.y, center.z + offset.z);
    mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);

    mesh.userData.isDestroyed = false;
    mesh.userData.size = 0.3;
    mesh.userData.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.3);
    mesh.userData.rotationSpeed = new THREE.Vector3(
      (rng() - 0.5) * 0.3,
      (rng() - 0.5) * 0.3,
      (rng() - 0.5) * 0.3
    );
    mesh.userData.driftVelocity = new THREE.Vector3(
      (rng() - 0.5) * 1,
      (rng() - 0.5) * 1,
      (rng() - 0.5) * 1
    );

    return mesh;
  }

  _createJunkInstanced(center, count, rng) {
    const geo = new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6);
    const instancedMesh = new THREE.InstancedMesh(
      geo,
      new THREE.MeshStandardMaterial({
        roughness: 0.9,
        metalness: 0.3,
      }),
      count
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const offset = randomInCylinder(40, 25);
      
      dummy.position.set(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      const scale = 0.5 + rng() * 1.5;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(i, dummy.matrix);

      color.setHSL(0.08 + rng() * 0.1, 0.15, 0.2 + rng() * 0.15);
      instancedMesh.setColorAt(i, color);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    return instancedMesh;
  }

  /**
   * Update debris rotation and drift
   */
  update(dt) {
    for (const d of this._debris) {
      if (d.userData.rotationSpeed) {
        d.rotation.x += d.userData.rotationSpeed.x * dt;
        d.rotation.y += d.userData.rotationSpeed.y * dt;
      }
      if (d.userData.driftVelocity) {
        d.position.add(d.userData.driftVelocity.clone().multiplyScalar(dt));
      }
    }
  }

  /**
   * Clear all debris
   */
  clear() {
    for (const d of this._debris) {
      this.scene.remove(d);
      d.geometry?.dispose();
      d.material?.dispose();
    }
    for (const mesh of this._instancedMeshes) {
      this.scene.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
    this._debris = [];
    this._instancedMeshes = [];
  }
}

export default DebrisSystem;

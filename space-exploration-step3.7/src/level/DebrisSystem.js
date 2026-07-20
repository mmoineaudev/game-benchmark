// ============================================================
// DebrisSystem — Floating debris pieces in chunks
// ============================================================
import * as THREE from 'three';
import { randomInCylinder } from '../utils/MathHelpers.js';

class DebrisSystem {
  constructor(scene) {
    this.scene = scene;
    this._debris = [];
  }

  init() {
    return this._debris;
  }

  /**
   * Create debris pieces for a chunk
   */
  createDebris(chunkCenter, count, rng) {
    const debris = [];
    
    // Create instanced mesh for debris (small floating rocks)
    const baseGeo = new THREE.IcosahedronGeometry(0.3, 0);
    const positions = baseGeo.attributes.position;
    
    // Add some noise to make them look like rocks
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const noise = Math.sin(x * 3.7 + y * 2.3) * 0.1 + Math.cos(z * 2.9) * 0.1;
      const len = Math.sqrt(x*x + y*y + z*z);
      if (len > 0) {
        positions.setXYZ(i, x * (1 + noise/len), y * (1 + noise/len), z * (1 + noise/len));
      }
    }
    baseGeo.computeVertexNormals();

    const instancedMesh = new THREE.InstancedMesh(
      baseGeo,
      new THREE.MeshStandardMaterial({
        roughness: 0.95,
        metalness: 0.1,
        flatShading: true,
      }),
      count
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const offset = randomInCylinder(50, 40);
      const size = 0.1 + rng() * 0.3;

      dummy.position.set(
        chunkCenter.x + offset.x,
        chunkCenter.y + offset.y,
        chunkCenter.z + offset.z
      );
      dummy.rotation.set(
        rng() * Math.PI,
        rng() * Math.PI,
        rng() * Math.PI
      );
      dummy.scale.setScalar(size);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(i, dummy.matrix);

      // Per-instance color variation
      color.setHSL(0.05 + rng() * 0.1, 0.2, 0.15 + rng() * 0.15);
      instancedMesh.setColorAt(i, color);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    instancedMesh.userData.isDebris = true;
    this.scene.add(instancedMesh);
    
    // Store reference for collision detection
    debris.push({
      mesh: instancedMesh,
      isInstanced: true,
      userData: { 
        size: 0.2, 
        isDestroyed: false, 
        boundingSphere: null 
      }
    });

    return debris;
  }

  /**
   * Update all debris (drift)
   */
  update(dt) {
    // Debris doesn't move much, just slight drift
    for (const d of this._debris) {
      if (d.mesh && !d.mesh.isInstanced) {
        d.mesh.position.y += Math.sin(Date.now() * 0.001 + d.mesh.userData.seed || 0) * 0.01;
      }
    }
  }

  /**
   * Remove destroyed debris
   */
  removeDestroyed() {
    // Debris fragments are not individually tracked for destruction
    // Only the instanced mesh is removed when chunk is cleaned up
  }

  /**
   * Clear all debris
   */
  clear() {
    for (const d of this._debris) {
      if (d.mesh && !d.isInstanced) {
        this.scene.remove(d.mesh);
        d.mesh.geometry?.dispose();
        d.mesh.material?.dispose();
      }
    }
    this._debris = [];
  }
}

export default DebrisSystem;
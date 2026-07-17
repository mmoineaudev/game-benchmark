// ============================================================
// AsteroidField — Procedural asteroid generation (InstancedMesh)
// ============================================================
import * as THREE from 'three';
import { randomInCylinder, randomRange } from '../utils/MathHelpers.js';

class AsteroidField {
  constructor(scene) {
    this.scene = scene;
    this._asteroids = [];
    this._instancedMeshes = [];
  }

  init() {
    return this._asteroids;
  }

  /**
   * Create procedural asteroids for a chunk
   */
  createAsteroids(chunkCenter, count, params, rng) {
    const asteroids = [];
    const density = params.asteroidDensity;
    const actualCount = Math.floor(count * density);

    // Create instanced meshes for medium and small asteroids
    const mediumCount = Math.floor(actualCount * 0.4);
    const smallCount = Math.floor(actualCount * 0.4);
    const largeCount = actualCount - mediumCount - smallCount;

    // Large asteroids — individual meshes (fewer, more detailed)
    if (largeCount > 0) {
      for (let i = 0; i < largeCount; i++) {
        const asteroid = this._createLargeAsteroid(chunkCenter, rng);
        this.scene.add(asteroid);
        asteroids.push(asteroid);
        this._asteroids.push(asteroid);
      }
    }

    // Medium asteroids — InstancedMesh
    if (mediumCount > 0) {
      const mesh = this._createMediumInstanced(chunkCenter, mediumCount, rng);
      this.scene.add(mesh);
      this._instancedMeshes.push(mesh);
      // Store references
      for (let i = 0; i < mediumCount; i++) {
        asteroids.push({
          mesh,
          instanceId: i,
          isInstanced: true,
          userData: { size: 1.2, isDestroyed: false, boundingSphere: null }
        });
      }
    }

    // Small asteroids — InstancedMesh
    if (smallCount > 0) {
      const mesh = this._createSmallInstanced(chunkCenter, smallCount, rng);
      this.scene.add(mesh);
      this._instancedMeshes.push(mesh);
      for (let i = 0; i < smallCount; i++) {
        asteroids.push({
          mesh,
          instanceId: i,
          isInstanced: true,
          userData: { size: 0.4, isDestroyed: false, boundingSphere: null }
        });
      }
    }

    return asteroids;
  }

  _createLargeAsteroid(center, rng) {
    // Icosahedron with vertex displacement
    const baseGeo = new THREE.IcosahedronGeometry(1, 2);
    const positions = baseGeo.attributes.position;
    const simplex = this._simplexNoise(positions.count);

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const noise = simplex(x * 0.5, y * 0.5, z * 0.5) * 0.3;
      const len = Math.sqrt(x*x + y*y + z*z);
      const scale = (1 + noise) / len;
      positions.setXYZ(i, x * scale, y * scale, z * scale);
    }
    baseGeo.computeVertexNormals();

    const size = 2 + rng() * 3;
    const color = new THREE.Color().setHSL(
      0.05 + rng() * 0.1, // brown/orange hue
      0.2 + rng() * 0.3,
      0.15 + rng() * 0.2
    );

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.85 + rng() * 0.15,
      metalness: 0.1 + rng() * 0.2,
      flatShading: true,
    });

    const mesh = new THREE.Mesh(baseGeo, mat);
    const offset = randomInCylinder(60, 40);
    mesh.position.set(center.x + offset.x, center.y + offset.y, center.z + offset.z);
    mesh.scale.setScalar(size);
    mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);

    mesh.userData.size = size;
    mesh.userData.isDestroyed = false;
    mesh.userData.boundingSphere = new THREE.Sphere(new THREE.Vector3(), size);
    mesh.userData.rotationSpeed = new THREE.Vector3(
      (rng() - 0.5) * 0.5,
      (rng() - 0.5) * 0.5,
      (rng() - 0.5) * 0.5
    );
    mesh.userData.driftVelocity = new THREE.Vector3(
      (rng() - 0.5) * 2,
      (rng() - 0.5) * 2,
      (rng() - 0.5) * 2
    );

    return mesh;
  }

  _createMediumInstanced(center, count, rng) {
    const baseGeo = new THREE.DodecahedronGeometry(1, 0);
    const positions = baseGeo.attributes.position;

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
        roughness: 0.9,
        metalness: 0.15,
        flatShading: true,
      }),
      count
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const offset = randomInCylinder(50, 30);
      const size = 0.5 + rng() * 1.0;

      dummy.position.set(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(i, dummy.matrix);

      // Per-instance color variation
      color.setHSL(0.06 + rng() * 0.08, 0.3, 0.15 + rng() * 0.15);
      instancedMesh.setColorAt(i, color);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    instancedMesh.userData.size = 1.2;
    instancedMesh.userData.isInstanced = true;

    return instancedMesh;
  }

  _createSmallInstanced(center, count, rng) {
    const baseGeo = new THREE.OctahedronGeometry(1, 0);
    const positions = baseGeo.attributes.position;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const z = positions.getZ(i);
      const noise = Math.sin(x * 5.1 + z * 3.7) * 0.08;
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
        metalness: 0.2,
        flatShading: true,
      }),
      count
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const offset = randomInCylinder(40, 25);
      const size = 0.2 + rng() * 0.4;

      dummy.position.set(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();

      instancedMesh.setMatrixAt(i, dummy.matrix);

      color.setHSL(0.05 + rng() * 0.1, 0.2, 0.2 + rng() * 0.15);
      instancedMesh.setColorAt(i, color);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) instancedMesh.instanceColor.needsUpdate = true;

    instancedMesh.userData.size = 0.4;
    instancedMesh.userData.isInstanced = true;

    return instancedMesh;
  }

  _simplexNoise(count) {
    // Simple pseudo-noise for vertex displacement
    const s = Math.sin;
    return function(x, y, z) {
      return s(x * 1.1 + y * 2.3 + z * 0.7) * s(x * 3.1 - z * 1.9) * 0.5 +
             s(x * 5.3 + y * 0.9 + z * 4.1) * 0.25 +
             s(x * 9.7 - y * 7.3 + z * 11.1) * 0.125;
    };
  }

  /**
   * Update all asteroids (rotation, drift)
   */
  update(dt, time) {
    // Large/individual asteroids
    for (const asteroid of this._asteroids) {
      if (asteroid.isInstanced) continue;
      if (!asteroid.userData.rotationSpeed) continue;
      
      asteroid.rotation.x += asteroid.userData.rotationSpeed.x * dt;
      asteroid.rotation.y += asteroid.userData.rotationSpeed.y * dt;
      asteroid.position.add(asteroid.userData.driftVelocity.clone().multiplyScalar(dt));
    }
  }

  /**
   * Remove destroyed asteroids
   */
  removeDestroyed() {
    // For large asteroids, remove destroyed meshes
    for (let i = this._asteroids.length - 1; i >= 0; i--) {
      const a = this._asteroids[i];
      if (!a.isInstanced && a.userData.isDestroyed) {
        this.scene.remove(a);
        a.geometry.dispose();
        a.material.dispose();
        this._asteroids.splice(i, 1);
      }
    }
  }

  /**
   * Clear all asteroids
   */
  clear() {
    for (const a of this._asteroids) {
      if (!a.isInstanced) {
        this.scene.remove(a);
        a.geometry?.dispose();
        a.material?.dispose();
      }
    }
    for (const mesh of this._instancedMeshes) {
      this.scene.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
    this._asteroids = [];
    this._instancedMeshes = [];
  }
}

export default AsteroidField;
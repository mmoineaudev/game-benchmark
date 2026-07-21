// VOID DRIFT — AsteroidField.js
// Three tiers: large = individual vertex-displaced icosahedron meshes;
// medium/small = InstancedMesh with per-instance collidable records
// (projectile-hittable via PhysicsSystem per-instance path).

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

let _instanceIdCounter = 0;

function displaceGeometry(geo, amount, rng) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const len = v.length();
    v.normalize().multiplyScalar(len * (1 + (rng() - 0.5) * amount));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export class AsteroidField {
  constructor(scene) {
    this._scene = scene;
    this._material = new THREE.MeshStandardMaterial({ color: 0x8a7f70, metalness: 0.15, roughness: 0.9 });
    this._darkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b6055, metalness: 0.2, roughness: 0.85 });
    this._baseGeoLarge = new THREE.IcosahedronGeometry(1, 1);
    this._geoMedium = new THREE.DodecahedronGeometry(1, 0);
    this._geoSmall = new THREE.OctahedronGeometry(1, 0);
    this._objects = [];       // meshes + instanced meshes in scene
    this._rotators = [];      // { obj, rx, ry, drift } large only
    this._tmpMatrix = new THREE.Matrix4();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpScale = new THREE.Vector3();
  }

  /**
   * Generate the asteroids for one chunk.
   * @param center THREE.Vector3 chunk center
   * @param rng seeded rng
   * @param density biome asteroid density
   * @param isSafe when true, skip (origin safety radius)
   */
  generateChunk(center, rng, density, isSafe) {
    if (isSafe) return;
    const count = Math.max(0, Math.floor(
      (Constants.CHUNK.ASTEROID_COUNT_BASE + rng() * Constants.CHUNK.ASTEROID_COUNT_VAR) * density));
    if (count === 0) return;

    const half = Constants.CHUNK.SIZE / 2;
    const mediums = [];
    const smalls = [];

    for (let i = 0; i < count; i++) {
      const px = center.x + (rng() - 0.5) * Constants.CHUNK.SIZE;
      const py = center.y + (rng() - 0.5) * Constants.CHUNK.SIZE;
      const pz = center.z + (rng() - 0.5) * Constants.CHUNK.SIZE;
      const roll = rng();

      if (roll < 0.22) {
        // Large individual asteroid (size 2–5).
        const size = 2 + rng() * 3;
        const geo = displaceGeometry(this._baseGeoLarge.clone(), 0.55, rng);
        const mesh = new THREE.Mesh(geo, this._material);
        mesh.scale.setScalar(size);
        mesh.position.set(px, py, pz);
        mesh.userData = {
          isChunkObject: true, isAsteroid: true, size, radius: size, isDestroyed: false,
          driftVelocity: new THREE.Vector3((rng() - 0.5) * 0.8, (rng() - 0.5) * 0.8, (rng() - 0.5) * 0.8),
        };
        this._scene.add(mesh);
        this._objects.push(mesh);
        this._rotators.push({
          obj: mesh,
          rx: (rng() - 0.5) * 0.4, ry: (rng() - 0.5) * 0.4,
        });
      } else if (roll < 0.6) {
        mediums.push({ x: px, y: py, z: pz, size: 0.5 + rng() * 1.0 });
      } else {
        smalls.push({ x: px, y: py, z: pz, size: 0.2 + rng() * 0.4 });
      }
    }

    if (mediums.length) this._buildInstanced(mediums, this._geoMedium, this._darkMaterial, 'medium');
    if (smalls.length) this._buildInstanced(smalls, this._geoSmall, this._darkMaterial, 'small');
  }

  _buildInstanced(items, geometry, material, tier) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const collidables = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      this._tmpQuat.setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, 0));
      this._tmpScale.setScalar(it.size);
      this._tmpMatrix.compose(new THREE.Vector3(it.x, it.y, it.z), this._tmpQuat, this._tmpScale);
      mesh.setMatrixAt(i, this._tmpMatrix);
      collidables.push({
        uid: `ast_${++_instanceIdCounter}`,
        instanceId: i,
        position: new THREE.Vector3(it.x, it.y, it.z),
        size: it.size,
        radius: it.size,
        alive: true,
        tier,
        mesh,
      });
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData = { isChunkObject: true, isInstanced: true, _collidables: collidables, tier };
    mesh.isInstanced = true;   // marker for PhysicsSystem
    this._scene.add(mesh);
    this._objects.push(mesh);
  }

  /** Zero out one instance's matrix (kill). */
  killInstance(mesh, instanceId) {
    this._tmpScale.setScalar(0.0001);
    this._tmpQuat.identity();
    this._tmpMatrix.compose(new THREE.Vector3(0, -99999, 0), this._tmpQuat, this._tmpScale);
    mesh.setMatrixAt(instanceId, this._tmpMatrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Large asteroid destruction: remove mesh. */
  destroyMesh(mesh) {
    mesh.userData.isDestroyed = true;
    this._scene.remove(mesh);
    if (mesh.geometry && mesh.geometry !== this._baseGeoLarge) mesh.geometry.dispose();
    const idx = this._objects.indexOf(mesh);
    if (idx >= 0) this._objects.splice(idx, 1);
    const ridx = this._rotators.findIndex((r) => r.obj === mesh);
    if (ridx >= 0) this._rotators.splice(ridx, 1);
  }

  update(dt) {
    for (const r of this._rotators) {
      r.obj.rotation.x += r.rx * dt;
      r.obj.rotation.y += r.ry * dt;
      if (r.obj.userData.driftVelocity) {
        r.obj.position.addScaledVector(r.obj.userData.driftVelocity, dt);
      }
    }
  }

  /** Remove everything belonging to a chunk (objects tagged with chunkKey). */
  clearChunk(chunkKey) {
    for (let i = this._objects.length - 1; i >= 0; i--) {
      const o = this._objects[i];
      if (o.userData.chunkKey === chunkKey) {
        this._scene.remove(o);
        if (o.isInstanced) {
          // shared geometries — do not dispose base geos
        } else if (o.geometry && o.geometry !== this._baseGeoLarge) {
          o.geometry.dispose();
        }
        this._objects.splice(i, 1);
      }
    }
    for (let i = this._rotators.length - 1; i >= 0; i--) {
      if (this._rotators[i].obj.userData.chunkKey === chunkKey) this._rotators.splice(i, 1);
    }
  }

  tagChunk(chunkKey) {
    for (const o of this._objects) {
      if (o.userData.chunkKey == null) o.userData.chunkKey = chunkKey;
    }
  }

  clearAll() {
    for (const o of this._objects) {
      this._scene.remove(o);
      if (!o.isInstanced && o.geometry && o.geometry !== this._baseGeoLarge) o.geometry.dispose();
    }
    this._objects = [];
    this._rotators = [];
  }

  destroy() {
    this.clearAll();
    this._material.dispose();
    this._darkMaterial.dispose();
    this._baseGeoLarge.dispose();
    this._geoMedium.dispose();
    this._geoSmall.dispose();
  }
}

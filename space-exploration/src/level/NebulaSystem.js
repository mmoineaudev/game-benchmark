// ============================================================
// NebulaSystem — Volumetric-feel nebula clouds (custom shaders)
// ============================================================
import * as THREE from 'three';
import { NEBULA_VERTEX_SHADER, NEBULA_FRAGMENT_SHADER } from '../utils/ShaderHelpers.js';
import { randomInCylinder } from '../utils/MathHelpers.js';

class NebulaSystem {
  constructor(scene) {
    this.scene = scene;
    this._clusters = [];
  }

  init() {
    return this._clusters;
  }

  /**
   * Create nebula cloud clusters for a chunk
   */
  createCluster(position, params, rng) {
    const cluster = new THREE.Group();
    const numBillboards = 8 + Math.floor(rng() * 5);

    // Create a shared base geometry (large plane for billboarding)
    const baseGeo = new THREE.PlaneGeometry(1, 1);

    for (let i = 0; i < numBillboards; i++) {
      const scale = 15 + rng() * 35;
      const offset = randomInCylinder(30, 20);
      offset.y += position.y;
      offset.x += position.x;
      offset.z += position.z;

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor1: { value: new THREE.Color(...params.nebulaColors.c1) },
          uColor2: { value: new THREE.Color(...params.nebulaColors.c2) },
          uColor3: { value: new THREE.Color(...params.nebulaColors.c3) },
          uDensity: { value: params.nebulaDensity * (0.5 + rng() * 0.5) },
          uPulse: { value: 0.5 + rng() },
        },
        vertexShader: NEBULA_VERTEX_SHADER,
        fragmentShader: NEBULA_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const billboard = new THREE.Mesh(baseGeo, material);
      billboard.position.copy(offset);
      billboard.scale.setScalar(scale);
      billboard.rotation.z = rng() * Math.PI * 2;
      billboard.userData.isNebula = true;

      cluster.add(billboard);
    }

    this.scene.add(cluster);
    this._clusters.push({ group: cluster, position: position.clone(), params });
    return cluster;
  }

  /**
   * Update all nebula uniforms
   */
  update(time) {
    for (const cluster of this._clusters) {
      for (const child of cluster.group.children) {
        if (child.isMesh && child.material.uniforms) {
          child.material.uniforms.uTime.value = time;
        }
      }
    }
  }

  /**
   * Remove a specific cluster
   */
  removeCluster(cluster) {
    const idx = this._clusters.findIndex(c => c.group === cluster);
    if (idx >= 0) {
      this._clusters[idx].group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.scene.remove(this._clusters[idx].group);
      this._clusters.splice(idx, 1);
    }
  }

  /**
   * Clear all clusters
   */
  clear() {
    for (const cluster of this._clusters) {
      cluster.group.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.scene.remove(cluster.group);
    }
    this._clusters = [];
  }
}

export default NebulaSystem;

// ============================================================
// NebulaSystem — Volumetric-feel nebula clouds (custom shaders)
// ============================================================
import * as THREE from 'three';
import { NEBULA_FRAGMENT_SHADER } from '../utils/ShaderHelpers.js';

class NebulaSystem {
  constructor(scene) {
    this.scene = scene;
    this._clusters = [];
    this._sharedGeo = null;
  }

  init() {
    // Lazy-init shared geometry on first createCluster() call
    return this._clusters;
  }

  /**
   * Create nebula cloud clusters for a chunk
   */
  createCluster(position, params, rng) {
    const cluster = new THREE.Group();
    const numBillboards = 8 + Math.floor(rng() * 5);

    // Lazily create shared geometry (avoids init() ordering issues)
    if (!this._sharedGeo) {
      this._sharedGeo = new THREE.PlaneGeometry(1, 1);
    }

    for (let i = 0; i < numBillboards; i++) {
      const scale = 15 + rng() * 35;
      const offset = new THREE.Vector3(
        (rng() - 0.5) * 30,
        (rng() - 0.5) * 20,
        (rng() - 0.5) * 30
      );
      offset.add(position);

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor1: { value: new THREE.Color(...params.nebulaColors.c1) },
          uColor2: { value: new THREE.Color(...params.nebulaColors.c2) },
          uColor3: { value: new THREE.Color(...params.nebulaColors.c3) },
          uDensity: { value: params.nebulaDensity * (0.5 + rng() * 0.5) },
          uPulse: { value: 0.5 + rng() },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: NEBULA_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const billboard = new THREE.Mesh(this._sharedGeo, material);
      billboard.position.copy(offset);
      billboard.scale.setScalar(scale);
      billboard.rotation.z = rng() * Math.PI * 2;
      billboard.userData.isNebula = true;

      // Billboard: face camera each frame
      billboard.userData.billboard = true;

      cluster.add(billboard);
    }

    this.scene.add(cluster);
    this._clusters.push({ group: cluster, position: position.clone(), params });
    return cluster;
  }

  /**
   * Update all nebula uniforms and billboarding
   */
  update(time, camera) {
    const cam = camera || this.scene.parent?.camera || new THREE.Vector3();
    for (const cluster of this._clusters) {
      for (const child of cluster.group.children) {
        // Billboard: face camera each frame
        if (child.userData.billboard) {
          child.lookAt(cam);
        }
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

  destroy() {
    this.clear();
    if (this._sharedGeo) {
      this._sharedGeo.dispose();
      this._sharedGeo = null;
    }
  }
}

export default NebulaSystem;

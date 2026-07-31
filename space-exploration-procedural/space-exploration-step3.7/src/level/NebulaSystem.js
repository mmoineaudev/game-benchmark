// ============================================================
// NebulaSystem — Volumetric nebula clouds with billboarding
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { NEBULA_FRAGMENT_BODY, NEBULA_VERTEX_SHADER, SIMPLEX_3D_GLSL } from '../utils/ShaderHelpers.js';

class NebulaSystem {
  constructor(scene) {
    this.scene = scene;
    this._clusters = [];
    this._sharedGeo = null; // Lazy init to avoid ordering issues
  }

  init() {
    // Create shared geometry lazily on first use
    return this._clusters;
  }

  /**
   * Create a nebula cluster at position
   */
  createCluster(position, params, rng) {
    if (!this._sharedGeo) {
      this._sharedGeo = new THREE.PlaneGeometry(1, 1);
    }

    const cluster = new THREE.Group();
    const count = 5 + Math.floor(rng() * 8);

    for (let i = 0; i < count; i++) {
      const offset = new THREE.Vector3(
        (rng() - 0.5) * 20,
        (rng() - 0.5) * 15,
        (rng() - 0.5) * 20
      );

      const scale = 8 + rng() * 15;
      const rotation = rng() * Math.PI * 2;

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor1: { value: new THREE.Color(params.nebulaColors.c1[0], params.nebulaColors.c1[1], params.nebulaColors.c1[2]) },
          uColor2: { value: new THREE.Color(params.nebulaColors.c2[0], params.nebulaColors.c2[1], params.nebulaColors.c2[2]) },
          uColor3: { value: new THREE.Color(params.nebulaColors.c3[0], params.nebulaColors.c3[1], params.nebulaColors.c3[2]) },
          uDensity: { value: params.nebulaDensity },
          uPulse: { value: 0.5 + rng() * 1.5 },
        },
        vertexShader: NEBULA_VERTEX_SHADER,
        fragmentShader: `${SIMPLEX_3D_GLSL}\n${NEBULA_FRAGMENT_BODY}`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(this._sharedGeo, mat);
      mesh.position.copy(position).add(offset);
      mesh.scale.setScalar(scale);
      mesh.rotation.z = rotation;

      cluster.add(mesh);
    }

    this.scene.add(cluster);
    this._clusters.push(cluster);

    return cluster;
  }

  /**
   * Update nebula shader uniforms and billboarding
   */
  update(time, camera) {
    for (const cluster of this._clusters) {
      for (const mesh of cluster.children) {
        if (mesh.material.uniforms) {
          mesh.material.uniforms.uTime.value = time;
        }
        // Billboard: face the camera
        mesh.lookAt(camera.position);
      }
    }
  }

  /**
   * Clear all nebula clusters
   */
  clear() {
    for (const cluster of this._clusters) {
      this.scene.remove(cluster);
      for (const mesh of cluster.children) {
        if (mesh.material) mesh.material.dispose();
      }
    }
    this._clusters = [];
    this._sharedGeo?.dispose();
    this._sharedGeo = null;
  }
}

export default NebulaSystem;
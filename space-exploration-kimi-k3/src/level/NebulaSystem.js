// VOID DRIFT — NebulaSystem.js
// GLSL billboard nebula clusters, additive, camera-facing. Per-chunk quads,
// shared geometry owned by this system (explicit lifecycle).

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { SIMPLEX_3D_GLSL, NEBULA_FRAGMENT_BODY, NEBULA_VERTEX } from '../utils/ShaderHelpers.js';

export class NebulaSystem {
  constructor(scene) {
    this._scene = scene;
    // Shared quad geometry — this class is the sole owner.
    this._sharedGeo = new THREE.PlaneGeometry(1, 1);
    this._quads = [];   // { mesh, mat, chunkKey }
  }

  generateChunk(center, rng, nebulaCount, colors, isSafe) {
    if (isSafe || nebulaCount <= 0) return;
    const clusters = nebulaCount * 3;   // a few billboards per cluster
    for (let i = 0; i < clusters; i++) {
      const color = new THREE.Color(colors[i % colors.length]);
      const color2 = new THREE.Color(colors[(i + 1) % colors.length]);
      const color3 = new THREE.Color(colors[(i + 2) % colors.length]);
      const mat = new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERTEX,
        fragmentShader: `${SIMPLEX_3D_GLSL}\n${NEBULA_FRAGMENT_BODY}`,
        uniforms: {
          uTime: { value: rng() * 100 },
          uColor1: { value: color },
          uColor2: { value: color2 },
          uColor3: { value: color3 },
          uOpacity: { value: 0.5 + rng() * 0.3 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this._sharedGeo, mat);
      const scale = 60 + rng() * 90;
      mesh.scale.set(scale, scale, 1);
      mesh.position.set(
        center.x + (rng() - 0.5) * Constants.CHUNK.SIZE,
        center.y + (rng() - 0.5) * Constants.CHUNK.SIZE,
        center.z + (rng() - 0.5) * Constants.CHUNK.SIZE);
      mesh.userData = { isChunkObject: true, isNebula: true };
      this._scene.add(mesh);
      this._quads.push({ mesh, mat });
    }
  }

  /** Billboards face the camera; time advances. */
  update(dt, camera) {
    for (const q of this._quads) {
      q.mesh.quaternion.copy(camera.quaternion);
      q.mat.uniforms.uTime.value += dt;
    }
  }

  clearChunk(chunkKey) {
    for (let i = this._quads.length - 1; i >= 0; i--) {
      const q = this._quads[i];
      if (q.mesh.userData.chunkKey === chunkKey) {
        this._scene.remove(q.mesh);
        q.mat.dispose();   // material per-quad; geometry is shared, not disposed
        this._quads.splice(i, 1);
      }
    }
  }

  tagChunk(chunkKey) {
    for (const q of this._quads) {
      if (q.mesh.userData.chunkKey == null) q.mesh.userData.chunkKey = chunkKey;
    }
  }

  clearAll() {
    for (const q of this._quads) {
      this._scene.remove(q.mesh);
      q.mat.dispose();
    }
    this._quads = [];
  }

  destroy() {
    this.clearAll();
    this._sharedGeo.dispose();   // sole owner disposes shared geometry
  }
}

// VOID DRIFT — NebulaSystem.js
// Colored mist/colored dust clouds: flattened, wide translucent shells in additive layers.
// Explicit lifecycle.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { SIMPLEX_3D_GLSL, NEBULA_VERTEX, NEBULA_FRAGMENT_BODY } from '../utils/ShaderHelpers.js';

export class NebulaSystem {
  constructor(scene) {
    this._scene = scene;
    this._clouds = [];   // { mesh, mat, chunkKey }
  }

  generateChunk(center, rng, cloudCount, colors, isSafe) {
    if (isSafe || cloudCount <= 0) return;
    const total = Math.max(cloudCount * 4, 8);
    for (let i = 0; i < total; i++) {
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
          uOpacity: { value: 0.08 + rng() * 0.14 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const radius = 28 + rng() * 55;
      const geo = new THREE.SphereGeometry(radius, 14, 10);
      const mesh = new THREE.Mesh(geo, mat);

      // Flatten into wide discs / puffs rather than spheres.
      const squash = 0.08 + rng() * 0.18;
      mesh.scale.set(1, squash, 1);
      mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI * 0.5);

      mesh.position.set(
        center.x + (rng() - 0.5) * Constants.CHUNK.SIZE * 1.0,
        center.y + (rng() - 0.5) * Constants.CHUNK.SIZE * 0.45,
        center.z + (rng() - 0.5) * Constants.CHUNK.SIZE * 1.0
      );
      mesh.userData = { isChunkObject: true, isNebula: true, chunkKey: '' };
      this._scene.add(mesh);
      this._clouds.push({ mesh, mat });
    }
  }

  update(dt, camera) {
    for (const c of this._clouds) {
      c.mesh.rotation.y += dt * 0.04;
      c.mesh.rotation.x += dt * 0.02;
      c.mat.uniforms.uTime.value += dt;
    }
  }

  clearChunk(chunkKey) {
    for (let i = this._clouds.length - 1; i >= 0; i--) {
      const c = this._clouds[i];
      if (c.mesh.userData.chunkKey === chunkKey) {
        this._scene.remove(c.mesh);
        c.mat.dispose();
        c.mesh.geometry.dispose();
        this._clouds.splice(i, 1);
      }
    }
  }

  tagChunk(chunkKey) {
    for (const c of this._clouds) {
      if (!c.mesh.userData.chunkKey) c.mesh.userData.chunkKey = chunkKey;
    }
  }

  clearAll() {
    for (const c of this._clouds) {
      this._scene.remove(c.mesh);
      c.mat.dispose();
      c.mesh.geometry.dispose();
    }
    this._clouds = [];
  }

  destroy() {
    this.clearAll();
  }
}

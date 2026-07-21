// VOID DRIFT — PlanetManager.js
// Sparse shader planets on a coarse 3D grid, independent of chunks.
// Probabilistic deterministic spawn (grid hash), distance pruning.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { mulberry32, hashKey } from '../utils/MathHelpers.js';
import { PLANET_VERTEX, PLANET_FRAGMENT } from '../utils/ShaderHelpers.js';

const PALETTES = [
  [0x1a0f2e, 0x3d1f5c, 0x6b3fa0, 0x9966ff],
  [0x0f1e2e, 0x1f3d5c, 0x3fa06b, 0x66ffcc],
  [0x2e1a0f, 0x5c3d1f, 0xa06b3f, 0xffcc66],
  [0x2e0f1a, 0x5c1f3d, 0xa03f6b, 0xff6699],
  [0x0a1626, 0x142c4c, 0x2a5588, 0x5588dd],
];

export class PlanetManager {
  constructor(scene) {
    this._scene = scene;
    this._planets = new Map();   // key -> { mesh, mat, atmo }
  }

  _spawnPlanet(gx, gy, gz, key) {
    const rng = mulberry32(hashKey(key) * 1e9);
    const grid = Constants.PLANET.GRID_SIZE;
    const radius = Constants.PLANET.MIN_RADIUS +
      rng() * (Constants.PLANET.MAX_RADIUS - Constants.PLANET.MIN_RADIUS);
    const detail = Math.max(2, Math.floor(3 + radius * 0.02));

    const palette = PALETTES[Math.floor(rng() * PALETTES.length)];
    const mat = new THREE.ShaderMaterial({
      vertexShader: PLANET_VERTEX,
      fragmentShader: PLANET_FRAGMENT,
      uniforms: {
        uTime: { value: rng() * 100 },
        uColor1: { value: new THREE.Color(palette[0]) },
        uColor2: { value: new THREE.Color(palette[1]) },
        uColor3: { value: new THREE.Color(palette[2]) },
        uRim: { value: new THREE.Color(palette[3]) },
      },
      transparent: true,
    });
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, Math.min(detail, 5)), mat);
    mesh.position.set(
      gx * grid + (rng() - 0.5) * grid * 0.5,
      gy * grid + (rng() - 0.5) * grid * 0.5,
      gz * grid + (rng() - 0.5) * grid * 0.5);
    mesh.userData = { isChunkObject: true };
    this._scene.add(mesh);

    let atmo = null;
    if (radius > Constants.PLANET.ATMOSPHERE_MIN_RADIUS * 5) {
      const atmoMat = new THREE.MeshBasicMaterial({
        color: palette[3], transparent: true,
        opacity: Constants.PLANET.ATMOSPHERE_OPACITY,
        side: THREE.BackSide, depthWrite: false,
      });
      atmo = new THREE.Mesh(
        new THREE.IcosahedronGeometry(radius * Constants.PLANET.ATMOSPHERE_RATIO, 2), atmoMat);
      atmo.position.copy(mesh.position);
      atmo.userData = { isChunkObject: true };
      this._scene.add(atmo);
    }

    this._planets.set(key, { mesh, mat, atmo });
  }

  update(shipPos, dt) {
    const grid = Constants.PLANET.GRID_SIZE;
    const view = Constants.PLANET.VIEW_DISTANCE;
    const cgx = Math.round(shipPos.x / grid);
    const cgy = Math.round(shipPos.y / grid);
    const cgz = Math.round(shipPos.z / grid);

    // Spawn in neighborhood (±1 cell = up to 1.5×grid away < view distance).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cgx + dx},${cgy + dy},${cgz + dz}`;
          if (!this._planets.has(key) && hashKey(key) < Constants.PLANET.SPAWN_CHANCE) {
            this._spawnPlanet(cgx + dx, cgy + dy, cgz + dz, key);
          }
        }
      }
    }

    // Animate + prune by distance.
    for (const [key, p] of this._planets) {
      p.mat.uniforms.uTime.value += dt;
      if (p.mesh.position.distanceTo(shipPos) > view) {
        this._scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mat.dispose();
        if (p.atmo) {
          this._scene.remove(p.atmo);
          p.atmo.geometry.dispose();
          p.atmo.material.dispose();
        }
        this._planets.delete(key);
      }
    }
  }

  clearAll() {
    for (const [, p] of this._planets) {
      this._scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mat.dispose();
      if (p.atmo) {
        this._scene.remove(p.atmo);
        p.atmo.geometry.dispose();
        p.atmo.material.dispose();
      }
    }
    this._planets.clear();
  }

  destroy() { this.clearAll(); }
}

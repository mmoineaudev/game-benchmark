// ============================================================
// PlanetManager — large persistent stellar landmarks
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { mulberry32, chunkSeed } from '../utils/MathHelpers.js';

class PlanetManager {
  constructor(scene) {
    this.scene = scene;
    this._planets = new Map();
    this._spacing = 2800;
    this._viewDistance = 12000;
  }

  update(shipPos) {
    const cx = Math.round(shipPos.x / this._spacing);
    const cy = Math.round(shipPos.y / this._spacing);
    const cz = Math.round(shipPos.z / this._spacing);
    const needed = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cx+dx},${cy+dy},${cz+dz}`;
          needed.add(key);
          if (!this._planets.has(key)) this._spawnPlanet(cx+dx, cy+dy, cz+dz, key);
        }
      }
    }
    for (const [key, planet] of this._planets) {
      if (!needed.has(key) || planet.position.distanceToSquared(shipPos) > this._viewDistance * this._viewDistance) {
        this._removePlanet(key);
      }
    }
  }

  _spawnPlanet(gx, gy, gz, key) {
    const seed = chunkSeed(gx * 997, gy * 991, gz * 983);
    const rng = mulberry32(seed);
    const x = gx * this._spacing + (rng() - 0.5) * this._spacing * 0.6;
    const y = gy * this._spacing + (rng() - 0.5) * this._spacing * 0.6;
    const z = gz * this._spacing + (rng() - 0.5) * this._spacing * 0.6;
    const chunkRadius = 3 + Math.floor(rng() * 7); // 3-9 chunks
    const radius = chunkRadius * Constants.CHUNK.WIDTH * 0.5;

    const palette = [0x2244aa, 0xaa4422, 0x22aa44, 0xaa2244, 0x44aaaa, 0x886622];
    const baseColor = palette[Math.floor(rng() * palette.length)];

    const group = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(radius, 2);
    const mat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.8, metalness: 0.1, flatShading: true });
    group.add(new THREE.Mesh(geo, mat));

    const atmoGeo = new THREE.IcosahedronGeometry(radius * 1.06, 1);
    const atmoMat = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 0.12, side: THREE.BackSide });
    group.add(new THREE.Mesh(atmoGeo, atmoMat));

    group.position.set(x, y, z);
    group.userData.isChunkObject = true;
    this.scene.add(group);
    this._planets.set(key, group);
  }

  _removePlanet(key) {
    const planet = this._planets.get(key);
    if (!planet) return;
    planet.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    this.scene.remove(planet);
    this._planets.delete(key);
  }

  clear() {
    for (const key of [...this._planets.keys()]) this._removePlanet(key);
  }

  destroy() { this.clear(); }
}

export default PlanetManager;

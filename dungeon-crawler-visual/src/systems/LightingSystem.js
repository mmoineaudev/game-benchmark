import * as THREE from 'three';
import { LIGHTING } from '../core/Constants.js';

export class LightingSystem {
  constructor(scene) {
    this.scene = scene;
    this.torches = []; // { light, mesh, bracket }
    this.flameMaterial = new THREE.MeshBasicMaterial({ color: LIGHTING.FLAME_COLOR });
    this.bracketMaterial = new THREE.MeshStandardMaterial({
      color: LIGHTING.BRACKET_COLOR, roughness: 0.6, metalness: 0.8,
    });
  }

  init(dungeonData) {
    // Ambient
    this.ambient = new THREE.AmbientLight(LIGHTING.AMBIENT_COLOR, LIGHTING.AMBIENT_INTENSITY);
    this.scene.add(this.ambient);

    // Fog
    this.scene.fog = new THREE.FogExp2(LIGHTING.FOG_COLOR, LIGHTING.FOG_DENSITY);

    // Place torches
    this._placeAllTorches(dungeonData);
  }

  _placeAllTorches(dungeonData) {
    const cs = dungeonData.cellSize;
    const gs = dungeonData.gridSize;
    const spacing = 8;
    const torchY = 2.5;

    for (let cz = 0; cz < gs; cz++) {
      for (let cx = 0; cx < gs; cx++) {
        if (dungeonData.grid[cz][cx] === 'empty') continue;
        const wx = cx * cs;
        const wz = cz * cs;

        // North edge
        if (cz === 0 || dungeonData.grid[cz - 1][cx] === 'empty') {
          this._placeTorchesOnEdge(wx, wz, wx + cs, wz, torchY, 'north', spacing, cs);
        }
        // East edge
        if (cx === gs - 1 || dungeonData.grid[cz][cx + 1] === 'empty') {
          this._placeTorchesOnEdge(wx + cs, wz, wx + cs, wz + cs, torchY, 'east', spacing, cs);
        }
      }
    }
  }

  _placeTorchesOnEdge(x1, z1, x2, z2, y, dir, spacing, cellSize) {
    const dist = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    if (dist < spacing) {
      // Single torch at midpoint
      this._addTorch((x1 + x2) / 2, y, (z1 + z2) / 2, dir);
    } else {
      const count = Math.floor(dist / spacing);
      const off = (dist - (count - 1) * spacing) / 2;
      for (let i = 0; i < count; i++) {
        const t = (off + i * spacing) / dist;
        this._addTorch(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, dir);
      }
    }
  }

  _addTorch(x, y, z, dir) {
    // Offset from wall
    const offset = 0.3;
    if (dir === 'north') z += offset;
    else x -= offset;

    // Bracket
    const bracketGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
    const bracket = new THREE.Mesh(bracketGeo, this.bracketMaterial);
    bracket.position.set(x, y - 0.3, z);
    bracket.castShadow = true;
    this.scene.add(bracket);

    // Flame bulb
    const flameGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const flame = new THREE.Mesh(flameGeo, this.flameMaterial);
    flame.position.set(x, y, z);
    this.scene.add(flame);

    // PointLight
    const light = new THREE.PointLight(
      LIGHTING.TORCH_COLOR,
      LIGHTING.TORCH_INTENSITY,
      LIGHTING.TORCH_DISTANCE,
      LIGHTING.TORCH_DECAY,
    );
    light.position.set(x, y, z);
    this.scene.add(light);

    this.torches.push({ light, flame, bracket, x, y, z, baseIntensity: LIGHTING.TORCH_INTENSITY });
  }

  update(time, playerPos) {
    // Torch flicker
    for (const t of this.torches) {
      const flicker = Math.sin(time * 8 + t.x * 3) * 0.08 + Math.sin(time * 13 + t.z * 5) * 0.07;
      t.light.intensity = t.baseIntensity * (1 + flicker);
      // Vary flame scale slightly
      const s = 1 + flicker * 0.5;
      t.flame.scale.setScalar(s);
    }
  }

  dispose() {
    for (const t of this.torches) {
      t.light.dispose?.();
      if (t.flame.geometry) t.flame.geometry.dispose();
      if (t.bracket.geometry) t.bracket.geometry.dispose();
    }
    this.flameMaterial.dispose();
    this.bracketMaterial.dispose();
    this.torches = [];
  }
}

import * as THREE from 'three';
import { LIGHTING } from '../core/Constants.js';

export class LightingSystem {
  constructor(scene) {
    this.scene = scene;
    this.torches = []; // { light, flame, bracket, x, y, z, baseIntensity, shadowEnabled }
    this.flameMaterial = new THREE.MeshBasicMaterial({ color: LIGHTING.FLAME_COLOR });
    this.bracketMaterial = new THREE.MeshStandardMaterial({
      color: LIGHTING.BRACKET_COLOR, roughness: 0.6, metalness: 0.8,
    });
  }

  init(dungeonData) {
    this.ambient = new THREE.AmbientLight(LIGHTING.AMBIENT_COLOR, LIGHTING.AMBIENT_INTENSITY);
    this.scene.add(this.ambient);

    this.scene.fog = new THREE.FogExp2(LIGHTING.FOG_COLOR, LIGHTING.FOG_DENSITY);

    this._placeAllTorches(dungeonData);
    this._placeGodRays(dungeonData);
    this._placeExitMarker(dungeonData);
    this._updateShadowCasting(null); // initial: no shadows until player moves
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

        if (cz === 0 || dungeonData.grid[cz - 1][cx] === 'empty') {
          this._placeTorchesOnEdge(wx, wz, wx + cs, wz, torchY, 'north', spacing, cs);
        }
        if (cx === gs - 1 || dungeonData.grid[cz][cx + 1] === 'empty') {
          this._placeTorchesOnEdge(wx + cs, wz, wx + cs, wz + cs, torchY, 'east', spacing, cs);
        }
        // South edge
        if (cz === gs - 1 || dungeonData.grid[cz + 1][cx] === 'empty') {
          this._placeTorchesOnEdge(wx + cs, wz + cs, wx, wz + cs, torchY, 'south', spacing, cs);
        }
        // West edge
        if (cx === 0 || dungeonData.grid[cz][cx - 1] === 'empty') {
          this._placeTorchesOnEdge(wx, wz + cs, wx, wz, torchY, 'west', spacing, cs);
        }
      }
    }
  }

  _placeTorchesOnEdge(x1, z1, x2, z2, y, dir, spacing, cellSize) {
    const dist = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    if (dist < spacing) {
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
    const offset = 0.35;
    if (dir === 'north') z += offset;
    else if (dir === 'east') x -= offset;
    else if (dir === 'south') z -= offset;
    else if (dir === 'west') x += offset;

    // Bracket
    const bracketGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
    const bracket = new THREE.Mesh(bracketGeo, this.bracketMaterial);
    bracket.position.set(x, y - 0.3, z);
    bracket.castShadow = true;
    bracket.receiveShadow = true;
    this.scene.add(bracket);

    // Flame bulb
    const flameGeo = new THREE.SphereGeometry(0.12, 8, 8);
    const flame = new THREE.Mesh(flameGeo, this.flameMaterial);
    flame.position.set(x, y, z);
    this.scene.add(flame);

    // PointLight (shadow disabled by default, enabled for nearest 8)
    const light = new THREE.PointLight(
      LIGHTING.TORCH_COLOR, LIGHTING.TORCH_INTENSITY,
      LIGHTING.TORCH_DISTANCE, LIGHTING.TORCH_DECAY,
    );
    light.position.set(x, y, z);
    light.castShadow = false;
    this.scene.add(light);

    this.torches.push({
      light, flame, bracket, x, y, z,
      baseIntensity: LIGHTING.TORCH_INTENSITY,
      shadowEnabled: false,
    });
  }

  update(time, playerPos) {
    // Torch flicker
    for (const t of this.torches) {
      const flicker = Math.sin(time * 8 + t.x * 3) * 0.08 + Math.sin(time * 13 + t.z * 5) * 0.07;
      t.light.intensity = t.baseIntensity * (1 + flicker);
      t.flame.scale.setScalar(1 + flicker * 0.5);
    }

    // Update shadow casting: nearest 8 torches to player (throttled to 500ms)
    if (!this._lastShadowUpdate || time - this._lastShadowUpdate > 0.5) {
      this._updateShadowCasting(playerPos);
      this._lastShadowUpdate = time;
    }
  }

  _updateShadowCasting(playerPos) {
    if (!playerPos) return;

    // Sort torches by distance to player
    const sorted = [...this.torches].sort((a, b) => {
      const da = (a.x - playerPos.x) ** 2 + (a.z - playerPos.z) ** 2;
      const db = (b.x - playerPos.x) ** 2 + (b.z - playerPos.z) ** 2;
      return da - db;
    });

    // Enable shadows on nearest 8, disable on rest
    const maxShadows = LIGHTING.TORCH_SHADOW_COUNT;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const shouldCast = i < maxShadows;
      if (t.shadowEnabled !== shouldCast) {
        t.shadowEnabled = shouldCast;
        t.light.castShadow = shouldCast;
        if (shouldCast) {
          t.light.shadow.mapSize.set(
            LIGHTING.TORCH_SHADOW_MAP, LIGHTING.TORCH_SHADOW_MAP,
          );
          t.light.shadow.camera.near = LIGHTING.TORCH_SHADOW_NEAR;
          t.light.shadow.camera.far = LIGHTING.TORCH_SHADOW_FAR;
          t.light.shadow.bias = -0.005;
          t.light.shadow.normalBias = 0.02;
        }
      }
    }
  }

  dispose() {
    for (const t of this.torches) {
      if (t.light.shadow) t.light.shadow.dispose?.();
      t.light.dispose?.();
      if (t.flame.geometry) t.flame.geometry.dispose();
      if (t.bracket.geometry) t.bracket.geometry.dispose();
    }
    for (const gr of this.godRays) {
      gr.geometry.dispose();
      gr.material.dispose();
      this.scene.remove(gr);
    }
    if (this.exitMarker) {
      this.exitMarker.geometry.dispose();
      this.exitMarker.material.dispose();
      this.scene.remove(this.exitMarker);
    }
    this.flameMaterial.dispose();
    this.bracketMaterial.dispose();
    this.torches = [];
    this.godRays = [];
  }

  _placeGodRays(dungeonData) {
    this.godRays = [];
    // Only place god rays in vault rooms
    for (const t of this.torches) {
      const cx = Math.floor(t.x / dungeonData.cellSize);
      const cz = Math.floor(t.z / dungeonData.cellSize);
      if (cz < 0 || cz >= dungeonData.gridSize || cx < 0 || cx >= dungeonData.gridSize) continue;
      const meta = dungeonData.metadata[cz][cx];
      if (meta && meta.type === 'room' && meta.roomType === 'VAULT') {
        const geo = new THREE.CylinderGeometry(0.3, 1.5, 4, 8, 1, true);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffaa44,
          transparent: true,
          opacity: 0.06,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const ray = new THREE.Mesh(geo, mat);
        ray.position.set(t.x, t.y - 2, t.z);
        this.scene.add(ray);
        this.godRays.push(ray);
      }
    }
  }

  _placeExitMarker(dungeonData) {
    const exit = dungeonData.exitCell;
    const cs = dungeonData.cellSize;
    const x = exit.x * cs + cs / 2;
    const z = exit.z * cs + cs / 2;
    const geo = new THREE.RingGeometry(1.2, 1.5, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.exitMarker = new THREE.Mesh(geo, mat);
    this.exitMarker.rotation.x = -Math.PI / 2;
    this.exitMarker.position.set(x, 0.03, z);
    this.scene.add(this.exitMarker);
  }
}

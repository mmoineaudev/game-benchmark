import * as THREE from 'three';
import { WORLD, TILE, TILE_COLORS } from '../core/Constants.js';

// Renders the 3D terrain grid using InstancedMesh for performance
export class TerrainRenderer {
  constructor(scene) {
    this.scene = scene;
    this._mesh = null;
    this._instanceData = null; // {positions, colors, activeCount}
    this._visible = true;
  }

  build(terrainData) {
    if (this._mesh) {
      this.scene.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
    }

    const { data, width, height, depth } = terrainData;

    // Collect all non-air tiles
    const tiles = [];
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        for (let z = 0; z < depth; z++) {
          const idx = x + z * width + y * width * depth;
          const tileType = data[idx];
          if (tileType === TILE.AIR) continue;
          tiles.push({ x, y, z, type: tileType });
        }
      }
    }

    if (tiles.length === 0) return;

    const count = tiles.length;
    const geometry = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    const material = new THREE.MeshLambertMaterial({
      vertexColors: false,
      roughness: 0.8,
    });

    this._mesh = new THREE.InstancedMesh(geometry, material, count);
    this._mesh.castShadow = false;
    this._mesh.receiveShadow = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();

    // Store per-instance data for updates
    this._instanceData = {
      positions: new Float32Array(count * 3),
      colors: new Float32Array(count * 3),
      types: new Uint8Array(count),
      active: new Uint8Array(count),
      activeCount: count,
      width, height, depth,
    };

    for (let i = 0; i < count; i++) {
      const t = tiles[i];
      const cx = t.x + 0.5;
      const cy = t.y + 0.5;
      const cz = t.z + 0.5;

      dummy.position.set(cx, cy, cz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this._mesh.setMatrixAt(i, dummy.matrix);

      const c = TILE_COLORS[t.type] || 0x888888;
      color.setHex(c);
      this._mesh.setColorAt(i, color);

      this._instanceData.positions[i * 3] = cx;
      this._instanceData.positions[i * 3 + 1] = cy;
      this._instanceData.positions[i * 3 + 2] = cz;
      this._instanceData.colors[i * 3] = color.r;
      this._instanceData.colors[i * 3 + 1] = color.g;
      this._instanceData.colors[i * 3 + 2] = color.b;
      this._instanceData.types[i] = t.type;
      this._instanceData.active[i] = 1;
    }

    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.instanceColor.needsUpdate = true;
    this.scene.add(this._mesh);
  }

  // Remove a tile at world position (center coordinate)
  removeTile(wx, wy, wz) {
    if (!this._instanceData) return;
    const eps = 0.01;
    for (let i = 0; i < this._instanceData.activeCount; i++) {
      if (!this._instanceData.active[i]) continue;
      const ix = this._instanceData.positions[i * 3];
      const iy = this._instanceData.positions[i * 3 + 1];
      const iz = this._instanceData.positions[i * 3 + 2];
      if (Math.abs(ix - wx) < eps && Math.abs(iy - wy) < eps && Math.abs(iz - wz) < eps) {
        // Hide by scaling to 0
        const dummy = new THREE.Object3D();
        dummy.position.set(ix, iy, iz);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this._mesh.setMatrixAt(i, dummy.matrix);
        this._mesh.instanceMatrix.needsUpdate = true;
        this._instanceData.active[i] = 0;
        return;
      }
    }
  }

  updateTileColor(wx, wy, wz, tileType) {
    // Update a tile's color (e.g. when revealed)
    if (!this._instanceData || !this._mesh) return;
    const eps = 0.01;
    const color = new THREE.Color();
    const c = TILE_COLORS[tileType] || 0x888888;
    color.setHex(c);
    for (let i = 0; i < this._instanceData.activeCount; i++) {
      if (!this._instanceData.active[i]) continue;
      const ix = this._instanceData.positions[i * 3];
      const iy = this._instanceData.positions[i * 3 + 1];
      const iz = this._instanceData.positions[i * 3 + 2];
      if (Math.abs(ix - wx) < eps && Math.abs(iy - wy) < eps && Math.abs(iz - wz) < eps) {
        this._mesh.setColorAt(i, color);
        this._mesh.instanceColor.needsUpdate = true;
        this._instanceData.colors[i * 3] = color.r;
        this._instanceData.colors[i * 3 + 1] = color.g;
        this._instanceData.colors[i * 3 + 2] = color.b;
        return;
      }
    }
  }

  setVisible(v) {
    if (this._mesh) this._mesh.visible = v;
  }

  dispose() {
    if (this._mesh) {
      this.scene.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
    }
  }
}

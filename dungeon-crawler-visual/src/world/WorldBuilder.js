import * as THREE from 'three';
import { WORLD, MATERIALS } from '../core/Constants.js';

export class WorldBuilder {
  constructor(scene, dungeonData) {
    this.scene = scene;
    this.data = dungeonData;
    this.wallMaterial = new THREE.MeshStandardMaterial({
      color: MATERIALS.WALL_COLOR,
      roughness: MATERIALS.WALL_ROUGHNESS,
      metalness: MATERIALS.WALL_METALNESS,
    });
    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: MATERIALS.FLOOR_COLOR,
      roughness: MATERIALS.FLOOR_ROUGHNESS,
      metalness: MATERIALS.FLOOR_METALNESS,
    });
    this.ceilingMaterial = new THREE.MeshStandardMaterial({
      color: MATERIALS.CEILING_COLOR,
      roughness: MATERIALS.CEILING_ROUGHNESS,
      metalness: 0,
    });
    this.torchPositions = []; // { x, y, z } world coords
  }

  build() {
    this._buildFloors();
    this._buildWalls();
    this._buildCeilings();
    return { torchPositions: this.torchPositions };
  }

  _cellToWorld(cx, cz) {
    return {
      x: cx * this.data.cellSize + this.data.cellSize / 2,
      z: cz * this.data.cellSize + this.data.cellSize / 2,
    };
  }

  _buildFloors() {
    const cs = this.data.cellSize;
    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        const { x, z } = this._cellToWorld(cx, cz);
        const geo = new THREE.PlaneGeometry(cs, cs);
        const mesh = new THREE.Mesh(geo, this.floorMaterial);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, 0, z);
        mesh.receiveShadow = true;
        mesh.userData = { isFloor: true };
        this.scene.add(mesh);
      }
    }
  }

  _buildWalls() {
    const cs = this.data.cellSize;
    const wh = WORLD.WALL_HEIGHT;
    const wallThickness = 0.3;

    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;

        const wx = cx * cs;
        const wz = cz * cs;

        // Check each neighbor — if neighbor is empty, place a wall on that edge
        // North wall (z-)
        if (cz === 0 || this.data.grid[cz - 1][cx] === 'empty') {
          this._addWall(wx + cs / 2, wh / 2, wz, cs, wh, wallThickness, 0);
        }
        // South wall (z+)
        if (cz === this.data.gridSize - 1 || this.data.grid[cz + 1][cx] === 'empty') {
          this._addWall(wx + cs / 2, wh / 2, wz + cs, cs, wh, wallThickness, 0);
        }
        // West wall (x-)
        if (cx === 0 || this.data.grid[cz][cx - 1] === 'empty') {
          this._addWall(wx, wh / 2, wz + cs / 2, wallThickness, wh, cs, Math.PI / 2);
        }
        // East wall (x+)
        if (cx === this.data.gridSize - 1 || this.data.grid[cz][cx + 1] === 'empty') {
          this._addWall(wx + cs, wh / 2, wz + cs / 2, wallThickness, wh, cs, Math.PI / 2);
        }
      }
    }
  }

  _addWall(x, y, z, w, h, d, ry) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, this.wallMaterial);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isWall: true };
    this.scene.add(mesh);
  }

  _buildCeilings() {
    const cs = this.data.cellSize;
    const wh = WORLD.WALL_HEIGHT;

    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        const { x, z } = this._cellToWorld(cx, cz);
        const geo = new THREE.PlaneGeometry(cs, cs);
        const mesh = new THREE.Mesh(geo, this.ceilingMaterial);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(x, wh, z);
        mesh.userData = { isCeiling: true };
        this.scene.add(mesh);
      }
    }
  }

  _placeTorches() {
    // Place torches along corridor walls and room walls
    this.torchPositions = [];
    const cs = this.data.cellSize;
    const spacing = 8;
    const torchY = 2.5;

    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        const wx = cx * cs;
        const wz = cz * cs;

        // Check edges facing empty cells (interior walls don't get torches on both sides)
        // North edge
        if (cz === 0 || this.data.grid[cz - 1][cx] === 'empty') {
          this._placeTorchesOnEdge(wx, wz, wx + cs, wz, torchY, 'north');
        }
        // East edge
        if (cx === this.data.gridSize - 1 || this.data.grid[cz][cx + 1] === 'empty') {
          this._placeTorchesOnEdge(wx + cs, wz, wx + cs, wz + cs, torchY, 'east');
        }
      }
    }
  }

  _placeTorchesOnEdge(x1, z1, x2, z2, y, dir) {
    const spacing = 8;
    const dist = Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
    const count = Math.max(1, Math.floor(dist / spacing));
    const offset = (dist - (count - 1) * spacing) / 2; // center torches along edge

    for (let i = 0; i < count; i++) {
      const t = (offset + i * spacing) / dist;
      const x = x1 + (x2 - x1) * t;
      const z = z1 + (z2 - z1) * t;
      // Slight offset from wall
      if (dir === 'north') {
        this.torchPositions.push({ x, y, z: z + 0.3 });
      } else if (dir === 'east') {
        this.torchPositions.push({ x: x - 0.3, y, z });
      }
    }
  }

  dispose() {
    this.wallMaterial.dispose();
    this.floorMaterial.dispose();
    this.ceilingMaterial.dispose();
    // Scene cleaning handled by Game._disposeScene
  }
}

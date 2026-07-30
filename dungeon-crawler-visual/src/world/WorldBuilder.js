import * as THREE from 'three';
import { WORLD, MATERIALS } from '../core/Constants.js';
import { generateStoneWallTexture, generateFloorTexture, generateCeilingTexture } from './Textures.js';

export class WorldBuilder {
  constructor(scene, dungeonData) {
    this.scene = scene;
    this.data = dungeonData;

    const wallTex = generateStoneWallTexture();
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(2, 2);

    this.wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: MATERIALS.WALL_ROUGHNESS,
      metalness: MATERIALS.WALL_METALNESS,
    });

    const floorTex = generateFloorTexture();
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(2, 2);

    this.floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: MATERIALS.FLOOR_ROUGHNESS,
      metalness: MATERIALS.FLOOR_METALNESS,
    });

    this.ceilingMaterial = new THREE.MeshStandardMaterial({
      map: generateCeilingTexture(),
      roughness: MATERIALS.CEILING_ROUGHNESS,
      metalness: 0,
    });
  }

  build() {
    this._buildFloors();
    this._buildWalls();
    this._buildCeilings();
    this._addCeilingBeams();
    this._addFloorDebris();
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

        if (cz === 0 || this.data.grid[cz - 1][cx] === 'empty') {
          this._addWall(wx + cs / 2, wh / 2, wz, cs, wh, wallThickness, 0);
        }
        if (cz === this.data.gridSize - 1 || this.data.grid[cz + 1][cx] === 'empty') {
          this._addWall(wx + cs / 2, wh / 2, wz + cs, cs, wh, wallThickness, 0);
        }
        if (cx === 0 || this.data.grid[cz][cx - 1] === 'empty') {
          this._addWall(wx, wh / 2, wz + cs / 2, wallThickness, wh, cs, Math.PI / 2);
        }
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

  _addCeilingBeams() {
    const cs = this.data.cellSize;
    const wh = WORLD.WALL_HEIGHT;
    const beamMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a1a,
      roughness: 0.8,
      metalness: 0.0,
    });

    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        const { x, z } = this._cellToWorld(cx, cz);

        // Cross beam every 3 cells
        if (cx % 3 === 0) {
          const geo = new THREE.BoxGeometry(0.2, 0.25, cs);
          const beam = new THREE.Mesh(geo, beamMat);
          beam.position.set(x - cs / 2, wh - 0.12, z);
          beam.castShadow = true;
          this.scene.add(beam);
        }
        if (cz % 3 === 0) {
          const geo = new THREE.BoxGeometry(cs, 0.25, 0.2);
          const beam = new THREE.Mesh(geo, beamMat);
          beam.position.set(x, wh - 0.12, z - cs / 2);
          beam.castShadow = true;
          this.scene.add(beam);
        }
      }
    }

    this._beamMaterial = beamMat;
  }

  _addFloorDebris() {
    const cs = this.data.cellSize;
    const debrisGeo = new THREE.SphereGeometry(0.08, 4, 3);
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a40,
      roughness: 0.9,
      metalness: 0.1,
    });

    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        const wx = cx * cs;
        const wz = cz * cs;

        // 3-8 pebbles per cell, near edges
        const count = 3 + Math.floor(Math.random() * 6);
        for (let i = 0; i < count; i++) {
          const x = wx + Math.random() * cs;
          const z = wz + Math.random() * cs;
          const debris = new THREE.Mesh(debrisGeo, debrisMat);
          debris.position.set(x, 0.03, z);
          debris.scale.setScalar(0.5 + Math.random() * 0.8);
          debris.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
          debris.receiveShadow = true;
          debris.castShadow = true;
          this.scene.add(debris);
        }
      }
    }
  }

  dispose() {
    if (this.wallMaterial.map) this.wallMaterial.map.dispose();
    this.wallMaterial.dispose();
    if (this.floorMaterial.map) this.floorMaterial.map.dispose();
    this.floorMaterial.dispose();
    if (this.ceilingMaterial.map) this.ceilingMaterial.map.dispose();
    this.ceilingMaterial.dispose();
    if (this._beamMaterial) this._beamMaterial.dispose();
  }
}

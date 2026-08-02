import * as THREE from 'three';
import { WORLD, MATERIALS } from '../core/Constants.js';
import { generateStoneWallTexture, generateFloorTexture, generateCeilingTexture } from './Textures.js';

export class WorldBuilder {
  constructor(scene, dungeonData, biomeTextures = null) {
    this.scene = scene;
    this.data = dungeonData;

    // biomeTextures: { wallTex, floorTex, ceilingTex } from BiomeSystem,
    // or null to generate the default stone set (existing behavior).
    const wallTex = biomeTextures?.wallTex ?? generateStoneWallTexture();
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(2, 2);

    this.wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: MATERIALS.WALL_ROUGHNESS,
      metalness: MATERIALS.WALL_METALNESS,
    });

    const floorTex = biomeTextures?.floorTex ?? generateFloorTexture();
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(2, 2);

    this.floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: MATERIALS.FLOOR_ROUGHNESS,
      metalness: MATERIALS.FLOOR_METALNESS,
    });

    this.ceilingMaterial = new THREE.MeshStandardMaterial({
      map: biomeTextures?.ceilingTex ?? generateCeilingTexture(),
      roughness: MATERIALS.CEILING_ROUGHNESS,
      metalness: 0,
    });
    this._collisionBoxes = []; // { minX, maxX, minZ, maxZ }
  }

  build() {
    this._buildFloors();
    this._buildWalls();
    this._buildCeilings();
    this._addCeilingBeams();
    this._addFloorDebris();
    return { collisionBoxes: this._collisionBoxes };
  }

  _cellToWorld(cx, cz) {
    return {
      x: cx * this.data.cellSize + this.data.cellSize / 2,
      z: cz * this.data.cellSize + this.data.cellSize / 2,
    };
  }

  _buildFloors() {
    const cs = this.data.cellSize;
    // Collect every walkable cell into ONE InstancedMesh (one draw call instead
    // of one mesh per cell — the single biggest level-loading win).
    const cells = [];
    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        cells.push(this._cellToWorld(cx, cz));
      }
    }
    const geo = new THREE.PlaneGeometry(cs, cs);
    const mat = this.floorMaterial;
    const inst = new THREE.InstancedMesh(geo, mat, cells.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < cells.length; i++) {
      m.makeRotationX(-Math.PI / 2);
      m.setPosition(cells[i].x, 0, cells[i].z);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    this._floorInst = inst;
    this.scene.add(inst);
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
          this._addWall(wx, wh / 2, wz + cs / 2, cs, wh, wallThickness, Math.PI / 2);
        }
        if (cx === this.data.gridSize - 1 || this.data.grid[cz][cx + 1] === 'empty') {
          this._addWall(wx + cs, wh / 2, wz + cs / 2, cs, wh, wallThickness, Math.PI / 2);
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

    // Collision box (slightly thinner than visual for forgiving gameplay)
    const halfW = w / 2;
    const halfD = d / 2 * 0.6;
    if (ry === 0) {
      this._collisionBoxes.push({ minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD });
    } else {
      this._collisionBoxes.push({ minX: x - halfD, maxX: x + halfD, minZ: z - halfW, maxZ: z + halfW });
    }
  }

  _buildCeilings() {
    const cs = this.data.cellSize;
    const wh = WORLD.WALL_HEIGHT;
    // One InstancedMesh for all ceiling per-cell planes (was one mesh per cell).
    const cells = [];
    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        cells.push(this._cellToWorld(cx, cz));
      }
    }
    const geo = new THREE.PlaneGeometry(cs, cs);
    const inst = new THREE.InstancedMesh(geo, this.ceilingMaterial, cells.length);
    const m = new THREE.Matrix4();
    for (let i = 0; i < cells.length; i++) {
      m.makeRotationX(Math.PI / 2);
      m.setPosition(cells[i].x, wh, cells[i].z);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    this._ceilingInst = inst;
    this.scene.add(inst);
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
    // Collect all pebble transforms first, then draw ONE InstancedMesh.
    // Previously every pebble was its own Mesh + shadow caster — ~1500 draw
    // calls per 16x16 dungeon at level load. Now it's a single draw call.
    const placements = []; // {x, z, s, rx, ry}
    for (let cz = 0; cz < this.data.gridSize; cz++) {
      for (let cx = 0; cx < this.data.gridSize; cx++) {
        if (this.data.grid[cz][cx] === 'empty') continue;
        const wx = cx * cs;
        const wz = cz * cs;
        const count = 3 + Math.floor(Math.random() * 6); // 3-8 pebbles per cell
        for (let i = 0; i < count; i++) {
          placements.push({
            x: wx + Math.random() * cs,
            z: wz + Math.random() * cs,
            s: 0.5 + Math.random() * 0.8,
            rx: Math.random() * Math.PI,
            ry: Math.random() * Math.PI,
          });
        }
      }
    }

    const debrisGeo = new THREE.SphereGeometry(0.08, 4, 3);
    const debrisMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a40,
      roughness: 0.9,
      metalness: 0.1,
    });
    const inst = new THREE.InstancedMesh(debrisGeo, debrisMat, placements.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < placements.length; i++) {
      const d = placements[i];
      e.set(d.rx, d.ry, 0);
      q.setFromEuler(e);
      s.setScalar(d.s);
      p.set(d.x, 0.03, d.z);
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    inst.castShadow = true;
    this._debrisInst = inst;
    this.scene.add(inst);
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

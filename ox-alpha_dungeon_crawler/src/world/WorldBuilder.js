// WorldBuilder.js — grid → instanced geometry + wall boxes + collision (§5.4)
import * as THREE from 'three';

const EMPTY = 'empty';
export const WALL_THICKNESS = 0.3;
export const COLLISION_DEPTH = 0.6; // collision boxes use thickness × 0.6 (forgiving)

export default class WorldBuilder {
  constructor() {
    this.group = null;
    this.collisionBoxes = []; // [{minX,maxX,minZ,maxZ}]
    this._disposables = [];
    this.debrisMesh = null;
  }

  build(scene, dungeon, texSet) {
    const { grid, gridSize, cellSize } = dungeon;
    const H = 20; // WORLD.WALL_HEIGHT
    const group = new THREE.Group();
    this.group = group;
    scene.add(group);

    // count non-empty cells
    let cells = [];
    for (let z = 0; z < gridSize; z++) for (let x = 0; x < gridSize; x++)
      if (grid[z][x] !== EMPTY) cells.push({ x, z });

    const floorMat = new THREE.MeshStandardMaterial({ map: texSet.floor, roughness: 0.95 });
    const ceilMat = new THREE.MeshStandardMaterial({ map: texSet.ceiling, roughness: 1 });
    const wallMat = new THREE.MeshStandardMaterial({ map: texSet.wall, roughness: 0.9 });
    this._disposables.push(floorMat, ceilMat, wallMat);

    const plane = new THREE.PlaneGeometry(cellSize, cellSize);
    const floorGeo = plane; this._disposables.push(plane);

    // floors — ONE InstancedMesh
    const floors = new THREE.InstancedMesh(plane, floorMat, cells.length);
    const ceilings = new THREE.InstancedMesh(plane, ceilMat, cells.length);
    const m = new THREE.Matrix4();
    const rotFloor = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const rotCeil = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    for (let i = 0; i < cells.length; i++) {
      const wx = cells[i].x * cellSize, wz = cells[i].z * cellSize;
      m.copy(rotFloor).setPosition(wx, 0, wz); floors.setMatrixAt(i, m);
      m.copy(rotCeil).setPosition(wx, H, wz); ceilings.setMatrixAt(i, m);
    }
    floors.instanceMatrix.needsUpdate = true;
    ceilings.instanceMatrix.needsUpdate = true;
    floors.receiveShadow = true; ceilings.receiveShadow = true;
    group.add(floors, ceilings);

    // walls — one box per exposed edge; collision depth ×0.6
    const edges = [];
    for (const c of cells) {
      const wx = c.x * cellSize, wz = c.z * cellSize;
      const nb = [
        [1, 0, wx + cellSize / 2, wz],
        [-1, 0, wx - cellSize / 2, wz],
        [0, 1, wx, wz + cellSize / 2],
        [0, -1, wx, wz - cellSize / 2]
      ];
      for (const [dx, dz] of nb) {
        const nx = c.x + dx, nz = c.z + dz;
        const outOfBounds = nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize;
        if (!outOfBounds && grid[nz][nx] !== EMPTY) continue; // interior edge between two open cells
        // exposed OR boundary edge → wall (boundary walls keep the player inside the map)
        edges.push({ ex, ez, horiz: dz !== 0 });
      }
    }
    if (edges.length) {
      const wallGeoH = new THREE.BoxGeometry(cellSize, H, WALL_THICKNESS); // N/S walls
      const wallGeoE = new THREE.BoxGeometry(WALL_THICKNESS, H, cellSize); // E/W walls
      this._disposables.push(wallGeoH, wallGeoE);
      const nH = edges.filter(e => e.horiz).length;
      const wallsH = new THREE.InstancedMesh(wallGeoH, wallMat, Math.max(1, nH));
      const wallsE = new THREE.InstancedMesh(wallGeoE, wallMat, Math.max(1, edges.length - nH));
      let ih = 0, ie = 0;
      const cd = WALL_THICKNESS * COLLISION_DEPTH;
      for (const e of edges) {
        if (e.horiz) {
          m.identity().setPosition(e.ex, H / 2, e.ez); wallsH.setMatrixAt(ih++, m);
          this.collisionBoxes.push({ minX: e.ex - cellSize / 2, maxX: e.ex + cellSize / 2, minZ: e.ez - cd / 2, maxZ: e.ez + cd / 2 });
        } else {
          m.identity().setPosition(e.ex, H / 2, e.ez); wallsE.setMatrixAt(ie++, m);
          this.collisionBoxes.push({ minX: e.ex - cd / 2, maxX: e.ex + cd / 2, minZ: e.ez - cellSize / 2, maxZ: e.ez + cellSize / 2 });
        }
      }
      if (nH > 0) { wallsH.count = ih; wallsH.instanceMatrix.needsUpdate = true; wallsH.castShadow = wallsH.receiveShadow = true; group.add(wallsH); }
      if (ie > 0 || edges.length - nH > 0) { wallsE.count = ie; wallsE.instanceMatrix.needsUpdate = true; wallsE.castShadow = wallsE.receiveShadow = true; group.add(wallsE); }
    }

    // floor debris — ONE InstancedMesh (~1/cell cut ~80%)
    const debrisCount = Math.floor(cells.length * 0.2);
    if (debrisCount > 0) {
      const pebble = new THREE.DodecahedronGeometry(0.12, 0);
      const pebMat = new THREE.MeshStandardMaterial({ color: 0x555048, roughness: 1 });
      this._disposables.push(pebble, pebMat);
      this.debrisMesh = new THREE.InstancedMesh(pebble, pebMat, debrisCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < debrisCount; i++) {
        const c = cells[(Math.random() * cells.length) | 0];
        dummy.position.set(c.x * cellSize + (Math.random() - .5) * cellSize * .7, 0.08, c.z * cellSize + (Math.random() - .5) * cellSize * .7);
        dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        const s = 0.5 + Math.random();
        dummy.scale.set(s, s * 0.6, s);
        dummy.updateMatrix();
        this.debrisMesh.setMatrixAt(i, dummy.matrix);
      }
      this.debrisMesh.instanceMatrix.needsUpdate = true;
      group.add(this.debrisMesh);
    }

    return group;
  }

  // append prop collision AABBs AFTER walls, BEFORE enemy spawn
  addCollisionBoxes(boxes) { for (const b of boxes) this.collisionBoxes.push(b); }

  setDegraded(factor) {
    // shed tail instances of the debris mesh
    if (this.debrisMesh) this.debrisMesh.count = Math.floor(this.debrisMesh.count * factor);
    if (this.debrisMesh) this.debrisMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene) {
    if (this.group && scene) scene.remove(this.group);
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    this.group = null;
    this.collisionBoxes = [];
  }
}

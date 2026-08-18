/**
 * WorldBuilder.js — converts a generated dungeon grid into three.js geometry
 * + collision AABBs (§5.4, binding).
 *
 * Cell (cx, cz) center in world space: (cx*6 + 3, 0, cz*6 + 3).
 * Exposed edges sit on the boundary lines between cells.
 *
 * build(dungeon, biomeTextures) →
 *   { group, collisionBoxes, dispose() }
 */

import * as THREE from 'three';
import { DUNGEON } from '../core/Constants.js';

const CELL = DUNGEON.CELL_SIZE;             // 6 u
const WALL_H = DUNGEON.WALL_HEIGHT;         // 20 u
const WALL_T = DUNGEON.WALL_THICKNESS;      // 0.3 u visual
const COLL_T = WALL_T * DUNGEON.COLLISION_DEPTH_MULT; // 0.18 u effective

export class WorldBuilder {
  /**
   * @param {object} dungeon  — DungeonGenerator.generate() output
   * @param {object|null} biomeTextures — {wall, floor, ceiling} THREE textures
   *        (null / null entries → placeholder materials, headless)
   */
  build(dungeon, biomeTextures) {
    const { grid, gridSize, cellSize = CELL } = dungeon;
    const n = gridSize;
    const tx = biomeTextures || {};

    const group = new THREE.Group();
    const collisionBoxes = [];
    const geometries = [];
    const materials = [];
    const meshes = [];

    const cellCenter = (c) => (c * cellSize + cellSize / 2);

    // --- Material helpers: biome textures w/ RepeatWrapping ×2, placeholder when null
    const makeMat = (tex, baseColor) => {
      let mat;
      if (tex) {
        mat = new THREE.MeshStandardMaterial({
          map: tex,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
        });
      } else {
        mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
        });
      }
      materials.push(mat);
      return mat;
    };

    // ------------------------------------------------------------------
    // Enumerate non-empty cells and wall segments
    // ------------------------------------------------------------------
    const cells = []; // [cx, cz]
    const walls = []; // { axis: 'X'|'Z', boundary, cx, cz } — wall LINE at boundary, belonging to cell (cx,cz)
    for (let cx = 0; cx < n; cx++) {
      for (let cz = 0; cz < n; cz++) {
        if (grid[cx][cz] === 'empty') continue;
        cells.push([cx, cz]);
        // West edge: grid boundary (cx === 0) or 'empty' neighbor (cx-1, cz)
        if (cx === 0 || grid[cx - 1][cz] === 'empty') {
          walls.push({ axis: 'X', boundary: cx * cellSize, cx, cz });
        }
        // East edge
        if (cx === n - 1 || grid[cx + 1][cz] === 'empty') {
          walls.push({ axis: 'X', boundary: (cx + 1) * cellSize, cx, cz });
        }
        // North edge (lower cz)
        if (cz === 0 || grid[cx][cz - 1] === 'empty') {
          walls.push({ axis: 'Z', boundary: cz * cellSize, cx, cz });
        }
        // South edge
        if (cz === n - 1 || grid[cx][cz + 1] === 'empty') {
          walls.push({ axis: 'Z', boundary: (cz + 1) * cellSize, cx, cz });
        }
      }
    }

    // ------------------------------------------------------------------
    // FLOORS — ONE InstancedMesh, plane per non-empty cell, rotX −π/2, y 0
    // ------------------------------------------------------------------
    const floorGeo = new THREE.PlaneGeometry(CELL, CELL);
    geometries.push(floorGeo);
    const floorMat = makeMat(tx.floor, 0x4a453f);
    const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, cells.length);
    const m4 = new THREE.Matrix4();
    const qX = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    cells.forEach(([cx, cz], i) => {
      m4.compose(
        new THREE.Vector3(cellCenter(cx), 0, cellCenter(cz)),
        qX,
        new THREE.Vector3(1, 1, 1)
      );
      floorMesh.setMatrixAt(i, m4);
    });
    floorMesh.instanceMatrix.needsUpdate = true;
    group.add(floorMesh);
    meshes.push(floorMesh);

    // ------------------------------------------------------------------
    // CEILINGS — ONE InstancedMesh at y = WALL_HEIGHT, rotX +π/2
    // ------------------------------------------------------------------
    const ceilGeo = new THREE.PlaneGeometry(CELL, CELL);
    geometries.push(ceilGeo);
    const ceilMat = makeMat(tx.ceiling, 0x2e2b28);
    const ceilMesh = new THREE.InstancedMesh(ceilGeo, ceilMat, cells.length);
    const qC = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    cells.forEach(([cx, cz], i) => {
      m4.compose(
        new THREE.Vector3(cellCenter(cx), WALL_H, cellCenter(cz)),
        qC,
        new THREE.Vector3(1, 1, 1)
      );
      ceilMesh.setMatrixAt(i, m4);
    });
    ceilMesh.instanceMatrix.needsUpdate = true;
    group.add(ceilMesh);
    meshes.push(ceilMesh);

    // ------------------------------------------------------------------
    // WALLS — one box per exposed edge; castShadow/receiveShadow = true
    // BoxGeometry(CELL, WALL_H, WALL_T) for Z-axis walls; rotated for X (east/west)
    // ------------------------------------------------------------------
    const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, WALL_T);
    geometries.push(wallGeo);
    const wallMat = makeMat(tx.wall, 0x6b6560);
    const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, walls.length);
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    const qRotY = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
    const q1 = new THREE.Quaternion();
    walls.forEach((w, i) => {
      if (w.axis === 'X') {
        // east/west wall at x = boundary, spanning z: cz*cellSize .. cz*cellSize+CELL (one cell)
        m4.compose(
          new THREE.Vector3(w.boundary, WALL_H / 2, w.cz * cellSize + CELL / 2),
          qRotY,
          new THREE.Vector3(1, 1, 1)
        );
      } else {
        // north/south wall at z = boundary, spanning x: cx*cellSize .. cx*cellSize+CELL (one cell)
        m4.compose(
          new THREE.Vector3(w.cx * cellSize + CELL / 2, WALL_H / 2, w.boundary),
          q1,
          new THREE.Vector3(1, 1, 1)
        );
      }
      wallMesh.setMatrixAt(i, m4);
      // Collision AABB: thickness × 0.6 (0.18 u effective) centered on the wall line,
      // spanning that wall's single cell along its length.
      if (w.axis === 'X') {
        collisionBoxes.push({
          minX: w.boundary - COLL_T / 2,
          minZ: w.cz * cellSize,
          maxX: w.boundary + COLL_T / 2,
          maxZ: w.cz * cellSize + CELL,
        });
      } else {
        collisionBoxes.push({
          minX: w.cx * cellSize,
          minZ: w.boundary - COLL_T / 2,
          maxX: w.cx * cellSize + CELL,
          maxZ: w.boundary + COLL_T / 2,
        });
      }
    });
    wallMesh.instanceMatrix.needsUpdate = true;
    group.add(wallMesh);
    meshes.push(wallMesh);

    // ------------------------------------------------------------------
    // FLOOR DEBRIS — ONE InstancedMesh of small pebbles, ~1 per cell, ~80% cut
    // ------------------------------------------------------------------
    const debrisCount = Math.max(1, Math.round(cells.length * 0.8));
    const pebGeo = new THREE.DodecahedronGeometry(0.12, 0);
    geometries.push(pebGeo);
    const pebMat = makeMat(null, 0x3a3632);
    const pebMesh = new THREE.InstancedMesh(pebGeo, pebMat, debrisCount);
    pebMesh.receiveShadow = true;
    const qP = new THREE.Quaternion();
    for (let i = 0; i < debrisCount; i++) {
      const [cx, cz] = cells[Math.floor((i * 7919) % cells.length)]; // deterministic scatter
      const jx = (i * 13) % 100 / 100 - 0.5;
      const jz = (i * 17) % 100 / 100 - 0.5;
      m4.compose(
        new THREE.Vector3(cellCenter(cx) + jx * CELL * 0.8, 0.06, cellCenter(cz) + jz * CELL * 0.8),
        qP,
        new THREE.Vector3(1, 1, 1)
      );
      pebMesh.setMatrixAt(i, m4);
    }
    pebMesh.instanceMatrix.needsUpdate = true;
    group.add(pebMesh);
    meshes.push(pebMesh);

    // ------------------------------------------------------------------
    // dispose() — geometries, materials, InstancedMesh instances (§14)
    // ------------------------------------------------------------------
    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of meshes) {
        mesh.dispose();
        group.remove(mesh);
      }
      for (const g of geometries) g.dispose();
      for (const mat of materials) {
        // biome textures are cached (userData.biomeCached) — dispose only if not cached
        if (mat.map && mat.map.userData && mat.map.userData.biomeCached) {
          // texture belongs to the BiomeSystem cache; leave it alone
        } else if (mat.map) {
          mat.map.dispose();
        }
        mat.dispose();
      }
      group.clear();
    }

    return { group, collisionBoxes, dispose };
  }
}

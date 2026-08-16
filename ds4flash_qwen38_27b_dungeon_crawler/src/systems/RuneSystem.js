/**
 * RuneSystem.js — procedural glowing wall runes (§15: generateRuneTexture).
 *
 * A handful of small planes placed on exposed wall lines, each with a
 * rune-glyph texture (null-safe: headless → plain emissive placeholder
 * material, §27) and a pulsing opacity: opacity = base * (0.6 + 0.4 *
 * sin(now * speed + phase)). Budget: RUNE_COUNT planes per level (few —
 * well inside the §22 draw-call budget).
 *
 * build(dungeon, biomeId) → places runes on exposed edges (like the
 * WorldBuilder wall enumeration), returns { group, dispose() }.
 */

import * as THREE from 'three';
import { DUNGEON, BIOMES } from '../core/Constants.js';
import { generateRuneTexture } from '../world/Textures.js';

const RUNE_COUNT = 4;
const RUNE_Y = 1.6;              // mid-wall height (walls are 20 u tall, but runes live at eye level)
const RUNE_SIZE = 0.9;
const GLYPHS = ['ᚠ', 'ᚱ', 'ᚷ', 'ᛗ', 'ᛟ', 'ᛉ'];

export class RuneSystem {
  constructor() {
    this.group = new THREE.Group();
    this.runes = [];      // [{ mesh, phase, speed, baseOpacity }]
    this.materials = [];
    this.geometries = [];
    this.textures = [];
    this.group.userData.owner = this;
    this.disposed = false;
  }

  /**
   * Place runes on exposed wall lines of the dungeon.
   * @param {object} dungeon — DungeonGenerator.generate() output
   * @param {string} biomeId — biome id (tints the rune glow)
   */
  build(dungeon, biomeId) {
    if (this.disposed) return this;
    this._clear();
    if (!dungeon) return this;

    const { grid, gridSize, cellSize = DUNGEON.CELL_SIZE } = dungeon;
    const n = gridSize;
    const biome = BIOMES[biomeId] || BIOMES.STONE;
    const color = biome.torchColor;

    // exposed wall lines (same enumeration as WorldBuilder)
    const walls = [];
    for (let cx = 0; cx < n; cx++) {
      for (let cz = 0; cz < n; cz++) {
        if (grid[cx][cz] === 'empty') continue;
        if (cx === 0 || grid[cx - 1][cz] === 'empty') walls.push({ axis: 'X', cx, cz, boundary: cx * cellSize });
        if (cx === n - 1 || grid[cx + 1][cz] === 'empty') walls.push({ axis: 'X', cx, cz, boundary: (cx + 1) * cellSize });
        if (cz === 0 || grid[cx][cz - 1] === 'empty') walls.push({ axis: 'Z', cx, cz, boundary: cz * cellSize });
        if (cz === n - 1 || grid[cx][cz + 1] === 'empty') walls.push({ axis: 'Z', cx, cz, boundary: (cz + 1) * cellSize });
      }
    }
    if (walls.length === 0) return this;

    const count = Math.min(RUNE_COUNT, walls.length);
    const runeGeo = new THREE.PlaneGeometry(RUNE_SIZE, RUNE_SIZE);
    this.geometries.push(runeGeo);

    for (let i = 0; i < count; i++) {
      // deterministic, well-distributed pick
      const w = walls[Math.floor((i * 7919) % walls.length)];
      const glyph = GLYPHS[i % GLYPHS.length];

      const tex = generateRuneTexture(glyph, color, 64); // null headless
      if (tex) { this.textures.push(tex); tex.userData = { runeOwned: true }; }

      let mat;
      if (tex) {
        mat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      } else {
        // headless placeholder: unlit emissive-ish plane
        mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      }
      this.materials.push(mat);

      const mesh = new THREE.Mesh(runeGeo, mat);
      // sit just off the wall line, toward the open cell, at eye level
      const inset = 0.05;
      mesh.position.y = RUNE_Y;
      if (w.axis === 'X') {
        // wall line x = boundary, spanning z: boundary .. boundary+cellSize
        // (matches WorldBuilder: Z-axis segment centered at (boundary, ·, boundary+cell/2))
        const inZ = w.boundary + cellSize / 2;
        // open side: which neighbor cell is empty? west (cx-1) vs east (cx+1)
        const westEmpty = (w.cx === 0) || grid[w.cx - 1][w.cz] === 'empty';
        const eastEmpty = (w.cx === n - 1) || grid[w.cx + 1][w.cz] === 'empty';
        const face = westEmpty ? -1 : eastEmpty ? 1 : 0;
        mesh.position.x = w.boundary + face * inset;
        mesh.position.z = inZ;
        mesh.rotation.y = Math.PI / 2;
      } else {
        // wall line z = boundary, spanning x: boundary .. boundary+cellSize
        const inX = w.boundary + cellSize / 2;
        const northEmpty = (w.cz === 0) || grid[w.cx][w.cz - 1] === 'empty';
        const southEmpty = (w.cz === n - 1) || grid[w.cx][w.cz + 1] === 'empty';
        const face = northEmpty ? -1 : southEmpty ? 1 : 0;
        mesh.position.z = w.boundary + face * inset;
        mesh.position.x = inX;
        mesh.rotation.y = 0;
      }
      this.group.add(mesh);
      this.runes.push({
        mesh,
        phase: (i * 2.399) % (Math.PI * 2), // golden-angle spacing
        speed: 0.8 + (i * 0.17) % 0.6,
        baseOpacity: 0.55,
      });
    }
    return this;
  }

  /** Pulse rune opacities. @param {number} now — seconds. */
  update(now) {
    if (this.disposed) return;
    for (const r of this.runes) {
      r.mesh.material.opacity = r.baseOpacity * (0.6 + 0.4 * Math.sin(now * r.speed + r.phase));
    }
  }

  _clear() {
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.materials.length = 0;
    this.geometries.length = 0;
    this.textures.length = 0;
    for (const r of this.runes) this.group.remove(r.mesh);
    this.runes.length = 0;
  }

  /** Dispose tracked geometries/materials/textures (idempotent, §14). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._clear();
    this.group.clear();
  }
}

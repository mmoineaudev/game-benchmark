// RuneSystem.js — procedural wall runes with pulsing opacity
import * as THREE from 'three';
import { generateRuneTexture } from '../world/Textures.js';

const RUNE_CHARS = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᛃ', 'ᛇ'];

export default class RuneSystem {
  constructor(scene, dungeon, biomeId) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.runes = [];
    const { grid, gridSize, cellSize } = dungeon;
    const color = '#' + ((biomeId === 'HAUNTED_CRYPT' || biomeId === 'SPECTRAL_COURT') ? 0x88aaff :
      biomeId === 'CRYSTAL_DEPTHS' ? 0xb07aff : 0xffc84a).toString(16).padStart(6, '0');
    // a handful of runes on random room walls — decorative, pooled at build
    let placed = 0;
    for (let z = 1; z < gridSize - 1 && placed < 10; z++) {
      for (let x = 1; x < gridSize - 1 && placed < 10; x++) {
        if (grid[z][x] !== 'room' || Math.random() > 0.08) continue;
        const char = RUNE_CHARS[placed % RUNE_CHARS.length];
        const tex = new THREE.CanvasTexture(generateRuneTexture(char, color));
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat);
        mesh.position.set(x * cellSize, 2.2 + Math.random(), z * cellSize);
        this.group.add(mesh);
        this.runes.push({ mat, phase: Math.random() * 6 });
        placed++;
      }
    }
  }

  update(time) {
    for (const r of this.runes) r.mat.opacity = 0.55 + 0.45 * Math.sin(time * 0.002 + r.phase);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    this.group = null; this.runes = [];
  }
}

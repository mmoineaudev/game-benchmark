import * as THREE from 'three';
import { WORLD } from '../core/Constants.js';
import { generateRuneTexture } from '../world/Textures.js';

const RUNE_SYMBOLS = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚹ', 'ᚺ', 'ᚾ', 'ᛁ', 'ᛃ', 'ᛇ', 'ᛈ', 'ᛉ', 'ᛊ', 'ᛏ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛚ', 'ᛜ', 'ᛞ', 'ᛟ'];
const RUNE_COLORS = [0x44aaff, 0xff6644, 0x44ff88, 0xffaa44];
const RUNES_PER_ROOM = { CHAMBER: 10, HALL: 5, VAULT: 18 };

export class RuneSystem {
  constructor(scene, dungeonData) {
    this.scene = scene;
    this.data = dungeonData;
    this.runes = [];
    this._textures = []; // track for disposal
  }

  init() {
    const cs = this.data.cellSize;
    const gs = this.data.gridSize;
    const wh = WORLD.WALL_HEIGHT;
    const visitedRooms = new Set();

    for (let cz = 0; cz < gs; cz++) {
      for (let cx = 0; cx < gs; cx++) {
        const cell = this.data.metadata[cz][cx];
        if (cell.type !== 'room') continue;

        let rx = cx, rz = cz;
        while (rz > 0 && this.data.metadata[rz - 1][cx].type === 'room') rz--;
        while (rx > 0 && this.data.metadata[cz][rx - 1].type === 'room') rx--;
        const key = `${rx},${rz}`;
        if (visitedRooms.has(key)) continue;
        visitedRooms.add(key);

        const roomType = cell.roomType || 'CHAMBER';
        const count = RUNES_PER_ROOM[roomType] || 8;

        for (let i = 0; i < count; i++) {
          this._placeRune(cx * cs, cz * cs, cs, wh);
        }
      }
    }
  }

  _placeRune(wx, wz, cs, wh) {
    const edge = Math.floor(Math.random() * 4);
    let x, z, rotY;

    switch (edge) {
      case 0: x = wx + Math.random() * cs; z = wz + 0.01; rotY = 0; break;
      case 1: x = wx + cs - 0.01; z = wz + Math.random() * cs; rotY = Math.PI / 2; break;
      case 2: x = wx + Math.random() * cs; z = wz + cs - 0.01; rotY = Math.PI; break;
      case 3: x = wx + 0.01; z = wz + Math.random() * cs; rotY = -Math.PI / 2; break;
    }

    const y = 0.8 + Math.random() * (wh - 1.8);
    const size = 0.25 + Math.random() * 0.35;
    const symbol = RUNE_SYMBOLS[Math.floor(Math.random() * RUNE_SYMBOLS.length)];
    const color = RUNE_COLORS[Math.floor(Math.random() * RUNE_COLORS.length)];

    const tex = generateRuneTexture(symbol, color);
    this._textures.push(tex);

    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    this.scene.add(mesh);

    this.runes.push({
      mesh,
      baseOpacity: 0.4 + Math.random() * 0.4,
      offset: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 1.5,
    });
  }

  update(time) {
    for (const r of this.runes) {
      const pulse = Math.sin(time * r.speed + r.offset) * 0.35;
      r.mesh.material.opacity = r.baseOpacity + pulse;
    }
  }

  dispose() {
    for (const r of this.runes) {
      r.mesh.geometry.dispose();
      if (r.mesh.material.map) r.mesh.material.map.dispose();
      r.mesh.material.dispose();
      this.scene.remove(r.mesh);
    }
    for (const tex of this._textures) tex.dispose();
    this.runes = [];
    this._textures = [];
  }
}

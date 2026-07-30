import * as THREE from 'three';
import { WORLD } from '../core/Constants.js';

const RUNE_COLORS = [0x44aaff, 0xff6644, 0x44ff88, 0xffaa44];
const RUNES_PER_ROOM = { CHAMBER: 15, HALL: 8, VAULT: 25 };

export class RuneSystem {
  constructor(scene, dungeonData) {
    this.scene = scene;
    this.data = dungeonData;
    this.runes = []; // { mesh, baseOpacity, offset, color }
  }

  init() {
    const cs = this.data.cellSize;
    const gs = this.data.gridSize;
    const wh = WORLD.WALL_HEIGHT;

    for (let cz = 0; cz < gs; cz++) {
      for (let cx = 0; cx < gs; cx++) {
        const cell = this.data.metadata[cz][cx];
        if (cell.type !== 'room') continue;

        const roomType = cell.roomType || 'CHAMBER';
        const count = RUNES_PER_ROOM[roomType] || 10;
        const wx = cx * cs;
        const wz = cz * cs;

        for (let i = 0; i < count; i++) {
          this._placeRune(wx, wz, cs, wh);
        }
      }
    }
  }

  _placeRune(wx, wz, cs, wh) {
    // Pick a random wall edge
    const edge = Math.floor(Math.random() * 4);
    let x, z, rotY, wallOffset;

    switch (edge) {
      case 0: // north wall (z-)
        x = wx + Math.random() * cs;
        z = wz + 0.02;
        rotY = 0;
        wallOffset = { x: 0, z: 0.02 };
        break;
      case 1: // east wall (x+)
        x = wx + cs - 0.02;
        z = wz + Math.random() * cs;
        rotY = Math.PI / 2;
        wallOffset = { x: -0.02, z: 0 };
        break;
      case 2: // south wall (z+)
        x = wx + Math.random() * cs;
        z = wz + cs - 0.02;
        rotY = Math.PI;
        wallOffset = { x: 0, z: -0.02 };
        break;
      case 3: // west wall (x-)
        x = wx + 0.02;
        z = wz + Math.random() * cs;
        rotY = -Math.PI / 2;
        wallOffset = { x: 0.02, z: 0 };
        break;
    }

    const y = 0.8 + Math.random() * (wh - 1.8);
    const size = 0.2 + Math.random() * 0.3;
    const color = RUNE_COLORS[Math.floor(Math.random() * RUNE_COLORS.length)];

    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + wallOffset.x, y, z + wallOffset.z);
    mesh.rotation.y = rotY;
    this.scene.add(mesh);

    this.runes.push({
      mesh,
      baseOpacity: 0.35 + Math.random() * 0.35,
      offset: Math.random() * Math.PI * 2,
      speed: 0.8 + Math.random() * 1.5,
    });
  }

  update(time) {
    for (const r of this.runes) {
      const pulse = Math.sin(time * r.speed + r.offset) * 0.3;
      r.mesh.material.opacity = r.baseOpacity + pulse;
    }
  }

  dispose() {
    for (const r of this.runes) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      this.scene.remove(r.mesh);
    }
    this.runes = [];
  }
}

// ============================================================
// NPCShipManager — occasional ambient ships cruising
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { mulberry32, chunkSeed } from '../utils/MathHelpers.js';

const CLR = [0x00ff88, 0xff8833, 0x33aaff, 0xff33aa, 0xffff33];

class NPCShipManager {
  constructor(scene) {
    this.scene = scene;
    this._ships = new Map();
    this._maxShips = 18;
    this._spacing = 1600;
    this._viewDistance = 9000;
  }

  update(shipPos, dt) {
    const gx = Math.round(shipPos.x / this._spacing);
    const gy = Math.round(shipPos.y / this._spacing);
    const gz = Math.round(shipPos.z / this._spacing);
    const needed = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${gx+dx},${gy+dy},${gz+dz}`;
          needed.add(key);
          if (!this._ships.has(key) && this._ships.size < this._maxShips) this._spawnNPC(gx+dx, gy+dy, gz+dz, key);
        }
      }
    }
    for (const [key, npc] of this._ships) {
      if (!needed.has(key) || npc.position.distanceToSquared(shipPos) > this._viewDistance * this._viewDistance) {
        this._removeNPC(key);
      } else {
        this._moveNPC(npc, dt);
      }
    }
  }

  _spawnNPC(gx, gy, gz, key) {
    const seed = chunkSeed(gx * 1013, gy * 1009, gz * 997);
    const rng = mulberry32(seed);
    const x = gx * this._spacing + (rng() - 0.5) * this._spacing * 0.5;
    const y = gy * this._spacing + (rng() - 0.5) * this._spacing * 0.5;
    const z = gz * this._spacing + (rng() - 0.5) * this._spacing * 0.5;

    const shape = Math.floor(rng() * 4);
    let mesh;
    if (shape === 0) {
      mesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.35, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: CLR[Math.floor(rng()*CLR.length)], emissive: CLR[Math.floor(rng()*CLR.length)], emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.5 })
      );
    } else if (shape === 1) {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.2, 1.4),
        new THREE.MeshStandardMaterial({ color: CLR[Math.floor(rng()*CLR.length)], emissive: CLR[Math.floor(rng()*CLR.length)], emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.4 })
      );
    } else if (shape === 2) {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.55),
        new THREE.MeshStandardMaterial({ color: CLR[Math.floor(rng()*CLR.length)], emissive: CLR[Math.floor(rng()*CLR.length)], emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.7 })
      );
    } else {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.4, 1.5, 8),
        new THREE.MeshStandardMaterial({ color: CLR[Math.floor(rng()*CLR.length)], emissive: CLR[Math.floor(rng()*CLR.length)], emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.3 })
      );
      mesh.rotation.x = Math.PI / 2;
    }

    mesh.position.set(x, y, z);
    mesh.userData = {
      velocity: new THREE.Vector3((rng()-0.5)*8, (rng()-0.5)*4, (rng()-0.5)*8),
      rotSpeed: (rng()-0.5) * 1.5,
      isChunkObject: true,
      isNPC: true,
    };
    this.scene.add(mesh);
    this._ships.set(key, mesh);
  }

  _moveNPC(npc, dt) {
    npc.position.addScaledVector(npc.userData.velocity, dt);
    npc.rotation.y += npc.userData.rotSpeed * dt;
    npc.rotation.x += npc.userData.rotSpeed * 0.5 * dt;
  }

  _removeNPC(key) {
    const npc = this._ships.get(key);
    if (!npc) return;
    if (npc.geometry) npc.geometry.dispose();
    if (npc.material) npc.material.dispose();
    this.scene.remove(npc);
    this._ships.delete(key);
  }

  clear() { for (const key of [...this._ships.keys()]) this._removeNPC(key); }
  destroy() { this.clear(); }
}

export default NPCShipManager;

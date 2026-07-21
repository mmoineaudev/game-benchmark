// VOID DRIFT — CollectibleSystem.js
// Crystals (green octahedrons, 50pts) + ruins (tan tetrahedrons, 20pts).
// IMPORTANT: ruins spawn VISIBLE (step-3.7 EC-07 bug fixed).
// Proximity pickup → invisible + score + sparkle + chime + floating text.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { GameState } from '../core/GameState.js';
import { EventBus } from '../core/EventBus.js';

const PICKUP_RADIUS = 3.5;

export class CollectibleSystem {
  constructor(scene) {
    this._scene = scene;
    this._crystalGeo = new THREE.OctahedronGeometry(0.7, 0);
    this._crystalMat = new THREE.MeshStandardMaterial({
      color: 0x0a3322, emissive: 0x33ff88, emissiveIntensity: 2.2,
      metalness: 0.3, roughness: 0.2,
    });
    this._ruinGeo = new THREE.TetrahedronGeometry(1.1, 0);
    this._ruinMat = new THREE.MeshStandardMaterial({
      color: 0xaa9977, metalness: 0.1, roughness: 0.9,
      emissive: 0x332211, emissiveIntensity: 0.4,
    });
    this._items = [];   // { mesh, type, chunkKey, baseY }
  }

  generateChunk(center, rng, isSafe) {
    if (isSafe) return;
    const crystals = Constants.CHUNK.CRYSTALS_MIN + Math.floor(rng() * Constants.CHUNK.CRYSTALS_VAR);
    const ruins = Constants.CHUNK.RUINS_MIN + Math.floor(rng() * Constants.CHUNK.RUINS_VAR);
    for (let i = 0; i < crystals; i++) {
      const mesh = new THREE.Mesh(this._crystalGeo, this._crystalMat);
      mesh.position.set(
        center.x + (rng() - 0.5) * Constants.CHUNK.SIZE,
        center.y + (rng() - 0.5) * Constants.CHUNK.SIZE,
        center.z + (rng() - 0.5) * Constants.CHUNK.SIZE);
      mesh.visible = true;
      mesh.userData = { isChunkObject: true };
      this._scene.add(mesh);
      this._items.push({ mesh, type: 'crystal', baseY: mesh.position.y, phase: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < ruins; i++) {
      const mesh = new THREE.Mesh(this._ruinGeo, this._ruinMat);
      mesh.position.set(
        center.x + (rng() - 0.5) * Constants.CHUNK.SIZE,
        center.y + (rng() - 0.5) * Constants.CHUNK.SIZE,
        center.z + (rng() - 0.5) * Constants.CHUNK.SIZE);
      mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      mesh.visible = true;   // EC-07 fix
      mesh.userData = { isChunkObject: true };
      this._scene.add(mesh);
      this._items.push({ mesh, type: 'ruin', baseY: mesh.position.y, phase: rng() * Math.PI * 2 });
    }
  }

  /** Spin/bob + proximity pickup. Returns pickups collected this frame. */
  update(dt, time, shipPos) {
    const collected = [];
    for (const it of this._items) {
      if (!it.mesh.visible) continue;   // already collected
      it.mesh.rotation.y += dt * 1.2;
      if (it.type === 'crystal') {
        it.mesh.position.y = it.baseY + Math.sin(time * 1.5 + it.phase) * 0.4;
      }
      if (shipPos && it.mesh.position.distanceToSquared(shipPos) < PICKUP_RADIUS * PICKUP_RADIUS) {
        it.mesh.visible = false;
        collected.push({ type: it.type, position: it.mesh.position.clone() });
        EventBus.emit('collectible:pickup', { type: it.type, position: it.mesh.position });
      }
    }
    return collected;
  }

  clearChunk(chunkKey) {
    for (let i = this._items.length - 1; i >= 0; i--) {
      if (this._items[i].mesh.userData.chunkKey === chunkKey) {
        this._scene.remove(this._items[i].mesh);
        this._items.splice(i, 1);
      }
    }
  }

  tagChunk(chunkKey) {
    for (const it of this._items) {
      if (it.mesh.userData.chunkKey == null) it.mesh.userData.chunkKey = chunkKey;
    }
  }

  clearAll() {
    for (const it of this._items) this._scene.remove(it.mesh);
    this._items = [];
  }

  destroy() {
    this.clearAll();
    this._crystalGeo.dispose();
    this._crystalMat.dispose();
    this._ruinGeo.dispose();
    this._ruinMat.dispose();
  }
}

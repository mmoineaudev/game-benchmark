// VOID DRIFT — WormholeSystem.js
// Active wormhole registry + ship teleportation between distinct wormholes.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { EventBus } from '../core/EventBus.js';

export class WormholeSystem {
  constructor(scene) {
    this._scene = scene;
    this._holes = []; // { group, center, chunkKey }
    this._teleportCooldown = 0;
  }

  register(group, center, chunkKey) {
    const entry = { group, center: center.clone(), chunkKey };
    this._holes.push(entry);
    return entry;
  }

  unregister(chunkKey) {
    this._holes = this._holes.filter(h => h.chunkKey !== chunkKey);
  }

  update(shipPos, shipMesh, dt) {
    if (this._teleportCooldown > 0) this._teleportCooldown -= dt;
    if (!shipPos || this._holes.length < 2 || !shipMesh) return null;

    const trigger = Constants.WORMHOLE || {};
    const radius = trigger.TELEPORT_RADIUS || 40;
    const cooldown = trigger.COOLDOWN || 2.5;

    for (const h of this._holes) {
      if (shipPos.distanceTo(h.center) < radius) {
        if (this._teleportCooldown > 0) break;
        this._teleportCooldown = cooldown;
        const target = this._holes.find(t => t.chunkKey !== h.chunkKey) || this._holes[0];
        return { from: h, to: target };
      }
    }
    return null;
  }

  applyTeleport(state) {
    if (!state) return;
    const { shipMesh, cameraSystem } = state;
    const offset = shipMesh.position.clone().sub(state.from.center);
    shipMesh.position.copy(state.to.center).add(offset);
    if (cameraSystem && typeof cameraSystem.snap === 'function') cameraSystem.snap();

    EventBus.emit('wormhole:teleport', { position: state.to.center.clone() });
  }

  clearAll() {
    this._holes = [];
    this._teleportCooldown = 0;
  }

  destroy() { this.clearAll(); }
}

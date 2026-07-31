// VOID DRIFT — WeaponSystem.js
// Laser projectiles keyed by UUID. Shared geometry/material. Recoil on fire.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { GameState, nextUUID } from '../core/GameState.js';

export class WeaponSystem {
  constructor(scene) {
    this._scene = scene;
    this._geo = null;
    this._mat = null;
    this._forward = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._spawnPos = new THREE.Vector3();
    this._mouseFire = false;
    this._unsub = [];
  }

  init(eventBus) {
    this._geo = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6);
    this._geo.rotateX(Math.PI / 2);   // align along Z
    this._mat = new THREE.MeshStandardMaterial({
      color: 0x003322,
      emissive: Constants.WEAPON.LASER_COLOR,
      emissiveIntensity: Constants.WEAPON.LASER_EMISSIVE,
    });
    this._unsub.push(eventBus.on('input:fire-mouse', (down) => { this._mouseFire = down; }));
  }

  /** Returns true if a shot was fired this call. */
  tryFire(shipObject, time, fireKeyHeld) {
    const W = Constants.WEAPON;
    if (!(fireKeyHeld || this._mouseFire)) return false;
    if (time - GameState.combat.lastFireTime < 1 / W.FIRE_RATE) return false;
    GameState.combat.lastFireTime = time;

    this._forward.set(0, 0, -1).applyQuaternion(shipObject.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(shipObject.quaternion);
    this._spawnPos.copy(shipObject.position)
      .addScaledVector(this._forward, W.SPAWN_FORWARD)
      .addScaledVector(this._up, W.SPAWN_UP);

    const mesh = new THREE.Mesh(this._geo, this._mat);
    mesh.position.copy(this._spawnPos);
    mesh.quaternion.copy(shipObject.quaternion);
    this._scene.add(mesh);

    const id = nextUUID();
    GameState.addProjectile({
      id,
      mesh,
      velocity: this._forward.clone().multiplyScalar(W.PROJECTILE_SPEED),
      bornAt: time,
      distanceTraveled: 0,
      dead: false,
    });

    // Recoil kick.
    const vel = shipObject.userData.velocity;
    if (vel) vel.addScaledVector(this._forward, -Constants.WEAPON.RECOIL);

    return true;
  }

  /** Move projectiles, expire by lifetime/range. Removal strictly by UUID. */
  update(dt, time) {
    const W = Constants.WEAPON;
    const toRemove = [];
    for (const [id, p] of GameState.combat.projectiles) {
      if (p.dead) { toRemove.push(id); continue; }
      const step = p.velocity.length() * dt;
      p.distanceTraveled += step;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (time - p.bornAt > W.PROJECTILE_LIFETIME || p.distanceTraveled > W.PROJECTILE_RANGE) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) this._removeById(id);
  }

  _removeById(id) {
    const p = GameState.combat.projectiles.get(id);
    if (!p) return;
    this._scene.remove(p.mesh);
    // geometry/material shared — do not dispose.
    GameState.removeProjectile(id);
  }

  /** Remove a specific projectile (hit). */
  kill(id) { this._removeById(id); }

  clear() {
    for (const id of [...GameState.combat.projectiles.keys()]) this._removeById(id);
  }

  destroy() {
    this.clear();
    for (const u of this._unsub) u();
    this._unsub = [];
    if (this._geo) { this._geo.dispose(); this._geo = null; }
    if (this._mat) { this._mat.dispose(); this._mat = null; }
  }
}

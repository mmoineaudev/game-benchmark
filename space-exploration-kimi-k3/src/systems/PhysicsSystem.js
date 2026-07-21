// VOID DRIFT — PhysicsSystem.js
// Forward-axis thrust + lateral strafe/vertical with drag, sphere collisions.
// Per-instance hit testing for InstancedMesh targets. Zero per-frame allocation
// in hot paths (scratch vectors/spheres pre-allocated).

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { GameState } from '../core/GameState.js';
import { EventBus } from '../core/EventBus.js';

export class PhysicsSystem {
  constructor() {
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._accel = new THREE.Vector3();
    this._pushDir = new THREE.Vector3();
    this._worldPos = new THREE.Vector3();
    this._shipSphere = new THREE.Sphere(new THREE.Vector3(), Constants.SHIP.COLLISION_RADIUS);
    this._targetSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this._projSphere = new THREE.Sphere(new THREE.Vector3(), Constants.WEAPON.PROJECTILE_RADIUS);
    this._strafeSpeed = 0;
    this._vertSpeed = 0;
    this._forwardSpeed = 0;
  }

  reset() {
    this._strafeSpeed = 0;
    this._vertSpeed = 0;
    this._forwardSpeed = 0;
  }

  /** Arcade velocity model: velocity rebuilt each frame from ship axes. */
  updatePlayerPhysics(shipObject, input, dt) {
    if (!shipObject || !input) return;
    const vel = shipObject.userData.velocity;
    if (!vel) return;

    this._forward.set(0, 0, -1).applyQuaternion(shipObject.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(shipObject.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(shipObject.quaternion);

    // Forward / reverse.
    if (input.thrust) this._forwardSpeed += Constants.SHIP.ACCELERATION * dt;
    if (input.brake) this._forwardSpeed -= Constants.SHIP.DECELERATION * dt;
    const maxReverse = -Constants.SHIP.MAX_SPEED * Constants.SHIP.REVERSE_RATIO;
    if (this._forwardSpeed > Constants.SHIP.MAX_SPEED) this._forwardSpeed = Constants.SHIP.MAX_SPEED;
    if (this._forwardSpeed < maxReverse) this._forwardSpeed = maxReverse;
    // Gentle decay toward 0 when neither thrust nor brake held.
    if (!input.thrust && !input.brake) {
      this._forwardSpeed *= Math.pow(0.6, dt);
      if (Math.abs(this._forwardSpeed) < 0.05) this._forwardSpeed = 0;
    }

    // Strafe / vertical with drag (SHIP.LATERAL_DRAG — formerly dead constant).
    const strafeMax = Constants.SHIP.MAX_SPEED * Constants.SHIP.STRAFE_SPEED_RATIO;
    const strafeIn = input.getStrafeInput();
    const vertIn = input.getVerticalInput();
    this._strafeSpeed += strafeIn * Constants.SHIP.ACCELERATION * 0.8 * dt;
    this._vertSpeed += vertIn * Constants.SHIP.ACCELERATION * 0.8 * dt;
    const drag = Math.pow(Constants.SHIP.LATERAL_DRAG, dt * 60);
    if (strafeIn === 0) this._strafeSpeed *= drag;
    if (vertIn === 0) this._vertSpeed *= drag;
    this._strafeSpeed = Math.max(-strafeMax, Math.min(strafeMax, this._strafeSpeed));
    this._vertSpeed = Math.max(-strafeMax, Math.min(strafeMax, this._vertSpeed));

    // Compose velocity along ship axes.
    vel.copy(this._forward).multiplyScalar(this._forwardSpeed)
      .addScaledVector(this._right, this._strafeSpeed)
      .addScaledVector(this._up, this._vertSpeed);

    // Distance from actual displacement (cumulative, not abs-from-origin).
    const px = shipObject.position.x, py = shipObject.position.y, pz = shipObject.position.z;
    shipObject.position.addScaledVector(vel, dt);
    const dx = shipObject.position.x - px, dy = shipObject.position.y - py, dz = shipObject.position.z - pz;
    GameState.addDistance(Math.abs(dx) + Math.abs(dy) + Math.abs(dz));

    // Mirror into GameState.
    GameState.player.position.copy(shipObject.position);
    GameState.player.velocity.copy(vel);
  }

  /** Ship vs world collidables. Returns array of hit descriptors. */
  checkShipCollisions(shipObject, collidables) {
    const hits = [];
    if (!shipObject || !collidables || collidables.length === 0) return hits;
    this._shipSphere.center.copy(shipObject.position);

    for (const target of collidables) {
      if (!target) continue;
      // Per-instance collidables from InstancedMesh generators.
      if (target.isInstanced) {
        const list = target.userData && target.userData._collidables;
        if (!list) continue;
        for (const c of list) {
          if (!c.alive) continue;
          this._targetSphere.center.copy(c.position);
          this._targetSphere.radius = c.radius || 1;
          if (this._shipSphere.intersectsSphere(this._targetSphere)) {
            hits.push({ kind: 'instance', instance: c, mesh: target, size: c.size, position: c.position });
          }
        }
        continue;
      }
      // Individual meshes (large asteroids, NPCs).
      const radius = (target.userData && (target.userData.radius || target.userData.size)) || 1;
      this._targetSphere.center.copy(target.position);
      this._targetSphere.radius = radius;
      if (this._shipSphere.intersectsSphere(this._targetSphere)) {
        hits.push({
          kind: target.userData && target.userData.isNPC ? 'npc' : 'mesh',
          mesh: target,
          size: (target.userData && target.userData.size) || radius,
          position: target.position,
        });
      }
    }
    return hits;
  }

  /** Projectiles vs world collidables. Returns array of { projectileId, ... }. */
  checkProjectileCollisions(projectiles, collidables) {
    const hits = [];
    if (!projectiles || projectiles.size === 0 || !collidables || collidables.length === 0) return hits;

    for (const [, proj] of projectiles) {
      if (proj.dead) continue;
      this._projSphere.center.copy(proj.mesh.position);

      for (const target of collidables) {
        if (!target) continue;
        if (target.isInstanced) {
          const list = target.userData && target.userData._collidables;
          if (!list) continue;
          for (const c of list) {
            if (!c.alive) continue;
            this._targetSphere.center.copy(c.position);
            this._targetSphere.radius = c.radius || 1;
            if (this._projSphere.intersectsSphere(this._targetSphere)) {
              hits.push({
                projectileId: proj.id, kind: 'instance', instance: c, mesh: target,
                size: c.size, position: c.position.clone(),
              });
              proj.dead = true;
              break;
            }
          }
          if (proj.dead) break;
          continue;
        }
        if (target.userData && target.userData.isDestroyed) continue;
        const radius = (target.userData && (target.userData.radius || target.userData.size)) || 1;
        this._targetSphere.center.copy(target.position);
        this._targetSphere.radius = radius;
        if (this._projSphere.intersectsSphere(this._targetSphere)) {
          hits.push({
            projectileId: proj.id,
            kind: target.userData && target.userData.isNPC ? 'npc' : 'mesh',
            mesh: target, size: (target.userData && target.userData.size) || radius,
            position: target.position.clone(),
          });
          proj.dead = true;
          break;
        }
      }
    }
    return hits;
  }

  /** Bounce response for ship collisions (position push + velocity kick). */
  handleCollision(shipObject, hit) {
    if (!shipObject) return;
    this._pushDir.copy(shipObject.position).sub(hit.position);
    if (this._pushDir.lengthSq() === 0) this._pushDir.set(0, 1, 0);
    this._pushDir.normalize();

    let pen = Constants.SHIP.COLLISION_RADIUS;
    if (hit.size) pen += hit.size;
    shipObject.position.addScaledVector(this._pushDir, Math.min(pen * 0.25, 3));

    const vel = shipObject.userData.velocity;
    if (vel) {
      const kick = Math.min(vel.length() * 0.5 + 4, 15);
      vel.addScaledVector(this._pushDir, kick);
      // Damp forward speed on impact.
      this._forwardSpeed *= 0.55;
    }
  }
}

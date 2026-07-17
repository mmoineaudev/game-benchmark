// ============================================================
// PhysicsSystem — Collision detection, bounding volumes
// ============================================================
import * as THREE from 'three';
import GameState from '../core/GameState.js';
import EventBus from '../core/EventBus.js';
import Constants from '../core/Constants.js';
import { getVector3 } from '../utils/MathHelpers.js';

class PhysicsSystem {
  constructor() {
    this._sphere = new THREE.Sphere();
    this._targetSphere = new THREE.Sphere();
    this._contactPoint = new THREE.Vector3();
  }

  /**
   * Update player velocity based on input and physics
   */
  updatePlayerPhysics(shipObject, input, dt) {
    const vel = shipObject.userData.velocity;
    const forward = new THREE.Vector3(0, 0, -1);
    const right = new THREE.Vector3(1, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);

    // Acceleration direction
    const accel = getVector3(0, 0, 0);

    if (input.isPressed(Constants.INPUT.FORWARD)) {
      accel.add(forward.clone().multiplyScalar(Constants.SHIP.ACCELERATION));
    }
    if (input.isPressed(Constants.INPUT.BACKWARD)) {
      accel.add(forward.clone().multiplyScalar(-Constants.SHIP.ACCELERATION * 0.5));
    }
    if (input.isPressed(Constants.INPUT.LEFT)) {
      accel.add(right.clone().multiplyScalar(-Constants.SHIP.ACCELERATION * 0.6));
    }
    if (input.isPressed(Constants.INPUT.RIGHT)) {
      accel.add(right.clone().multiplyScalar(Constants.SHIP.ACCELERATION * 0.6));
    }
    if (input.isPressed(Constants.INPUT.UP)) {
      accel.add(up.clone().multiplyScalar(Constants.SHIP.ACCELERATION * 0.4));
    }
    if (input.isPressed(Constants.INPUT.DOWN)) {
      accel.add(up.clone().multiplyScalar(-Constants.SHIP.ACCELERATION * 0.4));
    }

    // Apply acceleration in ship's local frame
    accel.applyQuaternion(shipObject.quaternion);

    vel.add(accel.multiplyScalar(dt));

    // Drag
    vel.multiplyScalar(Math.pow(Constants.SHIP.DRAG, dt * 60));

    // Clamp speed
    if (vel.length() > Constants.SHIP.MAX_SPEED) {
      vel.normalize().multiplyScalar(Constants.SHIP.MAX_SPEED);
    }

    // Update position
    shipObject.position.add(vel.clone().multiplyScalar(dt));

    // Update GameState position
    GameState.setPlayerPosition(shipObject.position.clone());

    // Calculate distance traveled (simplified)
    const delta = shipObject.position.distanceTo(shipObject.userData.lastCheckpoint);
    if (delta > 0.5) {
      GameState.addDistance(delta);
      shipObject.userData.lastCheckpoint.copy(shipObject.position);
    }

    return accel.length() > 0.1;
  }

  /**
   * Check collision between ship and a list of targets
   * Returns array of collisions
   */
  checkShipCollisions(shipObject, targets) {
    const collisions = [];
    const shipRadius = 1.2;

    this._sphere.copy(shipObject.userData.boundingSphere || new THREE.Sphere(shipObject.position, shipRadius));

    for (const target of targets) {
      if (!target.userData.boundingSphere) continue;
      if (!target.visible) continue;

      this._targetSphere.copy(target.userData.boundingSphere);

      if (this._sphere.intersectsSphere(this._targetSphere)) {
        // Determine size tier
        const size = target.userData.size || 1;
        const isLarge = size > 2;

        collisions.push({
          target,
          isLarge,
          damage: isLarge ? Constants.HEALTH.COLLISION_LARGE : Constants.HEALTH.COLLISION_SMALL,
        });
      }
    }

    return collisions;
  }

  /**
   * Check projectile collisions with targets
   */
  checkProjectileCollisions(projectiles, targets) {
    const hits = [];
    const projRadius = 0.3;

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const proj = projectiles[i];
      const projSphere = new THREE.Sphere(proj.position, projRadius);

      for (let j = 0; j < targets.length; j++) {
        const target = targets[j];
        if (!target.visible) continue;
        if (!target.userData.boundingSphere) continue;
        if (target.userData.isDestroyed) continue;

        const targetSphere = target.userData.boundingSphere;

        if (projSphere.intersectsSphere(targetSphere)) {
          hits.push({ projectileIndex: i, target, targetIndex: j });
          break;
        }
      }
    }

    return hits;
  }

  /**
   * Apply collision response
   */
  handleCollision(shipObject, collision) {
    GameState.takeDamage(collision.damage);
    EventBus.emit('physics:collision', {
      damage: collision.damage,
      isLarge: collision.isLarge,
    });

    // Push ship back slightly
    const pushDir = getVector3();
    pushDir.subVectors(shipObject.position, collision.target.position).normalize().multiplyScalar(2);
    shipObject.userData.velocity.add(pushDir);

    // Trigger camera shake
    EventBus.emit('camera:shake', collision.isLarge ? 0.8 : 0.3);

    // Flash the ship
    shipObject.userData.hitFlash = 0.2;
  }
}

export default PhysicsSystem;

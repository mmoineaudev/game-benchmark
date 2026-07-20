// ============================================================
// PhysicsSystem — Collision detection, bounding volumes
// ============================================================
import * as THREE from 'three';
import GameState from '../core/GameState.js';
import EventBus from '../core/EventBus.js';
import Constants from '../core/Constants.js';

class PhysicsSystem {
  constructor() {
    this._sphere = new THREE.Sphere();
    this._targetSphere = new THREE.Sphere();
    this._contactPoint = new THREE.Vector3();
    this._lastPos = 0;
  }

  updatePlayerPhysics(shipObject, input, dt) {
    const vel = shipObject.userData.velocity;

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(shipObject.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(shipObject.quaternion).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(shipObject.quaternion).normalize();

    const accel = new THREE.Vector3(0, 0, 0);

    const fwd = input.getForwardInput();
    const strafe = input.getStrafeInput();
    const vertical = input.getVerticalInput();

    const forwardAccel = fwd > 0 ? Constants.SHIP.ACCELERATION : -Constants.SHIP.ACCELERATION * 0.7;
    accel.addScaledVector(forward, forwardAccel * fwd);

    accel.addScaledVector(right, Constants.SHIP.ACCELERATION * 0.7 * strafe);
    accel.addScaledVector(up, Constants.SHIP.ACCELERATION * 0.45 * vertical);

    vel.addScaledVector(accel, dt);
    vel.multiplyScalar(Math.pow(Constants.SHIP.DRAG, dt * 60));
    if (vel.length() > Constants.SHIP.MAX_SPEED) {
      vel.normalize().multiplyScalar(Constants.SHIP.MAX_SPEED);
    }

    shipObject.position.addScaledVector(vel, dt);

    const pos = shipObject.position;
    const currentDist = Math.abs(pos.x) + Math.abs(pos.y) + Math.abs(pos.z);
    if (currentDist > this._lastPos) {
      GameState.addDistance(currentDist - this._lastPos);
    }
    this._lastPos = currentDist;

    GameState.setPlayerPosition(shipObject.position.clone());
    const moving = vel.length() > 0.1 || Math.abs(fwd) > 0.01 || Math.abs(strafe) > 0.01 || Math.abs(vertical) > 0.01;
    return moving;
  }

  checkShipCollisions(shipObject, targets) {
    const collisions = [];
    const shipRadius = 1.2;
    this._sphere.copy(shipObject.userData.boundingSphere || new THREE.Sphere(shipObject.position, shipRadius));

    for (const target of targets) {
      if (target.isInstanced) continue;
      if (!target.visible) continue;
      if (!target.userData?.boundingSphere) continue;
      if (target.userData?.isDestroyed) continue;

      this._targetSphere.copy(target.userData.boundingSphere);
      if (this._sphere.intersectsSphere(this._targetSphere)) {
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

  checkProjectileCollisions(projectiles, targets) {
    const hits = [];
    const projRadius = 0.3;

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const proj = projectiles[i];
      if (!proj || !proj.mesh) continue;
      const projSphere = new THREE.Sphere(proj.mesh.position, projRadius);

      for (let j = 0; j < targets.length; j++) {
        const target = targets[j];
        if (!target.visible) continue;
        if (target.userData?.isDestroyed) continue;
        if (target.isInstanced) continue;

        let targetSphere;
        if (target.userData?.boundingSphere) {
          targetSphere = target.userData.boundingSphere;
        } else {
          continue;
        }

        if (projSphere.intersectsSphere(targetSphere)) {
          hits.push({ projectileIndex: i, target, targetIndex: j });
          break;
        }
      }
    }
    return hits;
  }

  handleCollision(shipObject, collision) {
    GameState.takeDamage(collision.damage);
    EventBus.emit('physics:collision', { damage: collision.damage, isLarge: collision.isLarge });

    const pushDir = new THREE.Vector3().subVectors(shipObject.position, collision.target.position).normalize().multiplyScalar(2);
    shipObject.userData.velocity.add(pushDir);
    EventBus.emit('camera:shake', collision.isLarge ? 0.8 : 0.3);
    shipObject.userData.hitFlash = 0.2;
  }
}

export default PhysicsSystem;

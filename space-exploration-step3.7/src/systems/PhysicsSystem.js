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
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._accel = new THREE.Vector3();
    this._pushDir = new THREE.Vector3();
  }

  updatePlayerPhysics(shipObject, input, dt) {
    if (!shipObject || !input) return false;

    const vel = shipObject.userData.velocity;
    const q = shipObject.quaternion;
    const _f = this._forward; _f.set(0, 0, -1).applyQuaternion(q).normalize();
    const _r = this._right; _r.set(1, 0, 0).applyQuaternion(q).normalize();
    const _u = this._up; _u.set(0, 1, 0).applyQuaternion(q).normalize();
    const accel = this._accel; accel.set(0, 0, 0);

    const forwardInput = input.getThrustInput();
    const rightInput = input.getYawInput();
    const verticalInput = input.getPitchInput();

    const forwardAccel = forwardInput > 0 ? Constants.SHIP.ACCELERATION : -Constants.SHIP.DECELERATION;
    accel.addScaledVector(_f, forwardAccel * Math.max(0, forwardInput));
    accel.addScaledVector(_r, Constants.SHIP.ACCELERATION * 1.1 * rightInput);
    accel.addScaledVector(_u, Constants.SHIP.ACCELERATION * 0.8 * verticalInput);

    vel.addScaledVector(accel, dt);

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

    GameState.setPlayerPosition(shipObject.position);
    const moving = vel.length() > 0.1 || Math.abs(forwardInput) > 0.01 || Math.abs(rightInput) > 0.01 || Math.abs(verticalInput) > 0.01;
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

    this._pushDir.subVectors(shipObject.position, collision.target.position).normalize().multiplyScalar(2);
    shipObject.userData.velocity.add(this._pushDir);
    EventBus.emit('camera:shake', collision.isLarge ? 0.8 : 0.3);
    shipObject.userData.hitFlash = 0.2;
  }
}

export default PhysicsSystem;

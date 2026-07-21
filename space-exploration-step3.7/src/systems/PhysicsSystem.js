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
    this._pushDir = new THREE.Vector3();
    this._projSphere = new THREE.Sphere();
  }

  updatePlayerPhysics(shipObject, input, dt) {
    if (!shipObject || !input) return false;

    const vel = shipObject.userData.velocity;
    const q = shipObject.quaternion;
    this._forward.set(0, 0, -1).applyQuaternion(q).normalize();

    // Ship always moves along its forward axis only; no sideways drift.
    const currentForwardSpeed = vel.dot(this._forward);
    let targetForwardSpeed = currentForwardSpeed;

    if (input.thrust) {
      targetForwardSpeed += Constants.SHIP.ACCELERATION * dt;
    }
    if (input.brake && currentForwardSpeed > 0) {
      targetForwardSpeed -= Constants.SHIP.DECELERATION * dt;
      if (targetForwardSpeed < 0) targetForwardSpeed = 0;
    }

    // Clamp speed for low-fps stability.
    targetForwardSpeed = Math.max(0, Math.min(targetForwardSpeed, Constants.SHIP.MAX_SPEED));

    vel.copy(this._forward).multiplyScalar(targetForwardSpeed);

    shipObject.position.addScaledVector(vel, dt);

    const pos = shipObject.position;
    const currentDist = Math.abs(pos.x) + Math.abs(pos.y) + Math.abs(pos.z);
    if (currentDist > this._lastPos) {
      GameState.addDistance(currentDist - this._lastPos);
    }
    this._lastPos = currentDist;

    GameState.setPlayerPosition(shipObject.position);
    const moving = targetForwardSpeed > 0.1;
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
          damage: Constants.HEALTH.COLLISION_DAMAGE,
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
      this._projSphere.center.copy(proj.mesh.position);
      this._projSphere.radius = projRadius;

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

        if (this._projSphere.intersectsSphere(targetSphere)) {
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

    const target = collision.target;
    const normal = new THREE.Vector3().subVectors(shipObject.position, target.position);
    if (normal.lengthSq() === 0) {
      if (shipObject.userData.velocity.lengthSq() > 0) {
        normal.copy(shipObject.userData.velocity).normalize();
      } else {
        normal.set(0, 1, 0);
      }
    }
    normal.normalize();

    const vel = shipObject.userData.velocity;
    const vn = vel.dot(normal);
    if (vn > 0) {
      vel.addScaledVector(normal, -(vn + 3.5));
    } else {
      vel.addScaledVector(normal, 3.5);
    }
    vel.multiplyScalar(0.7);

    const pen = 1.2 + (target.userData?.radius || target.userData?.size || 1);
    shipObject.position.addScaledVector(normal, pen + 0.2);
    EventBus.emit('camera:shake', collision.isLarge ? 0.8 : 0.3);
    shipObject.userData.hitFlash = 0.25;
  }
}

export default PhysicsSystem;

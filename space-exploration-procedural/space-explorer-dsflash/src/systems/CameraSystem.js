import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { damp, clamp, scratch } from '../utils/MathHelpers.js';

// Follow-cam: trails the ship heading, damped; no roll inheritance; FOV breathing; shake.
export class CameraSystem {
  constructor(camera) {
    this.camera = camera;
    this.camera.fov = Constants.CAMERA_FOV_REST;
    this.camera.near = 0.1;
    this.camera.far = 4000;
    this.camera.updateProjectionMatrix();

    this._pos = new THREE.Vector3(0, Constants.CAMERA_HEIGHT, Constants.CAMERA_DISTANCE); // smoothed position
    this._shake = 0;
    this._shakeOffset = new THREE.Vector3();
  }

  addShake(intensity, duration) {
    this._shake = Math.max(this._shake, intensity * (duration / 0.5));
  }

  update(dt, ship, thrustFraction, cameraQuatOut) {
    if (!ship) return;
    const C = Constants;

    // Desired camera position: behind heading (no roll), above ship
    const fwd = scratch.v1.set(0, 0, -1).applyQuaternion(ship.heading);
    // Ship forward is -Z: yaw = atan2(-fwd.x, -fwd.z) so identity heading → yaw 0
    const yaw = Math.atan2(-fwd.x, -fwd.z);
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const camQuat = scratch.q1.setFromEuler(scratch.e1.set(pitch, yaw, 0, 'YXZ'));
    if (cameraQuatOut) cameraQuatOut.copy(camQuat);

    const desired = scratch.v2.set(0, C.CAMERA_HEIGHT, C.CAMERA_DISTANCE)
      .applyQuaternion(camQuat)
      .add(ship.position);

    const lambda = C.CAMERA_DAMPING;
    this._pos.x = damp(this._pos.x, desired.x, lambda, dt);
    this._pos.y = damp(this._pos.y, desired.y, lambda, dt);
    this._pos.z = damp(this._pos.z, desired.z, lambda, dt);

    // Shake (exponential decay, spec §5.9)
    this._shake *= Math.exp(-C.SHAKE_DECAY_RATE * dt);
    this._shakeOffset.set(
      (Math.random() - 0.5) * this._shake,
      (Math.random() - 0.5) * this._shake,
      (Math.random() - 0.5) * this._shake,
    );

    this.camera.position.copy(this._pos).add(this._shakeOffset);
    this.camera.lookAt(ship.position);

    // FOV breathing with thrust
    const targetFov = THREE.MathUtils.lerp(C.CAMERA_FOV_REST, C.CAMERA_FOV_MAX, clamp(thrustFraction, 0, 1));
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  reset() {
    this._pos.set(0, Constants.CAMERA_HEIGHT, Constants.CAMERA_DISTANCE);
    this._shake = 0;
    this.camera.fov = Constants.CAMERA_FOV_REST;
    this.camera.updateProjectionMatrix();
  }
}

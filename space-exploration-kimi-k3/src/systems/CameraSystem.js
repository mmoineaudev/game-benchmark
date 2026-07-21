// VOID DRIFT — CameraSystem.js
// 3/4 above-behind chase cam: ship framed in the lower half of the screen.
// FOV lerp with speed, collision shake, wheel zoom. Zero per-frame allocation.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

export class CameraSystem {
  constructor(camera) {
    this.camera = camera;
    this.zoomFactor = 1;
    this._shakeAmount = 0;
    // Scratch vectors (pre-allocated).
    this._back = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._targetPos = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._shakeVec = new THREE.Vector3();
  }

  init() {
    this.camera.fov = Constants.CAMERA.MIN_FOV;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount) {
    this._shakeAmount = Math.min(this._shakeAmount + amount, 1.5);
  }

  applyZoom(delta) {
    this.zoomFactor = Math.max(
      Constants.CAMERA.ZOOM_MIN,
      Math.min(Constants.CAMERA.ZOOM_MAX, this.zoomFactor + delta));
  }

  update(shipObject, dt) {
    if (!shipObject) return;
    const vel = shipObject.userData.velocity;
    const speed = vel ? vel.length() : 0;
    const speedRatio = Math.min(speed / Constants.SHIP.MAX_SPEED, 1);

    // FOV widens with speed.
    const fovTarget = Constants.CAMERA.MIN_FOV +
      (Constants.CAMERA.MAX_FOV - Constants.CAMERA.MIN_FOV) * speedRatio;
    this.camera.fov += (fovTarget - this.camera.fov) * Math.min(3 * dt, 1);
    this.camera.updateProjectionMatrix();

    // Ship-local axes from quaternion.
    this._back.set(0, 0, 1).applyQuaternion(shipObject.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(shipObject.quaternion);

    const baseDist = Constants.CAMERA.FOLLOW_DISTANCE * Math.max(this.zoomFactor, Constants.CAMERA.ZOOM_MIN);

    this._targetPos.copy(shipObject.position)
      .addScaledVector(this._up, Constants.CAMERA.FOLLOW_HEIGHT)
      .addScaledVector(this._back, baseDist);

    // Exponential-decay damping: frame-rate independent.
    const t = 1 - Math.pow(0.01, Constants.CAMERA.DAMPING_SPEED * dt / 4.5);
    this.camera.position.lerp(this._targetPos, Math.min(t, 1));

    // Look target biased down/back — ship sits in lower half of frame.
    this._lookTarget.copy(shipObject.position)
      .addScaledVector(this._up, -Constants.CAMERA.LOOK_OFFSET_Y)
      .addScaledVector(this._back, Constants.CAMERA.LOOK_OFFSET_Z);

    // Shake (random per axis, decays exponentially).
    if (this._shakeAmount > 0.001) {
      this._shakeVec.set(
        (Math.random() - 0.5) * this._shakeAmount,
        (Math.random() - 0.5) * this._shakeAmount,
        (Math.random() - 0.5) * this._shakeAmount);
      this.camera.position.add(this._shakeVec);
      this._shakeAmount *= Math.pow(Constants.CAMERA.SHAKE_DECAY, dt);
    } else {
      this._shakeAmount = 0;
    }

    this.camera.lookAt(this._lookTarget);
  }

  reset() {
    this.zoomFactor = 1;
    this._shakeAmount = 0;
  }
}

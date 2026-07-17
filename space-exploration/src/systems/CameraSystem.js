// ============================================================
// CameraSystem — Follow-cam, damping, FOV speed effect
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import GameState from '../core/GameState.js';

class CameraSystem {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this._offset = new THREE.Vector3(0, Constants.CAMERA.FOLLOW_HEIGHT, -Constants.CAMERA.FOLLOW_DISTANCE);
    this._targetPos = new THREE.Vector3();
    this._currentPos = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._lastShipPos = new THREE.Vector3();
    this._fovTarget = Constants.CAMERA.START_FOV;
    this._shakeAmount = 0;
    this._shakeDecay = 5;
  }

  init() {
    this.camera.fov = Constants.CAMERA.START_FOV;
    this.camera.updateProjectionMatrix();
    this._currentPos.copy(this._targetPos);
  }

  update(shipObject, dt) {
    if (!shipObject) return;

    const speed = shipObject.userData.velocity.length() || 0;
    const speedRatio = Math.min(speed / Constants.SHIP.MAX_SPEED, 1);

    // FOV speed effect
    this._fovTarget = Constants.CAMERA.MIN_FOV + speedRatio * (Constants.CAMERA.MAX_FOV - Constants.CAMERA.MIN_FOV);
    this.camera.fov += (this._fovTarget - this.camera.fov) * Constants.CAMERA.FOV_LERP_SPEED * dt;
    this.camera.updateProjectionMatrix();

    // Target position behind ship
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(shipObject.quaternion);

    this._targetPos.copy(shipObject.position).add(
      this._offset.clone().applyQuaternion(shipObject.quaternion)
    );

    // Damped follow (exponential interpolation)
    const lerpFactor = Math.min(1, 1 - Math.pow(0.01, Constants.CAMERA.DAMPING_SPEED * dt));
    this._currentPos.lerp(this._targetPos, lerpFactor);

    // Camera shake
    if (this._shakeAmount > 0.001) {
      this._currentPos.x += (Math.random() - 0.5) * this._shakeAmount;
      this._currentPos.y += (Math.random() - 0.5) * this._shakeAmount;
      this._currentPos.z += (Math.random() - 0.5) * this._shakeAmount;
      this._shakeAmount *= Math.pow(0.01, dt); // exponential decay
      if (this._shakeAmount < 0.001) this._shakeAmount = 0;
    }

    // Look ahead of ship
    this._lookTarget.copy(shipObject.position).add(forward.multiplyScalar(15));

    this.camera.position.copy(this._currentPos);
    this.camera.lookAt(this._lookTarget);

    this._lastShipPos.copy(shipObject.position);
  }

  triggerShake(amount) {
    this._shakeAmount = Math.max(this._shakeAmount, amount);
  }

  get shakeAmount() {
    return this._shakeAmount;
  }
}

export default CameraSystem;

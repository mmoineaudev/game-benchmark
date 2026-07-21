// ============================================================
// CameraSystem — Follow-cam, damping, FOV speed effect, zoom
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
    this._back = new THREE.Vector3();
    this._rightAxis = new THREE.Vector3();
    this._upAxis = new THREE.Vector3();
    this._heightOffset = new THREE.Vector3();
    this._backOffset = new THREE.Vector3();
    this.zoomFactor = 1;
  }

  init() {
    this.camera.fov = Constants.CAMERA.START_FOV;
    this.camera.updateProjectionMatrix();
    this.zoomFactor = 1;
    this._currentPos.copy(this._targetPos);
  }

  update(shipObject, dt) {
    if (!shipObject) return;

    const speed = shipObject.userData.velocity.length() || 0;
    const speedRatio = Math.min(speed / Constants.SHIP.MAX_SPEED, 1);

    this._fovTarget = Constants.CAMERA.MIN_FOV + speedRatio * (Constants.CAMERA.MAX_FOV - Constants.CAMERA.MIN_FOV);
    this.camera.fov += (this._fovTarget - this.camera.fov) * Constants.CAMERA.FOV_LERP_SPEED * dt;
    this.camera.updateProjectionMatrix();

    const back = this._back; back.set(0, 0, 1).applyQuaternion(shipObject.quaternion);
    const right = this._rightAxis; right.set(1, 0, 0).applyQuaternion(shipObject.quaternion);
    const up = this._upAxis; up.set(0, 1, 0).applyQuaternion(shipObject.quaternion);

    const heightOffset = this._heightOffset.copy(up).multiplyScalar(Constants.CAMERA.FOLLOW_HEIGHT);
    const baseDist = Constants.CAMERA.FOLLOW_DISTANCE * Math.max(this.zoomFactor, Constants.CAMERA.ZOOM_MIN);
    const backOffset = this._backOffset.copy(back).multiplyScalar(baseDist);
    this._targetPos.copy(shipObject.position).add(heightOffset).add(backOffset);

    const lerpFactor = Math.min(1, 1 - Math.pow(0.01, Constants.CAMERA.DAMPING_SPEED * dt));
    this._currentPos.lerp(this._targetPos, lerpFactor);

    if (this._shakeAmount > 0.001) {
      this._currentPos.x += (Math.random() - 0.5) * this._shakeAmount;
      this._currentPos.y += (Math.random() - 0.5) * this._shakeAmount;
      this._currentPos.z += (Math.random() - 0.5) * this._shakeAmount;
      this._shakeAmount *= Math.pow(0.001, dt);
      if (this._shakeAmount < 0.001) this._shakeAmount = 0;
    }

    this._lookTarget.copy(shipObject.position).addScaledVector(right, 0.2).addScaledVector(back, -15);

    this.camera.position.copy(this._currentPos);
    this.camera.lookAt(this._lookTarget);

    this._lastShipPos.copy(shipObject.position);
  }

  applyZoom(delta) {
    this.zoomFactor = Math.max(
      Constants.CAMERA.ZOOM_MIN,
      Math.min(Constants.CAMERA.ZOOM_MAX, this.zoomFactor + delta)
    );
  }

  triggerShake(amount) {
    this._shakeAmount = Math.max(this._shakeAmount, amount);
  }

  get shakeAmount() {
    return this._shakeAmount;
  }
}

export default CameraSystem;

import * as THREE from 'three';
import { CAMERA, ROOM, LOG } from '../core/Constants.js';

/**
 * Orthographic camera that follows the player with deadzone,
 * clamped to room bounds.
 */
export default class CameraSystem {
  constructor(camera) {
    this._cam = camera;
    this._targetX = 0;
    this._targetY = 0;
    this._currentX = 0;
    this._currentY = 0;
    this._bounds = null;   // { minX, maxX, minY, maxY }
    this._zoom = CAMERA.BASE_ZOOM;

    // scratch vectors
    this._v3 = new THREE.Vector3();
    LOG('Camera', 'Initialized');
  }

  /** Snap camera to position instantly (room transition) */
  snap(x, y) {
    this._currentX = x;
    this._currentY = y;
    this._targetX = x;
    this._targetY = y;
    this._applyPosition();
  }

  /** Follow player with deadzone and lerp */
  follow(player, dt) {
    if (!player.isAlive) return;

    const px = player.x;
    const py = player.y;

    // Deadzone: only move camera if player exceeds threshold from target
    const dx = px - this._targetX;
    const dy = py - this._targetY;

    if (Math.abs(dx) > CAMERA.DEADZONE_X) {
      this._targetX += dx - Math.sign(dx) * CAMERA.DEADZONE_X;
    }
    if (Math.abs(dy) > CAMERA.DEADZONE_Y) {
      this._targetY += dy - Math.sign(dy) * CAMERA.DEADZONE_Y;
    }

    // Clamp to room bounds
    if (this._bounds) {
      const halfW = this._cam.right - this._cam.left;
      const halfH = this._cam.top - this._cam.bottom;
      this._targetX = Math.max(this._bounds.minX + halfW / 2, Math.min(this._bounds.maxX - halfW / 2, this._targetX));
      this._targetY = Math.max(this._bounds.minY + halfH / 2, Math.min(this._bounds.maxY - halfH / 2, this._targetY));
    }

    // Lerp toward target
    const t = 1 - Math.exp(-CAMERA.LERP_SPEED * dt);
    this._currentX += (this._targetX - this._currentX) * t;
    this._currentY += (this._targetY - this._currentY) * t;

    this._applyPosition();
  }

  _applyPosition() {
    this._cam.position.set(this._currentX, this._currentY, 20);
    this._cam.lookAt(this._currentX, this._currentY, 0);
  }

  setBounds(bounds) {
    this._bounds = bounds;
  }

  get x() { return this._currentX; }
  get y() { return this._currentY; }
}

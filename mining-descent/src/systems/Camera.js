// =============================================================================
// Camera — angled top-down follow with smooth lerp, zoom, mouse orbit, pan.
// =============================================================================

import * as THREE from 'three';
import { CAMERA, CAVE_ENTRANCE } from '../core/Constants.js';
import { getEventBus } from '../core/EventBus.js';
import { Logger } from '../core/Logger.js';

export class Camera {
  constructor(camera) {
    this._cam = camera;
    this._bus = getEventBus();
    this._target = new THREE.Vector3();
    this._panOffset = new THREE.Vector3(); // world-space pan from ZQSD
    this._angle = 0;
    this._distance = CAMERA.DISTANCE;
    this._height = CAMERA.HEIGHT_OFFSET;
    this._disposed = false;
  }

  init() {
    const tx = CAVE_ENTRANCE.x + 0.5;
    const tz = CAVE_ENTRANCE.z + 0.5;
    this._target.set(tx, 0, tz);
    this._cam.position.set(tx, CAMERA.HEIGHT_OFFSET, tz - CAMERA.DISTANCE);
    this._cam.lookAt(this._target);

    this._unsubZoom = this._bus.on('camera:zoom', ({ delta }) => {
      this._distance = THREE.MathUtils.clamp(this._distance * delta, CAMERA.ZOOM_MIN, CAMERA.ZOOM_MAX);
    });

    Logger.info('Camera', 'initialized');
  }

  setAngle(rad) { this._angle = rad; }
  getAngle() { return this._angle; }

  rotateBy(delta, dt) {
    this._angle += delta * 3.0 * dt;
    this._angle = this._angle % (Math.PI * 2);
    if (this._angle < 0) this._angle += Math.PI * 2;
  }

  /** Pan the look-at target in world space. Call each frame with dt-aware input. */
  pan(worldDx, worldDz, dt) {
    const speed = 8.0; // tiles/sec
    this._panOffset.x += worldDx * speed * dt;
    this._panOffset.z += worldDz * speed * dt;
  }

  /** Follow vehicle world position + pan offset. */
  follow(worldPos, dt) {
    const desired = worldPos.clone().add(this._panOffset);
    this._target.lerp(desired, Math.min(1, CAMERA.LERP_SPEED * dt));
  }

  update(dt) {
    if (this._disposed) return;

    const sin = Math.sin(this._angle);
    const cos = Math.cos(this._angle);

    const idealX = this._target.x + sin * this._distance;
    const idealZ = this._target.z + cos * this._distance;
    const idealY = this._target.y + this._height;

    const ideal = new THREE.Vector3(idealX, idealY, idealZ);
    this._cam.position.lerp(ideal, Math.min(1, CAMERA.LERP_SPEED * dt));
    this._cam.lookAt(this._target);
  }

  dispose() {
    if (this._unsubZoom) this._unsubZoom();
    this._disposed = true;
    Logger.info('Camera', 'disposed');
  }
}

// =============================================================================
// Input — mouse orbit + ZQSD camera pan + A/E rotation, arrow keys for vehicle.
// =============================================================================

import { getEventBus } from '../core/EventBus.js';
import { Logger } from '../core/Logger.js';

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export class Input {
  constructor(canvas) {
    this._canvas = canvas;
    this._bus = getEventBus();
    this._keys = new Set();
    this._dir = { x: 0, z: 0 };
    this._rotate = 0;           // -1 (E), 0, +1 (A) — orbit
    this._cameraAngle = 0;
    this._pan = { x: 0, z: 0 }; // ZQSD camera pan in camera-space
    this._mouseDelta = 0;       // mouse drag orbit delta per frame

    // Mouse state
    this._mouseDown = false;
    this._lastMouseX = 0;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this.enabled = false;
  }

  init() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    if (this._canvas) {
      this._canvas.addEventListener('mousedown', this._onMouseDown);
      window.addEventListener('mouseup', this._onMouseUp);
      window.addEventListener('mousemove', this._onMouseMove);
    }
    this.enabled = true;
    Logger.info('Input', 'initialized (mouse=orbit, ZQSD=pan, A/E=rot, arrows=move)');
  }

  setCameraAngle(rad) { this._cameraAngle = rad; }

  update() {
    if (!this.enabled) return;

    // --- Vehicle movement: arrow keys ---
    let rx = 0, rz = 0;
    if (this._keys.has('ArrowUp'))    rz -= 1;
    if (this._keys.has('ArrowDown'))  rz += 1;
    if (this._keys.has('ArrowLeft'))  rx -= 1;
    if (this._keys.has('ArrowRight')) rx += 1;

    if (rx !== 0 || rz !== 0) {
      const cos = Math.cos(this._cameraAngle);
      const sin = Math.sin(this._cameraAngle);
      this._dir.x = rx * cos - rz * sin;
      this._dir.z = rx * sin + rz * cos;
      const len = Math.sqrt(this._dir.x * this._dir.x + this._dir.z * this._dir.z);
      if (len > 0) { this._dir.x /= len; this._dir.z /= len; }
    } else {
      this._dir.x = 0; this._dir.z = 0;
    }

    // --- Camera orbit: A/E keys + mouse drag ---
    this._rotate = 0;
    if (this._keys.has('KeyA')) this._rotate += 1;  // A = orbit left (CCW)
    if (this._keys.has('KeyE')) this._rotate -= 1;  // E = orbit right (CW)

    // Mouse orbit (delta accumulated per-frame)
    this._rotate += this._mouseDelta;
    this._mouseDelta = 0;

    // --- Camera pan: ZQSD (AZERTY layout: Z=forward, Q=left, S=back, D=right) ---
    let px = 0, pz = 0;
    if (this._keys.has('KeyZ')) pz -= 1;  // forward (away from camera)
    if (this._keys.has('KeyS')) pz += 1;  // back (toward camera)
    if (this._keys.has('KeyQ')) px -= 1;  // left
    if (this._keys.has('KeyD')) px += 1;  // right

    // Rotate pan from camera-space to world-space
    if (px !== 0 || pz !== 0) {
      const cos = Math.cos(this._cameraAngle);
      const sin = Math.sin(this._cameraAngle);
      this._pan.x = px * cos - pz * sin;
      this._pan.z = px * sin + pz * cos;
    } else {
      this._pan.x = 0; this._pan.z = 0;
    }
  }

  get direction() { return this._dir; }
  get rotate() { return this._rotate; }
  get pan() { return this._pan; }
  isDown() { return this._keys.has('ArrowDown'); }

  _onKeyDown(e) {
    if (ARROW_KEYS.includes(e.code)) e.preventDefault();
    this._keys.add(e.code);
  }

  _onKeyUp(e) { this._keys.delete(e.code); }

  _onWheel(e) {
    this._bus.emit('camera:zoom', { delta: e.deltaY > 0 ? 0.9 : 1.1 });
  }

  _onMouseDown(e) {
    if (e.button === 0) { // left button
      this._mouseDown = true;
      this._lastMouseX = e.clientX;
    }
  }

  _onMouseUp(e) {
    if (e.button === 0) this._mouseDown = false;
  }

  _onMouseMove(e) {
    if (!this._mouseDown) return;
    const dx = e.clientX - this._lastMouseX;
    this._lastMouseX = e.clientX;
    // Convert pixel delta to radians (sensitivity)
    this._mouseDelta -= dx * 0.005;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('wheel', this._onWheel);
    if (this._canvas) {
      this._canvas.removeEventListener('mousedown', this._onMouseDown);
      window.removeEventListener('mouseup', this._onMouseUp);
      window.removeEventListener('mousemove', this._onMouseMove);
    }
    this._keys.clear();
    this.enabled = false;
    Logger.info('Input', 'disposed');
  }
}

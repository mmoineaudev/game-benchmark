// VOID DRIFT — InputSystem.js
// event.code-based bindings (AZERTY/QWERTY safe), pointer-lock mouse flight
// with unbounded yaw/pitch accumulator + tanh-bounded per-frame deltas.

import * as Constants from '../core/Constants.js';
import { EventBus } from '../core/EventBus.js';
import { clamp } from '../utils/MathHelpers.js';

export class InputSystem {
  constructor() {
    this.keys = Object.create(null);
    // Unbounded angular accumulators (radians-ish steering input).
    this.yaw = 0;
    this.pitch = 0;
    this._lastYaw = 0;
    this._lastPitch = 0;
    // Bounded per-frame steering rates (output to PlayerShip).
    this.mouseX = 0;
    this.mouseY = 0;
    this.thrust = false;
    this.brake = false;
    this.fire = false;
    this.pointerLocked = false;
    this._unsub = [];
    this._domCleanup = [];
    this._canvas = null;
  }

  init(canvas) {
    this._canvas = canvas || document.getElementById('game-container');

    const preventCodes = new Set([
      Constants.INPUT.FORWARD, Constants.INPUT.BACKWARD,
      Constants.INPUT.STRAFE_LEFT, Constants.INPUT.STRAFE_RIGHT,
      Constants.INPUT.DOWN, Constants.INPUT.UP,
      Constants.INPUT.FIRE, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ]);

    const onKeyDown = (e) => {
      if (preventCodes.has(e.code)) e.preventDefault();
      if (!e.repeat) EventBus.emit('input:keydown', e.code);
      this.keys[e.code] = true;
    };
    const onKeyUp = (e) => { this.keys[e.code] = false; };
    const onBlur = () => { this.keys = Object.create(null); };

    const onMouseMove = (e) => {
      if (this.pointerLocked) {
        // Unbounded accumulator — never clamp steering input rates.
        this.yaw += e.movementX * Constants.INPUT.MOUSE_SENSITIVITY * 0.001;
        this.pitch += -e.movementY * Constants.INPUT.MOUSE_SENSITIVITY * 0.001;
      }
    };
    const onMouseDown = (e) => {
      if (e.button === 0) EventBus.emit('input:fire-mouse', true);
    };
    const onMouseUp = (e) => {
      if (e.button === 0) EventBus.emit('input:fire-mouse', false);
    };
    const onContextMenu = (e) => { if (this.pointerLocked) e.preventDefault(); };
    const onWheel = (e) => {
      EventBus.emit('camera:zoom', -Math.sign(e.deltaY) * Constants.CAMERA.ZOOM_STEP);
    };
    const onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement != null;
      EventBus.emit('input:pointer-lock', this.pointerLocked);
    };
    const onCanvasClick = () => {
      if (!this.pointerLocked) EventBus.emit('input:request-pointer-lock');
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('pointerlockchange', onPointerLockChange);
    if (this._canvas) this._canvas.addEventListener('click', onCanvasClick);

    this._domCleanup.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      if (this._canvas) this._canvas.removeEventListener('click', onCanvasClick);
    });

    this._unsub.push(EventBus.on('input:request-pointer-lock', () => this.requestPointerLock()));
  }

  requestPointerLock() {
    const el = document.querySelector('#game-container canvas') || this._canvas;
    if (el && el.requestPointerLock) {
      try { el.requestPointerLock(); } catch { /* pointer lock may fail headless */ }
    }
  }

  releasePointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isPressed(code) { return !!this.keys[code]; }

  getStrafeInput() {
    return clamp(
      (this.isPressed(Constants.INPUT.STRAFE_RIGHT) ? 1 : 0) +
      (this.isPressed(Constants.INPUT.STRAFE_LEFT) ? -1 : 0), -1, 1);
  }

  getVerticalInput() {
    return clamp(
      (this.isPressed(Constants.INPUT.UP) ? 1 : 0) +
      (this.isPressed(Constants.INPUT.DOWN) ? -1 : 0), -1, 1);
  }

  update() {
    // tanh-bounded per-frame deltas — fast flicks stay possible.
    const dy = this.yaw - this._lastYaw;
    const dp = this.pitch - this._lastPitch;
    this.mouseX = Math.tanh(dy * 60);
    this.mouseY = Math.tanh(dp * 60);
    this._lastYaw = this.yaw;
    this._lastPitch = this.pitch;

    this.thrust = this.isPressed(Constants.INPUT.FORWARD);
    this.brake = this.isPressed(Constants.INPUT.BACKWARD);
  }

  destroy() {
    for (const fn of this._domCleanup) fn();
    this._domCleanup = [];
    for (const u of this._unsub) u();
    this._unsub = [];
    this.keys = Object.create(null);
  }
}

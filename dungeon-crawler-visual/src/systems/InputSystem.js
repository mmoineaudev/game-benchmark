import { PLAYER } from '../core/Constants.js';

export class InputSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
    this.mouseButtons = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this._boundHandlers = new Map();
  }

  init() {
    const onKeyDown = (e) => {
      this.keys[e.code] = true;
    };
    const onKeyUp = (e) => {
      this.keys[e.code] = false;
    };
    const onMouseMove = (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.mouseX += e.movementX;
        this.mouseY += e.movementY;
      }
    };
    const onMouseDown = (e) => { this.mouseButtons[e.button] = true; };
    const onMouseUp = (e) => { this.mouseButtons[e.button] = false; };
    const onClick = () => {
      if (!document.pointerLockElement) {
        this.canvas.requestPointerLock();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    this.canvas.addEventListener('click', onClick);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      this.canvas.removeEventListener('click', onClick);
    });
  }

  isPressed(code) {
    return !!this.keys[code];
  }

  isMouseDown(button = 0) {
    return !!this.mouseButtons[button];
  }

  consumeMouse() {
    const mx = this.mouseX;
    const my = this.mouseY;
    this.mouseX = 0;
    this.mouseY = 0;
    return { x: mx, y: my };
  }

  isPointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  dispose() {
    const destroy = this._boundHandlers.get('destroy');
    if (destroy) destroy();
  }
}

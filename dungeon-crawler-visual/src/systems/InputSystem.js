import { PLAYER } from '../core/Constants.js';

export class InputSystem {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = {};
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
    const onClick = () => {
      if (!document.pointerLockElement) {
        this.canvas.requestPointerLock();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    this.canvas.addEventListener('click', onClick);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      this.canvas.removeEventListener('click', onClick);
    });
  }

  isPressed(code) {
    return !!this.keys[code];
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

// InputSystem.js — keyboard/mouse/pointer-lock state (§2)
export default class InputSystem {
  constructor() {
    this.keys = new Set();
    this.mouse = [false, false, false];
    this._dx = 0; this._dy = 0;
    this.pointerLocked = false;
    this._canvas = null;
    this._onKeyD = e => {
      if (['Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    };
    this._onKeyU = e => this.keys.delete(e.code);
    this._onMD = e => { if (e.button < 3) this.mouse[e.button] = true; };
    this._onMU = e => { if (e.button < 3) this.mouse[e.button] = false; };
    this._onMM = e => {
      if (!this.pointerLocked) return;
      this._dx += e.movementX || 0;
      this._dy += e.movementY || 0;
    };
    this._onPLC = () => { this.pointerLocked = document.pointerLockElement != null; };
    this._onCtx = e => e.preventDefault();
  }

  attach(canvas) {
    this._canvas = canvas;
    window.addEventListener('keydown', this._onKeyD);
    window.addEventListener('keyup', this._onKeyU);
    window.addEventListener('mousedown', this._onMD);
    window.addEventListener('mouseup', this._onMU);
    window.addEventListener('mousemove', this._onMM);
    document.addEventListener('pointerlockchange', this._onPLC);
    canvas.addEventListener('click', () => canvas.requestPointerLock?.());
    canvas.addEventListener('contextmenu', this._onCtx);
  }

  isPressed(code) { return this.keys.has(code); }
  isMouseDown(button) { return this.mouse[button]; }
  consumeMouse() {
    const d = { dx: this._dx, dy: this._dy };
    this._dx = 0; this._dy = 0;
    return d;
  }
  isPointerLocked() { return this.pointerLocked; }

  dispose() {
    window.removeEventListener('keydown', this._onKeyD);
    window.removeEventListener('keyup', this._onKeyU);
    window.removeEventListener('mousedown', this._onMD);
    window.removeEventListener('mouseup', this._onMU);
    window.removeEventListener('mousemove', this._onMM);
    document.removeEventListener('pointerlockchange', this._onPLC);
  }
}

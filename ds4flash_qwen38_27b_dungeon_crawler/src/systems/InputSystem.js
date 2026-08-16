/**
 * InputSystem.js — input capture (§2, binding).
 *
 * Window listeners: keydown/keyup (event.code), mousedown/mouseup (button),
 * mousemove (accumulated movementX/movementY). Consumers read
 * isPressed(code) / isMouseDown(button) / consumeMouse() / isPointerLocked()
 * and do their own edge-triggering by comparing previous-frame state.
 * Click on the canvas requests pointer lock; RMB context menu is prevented.
 *
 * Headless shim (§27): every window/document access is guarded — when no
 * `window` exists the system constructs with `enabled = false` and all
 * queries return inert values.
 */

export class InputSystem {
  /**
   * @param {HTMLCanvasElement|null} canvas   — canvas to lock the pointer on
   * @param {object|null} domElement         — element for pointer-lock state (falls back to document)
   */
  constructor(canvas, domElement = null) {
    this.canvas = canvas || null;
    this.domElement = domElement || null;
    this.enabled = typeof window !== 'undefined';

    /** @type {Set<string>} held key codes */
    this.keys = new Set();
    /** @type {Map<number, boolean>} held mouse buttons */
    this.mouseButtons = new Map();
    this.mouseDX = 0;
    this.mouseDY = 0;

    this._onKeyDown = (e) => { if (e && e.code) this.keys.add(e.code); };
    this._onKeyUp = (e) => { if (e && e.code) this.keys.delete(e.code); };
    this._onMouseDown = (e) => {
      if (e && e.button !== undefined) this.mouseButtons.set(e.button, true);
      this._tryLock();
    };
    this._onMouseUp = (e) => {
      if (e && e.button !== undefined) this.mouseButtons.set(e.button, false);
    };
    this._onMouseMove = (e) => {
      if (!e) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onContextMenu = (e) => { e.preventDefault(); };

    if (this.enabled) {
      const w = window;
      w.addEventListener('keydown', this._onKeyDown);
      w.addEventListener('keyup', this._onKeyUp);
      w.addEventListener('mousedown', this._onMouseDown);
      w.addEventListener('mouseup', this._onMouseUp);
      w.addEventListener('mousemove', this._onMouseMove);
      if (this.canvas && typeof this.canvas.addEventListener === 'function') {
        this.canvas.addEventListener('contextmenu', this._onContextMenu);
      }
    }
  }

  /** Pointer lock on canvas click, only when not already locked. */
  _tryLock() {
    if (!this.enabled || !this.canvas) return;
    if (!this.isPointerLocked() && typeof this.canvas.requestPointerLock === 'function') {
      this.canvas.requestPointerLock();
    }
  }

  isPressed(code) {
    return this.enabled && this.keys.has(code);
  }

  isMouseDown(button) {
    return this.enabled && this.mouseButtons.get(button) === true;
  }

  /**
   * Return accumulated mouse deltas and reset them.
   * @returns {{x: number, y: number}}
   */
  consumeMouse() {
    const out = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  isPointerLocked() {
    if (!this.enabled) return false;
    const d = typeof document !== 'undefined' ? document : null;
    return !!(d && (d.pointerLockElement === this.canvas ||
      (this.domElement && d.pointerLockElement === this.domElement)));
  }

  /** Remove all listeners. Safe to call twice. */
  dispose() {
    if (!this.enabled) {
      this.enabled = false;
      return;
    }
    this.enabled = false;
    const w = window;
    w.removeEventListener('keydown', this._onKeyDown);
    w.removeEventListener('keyup', this._onKeyUp);
    w.removeEventListener('mousedown', this._onMouseDown);
    w.removeEventListener('mouseup', this._onMouseUp);
    w.removeEventListener('mousemove', this._onMouseMove);
    if (this.canvas && typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('contextmenu', this._onContextMenu);
    }
    this.keys.clear();
    this.mouseButtons.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}

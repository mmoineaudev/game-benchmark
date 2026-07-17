// ============================================================
// InputSystem — Keyboard + mouse/pointer mapping
// ============================================================
import Constants from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

class InputSystem {
  constructor() {
    this.keys = {};
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this._boundHandlers = new Map();
  }

  init() {
    // Keyboard events
    const onKeyDown = (e) => {
      this.keys[e.code] = true;
      EventBus.emit('input:keydown', e.code);
      e.preventDefault();
    };
    const onKeyUp = (e) => {
      this.keys[e.code] = false;
      EventBus.emit('input:keyup', e.code);
      e.preventDefault();
    };
    const onMouseMove = (e) => {
      // Normalized -1 to 1
      this.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
      EventBus.emit('input:mouse', { x: this.mouseX, y: this.mouseY });
    };
    const onMouseDown = (e) => {
      this.mouseDown = true;
      EventBus.emit('input:mouse_down', { button: e.button });
    };
    const onMouseUp = (e) => {
      this.mouseDown = false;
      EventBus.emit('input:mouse_up', { button: e.button });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
    });
  }

  /**
   * Check if a key is currently pressed
   */
  isPressed(code) {
    return !!this.keys[code];
  }

  /**
   * Check if the fire key is pressed (spacebar or mouse)
   */
  shouldFire() {
    return this.keys[Constants.INPUT.FIRE] || this.mouseDown;
  }

  /**
   * Get roll input (-1 to 1 from mouse X)
   */
  getRollInput() {
    return this.mouseX;
  }

  destroy() {
    const cleanup = this._boundHandlers.get('destroy');
    if (cleanup) cleanup();
    this._boundHandlers.clear();
    this.keys = {};
  }
}

export default InputSystem;

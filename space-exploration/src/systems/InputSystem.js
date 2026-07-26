// ============================================================
// InputSystem — Keyboard + mouse/pointer mapping
// AZERTY-safe: used e.code so bindings are layout-independent
// ============================================================
import Constants from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

class InputSystem {
  constructor() {
    this.keys = {};
    this.rawMouseX = 0;
    this.rawMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this._boundHandlers = new Map();
    this._invertY = false;
    this._contextMenu = null;
    this._mouseButtons = {};
  }

  setInvertY(v) {
    this._invertY = !!v;
  }

  init() {
    this.rawMouseX = 0;
    this.rawMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    const onKeyDown = (e) => {
      this.keys[e.code] = true;
      EventBus.emit('input:keydown', e.code);
      if (
        [
          'Space',
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'KeyW',
          'KeyA',
          'KeyS',
          'KeyD',
          'KeyQ',
          'KeyE',
          'KeyR',
          'KeyM',
          'KeyP',
          'KeyC',
          'KeyI',
          'KeyO',
          'KeyK',
          'KeyL',
          'KeyX',
          'KeyZ',
        ].includes(e.code)
      ) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      this.keys[e.code] = false;
      EventBus.emit('input:keyup', e.code);
    };
    const onMouseMove = (e) => {
      this.rawMouseX = (e.clientX / window.innerWidth) * 2 - 1;
      this.rawMouseY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onMouseDown = (e) => {
      EventBus.emit('input:mousedown', e);
      if (e.button === 2) {
        EventBus.emit('input:contextmenu', { x: e.clientX, y: e.clientY });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    this._onContextMenu = (e) => e.preventDefault();
    window.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('mousedown', onMouseDown);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('contextmenu', this._onContextMenu);
      window.removeEventListener('mousedown', onMouseDown);
    });
  }

  update(dt) {
    const lerp = 1 - Math.pow(0.0005, dt);
    this.mouseX += (this.rawMouseX - this.mouseX) * lerp;
    this.mouseY += (this.rawMouseY - this.mouseY) * lerp;
  }

  clearFrame() {
    this.keys = {};
  }

  isPressed(code) {
    return !!this.keys[code];
  }

  getForwardInput() {
    const up = this.isPressed('ArrowUp') ? 1 : 0;
    const z = this.isPressed('KeyZ') ? 1 : 0;
    return Math.max(-1, Math.min(1, up + z));
  }

  getBackwardInput() {
    const down = this.isPressed('ArrowDown') ? -1 : 0;
    const s = this.isPressed('KeyS') ? -0.6 : 0;
    return Math.max(-1, Math.min(1, down + s));
  }

  getStrafeInput() {
    const arrow = (this.isPressed('ArrowRight') ? 1 : 0) + (this.isPressed('ArrowLeft') ? -1 : 0);
    const q = this.isPressed('KeyQ') ? -1 : 0;
    const d = this.isPressed('KeyD') ? 1 : 0;
    return Math.max(-1, Math.min(1, arrow + q + d));
  }

  getVerticalInput() {
    const a = this.isPressed('KeyA') ? -1 : 0;
    const e = this.isPressed('KeyE') ? 1 : 0;
    return Math.max(-1, Math.min(1, a + e));
  }

  getYawInput() {
    return this.mouseX;
  }

  getPitchInput() {
    return this._invertY ? -this.mouseY : this.mouseY;
  }

  getRollInput() {
    return 0;
  }

  destroy() {
    const cleanup = this._boundHandlers.get('destroy');
    if (cleanup) cleanup();
    this._boundHandlers.clear();
    this.keys = {};
  }
}

export default InputSystem;

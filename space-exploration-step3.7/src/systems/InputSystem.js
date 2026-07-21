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
    this.mouseDown = false;
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

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);

    const onPointerDown = (e) => {
      this.mouseDown = true;
    };
    const onPointerUp = (e) => {
      this.mouseDown = false;
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
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

  getYawInput() {
    const q = this.isPressed('KeyQ') ? -1 : 0;
    const d = this.isPressed('KeyD') ? 1 : 0;
    const arrow = (this.isPressed('ArrowLeft') ? -1 : 0) + (this.isPressed('ArrowRight') ? 1 : 0);
    return Math.max(-1, Math.min(1, q + d + arrow));
  }

  getPitchInput() {
    const a = this.isPressed('KeyA') ? -1 : 0;
    const e = this.isPressed('KeyE') ? 1 : 0;
    const arrow = (this.isPressed('ArrowUp') ? 1 : 0) + (this.isPressed('ArrowDown') ? -1 : 0);
    return Math.max(-1, Math.min(1, a + e + arrow));
  }

  getThrustInput() {
    const shift = this.isPressed('ShiftLeft') || this.isPressed('ShiftRight') ? 1 : 0;
    const comma = this.isPressed('Comma') ? -1 : 0;
    const up = this.isPressed('ArrowUp') ? 1 : 0;
    const w = this.isPressed('KeyW') ? 1 : 0;
    return Math.max(-1, Math.min(1, shift + comma + up + w));
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

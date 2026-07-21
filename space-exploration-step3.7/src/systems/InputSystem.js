// ============================================================
// InputSystem — Mouse orientation + click thrust/brake
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
    this.thrust = false;
    this.brake = false;
    this._boundHandlers = new Map();
  }

  init() {
    this.rawMouseX = 0;
    this.rawMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.thrust = false;
    this.brake = false;

    const onKeyDown = (e) => {
      this.keys[e.code] = true;
      EventBus.emit('input:keydown', e.code);
      if (
        [
          'Space',
          'KeyR',
          'KeyM',
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
    const onPointerDown = (e) => {
      if (e.button === 0) this.thrust = true;
      if (e.button === 2) this.brake = true;
    };
    const onPointerUp = (e) => {
      if (e.button === 0) this.thrust = false;
      if (e.button === 2) this.brake = false;
    };
    const onWheel = (e) => {
      EventBus.emit('camera:zoom', -Math.sign(e.deltaY) * Constants.CAMERA.ZOOM_STEP);
    };
    const onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('contextmenu', onContextMenu);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
    });
  }

  update(dt) {
    const lerp = 1 - Math.pow(0.0005, dt);
    this.mouseX += (this.rawMouseX - this.mouseX) * lerp;
    this.mouseY += (this.rawMouseY - this.mouseY) * lerp;
  }

  isPressed(code) {
    return !!this.keys[code];
  }

  destroy() {
    const cleanup = this._boundHandlers.get('destroy');
    if (cleanup) cleanup();
    this._boundHandlers.clear();
    this.keys = {};
  }
}

export default InputSystem;

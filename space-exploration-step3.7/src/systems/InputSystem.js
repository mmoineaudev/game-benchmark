// ============================================================
// InputSystem — Mouse orientation + click thrust/brake
// ============================================================
import Constants from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

const SENSITIVITY = 2.4;

class InputSystem {
  constructor() {
    this.keys = {};
    this.rawMouseX = 0;
    this.rawMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.thrust = false;
    this.brake = false;
    this.pointerLocked = false;
    this._boundHandlers = new Map();
  }

  init() {
    this.keys = {};
    this.rawMouseX = 0;
    this.rawMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.thrust = false;
    this.brake = false;
    this.pointerLocked = false;

    const onKeyDown = (e) => {
      this.keys[e.code] = true;
      EventBus.emit('input:keydown', e.code);
      if (['Space', 'KeyR', 'KeyM'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e) => {
      this.keys[e.code] = false;
      EventBus.emit('input:keyup', e.code);
    };
    const onMouseMove = (e) => {
      if (document.pointerLockElement) {
        const nx = e.movementX / window.innerWidth;
        const ny = e.movementY / window.innerHeight;
        this.mouseX = Math.max(-1, Math.min(1, nx * SENSITIVITY));
        this.mouseY = Math.max(-1, Math.min(1, -ny * SENSITIVITY));
      } else {
        const x = (e.clientX / window.innerWidth) * 2 - 1;
        const y = (e.clientY / window.innerHeight) * 2 - 1;
        const lerp = 1 - Math.pow(0.0005, 1 / 60);
        this.rawMouseX += (x - this.rawMouseX) * lerp;
        this.rawMouseY += (y - this.rawMouseY) * lerp;
        this.mouseX = Math.max(-1, Math.min(1, this.rawMouseX * SENSITIVITY));
        this.mouseY = Math.max(-1, Math.min(1, -this.rawMouseY * SENSITIVITY));
      }
    };
    const onPointerDown = (e) => {
      if (e.button === 0) {
        this.thrust = true;
        if (!document.pointerLockElement) {
          document.body.requestPointerLock?.().catch(() => {});
        }
      }
      if (e.button === 2) this.brake = true;
    };
    const onPointerUp = (e) => {
      if (e.button === 0) this.thrust = false;
      if (e.button === 2) this.brake = false;
    };
    const onPointerLockChange = () => {
      this.pointerLocked = !!document.pointerLockElement;
    };
    const onWheel = (e) => {
      EventBus.emit('camera:zoom', -Math.sign(e.deltaY) * Constants.CAMERA.ZOOM_STEP);
    };
    const onContextMenu = (e) => e.preventDefault();

    window.addEventListener('mousemove', onMouseMove);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('contextmenu', onContextMenu);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
    });
  }

  update(dt) {
    // values are already continuous rates in [-1, 1].
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

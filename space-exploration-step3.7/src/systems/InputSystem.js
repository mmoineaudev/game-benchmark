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
    this.pointerLocked = false;
    this._steerX = 0;
    this._steerY = 0;
    this._boundHandlers = new Map();
  }

  init() {
    this.rawMouseX = 0;
    this.rawMouseY = 0;
    this.mouseX = 0;
    this.mouseY = 0;
    this.thrust = false;
    this.brake = false;
    this.pointerLocked = false;
    this._steerX = 0;
    this._steerY = 0;

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
      if (document.pointerLockElement) {
        const sens = 0.008;
        this._steerX = Math.max(-1, Math.min(1, this._steerX + e.movementX * sens));
        this._steerY = Math.max(-1, Math.min(1, this._steerY + e.movementY * sens));
      } else {
        this.rawMouseX = (e.clientX / window.innerWidth) * 2 - 1;
        this.rawMouseY = (e.clientY / window.innerHeight) * 2 - 1;
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
      if (!this.pointerLocked) {
        this._steerX = 0;
        this._steerY = 0;
      }
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
    window.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('contextmenu', onContextMenu);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('contextmenu', onContextMenu);
    });
  }

  update(dt) {
    if (document.pointerLockElement) {
      this.mouseX = this._steerX;
      this.mouseY = this._steerY;
    } else {
      const lerp = 1 - Math.pow(0.0005, dt);
      this.mouseX += (this.rawMouseX - this.mouseX) * lerp;
      this.mouseY += (this.rawMouseY - this.mouseY) * lerp;
    }
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

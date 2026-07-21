// ============================================================
// InputSystem — Arrow orientation + Shift/Space/F
// ============================================================
import Constants from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

class InputSystem {
  constructor() {
    this.keys = {};
    this.thrust = false;
    this.brake = false;
    this._boundHandlers = new Map();
  }

  init() {
    this.keys = {};
    this.thrust = false;
    this.brake = false;

    const onKeyDown = (e) => {
      this.keys[e.code] = true;
      EventBus.emit('input:keydown', e.code);
      if (['Space', 'KeyR', 'KeyM'].includes(e.code)) e.preventDefault();
    };
    const onKeyUp = (e) => {
      this.keys[e.code] = false;
      EventBus.emit('input:keyup', e.code);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    this._boundHandlers.set('destroy', () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    });
  }

  update(dt) {
    this.thrust = !!this.keys[Constants.INPUT.FORWARD];
    this.brake = !!this.keys[Constants.INPUT.BACKWARD];
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

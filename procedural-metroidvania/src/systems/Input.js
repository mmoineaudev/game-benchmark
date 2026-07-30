import { KEYS, LOG } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

/**
 * Input system — tracks held keys by event.code (AZERTY + QWERTY compatible).
 * No event.key usage anywhere.
 */
export default class Input {
  constructor() {
    this._keys = new Set();
    this._justPressed = new Set();  // cleared each frame
    this._justReleased = new Set();
    this._bound = {};
  }

  init() {
    const kd = (this._bound.keydown = (e) => {
      if (e.repeat) return;
      if (!this._keys.has(e.code)) {
        this._justPressed.add(e.code);
      }
      this._keys.add(e.code);
      // Prevent browser defaults for game keys
      if ([KEYS.JUMP, KEYS.JUMP_ALT, KEYS.DASH, KEYS.LEFT, KEYS.RIGHT].includes(e.code)) {
        e.preventDefault();
      }
    });
    const ku = (this._bound.keyup = (e) => {
      this._keys.delete(e.code);
      this._justReleased.add(e.code);
    });
    const blur = (this._bound.blur = () => {
      this._keys.clear();
    });

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    LOG('Input', 'Initialized (event.code bindings)');
  }

  update() {
    this._justPressed.clear();
    this._justReleased.clear();
  }

  /** Is the key currently held? */
  held(code) { return this._keys.has(code); }

  /** Was the key just pressed this frame? */
  pressed(code) { return this._justPressed.has(code); }

  /** Was the key just released this frame? */
  released(code) { return this._justReleased.has(code); }

  // ── semantic helpers ─────────────────────────────────────────────────────
  get left()  { return this.held(KEYS.LEFT) || this.held('ArrowLeft'); }
  get right() { return this.held(KEYS.RIGHT) || this.held('ArrowRight'); }
  get jumpPressed() { return this.pressed(KEYS.JUMP) || this.pressed(KEYS.JUMP_ALT); }
  get jumpHeld()    { return this.held(KEYS.JUMP) || this.held(KEYS.JUMP_ALT); }
  get dashPressed() { return this.pressed(KEYS.DASH); }
  get attackPressed() { return this.pressed(KEYS.ATTACK) || this.pressed('KeyJ'); }
  get mapPressed()  { return this.pressed(KEYS.MAP); }

  reset() {
    this._keys.clear();
    this._justPressed.clear();
    this._justReleased.clear();
  }

  destroy() {
    window.removeEventListener('keydown', this._bound.keydown);
    window.removeEventListener('keyup', this._bound.keyup);
    window.removeEventListener('blur', this._bound.blur);
    this.reset();
  }
}

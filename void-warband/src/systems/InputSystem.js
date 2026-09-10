/**
 * InputSystem.js — singleton input state.
 * All binds are `event.code` (AZERTY-safe).
 *
 * Keys: isDown / justPressed / justPressedAny (one-frame, cleared in update()).
 * Mouse: the cursor is the crosshair (ship steers toward it in NORMAL mode;
 *        TURRET mode free-aims the camera at the cursor — no pointer lock,
 *        the crosshair follows the visible cursor in both modes).
 * Wheel: scroll up = accelerate (+throttle), scroll down = brake.
 * Buttons: 0 LMB, 1 MMB (camera free-look + aim-fire), 2 RMB.
 * Space + arrows preventDefault.
 */

/** Codes that must not scroll/page the browser. */
const PREVENT_DEFAULT_CODES = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

class _InputSystem {
  constructor() {
    /** @type {Set<string>} currently held `event.code`s. */
    this._down = new Set();
    /** @type {Set<string>} codes pressed this frame (cleared in update()). */
    this._pressed = new Set();
    /** Accumulated pointer delta since last consume, px. */
    this._mouseDX = 0;
    this._mouseDY = 0;
    /** Accumulated wheel deltaY since last consume (clamped to ±1 notch). */
    this._wheelAccel = 0;
    /** @type {Set<number>} currently held mouse buttons. */
    this._mouseButtons = new Set();
    /** @type {Set<number>} buttons pressed this frame (cleared in update()). */
    this._mousePressed = new Set();
    /** Last cursor CSS px position (0,0 until first move). */
    this.mouseX = 0;
    this.mouseY = 0;
    /** performance.now() of the last real mouse move (drives steer-vs-straight). */
    this.lastMoveTime = 0;
    /** Cursor in NDC (x∈[-1,1], y∈[-1,1]); NaN until first move. */
    this.ndcX = 0;
    this.ndcY = 0;
    /** Previous cursor pos (delta tracking). */
    this._px = null;
    this._py = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  /**
   * Attach all window/document listeners. Idempotent.
   */
  attach() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('blur', this._onBlur);
  }

  /** Detach all listeners. */
  detach() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('blur', this._onBlur);
  }

  // -- Keys ------------------------------------------------------------------

  /**
   * Is the key held right now?
   * @param {string} code `event.code`, e.g. 'KeyA'.
   */
  isDown(code) {
    return this._down.has(code);
  }

  /**
   * Was the key first pressed this frame (repeat keydowns ignored)?
   * @param {string} code
   */
  justPressed(code) {
    return this._pressed.has(code);
  }

  /**
   * Was any of the given codes first pressed this frame?
   * @param {string[]} codes
   */
  justPressedAny(codes) {
    for (const code of codes) {
      if (this._pressed.has(code)) return true;
    }
    return false;
  }

  // -- Mouse -----------------------------------------------------------------

  /**
   * Consume accumulated pointer delta (px) since last call.
   * @returns {{dx: number, dy: number}}
   */
  consumeMouseDelta() {
    const delta = { dx: this._mouseDX, dy: this._mouseDY };
    this._mouseDX = 0;
    this._mouseDY = 0;
    return delta;
  }

  /**
   * Is a mouse button held right now?
   * @param {number} button 0 = LMB, 1 = MMB, 2 = RMB.
   * @returns {boolean}
   */
  isMouseDown(button) {
    return this._mouseButtons.has(button);
  }

  /**
   * Was this mouse button first pressed this frame? (One-frame flag, cleared
   * in update(). Used for tap-actions: MMB = IEM burst, RMB = missiles.)
   * @param {number} button 0 = LMB, 1 = MMB, 2 = RMB.
   */
  justPressedMouse(button) {
    return this._mousePressed.has(button);
  }

  /**
   * Consume a pending key press (remove its one-frame flag). Used by the
   * trade-menu close handler: while the sim is paused, press flags accumulate
   * unpurged, so the closing H press would otherwise be re-read by the
   * flight loop the frame after unpause — instantly reopening the menu.
   * @param {string} code
   */
  consumePress(code) {
    this._pressed.delete(code);
  }

  // -- Wheel -----------------------------------------------------------------

  /**
   * Consume accumulated wheel deltaY since last call, clamped to ±1 notch so a
   * fast spin doesn't overshoot. Sign: scroll up (away) = -deltaY = accelerate.
   * @returns {number} -1..1
   */
  consumeWheel() {
    const v = Math.max(-1, Math.min(1, this._wheelAccel / 100));
    this._wheelAccel = 0;
    return v;
  }

  // -- Frame -----------------------------------------------------------------

  /**
   * End-of-frame: clear one-frame press flags. Called from Game loop.
   */
  update() {
    this._pressed.clear();
    this._mousePressed.clear();
  }

  /**
   * Hard reset (restart, SPEC §11): no keys held, no pending presses,
   * zero accumulators.
   */
  reset() {
    this._down.clear();
    this._pressed.clear();
    this._mouseDX = 0;
    this._mouseDY = 0;
    this._wheelAccel = 0;
    this._mouseButtons.clear();
    this._mousePressed.clear();
  }

  // -- Handlers ----------------------------------------------------------------

  _onKeyDown(e) {
    if (PREVENT_DEFAULT_CODES.has(e.code)) e.preventDefault();
    if (e.repeat) return; // first keydown only
    this._down.add(e.code);
    this._pressed.add(e.code);
    // Help (F1) reuses the pause menu (same controls table) — toggle here so
    // Game sees justPressed('F1') too and can pause the sim with it.
    if (e.code === 'F1') e.preventDefault();
  }

  _onKeyUp(e) {
    this._down.delete(e.code);
  }

  _onMouseDown(e) {
    this._mouseButtons.add(e.button);
    this._mousePressed.add(e.button);
    // No pointer lock: the cursor is the crosshair and must stay visible.
  }

  _onMouseMove(e) {
    // Track screen position + deltas ALWAYS (visible cursor, no pointer lock).
    const x = e.clientX;
    const y = e.clientY;
    if (this._px !== null && this._py !== null) {
      this._mouseDX += x - this._px;
      this._mouseDY += y - this._py;
    }
    this._px = x;
    this._py = y;
    this.mouseX = x;
    this.mouseY = y;
    this.lastMoveTime = performance.now();
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w && h) {
      this.ndcX = (x / w) * 2 - 1;
      this.ndcY = -(y / h) * 2 + 1;
    }
  }

  _onMouseUp(e) {
    this._mouseButtons.delete(e.button);
  }

  _onWheel(e) {
    e.preventDefault();
    // Scroll down (deltaY>0) = brake; scroll up = accelerate. Ship reads sign.
    this._wheelAccel += e.deltaY;
  }

  /** Losing focus: drop all held keys + mouse buttons so nothing sticks. */
  _onBlur() {
    this._down.clear();
    this._pressed.clear();
    this._mouseButtons.clear();
    this._mousePressed.clear();
    this._px = null;
    this._py = null;
  }
}

/** Singleton input system. */
export const InputSystem = new _InputSystem();

export default InputSystem;

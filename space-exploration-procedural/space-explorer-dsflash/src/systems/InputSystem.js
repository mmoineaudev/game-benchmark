// Input: event.code keyboard + mouse/pointer mapping + touch (spec §2).
// AZERTY labels -> physical codes: Z=KeyW, Q=KeyA, S=KeyS, D=KeyD, A=KeyQ, E=KeyE.
import { eventBus, Events } from '../core/EventBus.js';
import { Constants } from '../core/Constants.js';

export class InputSystem {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pointerLocked = false;

    // Per-frame accumulators
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.throttleDelta = 0;   // scroll wheel: positive = increase throttle
    this.pitchUp = false;     // S / ArrowDown — climb
    this.pitchDown = false;   // Z / ArrowUp — dive
    this.left = false;
    this.right = false;
    this.rollLeft = false;
    this.rollRight = false;
    this.thrustHeld = false;

    // Edge-triggered flags (consumed by Game each frame)
    this.firePressed = false;
    this.shieldPressed = false;
    this.pausePressed = false;
    this.mutePressed = false;
    this.restartPressed = false;
    this.ladderChartPressed = false; // C — ladder chart overlay
    this.lightProfilePressed = false; // L — LightManager profile toggle
    this.pointerClicked = false;

    // Touch state
    this.touchMove = { x: 0, y: 0 };
    this.touchLook = { x: 0, y: 0 };
    this.touchRoll = 0;
    this._touchLookActive = false;

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (e.code === 'Space') e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      if (e.code === 'Space') { e.preventDefault(); this.firePressed = true; }
      if (e.code === 'Escape') this.pausePressed = true;
      if (e.code === 'KeyM') this.mutePressed = true;
      if (e.code === 'KeyR') this.restartPressed = true;
      if (e.code === 'KeyC') this.ladderChartPressed = true;
      if (e.code === 'KeyL') this.lightProfilePressed = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => this.keys.clear());

    // Pointer lock: click canvas to capture
    this.dom.addEventListener('click', () => {
      this.pointerClicked = true;
      if (!this.pointerLocked) {
        this.dom.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        this.yawDelta += e.movementX;
        this.pitchDelta += e.movementY;
      }
    });
    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.pointerLocked) this.firePressed = true;
      if (e.button === 2 && this.pointerLocked) this.shieldPressed = true;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    eventBus.on('input:shield', (e) => {
      if (e.active) this.shieldPressed = true;
    });

    // Scroll wheel = throttle 0-100% (scroll up = more thrust)
    window.addEventListener('wheel', (e) => {
      this.throttleDelta += -e.deltaY;
    }, { passive: true });

    // Touch controls
    this._touchState = { moveId: null, lookId: null, moveStart: null, lookStart: null, lastLook: null, lastMove: null };
    this.dom.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.dom.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.dom.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    this.dom.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
  }

  _onTouchStart(e) {
    e.preventDefault();
    const ts = this._touchState;
    for (const t of e.changedTouches) {
      const isLeft = t.clientX < window.innerWidth / 2;
      if (isLeft && ts.moveId === null) {
        ts.moveId = t.identifier;
        ts.moveStart = { x: t.clientX, y: t.clientY };
        ts.lastMove = { x: t.clientX, y: t.clientY };
      } else if (!isLeft && ts.lookId === null) {
        ts.lookId = t.identifier;
        ts.lookStart = { x: t.clientX, y: t.clientY };
        ts.lastLook = { x: t.clientX, y: t.clientY };
      }
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    const ts = this._touchState;
    for (const t of e.changedTouches) {
      if (t.identifier === ts.moveId && ts.moveStart) {
        const dx = (t.clientX - ts.moveStart.x) / 60;
        const dy = (t.clientY - ts.moveStart.y) / 60;
        this.touchMove.x = Math.max(-1, Math.min(1, dx));
        this.touchMove.y = Math.max(-1, Math.min(1, dy));
        ts.lastMove = { x: t.clientX, y: t.clientY };
      } else if (t.identifier === ts.lookId && ts.lastLook) {
        this.touchLook.x += (t.clientX - ts.lastLook.x) * 0.35;
        this.touchLook.y += (t.clientY - ts.lastLook.y) * 0.35;
        ts.lastLook = { x: t.clientX, y: t.clientY };
        this._touchLookActive = true;
      }
    }
    // Two-finger swipe = roll
    if (e.touches.length === 2) {
      const [a, b] = e.touches;
      const dx = (a.clientX + b.clientX) / 2 - (ts._pinchCenter?.x ?? (a.clientX + b.clientX) / 2);
      if (ts._pinchCenter) this.touchRoll = dx * 0.02;
      ts._pinchCenter = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    }
  }

  _onTouchEnd(e) {
    e.preventDefault();
    const ts = this._touchState;
    for (const t of e.changedTouches) {
      if (t.identifier === ts.moveId) {
        ts.moveId = null;
        ts.moveStart = null;
        ts.lastMove = null;
        this.touchMove.x = 0;
        this.touchMove.y = 0;
      } else if (t.identifier === ts.lookId) {
        ts.lookId = null;
        ts.lookStart = null;
        ts.lastLook = null;
        this._touchLookActive = false;
        // Tap on right half = fire
        const dist = Math.hypot(t.clientX - (ts.lookStart?.x ?? t.clientX), t.clientY - (ts.lookStart?.y ?? t.clientY));
        if (dist < 12) this.firePressed = true;
      }
    }
    if (e.touches.length < 2) {
      ts._pinchCenter = null;
      this.touchRoll = 0;
    }
  }

  /** Poll keyboard state into per-frame flags. */
  update(dt) {
    const k = this.keys;
    this.pitchUp = k.has('KeyS') || k.has('ArrowDown');
    this.pitchDown = k.has('KeyW') || k.has('ArrowUp');
    this.left = k.has('KeyA') || k.has('ArrowLeft');
    this.right = k.has('KeyD') || k.has('ArrowRight');
    this.rollLeft = k.has('KeyQ');
    this.rollRight = k.has('KeyE');
    this.thrustHeld = this.pitchUp || this.pitchDown || this.left || this.right;
  }

  /** Consume one frame's worth of edge-triggered input. */
  consumeFrame() {
    const frame = {
      firePressed: this.firePressed,
      shieldPressed: this.shieldPressed,
      pausePressed: this.pausePressed,
      mutePressed: this.mutePressed,
      restartPressed: this.restartPressed,
      ladderChartPressed: this.ladderChartPressed,
      lightProfilePressed: this.lightProfilePressed,
      pointerClicked: this.pointerClicked,
      yawDelta: this.yawDelta,
      pitchDelta: this.pitchDelta,
      throttleDelta: this.throttleDelta,
      touchLook: this._touchLookActive ? { x: this.touchLook.x, y: this.touchLook.y } : null,
    };
    this.firePressed = false;
    this.shieldPressed = false;
    this.pausePressed = false;
    this.mutePressed = false;
    this.restartPressed = false;
    this.ladderChartPressed = false;
    this.lightProfilePressed = false;
    this.pointerClicked = false;
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.throttleDelta = 0;
    this.touchLook.x = 0;
    this.touchLook.y = 0;
    this.touchRoll = 0;
    return frame;
  }

  get movement() {
    return {
      pitchUp: this.pitchUp,
      pitchDown: this.pitchDown,
      left: this.left,
      right: this.right,
      rollLeft: this.rollLeft,
      rollRight: this.rollRight,
    };
  }
}

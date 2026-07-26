// Keyboard input manager — event.code for AZERTY/QWERTY compatibility
class Input {
  constructor() {
    this._pressed = {};
    this._justPressedMap = {};
    this._init();
  }

  _init() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!this._pressed[e.code]) {
        this._justPressedMap[e.code] = true;
      }
      this._pressed[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this._pressed[e.code] = false;
    });
    window.addEventListener('blur', () => {
      this._pressed = {};
    });
  }

  isDown(code) {
    return !!this._pressed[code];
  }

  justPressed(code) {
    return !!this._justPressedMap[code];
  }

  // Call once per frame after processing just-pressed actions
  update() {
    this._justPressedMap = {};
  }

  // Helper: wasd direction as {x, z} normalized
  getWASD() {
    let x = 0, z = 0;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1;
    // Normalize for diagonal
    if (x !== 0 && z !== 0) {
      const inv = 0.7071;
      x *= inv;
      z *= inv;
    }
    return { x, z };
  }
}

export const input = new Input();

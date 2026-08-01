import * as THREE from 'three';
import { GRID_COLS, GRID_ROWS } from '../core/Constants.js';

export default class InputSystem {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this._keys = new Set();
    this._mouse = { x: 0, y: 0, buttons: 0 };
    // Camera pan offset (world units) — driven by middle-drag
    this._pan = { x: 0, z: 0 };
    this._midMouse = false;
    this._prev = { x: 0, y: 0 };
    window.addEventListener('keydown', (e) => this._onKey(e, true));
    window.addEventListener('keyup', (e) => this._onKey(e, false));
    dom.addEventListener('mousemove', (e) => this._onMouseMove(e));
    dom.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mouseup', (e) => this._onMouseUp(e));
    dom.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  update() {
    // Pan is applied to the camera by RenderSystem each frame.
  }
  _onKey(e, down) { if (down) this._keys.add(e.code); else this._keys.delete(e.code); if (e.code === 'Space') e.preventDefault(); }
  _onMouseMove(e) {
    const rect = this.dom.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
    this._mouse.y = -((e.clientY - rect.top)/rect.height)*2 + 1;
    if (this._midMouse) {
      // Content follows the drag: camera moves opposite to the mouse delta.
      const scale = this._worldPerPixel();
      this._pan.x -= (e.clientX - this._prev.x) * scale;
      this._pan.z -= (e.clientY - this._prev.y) * scale;
      this._clampPan();
    }
    this._prev = { x: e.clientX, y: e.clientY };
  }
  /** World units per screen pixel at the current top-down camera height. */
  _worldPerPixel() {
    const cam = this.camera;
    const halfFov = (cam.fov * Math.PI / 180) / 2;
    const worldH = 2 * cam.position.y * Math.tan(halfFov);
    return worldH / window.innerHeight;
  }
  /** Keep the map reachable but not pannable into empty space. */
  _clampPan() {
    const maxX = GRID_COLS * 0.5 - 2;
    const maxZ = GRID_ROWS * 0.5 - 2;
    this._pan.x = Math.max(-maxX, Math.min(maxX, this._pan.x));
    this._pan.z = Math.max(-maxZ, Math.min(maxZ, this._pan.z));
  }
  _onMouseDown(e) {
    this._mouse.buttons = e.buttons;
    // Seed the drag baseline so the first delta is correct even if no
    // mousemove was ever received before the press.
    this._prev = { x: e.clientX, y: e.clientY };
    if (e.button === 1) { this._midMouse = true; e.preventDefault(); }
  }
  _onMouseUp(e) {
    this._mouse.buttons = e.buttons;
    if (e.button === 1) this._midMouse = false;
  }
  _onWheel(e) {
    e.preventDefault();
  }
  get pointer() { return new THREE.Vector2(this._mouse.x, this._mouse.y); }
  get leftClick() { return this._mouse.buttons === 1; }
  get middleDrag() { return this._midMouse; }
  get pan() { return this._pan; }
}

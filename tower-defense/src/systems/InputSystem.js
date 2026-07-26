import * as THREE from 'three';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from '../core/Constants.js';

export default class InputSystem {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this._keys = new Set();
    this._mouse = { x: 0, y: 0, buttons: 0 };
    this._pan = { x: this.camera.position.x, z: this.camera.position.z, y: this.camera.position.y, zoom: this.camera.position.clone() };
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
  update(dt, state, camera, dom) {
    // Camera locked by RenderSystem — no pan/zoom
  }
  _onKey(e, down) { if (down) this._keys.add(e.code); else this._keys.delete(e.code); if (e.code === 'Space') e.preventDefault(); }
  _onMouseMove(e) {
    const rect = this.dom.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left)/rect.width)*2 - 1;
    this._mouse.y = -((e.clientY - rect.top)/rect.height)*2 + 1;
    if (this._midMouse) {
      const dx = (e.clientX - this._prev.x) * 0.05;
      const dy = (e.clientY - this._prev.y) * 0.05;
      this._pan.x -= dx;
      this._pan.z += dy;
    }
    this._prev = { x: e.clientX, y: e.clientY };
  }
  _onMouseDown(e) {
    this._mouse.buttons = e.buttons;
    if (e.button === 1) { this._midMouse = true; e.preventDefault(); }
  }
  _onMouseUp(e) {
    this._mouse.buttons = e.buttons;
    if (e.button === 1) this._midMouse = false;
  }
  _onWheel(e) {
    e.preventDefault();
    this._pan.y += Math.sign(e.deltaY) * this._pan.y * 0.08;
  }
  get pointer() { return new THREE.Vector2(this._mouse.x, this._mouse.y); }
  get leftClick() { return this._mouse.buttons === 1; }
  get middleDrag() { return this._midMouse; }
}

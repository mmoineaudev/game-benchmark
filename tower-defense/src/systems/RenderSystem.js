import * as THREE from 'three';
import { GRID_COLS, GRID_ROWS, TILE_SIZE, CAMERA } from '../core/Constants.js';

export default class RenderSystem {
  constructor() {
    this.dom = document.getElementById('gameCanvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.dom, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060d);
    this.scene.fog = new THREE.FogExp2(0x05060d, 0.00008);
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, CAMERA.near, CAMERA.far);
    // Pan offset (world units) applied on top of the fitted base view
    this.pan = { x: 0, z: 0 };
    this._basePos = new THREE.Vector3();
    this._baseLook = new THREE.Vector3();
    this._setupLights();
    this._fitCamera();
    window.addEventListener('resize', () => this._resize());
  }
  init() {}

  /** Compute camera Y so the full grid is always visible. */
  _fitCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const halfFov = (this.camera.fov * Math.PI / 180) / 2;
    const gridCx = GRID_COLS * TILE_SIZE / 2;
    const gridCz = GRID_ROWS * TILE_SIZE / 2;
    const halfH = GRID_ROWS * TILE_SIZE / 2;   // 20
    const halfW = GRID_COLS * TILE_SIZE / 2;   // 28
    // Y needed to fit height: h / tan(halfFov)
    // Y needed to fit width:  w / (tan(halfFov) * aspect)
    const yForHeight = halfH / Math.tan(halfFov);
    const yForWidth = halfW / (Math.tan(halfFov) * aspect);
    const y = Math.max(yForHeight, yForWidth) * 1.12; // +12% margin
    this._basePos.set(gridCx, y, gridCz);
    this._baseLook.set(gridCx, 0, gridCz);
    this._applyPan();
  }

  /** Set the pan offset and reposition the camera. */
  applyPan(x, z) {
    this.pan.x = x;
    this.pan.z = z;
    this._applyPan();
  }

  _applyPan() {
    this.camera.position.set(this._basePos.x + this.pan.x, this._basePos.y, this._basePos.z + this.pan.z);
    this.camera.lookAt(this._baseLook.x + this.pan.x, this._baseLook.y, this._baseLook.z + this.pan.z);
  }

  _setupLights() {
    const ambient = new THREE.AmbientLight(0x1a2035, 0.4);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0x4455aa, 0.6);
    dir.position.set(20, 30, 10);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x223344, 0.3);
    fill.position.set(-15, 20, -10);
    this.scene.add(fill);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._fitCamera();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
    document.getElementById('gameCanvas')?.remove();
  }
}
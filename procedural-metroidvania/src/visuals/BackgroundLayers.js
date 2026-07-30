import * as THREE from 'three';
import { VISUAL, LAYERS, LOG } from '../core/Constants.js';

/**
 * BackgroundLayers — multi-layer parallax scenery.
 * Layers: starfield (deepest), nebula blobs, floating crystals, near debris.
 */
export default class BackgroundLayers {
  constructor(scene) {
    this._scene = scene;
    this._layers = [];
    this._starfield = null;
    LOG('BackgroundLayers', 'Initialized');
  }

  init() {
    this._layers = [];

    // ── Layer 0: Starfield (deepest, static twinkling dots) ──────────────
    this._initStarfield();

    // ── Layer 1: Nebula blobs (large semi-transparent shapes) ────────────
    this._initNebulaLayer(LAYERS.BG_FAR, 8, 0.12, 0x111133);

    // ── Layer 2: Floating crystal shapes ─────────────────────────────────
    this._initCrystalLayer(LAYERS.BG_MID, 10, 0.18, 0x1a1a3a);

    // ── Layer 3: Near debris / rocks ────────────────────────────────────
    this._initNearLayer(LAYERS.BG_NEAR, 8, 0.25, 0x223355);

    LOG('BackgroundLayers', `Initialized ${this._layers.length} layers + starfield`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STARFIELD — hundreds of tiny twinkling points
  // ═══════════════════════════════════════════════════════════════════════
  _initStarfield() {
    const count = 200;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const spread = 80;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 0.6;
      positions[i * 3 + 2] = LAYERS.BG_SKY;
      sizes[i] = 0.02 + Math.random() * 0.06;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(4, 4, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);

    const mat = new THREE.PointsMaterial({
      color: 0x8899cc,
      size: 0.12,
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.6,
    });

    this._starfield = new THREE.Points(geo, mat);
    this._starfield.name = '_starfield';
    this._starfield.frustumCulled = false;
    this._scene.add(this._starfield);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NEBULA — large semi-transparent floating blobs
  // ═══════════════════════════════════════════════════════════════════════
  _initNebulaLayer(z, count, alpha, color) {
    const shapes = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 70;
      const y = (Math.random() - 0.5) * 35;
      const size = 1.5 + Math.random() * 4;

      // Irregular blob: icosahedron with random vertex displacement
      const geo = new THREE.IcosahedronGeometry(size, 0);
      // Slightly flatten
      const pos = geo.attributes.position;
      for (let j = 0; j < pos.count; j++) {
        pos.setY(j, pos.getY(j) * 0.4 + (Math.random() - 0.5) * size * 0.3);
      }
      geo.computeVertexNormals();

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: alpha,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.userData = { baseX: x, baseY: y, speedMult: 0.12 };
      this._scene.add(mesh);
      shapes.push(mesh);
    }
    this._layers.push({ z, shapes, speed: 0.12 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CRYSTALS — diamond/octahedron shapes floating in background
  // ═══════════════════════════════════════════════════════════════════════
  _initCrystalLayer(z, count, alpha, color) {
    const shapes = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 55;
      const y = (Math.random() - 0.5) * 28;
      const size = 0.3 + Math.random() * 0.8;

      const geo = new THREE.OctahedronGeometry(size, 0);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: alpha,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.userData = {
        baseX: x,
        baseY: y,
        speedMult: 0.25,
        rotSpeed: 0.1 + Math.random() * 0.3,
      };
      this._scene.add(mesh);
      shapes.push(mesh);
    }
    this._layers.push({ z, shapes, speed: 0.25 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NEAR — rock debris floating close to player
  // ═══════════════════════════════════════════════════════════════════════
  _initNearLayer(z, count, alpha, color) {
    const shapes = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 35;
      const y = (Math.random() - 0.5) * 18;
      const size = 0.15 + Math.random() * 0.4;

      // Dodecahedron for rocky look
      const geo = new THREE.DodecahedronGeometry(size, 0);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: alpha,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      mesh.userData = {
        baseX: x,
        baseY: y,
        speedMult: 0.45,
        rotSpeed: 0.2 + Math.random() * 0.5,
      };
      this._scene.add(mesh);
      shapes.push(mesh);
    }
    this._layers.push({ z, shapes, speed: 0.45 });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UPDATE — parallax drift + twinkle
  // ═══════════════════════════════════════════════════════════════════════
  update(dt, camX, camY) {
    // Starfield twinkle (update opacity)
    if (this._starfield?.material) {
      this._starfield.material.opacity = 0.4 + Math.sin(performance.now() / 2000) * 0.2;
    }

    // Parallax layers
    for (const layer of this._layers) {
      for (const shape of layer.shapes) {
        const ud = shape.userData;
        const px = ud.baseX - camX * ud.speedMult;
        const py = ud.baseY - camY * ud.speedMult * 0.6;
        shape.position.x = px;
        shape.position.y = py;

        // Slow rotation for crystals / rocks
        if (ud.rotSpeed) {
          shape.rotation.x += ud.rotSpeed * dt;
          shape.rotation.y += ud.rotSpeed * 0.7 * dt;
        }

        // Wrap around
        if (Math.abs(px - camX) > 45) {
          ud.baseX += (px > camX ? -65 : 65);
        }
        if (Math.abs(py - camY) > 20) {
          ud.baseY += (py > camY ? -30 : 30);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  dispose() {
    if (this._starfield) {
      this._scene.remove(this._starfield);
      this._starfield.geometry.dispose();
      this._starfield.material.dispose();
      if (this._starfield.material.map) this._starfield.material.map.dispose();
    }
    for (const layer of this._layers) {
      for (const shape of layer.shapes) {
        this._scene.remove(shape);
        shape.geometry.dispose();
        shape.material.dispose();
      }
    }
    this._layers.length = 0;
    LOG('BackgroundLayers', 'Disposed');
  }
}

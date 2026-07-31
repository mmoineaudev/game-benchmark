import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';
import { DISK_VERTEX, DISK_FRAGMENT, softDotTexture } from '../utils/ShaderHelpers.js';

// Black holes: gravity well, accretion disk, consumption (spec §6.7, §5.12).
export class BlackHoleSystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.holes = [];
    this._group = new THREE.Group();
    this._group.name = 'blackHoles';
    scene.add(this._group);

    this._flashTex = softDotTexture();
  }

  spawnChunk(chunk, rng, biomeCfg, mult) {
    const pct = biomeCfg.blackHoleDensity;
    if (pct <= 0) { chunk.blackHoles = []; return; }
    if (rng() * 100 >= pct) { chunk.blackHoles = []; return; }
    const x = chunk.cx * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const z = chunk.cz * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const y = randRange(rng, -Constants.WORLD_Y_BAND, Constants.WORLD_Y_BAND);

    const hole = {
      type: 'blackHole',
      owner: this,
      x, y, z,
      radius: Constants.BLACK_HOLE_RADIUS,
      active: true,
      pullMult: mult.blackHolePull,
      group: this._buildVisual(),
      flash: 0,
      chunkKey: chunk.key,
    };
    hole.group.position.set(x, y, z);
    this._group.add(hole.group);
    this.holes.push(hole);
    chunk.blackHoles = [hole];
    this.events.emit('environment:blackHoleSpawned', { position: { x, y, z }, radius: hole.radius });
  }

  _buildVisual() {
    const g = new THREE.Group();
    const R = Constants.BLACK_HOLE_RADIUS;

    // Event horizon: pure black, renders black under all light
    const horizon = new THREE.Mesh(
      new THREE.SphereGeometry(R, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    g.add(horizon);

    // Photon ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.5, R * 0.06, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    g.add(ring);

    // Accretion disk (Doppler-brightened)
    const diskMat = new THREE.ShaderMaterial({
      vertexShader: DISK_VERTEX,
      fragmentShader: DISK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: Math.random() * 100 },
        uSpeed: { value: Constants.BLACK_HOLE_DISK_SPEED },
      },
    });
    const disk = new THREE.Mesh(new THREE.RingGeometry(R * 1.2, R * 3, 48, 1), diskMat);
    disk.rotation.x = Math.PI / 2.4;
    g.add(disk);
    g.userData.diskMat = diskMat;

    // Consumption flash sprite
    const flashMat = new THREE.SpriteMaterial({
      map: this._flashTex,
      color: 0xffcc88,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flash = new THREE.Sprite(flashMat);
    flash.scale.setScalar(R * 6);
    g.add(flash);
    g.userData.flash = flash;
    g.userData.flashMat = flashMat;

    return g;
  }

  /** Called by PhysicsSystem when a body crosses the horizon. */
  onConsume(objectType, x, y, z) {
    for (const h of this.holes) {
      const dx = h.x - x, dy = h.y - y, dz = h.z - z;
      if (dx * dx + dy * dy + dz * dz < (h.radius * 3) * (h.radius * 3)) {
        h.flash = 1;
      }
    }
    this.events.emit('environment:objectConsumed', { objectType, position: { x, y, z } });
  }

  update(dt) {
    for (const h of this.holes) {
      h.group.userData.diskMat.uniforms.uTime.value += dt;
      h.group.rotation.y += dt * 0.05;
      if (h.flash > 0) {
        h.flash = Math.max(0, h.flash - dt / 0.2);
        h.group.userData.flashMat.opacity = h.flash;
        h.group.userData.flash.scale.setScalar(Constants.BLACK_HOLE_RADIUS * (4 + h.flash * 4));
      }
    }
  }

  cleanupChunk(chunk) {
    if (!chunk.blackHoles) return;
    for (const h of chunk.blackHoles) {
      this._group.remove(h.group);
      h.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      const idx = this.holes.indexOf(h);
      if (idx >= 0) this.holes.splice(idx, 1);
    }
    chunk.blackHoles = [];
  }

  getColliders() {
    return this.holes.map((h) => ({ type: 'blackHole', owner: this, x: h.x, y: h.y, z: h.z, radius: h.radius, active: true }));
  }

  dispose() {
    for (const h of [...this.holes]) {
      this._group.remove(h.group);
      h.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.holes = [];
    this.scene.remove(this._group);
  }
}

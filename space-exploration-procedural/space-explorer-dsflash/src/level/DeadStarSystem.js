import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';

// Dead stars: huge dark-red radiating remnants, rare, visible from afar
// (spec §6.8, §5.13). Instant death on contact; pure landmarks otherwise.
export class DeadStarSystem {
  constructor(scene, events, particles) {
    this.scene = scene;
    this.events = events;
    this.particles = particles;
    this.stars = [];
    this._group = new THREE.Group();
    this._group.name = 'deadStars';
    scene.add(this._group);

    this._glowTex = this._makeGlowTexture();
    this._crackTex = this._makeCrackTexture();
    this._emberTimer = 0;
  }

  _makeGlowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,60,30,0.9)');
    g.addColorStop(0.4, 'rgba(180,30,15,0.4)');
    g.addColorStop(1, 'rgba(120,10,5,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  _makeCrackTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a0505';
    ctx.fillRect(0, 0, size, size);
    // patchy hot cracks
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.strokeStyle = `rgba(${120 + Math.random() * 80}, ${15 + Math.random() * 20}, ${8}, ${0.3 + Math.random() * 0.5})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let px = x, py = y;
      const segs = 4 + Math.floor(Math.random() * 6);
      for (let s = 0; s < segs; s++) {
        px += (Math.random() - 0.5) * 30;
        py += (Math.random() - 0.5) * 30;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // ember spots
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = 2 + Math.random() * 6;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r);
      g2.addColorStop(0, `rgba(255,80,30,${0.5 + Math.random() * 0.4})`);
      g2.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  spawnChunk(chunk, rng, biomeCfg, shipPos) {
    const pct = biomeCfg.deadStarDensity;
    if (pct <= 0) { chunk.deadStars = []; return; }
    if (rng() * 100 >= pct * Constants.DENSITY_REDUCTION) { chunk.deadStars = []; return; }
    // max 1 per chunk already implied; spacing guard
    for (const s of this.stars) {
      const dcx = s.x / Constants.CHUNK_SIZE, dcz = s.z / Constants.CHUNK_SIZE;
      const dist = Math.hypot(chunk.cx - dcx, chunk.cz - dcz) * Constants.CHUNK_SIZE;
      if (dist < Constants.DEAD_STAR_MIN_SPACING) { chunk.deadStars = []; return; }
    }
    const x = chunk.cx * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const z = chunk.cz * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const y = chunk.cy * Constants.CHUNK_SIZE + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
    const ds = Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z);
    if (ds < Constants.DEAD_STAR_MIN_DIST_FROM_SHIP) { chunk.deadStars = []; return; }

    const radius = randRange(rng, Constants.DEAD_STAR_RADIUS_MIN, Constants.DEAD_STAR_RADIUS_MAX);
    const star = {
      type: 'deadStar',
      owner: this,
      x, y, z,
      radius,
      active: true,
      mat: null,
      glowMat: null,
      light: null,
      group: null,
      pulsePhase: rng() * 10,
      chunkKey: chunk.key,
    };
    star.group = this._buildVisual(star, radius, rng);
    star.group.position.set(x, y, z);
    this._group.add(star.group);
    this.stars.push(star);
    chunk.deadStars = [star];
    this.events.emit('environment:deadStarSpawned', { position: { x, y, z }, radius });
  }

  _buildVisual(star, radius, rng) {
    const g = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a0505,
      emissive: 0x4a0d0d,
      emissiveIntensity: 0.7,
      emissiveMap: this._crackTex,
      roughness: 0.95,
      metalness: 0.05,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 24), mat);
    g.add(sphere);
    star.mat = mat;

    // Glow sprite — fog:false so it's visible from afar
    const glowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0xff4422,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(radius * Constants.DEAD_STAR_GLOW_SCALE);
    g.add(glow);
    star.glowMat = glowMat;

    // Red point light (culled by distance in update)
    const light = new THREE.PointLight(Constants.DEAD_STAR_LIGHT_COLOR, Constants.DEAD_STAR_LIGHT_INTENSITY, Constants.DEAD_STAR_LIGHT_RANGE, 2);
    light.position.set(0, 0, 0);
    g.add(light);
    star.light = light;

    return g;
  }

  update(dt, cameraPos) {
    this._emberTimer -= dt;
    const emitEmbers = this._emberTimer <= 0;
    if (emitEmbers) this._emberTimer = 0.15;

    for (const s of this.stars) {
      // Ember pulse (dying ember)
      const t = performance.now() / 1000 + s.pulsePhase;
      const pulse = 0.4 + 0.8 * (0.5 + 0.5 * Math.sin(t * 1.7) * Math.sin(t * 0.9 + 2.0));
      s.mat.emissiveIntensity = pulse;
      s.glowMat.opacity = 0.5 + 0.3 * (pulse / 1.2);

      // Light culling
      const d2 = (s.x - cameraPos.x) ** 2 + (s.y - cameraPos.y) ** 2 + (s.z - cameraPos.z) ** 2;
      s.light.visible = d2 < Constants.DEAD_STAR_LIGHT_RANGE * Constants.DEAD_STAR_LIGHT_RANGE;

      // Ember particles from surface
      if (emitEmbers) {
        for (let i = 0; i < 2; i++) {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          const px = s.x + Math.sin(phi) * Math.cos(theta) * s.radius;
          const py = s.y + Math.sin(phi) * Math.sin(theta) * s.radius;
          const pz = s.z + Math.cos(phi) * s.radius;
          this.particles.emit('ember', px, py, pz,
            (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2,
            { size: 0.2 + Math.random() * 0.3 });
        }
      }
    }
  }

  cleanupChunk(chunk) {
    if (!chunk.deadStars) return;
    for (const s of chunk.deadStars) {
      this._group.remove(s.group);
      s.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      const idx = this.stars.indexOf(s);
      if (idx >= 0) this.stars.splice(idx, 1);
    }
    chunk.deadStars = [];
  }

  getColliders() {
    return this.stars.map((s) => ({ type: 'deadStar', owner: this, x: s.x, y: s.y, z: s.z, radius: s.radius, active: true }));
  }

  dispose() {
    for (const s of [...this.stars]) {
      this._group.remove(s.group);
      s.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.stars = [];
    this.scene.remove(this._group);
    this._glowTex.dispose();
    this._crackTex.dispose();
  }
}

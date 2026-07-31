import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';

// Pulsars (spec v2.0 §3.4.2): blue-white neutron-star landmarks with two
// counter-rotating lighthouse beam cones. Beam touch = 50 dmg (checked by
// PhysicsSystem via getBeams()); body touch = instant death.
export class PulsarSystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.pulsars = [];
    this._group = new THREE.Group();
    this._group.name = 'pulsars';
    scene.add(this._group);
    this._glowTex = this._makeGlowTexture();
    this._beams = []; // { x, y, z, ax, ay, az, length } — world-space rays
  }

  _makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(190,216,255,0.5)');
    g.addColorStop(1, 'rgba(120,160,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  spawnChunk(chunk, rng, cfg, shipPos) {
    const C = Constants.PULSAR;
    if (!cfg.pulsarDensity || cfg.pulsarDensity <= 0) { chunk.pulsars = []; return; }
    // percentage chance per chunk (max 1)
    if (rng() * 100 >= cfg.pulsarDensity) { chunk.pulsars = []; return; }

    const s = Constants.CHUNK_SIZE;
    const x = chunk.cx * s + randRange(rng, 0, s);
    const z = chunk.cz * s + randRange(rng, 0, s);
    const y = chunk.cy * s + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);

    // spacing guards
    for (const p of this.pulsars) {
      if (Math.hypot(p.x - x, p.y - y, p.z - z) < C.minSpacing) { chunk.pulsars = []; return; }
    }
    if (shipPos && Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z) < C.minDistFromShip) { chunk.pulsars = []; return; }

    const radius = randRange(rng, C.radiusMin, C.radiusMax);
    const group = this._buildVisual(radius, rng);
    group.position.set(x, y, z);
    this._group.add(group);

    const pulsar = {
      type: 'pulsar',
      owner: this,
      x, y, z,
      radius,
      active: true,
      chunkKey: chunk.key,
      group,
      angleA: rng() * Math.PI * 2,
      angleB: rng() * Math.PI * 2,
      pulsePhase: rng() * Math.PI * 2,
    };
    this.pulsars.push(pulsar);
    chunk.pulsars = [pulsar];
    this.events.emit('environment:pulsarSpawned', { position: { x, y, z }, radius });
  }

  _buildVisual(radius, rng) {
    const C = Constants.PULSAR;
    const g = new THREE.Group();

    const bodyMat = new THREE.MeshBasicMaterial({ color: C.bodyColor, fog: false });
    const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), bodyMat);
    g.add(body);

    const glowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0xbfd8ff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(radius * 8);
    g.add(glow);

    const light = new THREE.PointLight(C.lightColor, C.lightIntensity, C.lightRange, 2);
    g.add(light);

    // Two counter-rotating beam cones (CylinderGeometry along +Y → rotate to +Z)
    const coneGeo = new THREE.CylinderGeometry(0.1, C.beamLength * Math.tan(C.beamHalfAngle), C.beamLength, 20, 1, true);
    coneGeo.rotateX(Math.PI / 2); // +Y → +Z
    const coneMat = new THREE.MeshBasicMaterial({
      color: C.beamColor,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const coneA = new THREE.Mesh(coneGeo, coneMat);
    const coneB = new THREE.Mesh(coneGeo, coneMat.clone());
    g.add(coneA);
    g.add(coneB);

    // Leading telegraph glows (one per cone)
    const leadMatA = new THREE.SpriteMaterial({ map: this._glowTex, color: 0x9fd8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const leadMatB = leadMatA.clone();
    const leadA = new THREE.Sprite(leadMatA);
    const leadB = new THREE.Sprite(leadMatB);
    leadA.scale.setScalar(24);
    leadB.scale.setScalar(24);
    g.add(leadA);
    g.add(leadB);

    g.userData = {
      body, bodyMat, glow, glowMat, light,
      coneA, coneB, coneMat, coneGeo,
      leadA, leadB, leadMatA, leadMatB,
    };
    return g;
  }

  update(dt, shipPos) {
    const C = Constants.PULSAR;
    this._beams.length = 0;
    for (const p of this.pulsars) {
      p.angleA += C.speedA * dt;
      p.angleB -= C.speedB * dt;
      p.pulsePhase += dt * C.pulseRate * Math.PI * 2;

      const pulse = 0.7 + 0.3 * Math.sin(p.pulsePhase);
      p.group.userData.glowMat.opacity = 0.6 + 0.3 * pulse;
      p.group.userData.light.intensity = C.lightIntensity * (0.75 + 0.25 * pulse);

      // Orient cones + leading glows
      const dirA = new THREE.Vector3(Math.cos(p.angleA), 0, Math.sin(p.angleA));
      const dirB = new THREE.Vector3(Math.cos(p.angleB), 0, Math.sin(p.angleB));
      const qA = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirA);
      const qB = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirB);
      p.group.userData.coneA.quaternion.copy(qA);
      p.group.userData.coneB.quaternion.copy(qB);
      // Leading glow at +leadAngle ahead of each cone
      const leadA = new THREE.Vector3(Math.cos(p.angleA + C.leadAngle), 0, Math.sin(p.angleA + C.leadAngle));
      const leadB = new THREE.Vector3(Math.cos(p.angleB - C.leadAngle), 0, Math.sin(p.angleB - C.leadAngle));
      p.group.userData.leadA.position.copy(leadA).multiplyScalar(C.beamLength * 0.45);
      p.group.userData.leadB.position.copy(leadB).multiplyScalar(C.beamLength * 0.45);

      // Expose beams for PhysicsSystem damage checks
      this._beams.push({ x: p.x, y: p.y, z: p.z, ax: dirA.x, ay: 0, az: dirA.z, length: C.beamLength });
      this._beams.push({ x: p.x, y: p.y, z: p.z, ax: dirB.x, ay: 0, az: dirB.z, length: C.beamLength });
    }
  }

  /** World-space beam rays (for PhysicsSystem beam-touch damage). */
  getBeams() { return this._beams; }

  getColliders() { return this.pulsars; }

  cleanupChunk(chunk) {
    if (!chunk.pulsars) return;
    for (const p of chunk.pulsars) {
      this._group.remove(p.group);
      p.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      const idx = this.pulsars.indexOf(p);
      if (idx >= 0) this.pulsars.splice(idx, 1);
    }
    chunk.pulsars = [];
  }

  dispose() {
    this.scene.remove(this._group);
    this._glowTex.dispose();
    this._group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

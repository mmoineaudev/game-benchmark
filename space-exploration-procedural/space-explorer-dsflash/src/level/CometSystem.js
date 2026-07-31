import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange, scratch } from '../utils/MathHelpers.js';
import { softDotTexture } from '../utils/ShaderHelpers.js';

// Comets: big icy bodies, 15-30 u/s, sine-curved path, dust + smoke trails,
// destructible (150 HP / 100 pts), bent by black hole gravity (spec §6.6, §5.11).
export class CometSystem {
  constructor(scene, events, particles) {
    this.scene = scene;
    this.events = events;
    this.particles = particles;
    this.bodies = [];
    this.colliders = [];
    this._group = new THREE.Group();
    this._group.name = 'comets';
    scene.add(this._group);

    this._nucleusGeo = this._displace(new THREE.IcosahedronGeometry(1, 1), 55, 0.5);
    this._dustTimer = 0;
    this._smokeTimer = 0;
  }

  _displace(geo, seed, amp) {
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 0.6 * Math.sin(v.x * 3.1 + seed) + 0.3 * Math.sin(v.y * 4.7 + seed * 2) + 0.1 * Math.sin(v.z * 5.3 + seed * 3);
      v.normalize().multiplyScalar(1 + n * amp);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  spawnChunk(chunk, rng, biomeCfg, mult, shipPos) {
    const count = Math.min(6, Math.round(biomeCfg.cometDensity * mult.comet * Constants.DENSITY_REDUCTION));
    chunk.comets = [];
    for (let i = 0; i < count; i++) {
      const x = chunk.cx * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
      const z = chunk.cz * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
      const y = chunk.cy * Constants.CHUNK_SIZE + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
      // fairness guard: ≥ 150 u from ship
      const ds = Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z);
      if (ds < Constants.COMET_MIN_DIST_FROM_SHIP) continue;

      const scale = randRange(rng, Constants.COMET_MIN_SCALE, Constants.COMET_MAX_SCALE);
      const speed = randRange(rng, Constants.COMET_SPEED_MIN, Constants.COMET_SPEED_MAX);
      const dir = new THREE.Vector3(randRange(rng, -1, 1), randRange(rng, -0.5, 0.5), randRange(rng, -1, 1)).normalize();
      const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();

      const body = {
        type: 'comet',
        owner: this,
        x, y, z,
        baseX: x, baseY: y, baseZ: z,
        vx: dir.x * speed, vy: dir.y * speed, vz: dir.z * speed,
        perpX: perp.x, perpY: perp.y, perpZ: perp.z,
        scale, radius: scale * 0.95,
        hp: Constants.COMET_HP,
        score: Constants.COMET_SCORE,
        travelDist: rng() * 100,
        quat: new THREE.Quaternion(),
        rotAxis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
        rotSpeed: Constants.COMET_TUMBLE_SPEED * (rng() > 0.5 ? 1 : -1),
        active: true,
        chunkKey: chunk.key,
        group: this._buildVisual(scale, rng),
      };
      this._group.add(body.group);
      this.bodies.push(body);
      this.colliders.push(body);
      chunk.comets.push(body);
    }
  }

  _buildVisual(scale, rng) {
    const g = new THREE.Group();

    const nucleusMat = new THREE.MeshStandardMaterial({
      color: 0x9aa8b8, roughness: 0.9, metalness: 0.1,
      emissive: 0x224466, emissiveIntensity: 0.35,
    });
    const nucleus = new THREE.Mesh(this._nucleusGeo, nucleusMat);
    nucleus.scale.setScalar(scale);
    g.add(nucleus);

    // Coma billboard (soft dot, pale cyan, additive)
    const comaMat = new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: 0x88ccff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coma = new THREE.Sprite(comaMat);
    coma.scale.setScalar(scale * 2.5);
    g.add(coma);

    // Ion tail: stretched plane along velocity (blue, additive)
    const ionMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ion = new THREE.Mesh(new THREE.PlaneGeometry(scale * 0.5, scale * 5), ionMat);
    ion.position.z = scale * 2.5;
    g.add(ion);

    // Dim icy light (LightManager 'land:comet' — budget-culled by distance)
    const CL = Constants.COMET_LIGHT;
    const light = new THREE.PointLight(CL.color, CL.intensity, CL.range, CL.decay);
    light.name = 'land:comet';
    g.add(light);

    g.userData.ion = ion;
    g.userData.coma = coma;
    return g;
  }

  update(dt, shipPos) {
    const amp = Constants.COMET_CURVE_AMPLITUDE;
    const wl = Constants.COMET_CURVE_WAVELENGTH;
    const axis = scratch.v1;
    const q = scratch.q1;

    for (const b of this.bodies) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.travelDist += Math.hypot(b.vx, b.vy, b.vz) * dt;
      const off = Math.sin((b.travelDist / wl) * Math.PI * 2) * amp;
      b.group.position.set(b.x + b.perpX * off, b.y + b.perpY * off, b.z + b.perpZ * off);

      q.setFromAxisAngle(axis.copy(b.rotAxis), b.rotSpeed * dt);
      b.quat.premultiply(q);
      b.group.quaternion.copy(b.quat);

      // Orient ion tail away from velocity
      const tail = b.group.userData.ion;
      if (tail) {
        const ang = Math.atan2(b.vx, b.vz);
        b.group.rotation.y = ang;
      }

      // Trails (only within COMET_TRAIL_RADIUS — distant comets are specks and
      // their emission would thrash the shared pools): warm dust + a long,
      // slowly-drifting smoke tail that stretches far behind the comet.
      const px = b.group.position.x, py = b.group.position.y, pz = b.group.position.z;
      const ds = Math.hypot(px - shipPos.x, py - shipPos.y, pz - shipPos.z);
      if (ds <= Constants.COMET_TRAIL_RADIUS) {
        const spd = Math.hypot(b.vx, b.vy, b.vz);
        const nx = -b.vx / (spd || 1), ny = -b.vy / (spd || 1), nz = -b.vz / (spd || 1);
        this.particles.emitStream('cometDust', px, py, pz, nx * spd * 0.35, ny * spd * 0.35, nz * spd * 0.35, {
          perFrame: 3, jitter: b.scale * 0.4, size: 0.5 + b.scale * 0.1,
        });
        this.particles.emitStream('cometSmoke', px, py, pz, nx * spd * 0.12, ny * spd * 0.12, nz * spd * 0.12, {
          perFrame: 2, jitter: b.scale * 0.8, size: 2.0 + b.scale * 0.2,
        });
      }
    }
  }

  applyGravity(center, strength, maxPull, dt) {
    for (const b of this.bodies) {
      if (!b.active) continue;
      const dx = center.x - b.x, dy = center.y - b.y, dz = center.z - b.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1 || d2 > Constants.BLACK_HOLE_GRAVITY_RADIUS * Constants.BLACK_HOLE_GRAVITY_RADIUS) continue;
      const a = Math.min(strength / d2, maxPull);
      const inv = a / Math.sqrt(d2);
      b.vx += dx * inv * dt;
      b.vy += dy * inv * dt;
      b.vz += dz * inv * dt;
    }
  }

  remove(body, { silent = false } = {}) {
    if (!body.active) return;
    body.active = false;
    this._group.remove(body.group);
    body.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    const idx = this.colliders.indexOf(body);
    if (idx >= 0) this.colliders.splice(idx, 1);
    if (silent) {
      this.events.emit('environment:objectConsumed', { objectType: 'comet', position: { x: body.x, y: body.y, z: body.z } });
    } else {
      this.events.emit('environment:cometDestroyed', { position: { x: body.x, y: body.y, z: body.z }, score: body.score });
    }
  }

  cleanupChunk(chunk) {
    if (!chunk.comets) return;
    for (const c of chunk.comets) this.remove(c, { silent: true });
    chunk.comets = [];
  }

  getColliders() { return this.colliders; }
  getGravityBodies() { return this.bodies; }

  dispose() {
    for (const b of [...this.bodies]) this.remove(b, { silent: true });
    this.scene.remove(this._group);
    this._nucleusGeo.dispose();
  }
}

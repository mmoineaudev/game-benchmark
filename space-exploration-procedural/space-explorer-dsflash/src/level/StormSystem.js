import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';
import { softDotTexture } from '../utils/ShaderHelpers.js';

// Plasma Storm (spec v2.0 §3.4.3): dark storm clouds with flicker lights,
// lightning bolts between close pairs, telegraphed strikes (40 dmg, checked
// by PhysicsSystem via getBolts), and distance-based HUD static.
export class StormSystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.clouds = [];
    this.pairs = [];
    this._group = new THREE.Group();
    this._group.name = 'storm';
    scene.add(this._group);
    this._dot = softDotTexture();
    this._staticActive = false;
    this._staticIntensity = 0;
    this._nearest = Infinity;

    // Bolt pool: 8 bolts × 6 segments
    const C = Constants.STORM;
    this._boltGeo = new THREE.BufferGeometry();
    this._boltPos = new Float32Array(8 * C.boltSegments * 2 * 3);
    this._boltGeo.setAttribute('position', new THREE.BufferAttribute(this._boltPos, 3).setUsage(THREE.DynamicDrawUsage));
    this._boltGeo.setDrawRange(0, 0);
    const boltMat = new THREE.LineBasicMaterial({
      color: C.boltColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._bolts = new THREE.LineSegments(this._boltGeo, boltMat);
    this._bolts.frustumCulled = false;
    this._group.add(this._bolts);
    this._activeBolts = []; // { a:{x,y,z}, b:{x,y,z}, life }
  }

  spawnChunk(chunk, rng, cfg, shipPos) {
    const C = Constants.STORM;
    if (!cfg.stormDensity || cfg.stormDensity <= 0) { chunk.storm = { clouds: [], pairs: [] }; return; }
    const count = cfg.stormDensity; // final per-chunk count
    const s = Constants.CHUNK_SIZE;
    const x0 = chunk.cx * s, z0 = chunk.cz * s;
    const yBase = chunk.cy * s;
    const chunkClouds = [];

    for (let i = 0; i < count; i++) {
      const x = x0 + randRange(rng, 0, s);
      const z = z0 + randRange(rng, 0, s);
      const y = yBase + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
      if (shipPos && Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z) < C.minDistFromShip) continue;
      const radius = randRange(rng, C.cloudRadiusMin, C.cloudRadiusMax);
      const group = this._buildCloud(radius, rng);
      group.position.set(x, y, z);
      this._group.add(group);
      const cloud = {
        type: 'stormCloud',
        x, y, z,
        radius,
        active: true,
        chunkKey: chunk.key,
        group,
        flash: 0,           // telegraph/lightning brightness 0..1
        flickerPhase: rng() * Math.PI * 2,
      };
      this.clouds.push(cloud);
      chunkClouds.push(cloud);
    }

    // Pairs within bolt distance (chunk-local)
    const pairs = [];
    for (let i = 0; i < chunkClouds.length; i++) {
      for (let j = i + 1; j < chunkClouds.length; j++) {
        const a = chunkClouds[i], b = chunkClouds[j];
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= C.boltDistanceMax) {
          const pair = {
            a, b,
            state: 'waiting',        // 'waiting' | 'telegraph' | 'bolt'
            t: randRange(rng, C.boltReMin, C.boltReMax),
            rng,
          };
          pairs.push(pair);
          this.pairs.push(pair);
        }
      }
    }
    chunk.storm = { clouds: chunkClouds, pairs };
  }

  _buildCloud(radius, rng) {
    const C = Constants.STORM;
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: C.cloudColor,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 3; i++) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 1.3), mat);
      plane.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      plane.position.set(randRange(rng, -radius * 0.3, radius * 0.3), 0, randRange(rng, -radius * 0.3, radius * 0.3));
      g.add(plane);
    }
    const flashMat = new THREE.SpriteMaterial({
      map: this._dot,
      color: C.boltColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const flash = new THREE.Sprite(flashMat);
    flash.scale.setScalar(radius * 2.2);
    g.add(flash);
    const light = new THREE.PointLight(C.lightColor, 0, 60, 2);
    light.name = 'sig:stormFlicker';
    g.add(light);
    g.userData = { mat, flash, flashMat, light };
    return g;
  }

  update(dt, shipPos) {
    const C = Constants.STORM;
    // Flicker lights + cloud flashes
    for (const c of this.clouds) {
      c.flickerPhase += dt * C.flickerHz * Math.PI * 2;
      const flicker = 0.5 + 0.5 * Math.sin(c.flickerPhase);
      c.group.userData.light.intensity = 1.2 * flicker;
      if (c.flash > 0) {
        c.group.userData.flashMat.opacity = c.flash;
        c.group.userData.light.intensity = 1.2 + 3.0 * c.flash;
      } else {
        c.group.userData.flashMat.opacity = 0;
      }
    }

    // Pair strike state machine
    this._activeBolts.length = 0;
    for (const p of this.pairs) {
      if (!p.a.active && !p.b.active) continue;
      p.t -= dt;
      if (p.state === 'waiting' && p.t <= 0) {
        p.state = 'telegraph';
        p.t = C.telegraphTime;
        p.a.flash = 1;
        p.b.flash = 1;
      } else if (p.state === 'telegraph' && p.t <= 0) {
        p.state = 'bolt';
        p.t = C.boltLife;
        // bolt endpoints slightly inside each cloud
        this._activeBolts.push({
          ax: p.a.x, ay: p.a.y, az: p.a.z,
          bx: p.b.x, by: p.b.y, bz: p.b.z,
          life: C.boltLife,
          pair: p,
        });
        this.events.emit('environment:stormStrike', {
          position: { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2, z: (p.a.z + p.b.z) / 2 },
          damage: C.strikeDamage,
        });
      } else if (p.state === 'bolt' && p.t <= 0) {
        p.state = 'waiting';
        p.t = randRange(p.rng, C.boltReMin, C.boltReMax);
        p.a.flash = 0;
        p.b.flash = 0;
      }
    }

    // Fade active bolts + write geometry
    let vert = 0;
    let draw = 0;
    for (const b of this._activeBolts) {
      b.life -= dt;
      if (b.life <= 0) continue;
      // jagged polyline
      const segs = C.boltSegments;
      const mid = { x: (b.ax + b.bx) / 2, y: (b.ay + b.by) / 2, z: (b.az + b.bz) / 2 };
      let prev = { x: b.ax, y: b.ay, z: b.az };
      for (let i = 0; i < segs; i++) {
        const t = (i + 1) / segs;
        const jitter = (1 - Math.abs(t - 0.5) * 2) * 25; // more jitter mid-bolt
        const cur = {
          x: b.ax + (b.bx - b.ax) * t + (Math.random() - 0.5) * jitter,
          y: b.ay + (b.by - b.ay) * t + (Math.random() - 0.5) * jitter,
          z: b.az + (b.bz - b.az) * t + (Math.random() - 0.5) * jitter,
        };
        this._boltPos[vert++] = prev.x; this._boltPos[vert++] = prev.y; this._boltPos[vert++] = prev.z;
        this._boltPos[vert++] = cur.x; this._boltPos[vert++] = cur.y; this._boltPos[vert++] = cur.z;
        draw += 2;
        prev = cur;
      }
    }
    this._boltGeo.setDrawRange(0, draw);
    if (draw > 0) this._boltGeo.attributes.position.needsUpdate = true;

    // HUD static: nearest cloud distance
    let nearest = Infinity;
    for (const c of this.clouds) {
      const d = Math.hypot(c.x - shipPos.x, c.y - shipPos.y, c.z - shipPos.z);
      if (d < nearest) nearest = d;
    }
    this._nearest = nearest;
    let active = false;
    let intensity = 0;
    if (nearest < C.staticRange) {
      active = true;
      intensity = nearest < C.staticRangeIntense ? C.staticOpacityIntense : C.staticOpacity;
    }
    if (active !== this._staticActive || intensity !== this._staticIntensity) {
      this._staticActive = active;
      this._staticIntensity = intensity;
      this.events.emit('storm:staticChanged', { active, intensity });
    }
  }

  /** Active bolt segments for PhysicsSystem strike damage. */
  getBolts() { return this._activeBolts; }

  getStaticInfo() { return { active: this._staticActive, intensity: this._staticIntensity }; }

  getShipDist() { return this._nearest; }

  cleanupChunk(chunk) {
    if (!chunk.storm) return;
    for (const c of chunk.storm.clouds) {
      this._group.remove(c.group);
      c.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material !== this._bolts.material) o.material.dispose();
      });
      c.active = false;
      const idx = this.clouds.indexOf(c);
      if (idx >= 0) this.clouds.splice(idx, 1);
    }
    for (let i = this.pairs.length - 1; i >= 0; i--) {
      const p = this.pairs[i];
      if (p.a.chunkKey === chunk.key || p.b.chunkKey === chunk.key) this.pairs.splice(i, 1);
    }
    chunk.storm = null;
  }

  dispose() {
    this.scene.remove(this._group);
    this._boltGeo.dispose();
    this._bolts.material.dispose();
    this._dot.dispose();
    this._group.traverse((o) => {
      if (o.geometry && o.geometry !== this._boltGeo) o.geometry.dispose();
      if (o.material && o.material !== this._bolts.material) o.material.dispose();
    });
  }
}

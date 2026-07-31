import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';
import { buildHulk, buildCityFragment } from './ProceduralWrecks.js';

// SPATIAL GRAVEYARD — the finale (spec v2.0 §3.4.5): huge broken space-city
// fragments (indestructible, flickering windows) + blinking wrecked ships
// (staggered red/white strobes, destructible 100 HP → 200 pts).
export class CitySystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.fragments = [];
    this.wrecks = [];
    this._group = new THREE.Group();
    this._group.name = 'city';
    scene.add(this._group);

    const C = Constants.CITY;
    this._windowTex = this._makeWindowTexture();
    this._glowTex = this._makeGlowTexture();
    this._palette = { hull: C.hullColor, window: C.windowColor };
    this._wreckPalette = { hull: C.wreckColor, glow: C.strobeRed };
  }

  _makeWindowTexture() {
    const C = Constants.CITY;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < C.windowCount; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const w = 2 + Math.random() * 4;
      ctx.fillStyle = `rgba(255,255,255,${0.5 + Math.random() * 0.5})`;
      ctx.fillRect(x, y, w, w * 1.6);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _makeGlowTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(90,168,143,0.5)');
    g.addColorStop(1, 'rgba(90,168,143,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  spawnChunk(chunk, rng, cfg, shipPos) {
    const C = Constants.CITY;
    const s = Constants.CHUNK_SIZE;
    const x0 = chunk.cx * s, z0 = chunk.cz * s;
    const yBase = chunk.cy * s;

    // ---- City fragment (50% chance, max 1/chunk) ---------------------------
    if (cfg.cityChance > 0 && rng() < cfg.cityChance) {
      const x = x0 + randRange(rng, 0, s);
      const z = z0 + randRange(rng, 0, s);
      const y = yBase + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
      let ok = true;
      if (shipPos && Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z) < C.minDistShip) ok = false;
      for (const f of this.fragments) {
        if (Math.hypot(f.x - x, f.y - y, f.z - z) < C.minSpacing) { ok = false; break; }
      }
      if (ok) {
        const seed = Math.floor(rng() * 1e9);
        const built = buildCityFragment(seed, this._windowTex, this._palette);
        built.group.position.set(x, y, z);
        this._group.add(built.group);
        // landmark glow (visible from afar)
        const glowMat = new THREE.SpriteMaterial({
          map: this._glowTex,
          transparent: true,
          opacity: C.glowOpacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        });
        const glow = new THREE.Sprite(glowMat);
        glow.scale.setScalar(C.fragmentScale * C.glowScale);
        built.group.add(glow);

        const fragment = {
          type: 'cityFragment',
          owner: this,
          x, y, z,
          vx: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          vy: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          vz: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          radius: C.fragmentRadius,
          hp: C.fragmentHp, // 0 = indestructible
          score: 0,
          active: true,
          chunkKey: chunk.key,
          group: built.group,
          light: built.light,
          windowMats: built.windowMats,
          phase: built.phase,
          rotSpeed: randRange(rng, C.rotMin, C.rotMax) * (rng() < 0.5 ? -1 : 1),
          scale: C.fragmentScale,
        };
        this.fragments.push(fragment);
        chunk.cityFragment = fragment;
        this.events.emit('environment:cityFragmentSpawned', { position: { x, y, z }, scale: fragment.scale });
      }
    }

    // ---- Blinking wrecks (5/chunk, final count) -----------------------------
    if (cfg.wreckDensity > 0) {
      for (let i = 0; i < cfg.wreckDensity; i++) {
        const x = x0 + randRange(rng, 0, s);
        const z = z0 + randRange(rng, 0, s);
        const y = yBase + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
        if (shipPos && Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z) < C.minDistShip) continue;
        const scale = randRange(rng, C.wreckScaleMin, C.wreckScaleMax);
        const seed = Math.floor(rng() * 1e9);
        const built = buildHulk(seed, this._wreckPalette);
        built.group.scale.setScalar(scale);
        built.group.position.set(x, y, z);
        built.light.name = 'sig:wreckStrobe';
        // white strobe beacon (phase offset π from the red one)
        const whiteMat = new THREE.MeshBasicMaterial({ color: C.strobeWhite, transparent: true, opacity: 0.1, fog: false });
        const whiteBeacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), whiteMat);
        whiteBeacon.position.set(0, 1.5, 0.6);
        built.group.add(whiteBeacon);
        this._group.add(built.group);

        const wreck = {
          type: 'wreck',
          owner: this,
          x, y, z,
          vx: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          vy: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          vz: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
          radius: 3.2 * scale,
          hp: C.wreckHp,
          score: C.wreckScore,
          active: true,
          chunkKey: chunk.key,
          group: built.group,
          light: built.light,
          strobeMats: [...built.strobeMats, whiteMat],
          phase: built.phase,
          tumble: 0.1,
        };
        this.wrecks.push(wreck);
      }
    }
    chunk.cityWrecks = this.wrecks.filter((w) => w.chunkKey === chunk.key);
  }

  update(dt) {
    const C = Constants.CITY;
    for (const f of this.fragments) {
      if (!f.active) continue;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      f.phase += dt * C.flickerFreq * Math.PI * 2;
      f.group.position.set(f.x, f.y, f.z);
      f.group.rotation.y += dt * f.rotSpeed;
      // window flicker + dropout
      let op = 0.4 + 0.6 * (Math.sin(f.phase) * 0.5 + 0.5);
      if (Math.random() < dt / C.dropoutEvery) op = 0.1; // random dropout
      for (const m of f.windowMats) m.opacity = op;
    }
    for (const w of this.wrecks) {
      if (!w.active) continue;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      w.z += w.vz * dt;
      w.phase += dt * C.strobeFreq * Math.PI * 2;
      w.group.position.set(w.x, w.y, w.z);
      w.group.rotation.y += dt * w.tumble;
      // staggered red/white strobes (phase offset π)
      const on = Math.sin(w.phase) > 0.75 ? 0.9 : 0.1;
      w.strobeMats[0].opacity = on;
      w.strobeMats[1].opacity = Math.sin(w.phase + Math.PI) > 0.75 ? 0.9 : 0.1;
      w.light.intensity = on * 0.5;
    }
  }

  remove(body) {
    if (!body.active) return;
    body.active = false;
    this._group.remove(body.group);
    const wi = this.wrecks.indexOf(body);
    if (wi >= 0) this.wrecks.splice(wi, 1);
    this.events.emit('environment:wreckDestroyed', {
      position: { x: body.x, y: body.y, z: body.z },
      score: body.score,
    });
  }

  getColliders() { return [...this.fragments.filter((f) => f.active), ...this.wrecks.filter((w) => w.active)]; }

  cleanupChunk(chunk) {
    if (chunk.cityFragment) {
      const f = chunk.cityFragment;
      if (f.active) {
        f.active = false;
        this._group.remove(f.group);
      }
      const fi = this.fragments.indexOf(f);
      if (fi >= 0) this.fragments.splice(fi, 1);
      chunk.cityFragment = null;
    }
    if (chunk.cityWrecks) {
      for (const w of chunk.cityWrecks) {
        if (!w.active) continue;
        w.active = false;
        this._group.remove(w.group);
        const wi = this.wrecks.indexOf(w);
        if (wi >= 0) this.wrecks.splice(wi, 1);
      }
      chunk.cityWrecks = [];
    }
  }

  dispose() {
    this.scene.remove(this._group);
    this._windowTex.dispose();
    this._glowTex.dispose();
    this._group.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (o.material && !o.material.userData?.shared) o.material.dispose();
    });
  }
}

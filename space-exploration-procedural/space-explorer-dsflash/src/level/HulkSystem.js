import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { randRange } from '../utils/MathHelpers.js';
import { buildHulk } from './ProceduralWrecks.js';

// Derelict Graveyard ship hulks (spec v2.0 §3.4.4): procedural wrecks,
// 250 HP (4 beam hits) → 150 pts + scrap burst, collision 25, drift + tumble.
export class HulkSystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.bodies = [];
    this._group = new THREE.Group();
    this._group.name = 'hulks';
    scene.add(this._group);
    this._palette = { hull: Constants.HULK.hullColor, glow: Constants.HULK.emergencyColor };
  }

  spawnChunk(chunk, rng, cfg, shipPos) {
    const C = Constants.HULK;
    if (!cfg.hulkDensity || cfg.hulkDensity <= 0) { chunk.hulks = []; return; }
    const count = cfg.hulkDensity; // final per-chunk count
    const s = Constants.CHUNK_SIZE;
    const x0 = chunk.cx * s, z0 = chunk.cz * s;
    const yBase = chunk.cy * s;

    for (let i = 0; i < count; i++) {
      const x = x0 + randRange(rng, 0, s);
      const z = z0 + randRange(rng, 0, s);
      const y = yBase + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
      if (shipPos && Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z) < C.minDistShip) continue;
      // spacing guard
      let tooClose = false;
      for (const b of this.bodies) {
        if (Math.hypot(b.x - x, b.y - y, b.z - z) < C.minSpacing) { tooClose = true; break; }
      }
      if (tooClose) continue;

      const seed = Math.floor(rng() * 1e9);
      const built = buildHulk(seed, this._palette);
      built.group.position.set(x, y, z);
      this._group.add(built.group);

      const body = {
        type: 'hulk',
        owner: this,
        x, y, z,
        vx: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
        vy: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
        vz: randRange(rng, C.driftMin, C.driftMax) * (rng() < 0.5 ? -1 : 1),
        radius: 5,
        hp: C.hp,
        score: C.score,
        active: true,
        chunkKey: chunk.key,
        group: built.group,
        light: built.light,
        strobeMats: built.strobeMats,
        phase: built.phase,
        tumble: C.tumble,
      };
      this.bodies.push(body);
    }
    chunk.hulks = this.bodies.filter((b) => b.chunkKey === chunk.key);
  }

  update(dt) {
    const C = Constants.HULK;
    for (const b of this.bodies) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.phase += dt;
      b.group.position.set(b.x, b.y, b.z);
      b.group.rotation.y += dt * b.tumble;
      // emergency light flicker (1.5 Hz)
      b.light.intensity = 0.3 + 0.5 * (Math.sin(b.phase * 3.0) > 0.6 ? 1 : 0.1);
      for (const m of b.strobeMats) m.opacity = Math.sin(b.phase * 3.0) > 0.6 ? 0.9 : 0.1;
    }
  }

  remove(body) {
    if (!body.active) return;
    body.active = false;
    this._group.remove(body.group);
    this.events.emit('environment:hulkDestroyed', {
      position: { x: body.x, y: body.y, z: body.z },
      score: body.score,
    });
  }

  getColliders() { return this.bodies; }

  cleanupChunk(chunk) {
    if (!chunk.hulks) return;
    for (const b of chunk.hulks) {
      if (!b.active) continue;
      b.active = false;
      this._group.remove(b.group);
    }
    chunk.hulks = [];
  }

  dispose() {
    this.scene.remove(this._group);
    this._group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

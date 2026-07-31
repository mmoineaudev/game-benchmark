import * as THREE from 'three';
import { Constants } from '../core/Constants.js';

// Decorative space stations (spec §6.9): procedural hull + ring + windows +
// beacon. Standalone entities with stable IDs in a registry — future-proofed
// for real functionality (landing/trading). Persist while in range.
export class StationSystem {
  constructor(scene, events) {
    this.scene = scene;
    this.events = events;
    this.stations = [];
    this._group = new THREE.Group();
    this._group.name = 'stations';
    scene.add(this._group);
    this._nextId = 1;
    this._windowTex = this._makeWindowTexture();
    this._windowTex.userData.shared = true;
    // Shared materials + geometries — no per-station GPU resource creation.
    this._shared = {
      hullMat: new THREE.MeshStandardMaterial({ color: 0x8a9aaa, metalness: 0.6, roughness: 0.35 }),
      ringMat: new THREE.MeshStandardMaterial({ color: 0x66778a, metalness: 0.7, roughness: 0.3 }),
      windowMat: new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0x88bbff, emissiveIntensity: 0.8, emissiveMap: this._windowTex,
      }),
      beaconMat: new THREE.MeshBasicMaterial({ color: 0xffcc44 }),
    };
    for (const m of Object.values(this._shared)) m.userData.shared = true;
    this._sharedGeo = {
      hullGeo: new THREE.CylinderGeometry(2.2, 2.8, 1, 12),
      windowsGeo: new THREE.CylinderGeometry(2.5, 3.1, 1, 12, 1, true),
      torusGeo: new THREE.TorusGeometry(5.5, 0.7, 10, 24),
      beaconGeo: new THREE.SphereGeometry(0.5, 8, 8),
    };
    for (const g of Object.values(this._sharedGeo)) g.userData.shared = true;
  }

  _makeWindowTexture() {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a2230';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 20; x++) {
        if (Math.random() < 0.75) {
          ctx.fillStyle = Math.random() < 0.25 ? '#aaccff' : '#556677';
          ctx.fillRect(x * 13, y * 40 + 8, 7, 14);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  spawnChunk(chunk, rng, biomeCfg, shipPos) {
    const pct = biomeCfg.stationDensity;
    if (pct <= 0) { chunk.stations = []; return; }
    if (rng() * 100 >= pct * Constants.DENSITY_REDUCTION) { chunk.stations = []; return; }
    // A chunk may host at most one station; if one already exists nearby, skip
    for (const s of this.stations) {
      if (s.chunkKey === chunk.key) { chunk.stations = []; return; }
    }
    const x = chunk.cx * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const z = chunk.cz * Constants.CHUNK_SIZE + randRange(rng, 0, Constants.CHUNK_SIZE);
    const y = chunk.cy * Constants.CHUNK_SIZE + randRange(rng, -Constants.CONTENT_Y_BAND, Constants.CONTENT_Y_BAND);
    const ds = Math.hypot(x - shipPos.x, y - shipPos.y, z - shipPos.z);
    if (ds < Constants.STATION_MIN_DIST_FROM_SHIP) { chunk.stations = []; return; }

    const scale = randRange(rng, Constants.STATION_MIN_SCALE, Constants.STATION_MAX_SCALE);
    const station = {
      type: 'station',
      owner: this,
      id: `station_${this._nextId++}`,
      x, y, z,
      scale,
      radius: Math.max(5, scale * 0.5),
      active: true,
      beaconMat: null,
      group: null,
      chunkKey: chunk.key,
    };
    station.group = this._buildVisual(station, scale, rng);
    station.group.position.set(x, y, z);
    this._group.add(station.group);
    this.stations.push(station);
    chunk.stations = [station];
    this.events.emit('environment:stationSpawned', { position: { x, y, z }, scale });
  }

  _buildVisual(station, scale, rng) {
    const g = new THREE.Group();
    const S = this._shared;
    const R = this._sharedGeo;

    // Hull (vertical cylinder) — shared geometry scaled per station
    const hull = new THREE.Mesh(R.hullGeo, S.hullMat);
    hull.scale.y = scale;
    g.add(hull);

    // Window bands
    const windows = new THREE.Mesh(R.windowsGeo, S.windowMat);
    windows.scale.y = scale * 0.8;
    g.add(windows);

    // Torus ring around the middle
    const ring = new THREE.Mesh(R.torusGeo, S.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0;
    g.add(ring);

    // Beacon (pulsing emissive sphere) — shared material (all beacons pulse together)
    const beacon = new THREE.Mesh(R.beaconGeo, S.beaconMat);
    beacon.position.y = scale / 2 + 1.2;
    g.add(beacon);
    station.beaconMat = S.beaconMat;

    // Deck lights
    const light = new THREE.PointLight(0x88bbff, 0.8, 40, 2);
    light.name = 'land:station';
    light.position.y = 0;
    g.add(light);
    station.light = light;

    return g;
  }

  update(dt, shipPos) {
    for (const s of this.stations) {
      s.group.rotation.y += dt * 0.15;
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 400 + s.id.length);
      s.beaconMat.color.setHSL(0.12, 1.0, 0.5 + 0.2 * pulse);
      // persist while in range
      const d2 = (s.x - shipPos.x) ** 2 + (s.y - shipPos.y) ** 2 + (s.z - shipPos.z) ** 2;
      s.light.visible = d2 < 40 * 40;
      if (d2 > (Constants.CHUNKS_CLEANUP_RADIUS * Constants.CHUNK_SIZE) ** 2) {
        this._removeStation(s);
      }
    }
  }

  _removeStation(s) {
    this._group.remove(s.group);
    s.group.traverse((o) => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      if (o.material && !o.material.userData?.shared) o.material.dispose();
    });
    const idx = this.stations.indexOf(s);
    if (idx >= 0) this.stations.splice(idx, 1);
  }

  cleanupChunk(chunk) {
    // Stations persist while in range — nothing to do on chunk cleanup
    // (they self-remove in update() when out of range).
    chunk.stations = [];
  }

  getColliders() {
    return this.stations.map((s) => ({ type: 'station', owner: this, x: s.x, y: s.y, z: s.z, radius: s.radius, active: true }));
  }

  dispose() {
    for (const s of [...this.stations]) this._removeStation(s);
    this.scene.remove(this._group);
    this._windowTex.dispose();
  }
}

function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

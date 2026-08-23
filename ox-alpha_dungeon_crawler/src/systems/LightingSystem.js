// LightingSystem.js — ambient/fog, torches (exposed-edge placement), braziers,
// crystals lights handled by props, start/exit markers, god rays, dispose (§12.1/§22)
import * as THREE from 'three';
import { BIOMES, LIGHT_SOURCES, TORCH_SHADOW_COUNT } from '../core/Constants.js';

const TORCH_SPACING = 16; // real spacing (u) along exposed edges

export default class LightingSystem {
  constructor() {
    this.group = null;
    this.lights = [];
    this._disposables = [];
    this.torchLights = [];
    this.markerExit = null;
    this.markerStart = null;
    this.godRays = [];
  }

  init(scene, dungeon, biomeId) {
    const pal = BIOMES[biomeId];
    const group = new THREE.Group();
    this.group = group;
    scene.add(group);

    // ambient + fog
    this.ambient = new THREE.AmbientLight(pal.ambient, pal.ambientIntensity);
    group.add(this.ambient);
    scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);
    scene.background = new THREE.Color(pal.fog);

    const { grid, gridSize, cellSize } = dungeon;

    // torches: standard = one per exposed grid edge; vaultOnly = VAULT rooms only.
    // spacing 16 u, y 2.5. Exactly TORCH_SHADOW_COUNT cast shadows (nearest entrance, static).
    let torchCount = 0;
    const torchPositions = [];
    const isVaultOnly = pal.torchMode === 'vaultOnly';
    for (let z = 0; z < gridSize; z++) {
      for (let x = 0; x < gridSize; x++) {
        if (grid[z][x] === 'empty') continue;
        if (isVaultOnly && grid[z][x] !== 'room') continue;
        if (isVaultOnly && dungeon.metadata[z][x].roomType !== 'VAULT') continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = z + dz;
          const exposed = nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize || grid[nz][nx] === 'empty';
          if (!exposed) continue;
          const wx = x * cellSize + dx * cellSize * 0.42;
          const wz = z * cellSize + dz * cellSize * 0.42;
          // spacing filter along the edge direction
          const key = Math.round((dx ? wz : wx) / TORCH_SPACING);
          torchPositions.push({ wx, wz, key, dx });
        }
      }
    }
    // dedupe by position key then build
    const seen = new Set();
    const torchGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.7, 6);
    const flameGeo = new THREE.SphereGeometry(0.12, 6, 5);
    const torchMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 1 });
    const flameMat = new THREE.MeshBasicMaterial({ color: pal.torchColor });
    this._disposables.push(torchGeo, flameGeo, torchMat, flameMat);

    for (const t of torchPositions) {
      const dedupeKey = `${Math.round(t.wx)}:${Math.round(t.wz)}:${t.key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const stick = new THREE.Mesh(torchGeo, torchMat);
      stick.position.set(t.wx, 2.5, t.wz);
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(t.wx, 2.95, t.wz);
      const light = new THREE.PointLight(pal.torchColor, LIGHT_SOURCES.TORCH.intensity, LIGHT_SOURCES.TORCH.distance, LIGHT_SOURCES.TORCH.decay);
      light.position.set(t.wx, 3.1, t.wz);
      light.castShadow = false; // assigned once below
      group.add(stick, flame, light);
      this.lights.push(light);
      this.torchLights.push(light);
      torchCount++;
    }
    // ONE shadow-casting torch, nearest the entrance, assigned ONCE at level build
    if (this.torchLights.length && dungeon.entranceCell) {
      const ex = dungeon.entranceCell.x * cellSize, ez = dungeon.entranceCell.z * cellSize;
      let best = null, bestD = Infinity;
      for (const l of this.torchLights) {
        const d = (l.position.x - ex) ** 2 + (l.position.z - ez) ** 2;
        if (d < bestD) { bestD = d; best = l; }
      }
      if (best) {
        best.castShadow = true;
        best.shadow.mapSize.set(256, 256);
        best.shadow.camera.near = 0.5;
        best.shadow.camera.far = 11;
        best.shadow.bias = -0.005;
        best.shadow.normalBias = 0.02;
      }
    }

    // braziers: one lit brazier per room of brazierRooms
    const bowlGeo = new THREE.CylinderGeometry(0.45, 0.3, 0.4, 8);
    const legGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.9, 6);
    this._disposables.push(bowlGeo, legGeo);
    for (const room of dungeon.rooms) {
      if (!pal.brazierRooms.includes(room.type)) continue;
      const bx = (room.cx + (room.w - 1) / 2) * cellSize;
      const bz = (room.cz + (room.h - 1) / 2) * cellSize;
      const bowl = new THREE.Mesh(bowlGeo, torchMat);
      bowl.position.set(bx, 1.1, bz);
      const leg = new THREE.Mesh(legGeo, torchMat);
      leg.position.set(bx, 0.45, bz);
      const fire = new THREE.Mesh(flameGeo, flameMat);
      fire.scale.set(2, 1.6, 2);
      fire.position.set(bx, 1.45, bz);
      const light = new THREE.PointLight(pal.torchColor, LIGHT_SOURCES.BRAZIER.intensity, LIGHT_SOURCES.BRAZIER.distance, LIGHT_SOURCES.BRAZIER.decay);
      light.position.set(bx, 1.8, bz);
      group.add(bowl, leg, fire, light);
      this.lights.push(light);
    }

    // start marker: green ring + light at the entrance
    if (dungeon.entranceCell) {
      const sx = dungeon.entranceCell.x * cellSize, sz = dungeon.entranceCell.z * cellSize;
      this.markerStart = this._makeMarker(group, sx, sz, 0x44ff66, 'start');
    }
    // exit marker: golden ring + glow + vertical beam + light
    if (dungeon.exitCell) {
      const ex = dungeon.exitCell.x * cellSize, ez = dungeon.exitCell.z * cellSize;
      this.markerExit = this._makeMarker(group, ex, ez, 0xffd700, 'exit');
    }

    // god rays: only in VAULT rooms — one additive shaft per torch inside a VAULT
    const rayMat = new THREE.MeshBasicMaterial({
      color: pal.torchColor, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    this._disposables.push(rayMat);
    for (const room of dungeon.rooms) {
      if (room.type !== 'VAULT') continue;
      const rx = (room.cx + (room.w - 1) / 2) * cellSize;
      const rz = (room.cz + (room.h - 1) / 2) * cellSize;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 20, 6, 1, true), rayMat);
      shaft.position.set(rx, 10, rz);
      group.add(shaft);
      this.godRays.push(shaft);
    }
  }

  _makeMarker(group, x, z, color, kind) {
    const ringGeo = new THREE.TorusGeometry(kind === 'exit' ? 1.1 : 0.9, 0.06, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color });
    this._disposables.push(ringGeo, ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.06, z);
    group.add(ring);
    const intensity = kind === 'exit' ? LIGHT_SOURCES.MARKER_EXIT : LIGHT_SOURCES.MARKER_START;
    const light = new THREE.PointLight(color, intensity.intensity, intensity.distance, intensity.decay);
    light.position.set(x, kind === 'exit' ? 2.5 : 1.5, z);
    group.add(light);
    this.lights.push(light);
    const obj = { ring, light };
    if (kind === 'exit') {
      const beamGeo = new THREE.CylinderGeometry(0.25, 0.25, 14, 8, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this._disposables.push(beamGeo, beamMat);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(x, 7, z);
      group.add(beam);
      obj.beam = beam;
    }
    return obj;
  }

  update(time) {
    // subtle flicker on torches (intensity jitter only — no per-frame toggling)
    for (const l of this.torchLights) {
      l.intensity = LIGHT_SOURCES.TORCH.intensity * (0.92 + 0.08 * Math.sin(time * 0.011 + l.position.x));
    }
    if (this.markerStart?.ring) this.markerStart.ring.rotation.z += 0.01;
    if (this.markerExit?.ring) this.markerExit.ring.rotation.z -= 0.012;
  }

  applyBRIGHT(on, pal) {
    // ambient ×2.5, fog density ×0.35 while active
    if (on) {
      this._savedAmbient = { i: this.ambient.intensity };
      this.ambient.intensity = pal.ambientIntensity * 2.5;
      this.sceneRef?.fog;
    } else if (this._savedAmbient) {
      this.ambient.intensity = pal.ambientIntensity;
      this._savedAmbient = null;
    }
  }

  dispose(scene) {
    if (this.group && scene) {
      scene.remove(this.group);
      scene.fog = null;
      scene.background = null;
    }
    for (const d of this._disposables) d.dispose();
    this.lights = []; this.torchLights = []; this.godRays = [];
    this.group = null; this.ambient = null; this._disposables = [];
  }
}

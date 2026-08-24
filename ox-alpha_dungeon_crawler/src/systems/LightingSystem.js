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

    // ambient + fog — bright ambient floor so NOTHING is ever pitch black.
    // Key: the ambient light's COLOR must be bright (near-white with a biome tint),
    // because AmbientLight multiplies color × intensity — a dark brown color stays dark
    // no matter the intensity.
    const brightTint = new THREE.Color(pal.ambient).lerp(new THREE.Color(0xffffff), 0.6);
    this.ambient = new THREE.AmbientLight(brightTint, 1.0);
    group.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(
      new THREE.Color(pal.ceiling).lerp(new THREE.Color(0xffffff), 0.7),
      new THREE.Color(pal.floor).lerp(new THREE.Color(0xffffff), 0.55),
      0.6);
    group.add(this.hemi);
    // soft directional from above: gives floor/walls shape (flat ambient = flat look)
    this.dir = new THREE.DirectionalLight(0xfff4e0, 0.28);
    this.dir.position.set(3, 10, 2);
    group.add(this.dir);
    // fog/background lifted toward a BIOME-TINTED gray (not white) — keeps each
    // biome's identity visible while never reading as pure black
    const fogLifted = new THREE.Color(pal.fog).lerp(new THREE.Color(0x8a8478), 0.55);
    scene.fog = new THREE.FogExp2(fogLifted.getHex(), pal.fogDensity * 0.45);
    scene.background = fogLifted.clone();

    const { grid, gridSize, cellSize } = dungeon;

    // torches: standard = one per exposed grid edge; vaultOnly = VAULT rooms only.
    // spacing 16 u, y 2.5. Exactly TORCH_SHADOW_COUNT cast shadows (nearest entrance, static).
    let torchCount = 0;
    const torchPositions = [];
    const isVaultOnly = pal.torchMode === 'vaultOnly';
    // Torch placement strategy (playability ruling): torches on EVERY cell center
    // row/column intersection of walkable space — dense enough that the whole map
    // reads as lit, spaced to avoid doubling up on adjacent parallel edges.
    for (let z = 0; z < gridSize; z++) {
      for (let x = 0; x < gridSize; x++) {
        if (grid[z][x] === 'empty') continue;
        if (isVaultOnly && grid[z][x] !== 'room') continue;
        if (isVaultOnly && dungeon.metadata[z][x].roomType !== 'VAULT') continue;
        // one torch per open cell whose grid coords are both even — a regular
        // 2-cell lattice (12 u spacing) covering every room and corridor
        if ((x + z) % 2 !== 0) continue;
        const wx = x * cellSize;
        const wz = z * cellSize;
        torchPositions.push({ wx, wz, key: 0, dx: 1 });
      }
    }
    // dedupe by position key then build
    const seen = new Set();
    const torchGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.7, 6);
    const bracketGeo = new THREE.BoxGeometry(0.3, 0.3, 0.05);
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.09, 1.6, 6);
    const flameGeo = new THREE.SphereGeometry(0.12, 6, 5);
    const torchMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 1 });
    const flameMat = new THREE.MeshBasicMaterial({ color: pal.torchColor });
    this._disposables.push(torchGeo, bracketGeo, poleGeo, flameGeo, torchMat, flameMat);

    for (const t of torchPositions) {
      const dedupeKey = `${Math.round(t.wx)}:${Math.round(t.wz)}:${t.key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const gx = Math.round(t.wx / cellSize), gz = Math.round(t.wz / cellSize);
      const isOpen = (x, z) => x >= 0 && z >= 0 && x < gridSize && z < gridSize && grid[z][x] !== 'empty';
      // find an adjacent wall to mount against (N/E/S/W); open cells get a floor-standing torch
      const wallDirs = [
        { dx: 0, dz: -1, rot: 0,          ox: 0,          oz: -cellSize / 2 },  // wall to north
        { dx: 1, dz: 0,  rot: Math.PI / 2, ox: cellSize / 2,  oz: 0 },          // wall to east
        { dx: 0, dz: 1,  rot: 0,          ox: 0,          oz: cellSize / 2 },   // wall to south
        { dx: -1, dz: 0, rot: Math.PI / 2, ox: -cellSize / 2, oz: 0 },          // wall to west
      ].filter(d => !isOpen(gx + d.dx, gz + d.dz));
      const group2 = new THREE.Group();
      if (wallDirs.length) {
        // wall-mounted: bracket plate ON the wall face, stick below it, flame just
        // proud of the wall, light exactly at the flame (nothing floats)
        const d = wallDirs[0];
        const bx = t.wx + d.ox * 0.94, bz = t.wz + d.oz * 0.94; // just inside the wall face
        const fx = t.wx + d.ox * 0.78, fz = t.wz + d.oz * 0.78; // flame proud of the wall
        const bracket = new THREE.Mesh(bracketGeo, torchMat);
        bracket.position.set(bx, 2.1, bz);
        bracket.rotation.y = d.rot;
        const stick = new THREE.Mesh(torchGeo, torchMat);
        stick.position.set(fx, 1.75, fz);
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.set(fx, 2.12, fz);
        const light = new THREE.PointLight(pal.torchColor, LIGHT_SOURCES.TORCH.intensity, LIGHT_SOURCES.TORCH.distance, LIGHT_SOURCES.TORCH.decay);
        light.position.set(fx, 2.12, fz);
        light.castShadow = false; // assigned once below
        group2.add(bracket, stick, flame, light);
        this.lights.push(light);
        this.torchLights.push(light);
      } else {
        // no adjacent wall (open room): standing torch — pole from the floor,
        // flame + light on top. Reads as intentional, never floating.
        const pole = new THREE.Mesh(poleGeo, torchMat);
        pole.position.set(t.wx, 0.8, t.wz);
        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.set(t.wx, 1.75, t.wz);
        const light = new THREE.PointLight(pal.torchColor, LIGHT_SOURCES.TORCH.intensity, LIGHT_SOURCES.TORCH.distance, LIGHT_SOURCES.TORCH.decay);
        light.position.set(t.wx, 1.75, t.wz);
        light.castShadow = false;
        group2.add(pole, flame, light);
        this.lights.push(light);
        this.torchLights.push(light);
      }
      group.add(group2);
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
    // ambient ×2 while active; restore otherwise
    if (on) {
      this.ambient.intensity = 2.0;
    } else if (this._brightWasOn) {
      this.ambient.intensity = 1.0;
    }
    this._brightWasOn = on;
  }

  dispose(scene) {
    if (this.group && scene) {
      scene.remove(this.group);
      scene.fog = null;
      scene.background = null;
    }
    this.hemi = null; this.dir = null;
    for (const d of this._disposables) d.dispose();
    this.lights = []; this.torchLights = []; this.godRays = [];
    this.group = null; this.ambient = null; this._disposables = [];
  }
}

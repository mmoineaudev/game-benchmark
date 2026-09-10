/**
 * BiomeVisuals.js — per-sector atmosphere (user feedback: enhance the visual
 * experience of the biome ladder). Each sector declares:
 *   bg      — scene background color
 *   fog     — FogExp2 color + density (0 = no fog)
 *   star    — starfield tint + brightness (multiplied over star colors)
 *   rock    — asteroid hull tint (material color, lerped)
 *   light   — key light tint + intensity
 *
 * update() lerps the CURRENT scene state toward the active sector's targets
 * (~2 s blend), so crossing a sector boundary is a smooth visual transition
 * rather than a hard cut. Voids are near-black with thin fog; the Forge is
 * the only red-lit sector.
 */
import * as THREE from 'three';
import { SECTORS } from '../core/Constants.js';

/** Per-palette visual targets (referenced by sector key via SECTORS.palette). */
const PALETTES = {
  'blue-grey': {
    bg: 0x060a12, fog: { color: 0x0a1020, density: 0.00006 },
    star: { tint: 0xbfd4ff, brightness: 1.0 },
    rock: 0x8a8f98,
    light: { color: 0xffffff, intensity: 1.6 },
  },
  'near-black': {
    bg: 0x010204, fog: { color: 0x010204, density: 0.00012 },
    star: { tint: 0x8fa3c8, brightness: 0.35 },
    rock: 0x4a5058,
    light: { color: 0x9db4d8, intensity: 0.7 },
  },
  'rust-orange': {
    bg: 0x120a06, fog: { color: 0x1c0f06, density: 0.00009 },
    star: { tint: 0xffd9b0, brightness: 0.9 },
    rock: 0x9a6a44,
    light: { color: 0xffc48a, intensity: 1.5 },
  },
  'cyan-magenta': {
    bg: 0x071118, fog: { color: 0x0c1c26, density: 0.00008 },
    star: { tint: 0x9ff0ff, brightness: 1.1 },
    rock: 0x6a8a9a,
    light: { color: 0xb0f0ff, intensity: 1.6 },
  },
  'teal': {
    bg: 0x041210, fog: { color: 0x0a2822, density: 0.00010 },
    star: { tint: 0xa8ffe8, brightness: 0.85 },
    rock: 0x5a8a7d,
    light: { color: 0x9fffe0, intensity: 1.4 },
  },
  'amber': {
    bg: 0x140d04, fog: { color: 0x241705, density: 0.00009 },
    star: { tint: 0xffe8a8, brightness: 0.8 },
    rock: 0x9a8452,
    light: { color: 0xffd27a, intensity: 1.5 },
  },
  'red-gold': {
    bg: 0x160404, fog: { color: 0x2a0a04, density: 0.00010 },
    star: { tint: 0xffb090, brightness: 0.9 },
    rock: 0x8a5040,
    light: { color: 0xff9a5a, intensity: 1.7 },
  },
  'void-purple': {
    bg: 0x06030c, fog: { color: 0x0d0518, density: 0.00011 },
    star: { tint: 0xd0b0ff, brightness: 0.55 },
    rock: 0x3a2a4a,
    light: { color: 0xb08aff, intensity: 1.1 },
  },
  'dead-star': {
    bg: 0x020308, fog: { color: 0x05060c, density: 0.00007 },
    star: { tint: 0xff8080, brightness: 0.75 },
    rock: 0x44484f,
    light: { color: 0xff6a5a, intensity: 1.2 },
  },
  'bone-rot': {
    bg: 0x0c0806, fog: { color: 0x181008, density: 0.00013 },
    star: { tint: 0xd8b890, brightness: 0.7 },
    rock: 0x6a5a44,
    light: { color: 0xd8a878, intensity: 1.3 },
  },
  'the-end': {
    bg: 0x000000, fog: { color: 0x000000, density: 0 },
    star: { tint: 0xffffff, brightness: 0.12 },
    rock: 0x202020,
    light: { color: 0x8090a0, intensity: 0.5 },
  },
};

class _BiomeVisuals {
  /**
   * @param {THREE.Scene} scene
   * @param {object} refs { starfield, asteroidMat, keyLight }
   */
  constructor(scene, refs) {
    this._scene = scene;
    this._refs = refs;

    // Scene background + fog start black-ish (open space default).
    const def = PALETTES['blue-grey'];
    scene.background = new THREE.Color(def.bg);
    scene.fog = new THREE.FogExp2(def.fog.color, def.fog.density);

    /** Current sector key (only transition on change). */
    this._sectorKey = 'open-space';
    /** Transition progress 0..1 (1 = fully blended into the target). */
    this._t = 1;
    /** Blend colors: current values lerped toward the target. */
    this._bg = new THREE.Color(def.bg);
    this._fogC = new THREE.Color(def.fog.color);
    this._fogD = def.fog.density;
    this._starTint = new THREE.Color(def.star.tint);
    this._starB = def.star.brightness;
    this._rock = new THREE.Color(def.rock);
    this._lightC = new THREE.Color(def.light.color);
    this._lightI = def.light.intensity;
    /** Blend source (snapshot at transition start). */
    this._from = {
      bg: this._bg.clone(), fogC: this._fogC.clone(), fogD: this._fogD,
      starTint: this._starTint.clone(), starB: this._starB,
      rock: this._rock.clone(), lightC: this._lightC.clone(),
      lightI: this._lightI,
    };
  }

  /**
   * Per-frame: detect sector change, then blend all visuals toward the
   * active palette.
   * @param {number} dt delta s.
   * @param {string} sectorKey active sector key.
   */
  update(dt, sectorKey) {
    if (sectorKey !== this._sectorKey) {
      this._sectorKey = sectorKey;
      this._t = 0;
      // Snapshot current visual state as the blend source.
      this._from.bg.copy(this._bg);
      this._from.fogC.copy(this._fogC);
      this._from.fogD = this._fogD;
      this._from.starTint.copy(this._starTint);
      this._from.starB = this._starB;
      this._from.rock.copy(this._rock);
      this._from.lightC.copy(this._lightC);
      this._from.lightI = this._lightI;
    }

    // Advance the blend (~2 s full transition).
    if (this._t < 1) {
      this._t = Math.min(1, this._t + dt / 2);
      const k = this._t * this._t * (3 - 2 * this._t); // smoothstep
      const pal = PALETTES[SECTORS.find((s) => s.key === this._sectorKey)?.palette] ?? PALETTES['blue-grey'];
      this._bg.copy(this._from.bg).lerp(new THREE.Color(pal.bg), k);
      this._fogC.copy(this._from.fogC).lerp(new THREE.Color(pal.fog.color), k);
      this._fogD = this._from.fogD + (pal.fog.density - this._from.fogD) * k;
      this._starTint.copy(this._from.starTint).lerp(new THREE.Color(pal.star.tint), k);
      this._starB = this._from.starB + (pal.star.brightness - this._from.starB) * k;
      this._rock.copy(this._from.rock).lerp(new THREE.Color(pal.rock), k);
      this._lightC.copy(this._from.lightC).lerp(new THREE.Color(pal.light.color), k);
      this._lightI = this._from.lightI + (pal.light.intensity - this._from.lightI) * k;
    }

    // Apply to the scene.
    this._scene.background.copy(this._bg);
    const fog = /** @type {THREE.FogExp2} */ (this._scene.fog);
    fog.color.copy(this._fogC);
    fog.density = this._fogD;

    // Starfield tint (star material color is vertexColors; tint via the
    // shared material color multiplier).
    if (this._refs.starfield?.setTint) {
      this._refs.starfield.setTint(this._starTint, this._starB);
    }
    // Asteroid hull tint.
    if (this._refs.asteroidMat) {
      this._refs.asteroidMat.color.copy(this._rock);
    }
    // Key light.
    if (this._refs.keyLight) {
      this._refs.keyLight.color.copy(this._lightC);
      this._refs.keyLight.intensity = this._lightI;
    }
  }
}

export { _BiomeVisuals as BiomeVisuals };
export default _BiomeVisuals;

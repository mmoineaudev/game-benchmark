// BiomeSystem.js — biome progression, palette resolution, lazy per-biome texture cache (§7)
import * as THREE from 'three';
import { BIOMES, BIOME_SEQUENCE, biomeForLevel } from '../core/Constants.js';
import { generateStoneWallTexture, generateFloorTexture, generateCeilingTexture } from './Textures.js';

export default class BiomeSystem {
  constructor() {
    this.current = 'STONE';
    this.index = 0;
    this._texCache = new Map(); // biomeId -> {wall, floor, ceiling}
  }

  applyLevel(level, state) {
    const id = biomeForLevel(level);
    const changed = id !== this.current;
    const prev = this.current;
    this.current = id;
    this.index = BIOME_SEQUENCE.indexOf(id);
    state.biome = id;
    state.biomeIndex = this.index;
    return { changed, prev };
  }

  palette() { return BIOMES[this.current]; }
  isBossBiome() { return this.current === 'SPECTRAL_COURT'; }

  // lazy per-biome texture set — cached across levels; marked biomeCached so
  // _disposeScene never disposes these.
  textures() {
    let set = this._texCache.get(this.current);
    if (!set) {
      const pal = BIOMES[this.current];
      const wallC = new THREE.CanvasTexture(generateStoneWallTexture(256, pal.wall));
      const floorC = new THREE.CanvasTexture(generateFloorTexture(256, pal.floor));
      const ceilC = new THREE.CanvasTexture(generateCeilingTexture(256, pal.ceiling));
      for (const t of [wallC, floorC, ceilC]) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(2, 2);
        t.colorSpace = THREE.SRGBColorSpace;
      }
      set = { wall: wallC, floor: floorC, ceiling: ceilC };
      for (const t of Object.values(set)) t.userData.biomeCached = true;
      this._texCache.set(this.current, set);
    }
    return set;
  }

  dispose() {
    // cache survives level regens by design (§14); only explicit shutdown clears it
    for (const set of this._texCache.values())
      for (const t of Object.values(set)) t.dispose();
    this._texCache.clear();
  }
}

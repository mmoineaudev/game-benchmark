import * as THREE from 'three';
import { BIOMES, biomeForLevel } from '../core/Constants.js';
import {
  generateStoneWallTexture, generateFloorTexture, generateCeilingTexture,
} from './Textures.js';

// Biome progression + palette application. One instance lives for the whole run
// (created in Game, survives level regens) and caches the 5 texture sets so a
// regen never re-generates canvases.
export class BiomeSystem {
  constructor() {
    this._cache = new Map(); // biomeId -> { wallTex, floorTex, ceilingTex }
    this.current = null;     // { id, palette }
  }

  // Texture set for a biome (cached, generated once per run)
  texturesFor(biomeId) {
    if (this._cache.has(biomeId)) return this._cache.get(biomeId);
    const pal = BIOMES[biomeId];
    const wallTex = generateStoneWallTexture(256, pal.wall);
    wallTex.wrapS = THREE.RepeatWrapping;
    wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.repeat.set(2, 2);
    const floorTex = generateFloorTexture(256, pal.floor);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(2, 2);
    const ceilingTex = generateCeilingTexture(256, pal.ceiling);
    // Mark as run-level cached so Game._disposeScene doesn't dispose them on regen
    for (const tex of [wallTex, floorTex, ceilingTex]) {
      tex.userData.biomeCached = true;
    }
    const set = { wallTex, floorTex, ceilingTex };
    this._cache.set(biomeId, set);
    return set;
  }

  // Resolve biome for a level and update `state.biome`/`state.biomeIndex`.
  // Returns true if the biome changed vs. the previous level (for biome:change events).
  applyLevel(level, state) {
    const id = biomeForLevel(level);
    const changed = state.biome !== id;
    state.biome = id;
    state.biomeIndex = BIOMES.SEQUENCE.indexOf(id);
    this.current = { id, palette: BIOMES[id] };
    return changed;
  }

  // Apply palette to the scene: fog, ambient, background tint.
  applyScene(scene) {
    const pal = this.current.palette;
    scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);
    // Ambient is re-created by LightingSystem; this only handles fog + background.
    // The background stays near-black (matches fog) so the tone holds.
    scene.background = new THREE.Color(pal.fog);
  }

  dispose() {
    for (const set of this._cache.values()) {
      set.wallTex.dispose();
      set.floorTex.dispose();
      set.ceilingTex.dispose();
    }
    this._cache.clear();
    this.current = null;
  }
}

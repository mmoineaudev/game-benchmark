/**
 * BiomeSystem.js — biome progression + lazy per-biome texture cache (§7, §14, §15).
 *
 * Survives across level regens (§14): the texture cache holds THREE textures
 * marked `userData.biomeCached = true` so the scene-dispose sweep spares them.
 * Only resources this class created itself are released by dispose().
 */

import { BIOMES, BIOME_SEQUENCE, biomeForLevel } from '../core/Constants.js';
import {
  generateStoneWallTexture,
  generateFloorTexture,
  generateCeilingTexture,
} from './Textures.js';

export class BiomeSystem {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.biome = null;
    this.biomeIndex = -1;
    this.textureCache = new Map(); // biomeId -> {wall, floor, ceiling}
  }

  /**
   * Apply the biome for `level` to `state` (§7: fixed for the whole level,
   * applied at level build). Emits `biome:change` only when the biome actually
   * changed vs the previous application.
   */
  applyLevel(level, state) {
    const biome = biomeForLevel(level);
    const changed = biome !== this.biome;
    this.biome = biome;
    this.biomeIndex = BIOME_SEQUENCE.indexOf(biome);

    state.biome = biome;
    state.biomeIndex = this.biomeIndex;

    if (changed && this.eventBus) {
      this.eventBus.emit('biome:change', { biome, biomeIndex: this.biomeIndex });
    }
    return biome;
  }

  /**
   * Lazy per-biome texture set. Builds {wall, floor, ceiling} THREE textures
   * once per biome using the Textures.js generators with the BIOMES palette
   * tints (§7.1: wall/floor/ceiling hex), caches them, and marks each with
   * `userData.biomeCached = true` so scene dispose spares them (§14).
   * In headless environments the generators return null; entries stay null.
   */
  getTexturesFor(biomeId) {
    if (this.textureCache.has(biomeId)) return this.textureCache.get(biomeId);

    const palette = BIOMES[biomeId] || {};
    const set = {
      wall: generateStoneWallTexture(256, palette.wall),
      floor: generateFloorTexture(256, palette.floor),
      ceiling: generateCeilingTexture(256, palette.ceiling),
    };
    for (const tex of Object.values(set)) {
      if (tex) tex.userData.biomeCached = true;
    }
    this.textureCache.set(biomeId, set);
    return set;
  }

  /** Texture set for the current biome (built lazily on first call). */
  currentTextures() {
    return this.biome ? this.getTexturesFor(this.biome) : null;
  }

  /**
   * Release non-cached resources. Cached biome textures are NOT disposed
   * here — they are the shared per-biome cache that survives level regens
   * (§14) and are owned by the cache, not by any scene.
   */
  dispose() {
    // Nothing transient is held: all textures live in this.textureCache and
    // are cached by design. Guarded double-dispose per §14 dispose contract.
    this.textureCache.clear();
    this.biome = null;
    this.biomeIndex = -1;
  }
}

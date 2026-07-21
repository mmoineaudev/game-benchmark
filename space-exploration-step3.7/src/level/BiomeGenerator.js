// ============================================================
// BiomeGenerator — Biome variant selection
// ============================================================
import Constants from '../core/Constants.js';
import { chunkSeed, mapRange, clamp, mulberry32 } from '../utils/MathHelpers.js';

class BiomeGenerator {
  constructor() {
    this._biomes = Constants.BIOME.ZONES;
  }

  /**
   * Get the current biome based on distance traveled
   */
  getCurrentBiome(distance) {
    let current = this._biomes[0];
    for (const zone of this._biomes) {
      if (distance >= zone.start && distance < zone.end) {
        current = zone;
      }
    }
    // Wrap for distances beyond last zone
    if (distance >= this._biomes[this._biomes.length - 1].end) {
      const totalCycle = this._biomes[this._biomes.length - 1].end;
      const cycle = distance % totalCycle;
      for (const zone of this._biomes) {
        if (cycle >= zone.start && cycle < zone.end) {
          current = zone;
          break;
        }
      }
    }
    return current;
  }

  /**
   * Get biome properties for visual/audio parameters
   */
  getBiomeParams(distance) {
    const biome = this.getCurrentBiome(distance);
    const intensity = 1 + distance / 5000;

    const params = {
      name: biome.name,
      nebulaCount: 0,
      nebulaDensity: 0,
      asteroidDensity: 0,
      debrisCount: 0,
      ambientColor: 0x000011,
      fogDensity: Constants.SCENE.FOG_DENSITY,
      wormholeActive: false,
      nebulaColors: { c1: [0.1, 0.1, 0.4], c2: [0.2, 0.1, 0.5], c3: [0.1, 0.3, 0.5] },
      tunnelColors: { c1: [0.3, 0.1, 0.6], c2: [0.1, 0.3, 0.8] },
    };

    switch (biome.name) {
      case 'Open Space':
        params.nebulaCount = 1;
        params.nebulaDensity = 0.15;
        params.asteroidDensity = 0.35;
        params.debrisCount = 8;
        params.nebulaColors = { c1: [0.1, 0.1, 0.4], c2: [0.2, 0.1, 0.5], c3: [0.1, 0.3, 0.5] };
        break;
      case 'Asteroid Belt':
        params.nebulaCount = 1;
        params.nebulaDensity = 0.15;
        params.asteroidDensity = 0.8;
        params.debrisCount = 8;
        params.ambientColor = 0x110800;
        params.nebulaColors = { c1: [0.5, 0.2, 0.05], c2: [0.7, 0.3, 0.1], c3: [0.4, 0.15, 0.05] };
        break;
      case 'Nebula Corridor':
        params.nebulaCount = 3;
        params.nebulaDensity = 0.4;
        params.asteroidDensity = 0.2;
        params.debrisCount = 10;
        params.nebulaColors = { c1: [0.3, 0.1, 0.5], c2: [0.1, 0.4, 0.5], c3: [0.5, 0.2, 0.3] };
        break;
      case 'Wormhole Tunnel':
        params.nebulaCount = 2;
        params.nebulaDensity = 0.5;
        params.asteroidDensity = 0.05;
        params.debrisCount = 4;
        params.wormholeActive = true;
        params.nebulaColors = { c1: [0.3, 0.1, 0.6], c2: [0.1, 0.3, 0.8], c3: [0.1, 0.6, 0.7] };
        params.tunnelColors = { c1: [0.4, 0.2, 0.8], c2: [0.1, 0.5, 0.9] };
        break;
    }

    // Apply intensity scaling
    params.nebulaCount = Math.floor(params.nebulaCount * Math.min(intensity, 3));
    params.nebulaDensity *= Math.min(intensity, 2.5);
    params.asteroidDensity *= Math.min(intensity, 3);
    params.debrisCount = Math.floor(params.debrisCount * Math.min(intensity, 3));

    return params;
  }

  /**
   * Generate a seeded random for chunk content
   */
  getChunkRNG(chunkX, chunkY, chunkZ) {
    const seed = chunkSeed(chunkX, chunkY || 0, chunkZ || 0);
    return mulberry32(seed);
  }
}

export default BiomeGenerator;
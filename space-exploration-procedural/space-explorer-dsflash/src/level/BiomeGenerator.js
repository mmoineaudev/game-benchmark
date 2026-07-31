import { Constants } from '../core/Constants.js';

// Biome variant selection per distance zone (spec §6.3).
// Distance = cumulative odometer (monotonic). Beyond 7000 u the biome
// cycle repeats with POST_7000_MULTIPLIER intensity.
const ORDER = ['OPEN_SPACE', 'ASTEROID_BELT', 'NEBULA_CORRIDOR', 'WORMHOLE'];

export class BiomeGenerator {
  /** @returns {number} index into ORDER (monotonic) */
  biomeIndexForDistance(d) {
    const base = Math.floor(d / 7000);
    const within = d % 7000;
    let idx = 0;
    for (let i = 0; i < ORDER.length; i++) {
      const [lo, hi] = Constants.BIOMES[ORDER[i]].range;
      if (within >= lo && within < hi) { idx = i; break; }
      if (within >= hi && i < ORDER.length - 1 && within < Constants.BIOMES[ORDER[i + 1]].range[0]) { idx = i; break; }
      if (within >= Constants.BIOMES[ORDER[ORDER.length - 1]].range[1]) { idx = ORDER.length - 1; break; }
    }
    // Clamp: within >= last range end stays in last biome
    if (within >= Constants.BIOMES[ORDER[ORDER.length - 1]].range[1]) idx = ORDER.length - 1;
    return base * ORDER.length + idx;
  }

  /** Full biome descriptor with cycle multiplier. */
  getBiome(d) {
    const idx = this.biomeIndexForDistance(d);
    const cycle = Math.floor(idx / ORDER.length);
    const key = ORDER[idx % ORDER.length];
    const cfg = Constants.BIOMES[key];
    const mult = cycle > 0 ? Constants.POST_7000_MULTIPLIER : 1;
    return { key, cfg, mult, index: idx };
  }

  /** Intensity multipliers within a zone (spec §6.3). */
  intensity(d) {
    return {
      asteroid: 1 + d / 5000,
      nebula: 1 + d / 8000,
      comet: 1 + d / 5000,
      blackHolePull: Math.min(2, 1 + d / 8000),
    };
  }
}

// VOID DRIFT — BiomeGenerator.js
// Distance → biome zone with wraparound (modulo full cycle) + intensity scaling.

import * as Constants from '../core/Constants.js';

export class BiomeGenerator {
  /** biome for a given distance from origin (Manhattan-style, cumulative-safe). */
  getBiome(distance) {
    const cycle = ((distance % Constants.BIOME.CYCLE_LENGTH) + Constants.BIOME.CYCLE_LENGTH) %
      Constants.BIOME.CYCLE_LENGTH;
    for (const zone of Constants.BIOME.ZONES) {
      if (cycle >= zone.min && cycle < zone.max) return zone;
    }
    return Constants.BIOME.ZONES[0];
  }

  /** Intensity multiplier: 1 + distance / divisor, clamped. */
  getIntensity(distance) {
    return Math.min(1 + distance / Constants.BIOME.INTENSITY_DIVISOR, Constants.BIOME.INTENSITY_MAX);
  }

  /** Resolved per-chunk params. */
  getBiomeParams(distance) {
    const zone = this.getBiome(distance);
    const intensity = this.getIntensity(distance);
    return {
      name: zone.name,
      nebulaCount: zone.nebulaCount,
      nebulaColors: zone.nebulaColors,
      asteroidDensity: Math.min(zone.asteroidDensity * intensity, 2.0),
      debrisCount: Math.floor(zone.debrisCount * intensity),
      wormhole: zone.wormhole,
    };
  }
}

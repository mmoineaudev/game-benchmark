import { Constants } from '../core/Constants.js';

// Biome ladder (spec v2.0 §3): fixed ascending sequence of 9 content rungs
// separated by 4 Deep Void travel zones. Distance = cumulative odometer
// (monotonic — rungs never regress). No cycling.
export class BiomeGenerator {
  /** @returns {number} index into Constants.LADDER (monotonic) */
  ladderIndexForDistance(d) {
    const ladder = Constants.LADDER;
    for (let i = 0; i < ladder.length; i++) {
      if (d >= ladder[i].range[0] && d < ladder[i].range[1]) return i;
    }
    return ladder.length - 1; // beyond the last range end (finale is Infinity)
  }

  /** Full ladder entry for a distance. */
  getBiome(d) {
    const idx = this.ladderIndexForDistance(d);
    const entry = Constants.LADDER[idx];
    return { key: entry.key, cfg: entry.cfg, mult: 1, index: idx, rungIndex: idx, scoreMult: entry.scoreMult, name: entry.name };
  }

  /** 1-based content-rung number (voids map to the previous content rung). */
  contentRungForDistance(d) {
    const idx = this.ladderIndexForDistance(d);
    let rung = 0;
    for (let i = 0; i <= idx; i++) {
      if (Constants.LADDER[i].key !== 'DEEP_VOID') rung++;
    }
    return rung;
  }

  /** Progress 0..1 within the current ladder entry (finale = 1). */
  progressForDistance(d) {
    const entry = Constants.LADDER[this.ladderIndexForDistance(d)];
    const [lo, hi] = entry.range;
    if (!isFinite(hi)) return 1;
    return Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
  }

  /** Intensity multipliers within a zone (capped, spec v2.0 §3.5). */
  intensity(d) {
    const caps = Constants.INTENSITY_CAPS;
    return {
      asteroid: Math.min(caps.asteroid, 1 + d / 5000),
      nebula: Math.min(caps.nebula, 1 + d / 8000),
      comet: Math.min(caps.comet, 1 + d / 5000),
      blackHolePull: Math.min(caps.blackHolePull, 1 + d / 8000),
    };
  }
}

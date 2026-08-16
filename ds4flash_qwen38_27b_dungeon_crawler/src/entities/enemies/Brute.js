// Brute.js — slam variant (§16.3).
// HP 8, speed 1.2, damage 3 (one-shot), range 2.4, cycle 1.2/0.3/1.2/2.5.
// Slam ±50° cone (0.87 rad). Elite: Ogre (HP 16, speed ×1.2, drops 4, scale ×1.9).

import { Skeleton } from '../Skeleton.js';
import { BRUTE, ELITE } from '../../core/Constants.js';

export class Brute extends Skeleton {
  constructor(scene, opts = {}) {
    const elite = opts.elite ? ELITE.BRUTE : null;
    super(scene, {
      ...opts,
      type: 'BRUTE',
      hp: elite ? elite.hp : (opts.hp ?? BRUTE.hp),
      speed: BRUTE.speed * (elite ? elite.speedMult : 1),
      damage: BRUTE.damage,
      range: BRUTE.range,
      cycle: {
        windup: BRUTE.windup, swing: BRUTE.swing,
        recover: BRUTE.recover, cooldown: BRUTE.cooldown,
      },
      drops: elite ? elite.drops : BRUTE.drops,
      elite: !!elite,
      scale: elite ? elite.scale : 1.3,
      colors: { body: 0x9a8468, glow: 0xff6a20, ...(opts.colors || {}) },
    });
    // Slam cone (radians, half-angle ±50°).
    this.coneHalfAngle = BRUTE.slamConeHalfAngle;
    this.dormantWakeRange = 8;
  }

  /**
   * Override the swing-hit: the brute's attack is a directional CONE slam
   * (±50°), not a point hit. Game's onAttackHit(enemy) will read
   * `enemy.coneHalfAngle` and `enemy.facing` to resolve the cone. We still
   * route through onAttackHit at swing progress ≥ 0.35 (inherited).
   */
  // (no override needed — inherited _runAttackCycle fires onAttackHit; the
  //  cone is resolved by Game using this.coneHalfAngle + this.facing.)
}

Skeleton.registerVariant('BRUTE', Brute);

export default Brute;

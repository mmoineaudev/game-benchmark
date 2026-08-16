// ArcherSkeleton.js — ranged kiter variant (§16.3).
// HP 2, speed 2.4, damage 1, range 10, cycle 0.5/0.1/0.4/1.8.
// Kites: stops at 8 u, retreats under 4 u at 2.0 u/s. Fires an arrow
// projectile (speed 8, life 3, radius 0.15) that needs LOS.
// Elite: Sharpshooter (drops 2, 2-arrow fan ±8°).

import { Skeleton } from '../Skeleton.js';
import { ARCHER, ELITE } from '../../core/Constants.js';

export class ArcherSkeleton extends Skeleton {
  constructor(scene, opts = {}) {
    const elite = opts.elite ? ELITE.ARCHER : null;
    super(scene, {
      ...opts,
      type: 'ARCHER',
      hp: elite ? elite.hp : (opts.hp ?? ARCHER.hp),
      speed: ARCHER.speed * (elite ? elite.speedMult : 1),
      damage: ARCHER.damage,
      range: ARCHER.range,
      cycle: {
        windup: ARCHER.windup, swing: ARCHER.swing,
        recover: ARCHER.recover, cooldown: ARCHER.cooldown,
      },
      drops: elite ? elite.drops : ARCHER.drops,
      elite: !!elite,
      colors: { body: 0xc8b89a, glow: 0x66ff99, ...(opts.colors || {}) },
    });
    // Kiter bands (§16.3).
    this.kiteStop = ARCHER.kiteStop;                 // 8 u
    this.kiteRetreatUnder = ARCHER.kiteRetreatUnder; // 4 u
    this.retreatSpeed = ARCHER.retreatSpeed;         // 2.0 u/s
    // Arrow projectile.
    this.projectileKind = 'arrow';
    this.configureRanged({
      speed: ARCHER.projectile.speed,   // 8
      life: ARCHER.projectile.life,     // 3
      radius: ARCHER.projectile.radius, // 0.15
      damage: ARCHER.damage,
      stopDistance: null,
      fanCount: elite ? ELITE.ARCHER.arrowFan : 1,             // 2 for elite
      fanHalfAngle: elite ? ELITE.ARCHER.arrowFanHalfAngle : 0, // ±8°
    });
    this.dormantWakeRange = 12; // archers engage from further out
  }

  /**
   * Override: archers only fire with LOS to the player (the swing hit at
   * progress ≥ 0.35 is gated here).
   */
  hasLOS(px, pz, boxes) {
    return super.hasLOS(px, pz, boxes);
  }
}

Skeleton.registerVariant('ARCHER', ArcherSkeleton);

export default ArcherSkeleton;

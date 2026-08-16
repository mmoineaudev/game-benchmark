// Wraith.js — phasing variant (§16.3).
// HP 2, speed 2.4, damage 1, range 0.9, instant/1.0. PHASES through walls —
// straight flight, no pathing/LOS, cannot be blocked. Elite: Banshee
// (HP 4, speed ×1.4, drops 3).

import { Skeleton } from '../Skeleton.js';
import { WRAITH, ELITE } from '../../core/Constants.js';

export class Wraith extends Skeleton {
  constructor(scene, opts = {}) {
    const elite = opts.elite ? ELITE.WRAITH : null;
    super(scene, {
      ...opts,
      type: 'WRAITH',
      hp: elite ? elite.hp : (opts.hp ?? WRAITH.hp),
      speed: WRAITH.speed * (elite ? elite.speedMult : 1),
      damage: WRAITH.damage,
      range: WRAITH.range,
      // instant/1.0: no windup/swing/recover, 1.0 s cooldown.
      cycle: { windup: 0, swing: 0, recover: 0, cooldown: WRAITH.swing /* 1.0 */ },
      drops: elite ? elite.drops : WRAITH.drops,
      elite: !!elite,
      phases: true, // PHASES: straight flight, ignores wall collision
      colors: { body: 0x5a6270, glow: 0xb088ff, ...(opts.colors || {}) },
    });
    this.dormantWakeRange = 7;
  }
}

Skeleton.registerVariant('WRAITH', Wraith);

export default Wraith;

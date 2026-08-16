// Rat.js — pack chaff variant (§16.3).
// HP 1, speed 4.2, damage 1, range 0.9, instant/0.8 cycle. The "instant/0.8"
// cycle means no windup — the contact hit is governed purely by a 0.8 s
// cooldown. Straight chase (greedy when blocked). No elite, 0 drops.

import { Skeleton } from '../Skeleton.js';
import { RAT } from '../../core/Constants.js';

export class Rat extends Skeleton {
  constructor(scene, opts = {}) {
    super(scene, {
      ...opts,
      type: 'RAT',
      hp: opts.hp ?? RAT.hp,
      speed: RAT.speed,
      damage: RAT.damage,
      range: RAT.range,
      // instant: windup/swing/recover = 0, full 0.8 s cooldown.
      cycle: { windup: 0, swing: 0, recover: 0, cooldown: RAT.swing /* 0.8 */ },
      drops: RAT.drops, // 0
      elite: false,
      scale: 0.5, // small chaff
      colors: { body: 0x7a5a3a, glow: 0xff4422, ...(opts.colors || {}) },
    });
    this.dormantWakeRange = 5;
  }
}

Skeleton.registerVariant('RAT', Rat);

export default Rat;

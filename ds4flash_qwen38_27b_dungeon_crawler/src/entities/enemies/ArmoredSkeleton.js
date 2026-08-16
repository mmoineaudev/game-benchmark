// ArmoredSkeleton.js — tank variant (§16.3).
// HP 5, speed 1.8, damage 2, range 0.85, cycle 0.5/0.3/0.5/1.6. No block
// (armor = HP, not a mechanic). Elite: Warlord (HP 10, speed ×1.3, drops 3).

import * as THREE from 'three';
import { Skeleton } from '../Skeleton.js';
import { ARMORED, ELITE } from '../../core/Constants.js';

export class ArmoredSkeleton extends Skeleton {
  constructor(scene, opts = {}) {
    const elite = opts.elite ? ELITE.ARMORED : null;
    super(scene, {
      ...opts,
      type: 'ARMORED',
      hp: elite ? elite.hp : (opts.hp ?? ARMORED.hp),
      speed: ARMORED.speed * (elite ? elite.speedMult : 1),
      damage: ARMORED.damage,
      range: ARMORED.range,
      cycle: {
        windup: ARMORED.windup, swing: ARMORED.swing,
        recover: ARMORED.recover, cooldown: ARMORED.cooldown,
      },
      drops: elite ? elite.drops : ARMORED.drops,
      elite: !!elite,
      colors: { body: 0x8a8f96, glow: 0x66e0ff, ...(opts.colors || {}) },
    });
    this._armorify();
  }

  /** Tank look: thicken the ribs and add shoulder plates (armor = HP visual). */
  _armorify() {
    const rib = this.bones.ribcage;
    if (!rib) return;
    // Bulk up existing rib boxes.
    for (const child of [...rib.children]) {
      if (child.geometry && child.geometry.type === 'BoxGeometry') {
        child.scale.y = 1.6;
        child.scale.x = 1.15;
      }
    }
    // Shoulder plates.
    const mkPlate = (x) => {
      const g = this._trackGeo(new THREE.BoxGeometry(0.14, 0.32, 0.14));
      const m = new THREE.Mesh(g, this._boneMat);
      m.position.set(x, 0.42, 0);
      rib.add(m);
    };
    mkPlate(0.28);
    mkPlate(-0.28);
  }
}

Skeleton.registerVariant('ARMORED', ArmoredSkeleton);

export default ArmoredSkeleton;

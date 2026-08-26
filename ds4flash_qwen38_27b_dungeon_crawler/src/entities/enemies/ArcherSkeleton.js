// ArcherSkeleton.js — ranged kiter variant (§16.3).
// HP 2, speed 2.4, damage 1, range 10, cycle 0.5/0.1/0.4/1.8.
// Kites: stops at 8 u, retreats under 4 u at 2.0 u/s. Fires an arrow
// projectile (speed 8, life 3, radius 0.15) that needs LOS.
// Elite: Sharpshooter (drops 2, 2-arrow fan ±8°).
//
// Distinct visuals: brown hooded head, green scarf, bow on left arm,
// quiver on back.

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
      colors: { body: 0x8b7355, glow: 0x55dd77, ...(opts.colors || {}) },
    });
    // Kiter bands (§16.3).
    this.kiteStop = ARCHER.kiteStop;                 // 8 u
    this.kiteRetreatUnder = ARCHER.kiteRetreatUnder; // 4 u
    this.retreatSpeed = ARCHER.retreatSpeed;         // 2.0 u/s
    // Arrow projectile.
    this.projectileKind = 'arrow';
    this.configureRanged({
      speed: ARCHER.projectile.speed,
      life: ARCHER.projectile.life,
      radius: ARCHER.projectile.radius,
      damage: ARCHER.damage,
      stopDistance: null,
      fanCount: elite ? ELITE.ARCHER.arrowFan : 1,
      fanHalfAngle: elite ? ELITE.ARCHER.arrowFanHalfAngle : 0,
    });
    this.dormantWakeRange = 12; // archers engage from further out

    // --- archer-specific visuals ---
    this._buildArcherGear();
  }

  _buildArcherGear() {
    const b = this.bones;

    // Hood: taller skull block + forward brim.
    const hoodMat = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 1 }));
    const hood = this._trackGeo(new THREE.BoxGeometry(0.24, 0.22, 0.26));
    hood.position.y = 0.14;
    b.head.add(hood);
    const brim = this._trackGeo(new THREE.BoxGeometry(0.28, 0.04, 0.12));
    brim.position.set(0, 0.04, 0.1);
    b.head.add(brim);

    // Scarf: thin green box around ribcage front.
    const scarfMat = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x3d8b5a, roughness: 0.9 }));
    const scarf = this._trackGeo(new THREE.BoxGeometry(0.22, 0.1, 0.08));
    scarf.position.set(0, 0.66, 0.14);
    b.ribcage.add(scarf);

    // Bow: held across armL. Simple curved shape using a thin cylinder + taut string.
    const bowMat = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 }));
    const bowStave = this._trackGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6));
    bowStave.rotation.x = Math.PI / 2;
    bowStave.position.set(0, -0.05, -0.2);
    b.armL.add(bowStave);

    const bowTipTop = this._trackGeo(new THREE.SphereGeometry(0.03, 6, 4));
    bowTipTop.position.set(0, 0.3, -0.2);
    b.armL.add(bowTipTop);
    const bowTipBot = this._trackGeo(new THREE.SphereGeometry(0.03, 6, 4));
    bowTipBot.position.set(0, -0.4, -0.2);
    b.armL.add(bowTipBot);

    const stringMat = this._trackMat(new THREE.MeshBasicMaterial({ color: 0xddccaa }));
    const bowString = this._trackGeo(new THREE.CylinderGeometry(0.005, 0.005, 0.7, 4));
    bowString.rotation.x = Math.PI / 2;
    bowString.position.set(0, -0.05, -0.2);
    b.armL.add(bowString);

    // Quiver: small box on back (ribcage rear).
    const quiverMat = this._trackMat(new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }));
    const quiver = this._trackGeo(new THREE.BoxGeometry(0.08, 0.28, 0.08));
    quiver.position.set(0, 0.7, -0.18);
    b.ribcage.add(quiver);
    for (let i = 0; i < 3; i++) {
      const shaft = this._trackGeo(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4));
      shaft.position.set(0, 0.05 + i * 0.09, 0);
      quiver.add(shaft);
    }
  }

  /** Override: archers only fire with LOS to the player. */
  hasLOS(px, pz, boxes) {
    return super.hasLOS(px, pz, boxes);
  }
}

Skeleton.registerVariant('ARCHER', ArcherSkeleton);

export default ArcherSkeleton;

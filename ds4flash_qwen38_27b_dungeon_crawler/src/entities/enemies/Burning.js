// Burning.js — BURN, the final foe (§18).
// HP = ceil(90 × (1 + 3·ngPlus)); speed 2.6, damage 1, range 1.3, cooldown 1.4.
// Chases straight-line (sub-stepped, collision-resolved — does NOT phase).
// While moving, every 0.6 s spawns a fire patch at its position via the
// `onFirePatch(x, z)` callback (visual-only). Drops 2 orbs. Never spawns on
// boss/arena levels (Game decides).

import { Skeleton } from '../Skeleton.js';
import { BURN } from '../../core/Constants.js';

export class Burning extends Skeleton {
  /**
   * @param {number} ngPlus NG+ cycle count for HP scaling.
   */
  constructor(scene, opts = {}) {
    const ngPlus = opts.ngPlus ?? 0;
    super(scene, {
      ...opts,
      type: 'BURN',
      hp: BURN.hp(ngPlus), // ceil(90 × (1 + 3·ngPlus))
      speed: BURN.speed,
      damage: BURN.damage,
      range: BURN.range,
      cycle: { windup: 0, swing: 0, recover: 0, cooldown: BURN.cooldown },
      drops: BURN.drops, // 2
      elite: false,
      scale: 1.25,
      colors: { body: 0xff6a20, glow: 0xffcc22, ...(opts.colors || {}) },
    });
    this.ngPlus = ngPlus;
    this.onFirePatch = opts.onFirePatch || null;
    this._fireT = 0;
    this.dormantWakeRange = 12;
  }

  /**
   * BURN override: straight-line chase (sub-stepped, collision-resolved,
   * does NOT phase) + ground-fire patch emission while moving.
   */
  update(dt, player, collisionBoxes = [], opts = {}) {
    if (this._disposed) return false;
    this._animT += dt;
    if (this.state === 'DEAD') {
      this._updateDeath(dt);
      return this._disposed === false;
    }
    if (!this.alive) return false;
    if (opts.frozen) { this._applyPose(); return true; }

    const p = this.position;
    const dist = Math.hypot(player.x - p.x, player.z - p.z);
    const fleeing = opts.fleeing || this.fleeing;
    const inRange = dist <= this.range;

    // Advance dormant → waking → chase.
    if (this.state === 'DORMANT') {
      this.wakeTimer -= dt;
      if (this.wakeTimer <= 0 && dist < this.wakeRange()) this.state = 'WAKING';
    } else if (this.state === 'WAKING') {
      this.state = 'CHASE';
    }

    if (fleeing && this.state === 'CHASE') {
      const fdx = (p.x - player.x) / (dist || 1e-6), fdz = (p.z - player.z) / (dist || 1e-6);
      this._moveToward(p.x + fdx * 10, p.z + fdz * 10, this.speed * 1.15 * dt, dt, collisionBoxes);
      this._applyPose();
      return true;
    }

    if (this.state === 'CHASE') {
      // Instant hit when in range & cooldown ready.
      if (inRange && this._phase === 'cd' && this.cooldown <= 0) {
        this._fireHit(player.x, player.z);
        this.cooldown = this.cycle.cooldown;
      }
      // Straight-line chase (no phase — collision resolved normally).
      this._moveToward(player.x, player.z, this.speed * dt, dt, collisionBoxes);
      this._spawnFirePatches(dt);
      this._applyPose();
    }
    return true;
  }

  /** Emit a visual fire patch every BURN.FIRE_PATCH_INTERVAL while moving. */
  _spawnFirePatches(dt) {
    this._fireT += dt;
    if (this._fireT >= BURN.FIRE_PATCH_INTERVAL) {
      this._fireT -= BURN.FIRE_PATCH_INTERVAL;
      if (this.onFirePatch) {
        const p = this.position;
        this.onFirePatch(p.x, p.z);
      }
    }
  }
}

Skeleton.registerVariant('BURN', Burning);

export default Burning;

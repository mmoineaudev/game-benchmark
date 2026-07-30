// =============================================================================
// ResourceSystem — manages fuel/O2/hull drain, replenishment, and death conditions.
// =============================================================================

import { RESOURCES } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';

let _alertedFuel = false, _alertedO2 = false;

export class ResourceSystem {
  constructor() {
    this._bus = getEventBus();
    this._state = getGameState();
    this._lastDepth = 0;
  }

  /** Called every frame with dt. Returns true if player still alive. */
  update(dt) {
    const s = this._state;
    if (!s.isAlive || s.phase !== 'descent') return true;

    // Oxygen drain
    const drainRate = s.isClimbing ? RESOURCES.OXYGEN_DRAIN_CLIMBING
      : s.isMoving ? RESOURCES.OXYGEN_DRAIN_MOVING
      : RESOURCES.OXYGEN_DRAIN_IDLE;

    s.oxygen -= drainRate * dt;
    if (s.oxygen <= 0) {
      s.oxygen = 0;
      s.isAlive = false;
      Logger.info('ResSys', 'OXYGEN DEPLETED');
      this._bus.emit(Events.OXYGEN_DEPLETED);
      this._bus.emit(Events.PLAYER_DIED, { cause: 'suffocation' });
      return false;
    }

    // Resource threshold alerts (log once per crossing)
    if (!_alertedO2 && s.oxygen < s.maxOxygen * 0.25) {
      Logger.warn('ResSys', `O2 LOW: ${s.oxygen.toFixed(1)}/${s.maxOxygen}`);
      _alertedO2 = true;
    }

    // Emit change events periodically (throttled by depth change to avoid spam)
    if (s.tileY !== this._lastDepth) {
      this._bus.emit(Events.FUEL_CHANGED, { fuel: s.fuel, maxFuel: s.maxFuel });
      this._bus.emit(Events.OXYGEN_CHANGED, { oxygen: s.oxygen, maxOxygen: s.maxOxygen });
      this._bus.emit(Events.DEPTH_CHANGED, { depth: s.tileY });
      this._lastDepth = s.tileY;
    }

    return true;
  }

  /** Deduct fuel for digging. Returns false if not enough fuel. */
  spendFuel(amount) {
    const s = this._state;
    if (s.fuel < amount) return false;
    s.fuel -= amount;
    this._bus.emit(Events.FUEL_CHANGED, { fuel: s.fuel, maxFuel: s.maxFuel });

    if (s.fuel <= 0) {
      Logger.info('ResSys', 'FUEL DEPLETED');
      this._bus.emit(Events.FUEL_DEPLETED);
      this._bus.emit(Events.PLAYER_DIED, { cause: 'starvation' });
      s.isAlive = false;
    } else if (!_alertedFuel && s.fuel < s.maxFuel * 0.1) {
      Logger.warn('ResSys', `FUEL LOW: ${s.fuel}/${s.maxFuel}`);
      _alertedFuel = true;
    }

    return true;
  }

  /** Burn coal for fuel (each coal = +5 fuel). */
  burnCoal(count) {
    const s = this._state;
    const gained = count * 5;
    s.fuel = Math.min(s.fuel + gained, s.maxFuel);
    _alertedFuel = false; // reset alert
    Logger.info('ResSys', `burned ${count} coal → +${gained} fuel (now ${s.fuel})`);
    this._bus.emit(Events.FUEL_CHANGED, { fuel: s.fuel, maxFuel: s.maxFuel });
  }

  onRestart() {
    _alertedFuel = false;
    _alertedO2 = false;
    this._lastDepth = 0;
  }

  dispose() {
    Logger.info('ResSys', 'disposed');
  }
}

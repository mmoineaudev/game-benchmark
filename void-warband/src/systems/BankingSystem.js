/**
 * BankingSystem.js — station banking (SPEC §5 extraction rule, §7 hangar).
 *
 * Per frame: find the nearest station within STATION_RADIUS of the player
 * and expose `nearStation` (HUD prompt). On player F press (routed through
 * `tryBank` from main.js), bank the run: cargo → meta, scrap → meta,
 * hull + shield refilled, and emit 'station:banked' {stationPosition}
 * for the HUD toast.
 *
 * Death forfeits anything unbanked (SPEC §5), so banking here is the only
 * mid-run extraction.
 */
import { EventBus } from '../core/EventBus.js';
import { Station, STATION_RADIUS } from '../entities/Station.js';

/** 'station:banked' payload event name (`domain:action`, SPEC §9). */
const EVENT_BANKED = 'station:banked';

class _BankingSystem {
  constructor() {
    /** @type {boolean} true while the player is within banking radius — HUD prompt. */
    this.nearStation = false;
  }

  /**
   * Per-frame: refresh the near-station prompt state.
   * @param {number} dt seconds.
   * @param {import('three').Vector3} playerPos
   * @param {object} gameState GameState singleton.
   * @param {Array<import('../entities/Station.js')>} stations
   */
  update(dt, playerPos, gameState, stations) {
    this.nearStation = false;
    if (!gameState.run || !gameState.run.alive) return;
    for (const s of stations) {
      if (Station.distanceCheck(playerPos, s.position, STATION_RADIUS)) {
        this.nearStation = true;
        break;
      }
    }
  }

  /**
   * Attempt to bank at the nearest in-radius station (called from main.js
   * on F press).
   * @param {import('three').Vector3} playerPos
   * @param {object} gameState GameState singleton.
   * @param {Array<import('../entities/Station.js')>} stations
   * @returns {boolean} true if banking happened.
   */
  tryBank(playerPos, gameState, stations) {
    if (!gameState.run || !gameState.run.alive) return false;

    // Nearest station within radius (deterministic: first-in-list if tied).
    let nearest = null;
    let nearestDist = Infinity;
    for (const s of stations) {
      if (!Station.distanceCheck(playerPos, s.position, STATION_RADIUS)) continue;
      const d = playerPos.distanceTo(s.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = s;
      }
    }
    if (!nearest) return false;

    const run = gameState.run;

    // Extraction (SPEC §5): bank cargo + scrap, repair hull, refill shield.
    gameState.bankCargo();
    gameState.bankScrap(run.scrap);
    run.hull = gameState.maxHull();
    run.shield = gameState.maxShield();

    EventBus.emit(EVENT_BANKED, { stationPosition: nearest.position });
    return true;
  }
}

export { _BankingSystem as BankingSystem };
export default _BankingSystem;

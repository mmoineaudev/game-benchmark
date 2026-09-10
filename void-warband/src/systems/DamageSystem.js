/**
 * DamageSystem.js — resolves player damage (SPEC §3, §4).
 *
 * hitPlayer(amount, gameState):
 *   shield first (absorbs, regen handled in update), then hull; sets the
 *   shield-regen delay timer; screen shake via FX; emits 'player:damaged'.
 * Death → run.alive=false, phase DEATH (import GamePhase).
 *
 * update(dt, gameState): shield regen — after PLAYER.shieldDelay s without a
 * hit, restore shield at PLAYER.shieldRegen/s up to max.
 *
 * All numbers come from Constants (PLAYER) — no magic numbers.
 */
import { PLAYER } from '../core/Constants.js';
import { GamePhase } from '../core/GameState.js';
import { EventBus } from '../core/EventBus.js';

class _DamageSystem {
  /**
   * @param {import('../visuals/FX.js')} fx for screen shake.
   */
  constructor(fx) {
    /** @type {import('../visuals/FX.js')} */
    this._fx = fx;
    /** Seconds since the last hit taken (shield regen delay). */
    this._timeSinceHit = 0;
    /** @type {boolean} death already fired this run (no re-fire). */
    this._dead = false;
    /** Invuln timer, s remaining (PLAYER.invuln window). */
    this._invulnTimer = 0;
  }

  /**
   * Apply damage to the player: shield first, then hull.
   * @param {number} amount damage points.
   * @param {object} gameState GameState singleton.
   */
  hitPlayer(amount, gameState) {
    // Real 0.75 s invuln window (PLAYER.invuln): swallow hits during it.
    if (this._invulnTimer > 0) return false;
    const run = gameState.run;
    if (!run || !run.alive) return;
    if (amount <= 0) return;

    // Start invuln window (swallows further hits until it expires).
    this._invulnTimer = PLAYER.invuln;

    // Shield absorbs first (up to its current value).
    const toShield = Math.min(run.shield, amount);
    run.shield -= toShield;
    let remaining = amount - toShield;
    if (remaining > 0) {
      run.hull -= remaining;
    }

    // Any hit resets the shield-regen delay.
    this._timeSinceHit = 0;
    run.timeSinceHit = 0;

    // Screen shake on player hit (SPEC §3).
    this._fx.shake(10, PLAYER.shakeDuration);

    // Damage-reflecting shield (user feedback: flagship): bounce a fraction
    // of the received damage back to the nearest live enemy within range.
    const reflect = gameState.currentShip().reflectShield;
    if (reflect > 0 && gameState.run && gameState.run.alive) {
      const pos = gameState.run.position;
      let nearest = null;
      let nearestDist = 300; // reflect range, u
      for (const e of gameState.enemiesRef?.() ?? []) {
        if (!e.alive || e.dying) continue;
        const d = Math.hypot(
          e.mesh.position.x - pos.x,
          e.mesh.position.y - pos.y,
          e.mesh.position.z - pos.z);
        if (d < nearestDist) { nearestDist = d; nearest = e; }
      }
      if (nearest) {
        nearest.takeDamage(amount * reflect);
        this._fx.spawn(nearest.mesh.position, Math.round(amount * reflect), '#fbbf24');
      }
    }

    if (run.hull <= 0) {
      run.hull = 0;
      this._die(gameState);
    } else {
      // Damaged (alive): shield-down cue when shield just broke.
      if (run.shield <= 0) {
        this._emit('player:shieldDown', run);
      }
      this._emit('player:damaged', { amount, hull: run.hull, shield: run.shield });
    }
  }

  /**
   * Per-frame: shield regen after PLAYER.shieldDelay s without a hit.
   * @param {number} dt delta, s.
   * @param {object} gameState GameState singleton.
   */
  update(dt, gameState) {
    const run = gameState.run;
    if (!run || !run.alive) return;

    if (this._invulnTimer > 0) this._invulnTimer -= dt;
    this._timeSinceHit += dt;
    run.timeSinceHit = this._timeSinceHit;

    if (this._timeSinceHit > PLAYER.shieldDelay && run.shield < gameState.maxShield()) {
      run.shield = Math.min(
        gameState.maxShield(),
        run.shield + (PLAYER.shieldRegen + gameState.shieldRegenBonus()) * dt,
      );
    }
  }

  /**
   * Reset after-death state (restart cleanup, SPEC §11).
   */
  reset() {
    this._timeSinceHit = 0;
    this._dead = false;
    this._invulnTimer = 0;
  }

  // -- Internal -------------------------------------------------------------

  /**
   * Death: run.alive=false, phase DEATH (import GamePhase).
   * @param {object} gameState
   */
  _die(gameState) {
    if (this._dead) return;
    this._dead = true;
    const run = gameState.run;
    run.alive = false;
    gameState.phase = GamePhase.DEATH;
    // Persist lifetime stats (kills/runs/bestDistance); DEATH path forfeits
    // unbanked cargo + scrap (SPEC §5 extraction rule).
    gameState.endRun();
    this._emit('player:died', run);
  }

  /**
   * Event wrapper.
   * @param {string} event
   * @param {...*} args
   */
  _emit(event, ...args) {
    EventBus.emit(event, ...args);
  }
}

export { _DamageSystem as DamageSystem };
export default _DamageSystem;

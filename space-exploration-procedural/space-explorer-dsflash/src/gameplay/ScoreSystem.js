import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';

// Score tracking + high score persistence (spec §6.4).
export class ScoreSystem {
  constructor() {
    this._unsubs = [
      eventBus.on(Events.ASTEROID_DESTROYED, (e) => this._add(e.score, 'asteroid')),
      eventBus.on(Events.DEBRIS_DESTROYED, (e) => this._add(e.score, 'debris')),
      eventBus.on(Events.COMET_DESTROYED, (e) => this._add(e.score, 'comet')),
    ];
  }

  _add(delta, reason) {
    const score = gameState.addScore(delta, reason);
    if (score !== undefined) {
      eventBus.emit(Events.SCORE_CHANGED, { score, delta, reason });
    }
  }

  /** Call on death — persists the high score if beaten. */
  saveHighScore() {
    if (gameState.saveHighScore()) {
      eventBus.emit(Events.HIGH_SCORE_SAVED, { score: gameState.highScore });
      return true;
    }
    return false;
  }

  dispose() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }
}

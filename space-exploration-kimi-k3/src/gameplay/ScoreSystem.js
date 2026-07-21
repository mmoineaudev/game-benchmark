// VOID DRIFT — ScoreSystem.js
// Score awards, distance scoring, game-over overlay population.

import * as Constants from '../core/Constants.js';
import { GameState } from '../core/GameState.js';

export class ScoreSystem {
  constructor() {
    this._distanceAccum = 0;
  }

  init() { this._distanceAccum = 0; }

  /** Points for destroying something of a given size/kind. */
  awardDestruction(kind, size) {
    const S = Constants.SCORE;
    let pts;
    if (kind === 'npc') pts = S.NPC;
    else if (kind === 'debris') pts = S.DEBRIS;
    else if (size > 2) pts = S.ASTEROID_LARGE;
    else if (size > 0.8) pts = S.ASTEROID_MEDIUM;
    else pts = S.ASTEROID_SMALL;
    GameState.addScore(pts);
    return pts;
  }

  awardCollectible(type) {
    const pts = type === 'crystal' ? Constants.SCORE.CRYSTAL : Constants.SCORE.RUIN;
    GameState.addScore(pts);
    return pts;
  }

  /** Distance score: integer-floored accumulation. */
  updateDistanceScore() {
    const target = GameState.player.distance * Constants.SCORE.DISTANCE_RATE;
    const delta = Math.floor(target - this._distanceAccum);
    if (delta > 0) {
      this._distanceAccum += delta;
      GameState.addScore(delta);
    }
  }

  showGameOver() {
    const el = document.getElementById('game-over');
    if (!el) return;
    document.getElementById('final-score').textContent = String(GameState.player.score);
    document.getElementById('final-distance').textContent = `${Math.floor(GameState.player.distance)} u`;
    document.getElementById('final-high').textContent = String(GameState.game.highScore);
    document.getElementById('new-high').style.display = GameState.game.newHighScore ? 'block' : 'none';
    el.classList.remove('hidden');
  }

  hideGameOver() {
    const el = document.getElementById('game-over');
    if (el) el.classList.add('hidden');
  }

  reset() {
    this._distanceAccum = 0;
    this.hideGameOver();
  }
}

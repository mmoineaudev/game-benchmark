// ============================================================
// ScoreSystem — Score tracking, high score persistence, distance tracking
// ============================================================
import Constants from '../core/Constants.js';
import GameState from '../core/GameState.js';
import EventBus from '../core/EventBus.js';

class ScoreSystem {
  constructor() {
    this._hudScore = document.getElementById('score-display');
    this._hudDistance = document.getElementById('distance-display');
    this._gameOver = document.getElementById('game-over');
    this._goScore = document.getElementById('go-score');
    this._goDistance = document.getElementById('go-distance');
    this._goHighscore = document.getElementById('go-highscore');
    this._lastDistance = 0;
    this._distanceTimer = 0;
  }

  init() {
    // Listen for game over
    EventBus.on('game:gameover', () => {
      this.showGameOver();
    });

    this.updateHUD();
  }

  /**
   * Award points for destruction
   */
  awardDestruction(type, size) {
    let points = 0;
    if (type === 'asteroid') {
      // Size tier: large (>2) = 30, medium (>0.8) = 20, small = 10
      if (size > 2) {
        points = Constants.SCORE.ASTEROID_LARGE;
      } else if (size > 0.8) {
        points = Constants.SCORE.ASTEROID_MEDIUM;
      } else {
        points = Constants.SCORE.ASTEROID_SMALL;
      }
    } else if (type === 'debris') {
      points = Constants.SCORE.DEBRIS;
    }

    GameState.addScore(points);
    EventBus.emit('score:changed', { type, points });
  }

  /**
   * Update distance score based on GameState.distance
   * Called every frame, awards points for newly traveled distance
   */
  updateDistanceScore(dt) {
    const currentDistance = Math.floor(GameState.distance);
    if (currentDistance > this._lastDistance) {
      const newDistance = currentDistance - this._lastDistance;
      const distancePoints = Math.floor(newDistance * Constants.SCORE.DISTANCE_PER_UNIT);
      if (distancePoints > 0) {
        GameState.addScore(distancePoints);
      }
      this._lastDistance = currentDistance;
    }
  }

  /**
   * Update HUD display
   */
  updateHUD() {
    if (!this._hudScore) return;

    this._hudScore.textContent = `SCORE: ${GameState.score.toLocaleString()}`;
    this._hudDistance.textContent = `DISTANCE: ${Math.floor(GameState.distance).toLocaleString()} units`;
  }

  /**
   * Show game over screen
   */
  showGameOver() {
    if (!this._gameOver) return;

    this._goScore.textContent = `Score: ${GameState.score.toLocaleString()}`;
    this._goDistance.textContent = `Distance: ${Math.floor(GameState.distance).toLocaleString()} units`;
    this._goHighscore.textContent = `High Score: ${GameState.highScore.toLocaleString()}`;
    this._gameOver.classList.add('active');
  }

  /**
   * Hide game over screen
   */
  hideGameOver() {
    if (this._gameOver) {
      this._gameOver.classList.remove('active');
    }
  }

  /**
   * Reset score and distance tracking
   */
  reset() {
    this.hideGameOver();
    this._lastDistance = 0;
    this._distanceTimer = 0;
    this.updateHUD();
  }
}

export default ScoreSystem;

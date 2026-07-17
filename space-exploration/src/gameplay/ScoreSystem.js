// ============================================================
// ScoreSystem — Score tracking, high score persistence
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
  }

  init() {
    // Listen for score changes
    EventBus.on('score:update', (data) => {
      this.updateHUD();
    });

    // Listen for game over
    EventBus.on('game:gameover', () => {
      this.showGameOver();
    });

    this.updateHUD();
  }

  /**
   * Award points for destruction
   */
  awardDestruction(type) {
    const points = type === 'asteroid'
      ? Constants.SCORE.ASTEROID_LARGE
      : Constants.SCORE.DEBRIS;
    
    GameState.addScore(points);
    EventBus.emit('score:update', { type, points });
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
   * Reset score display
   */
  reset() {
    this.hideGameOver();
    this.updateHUD();
  }
}

export default ScoreSystem;

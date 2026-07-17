// ============================================================
// main.js — Bootstraps Game, mounts canvas
// ============================================================
import Game from './core/Game.js';

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  // Boot the game
  const game = new Game('game-container');
  game.init();

  // Expose game instance for debugging
  window.__game = game;
});

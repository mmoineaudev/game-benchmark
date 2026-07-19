// ============================================================
// main.js — Bootstraps Game, mounts canvas
// ============================================================
import Game from './core/Game.js';

// Wait for DOM to be ready (or boot immediately if already loaded)
function bootGame() {
  try {
    const game = new Game('game-container');
    game.init();
    
    // Hide loading screen — it's in index.html but never removed by the game
    var loadingEl = document.getElementById('loading-screen');
    if (loadingEl) loadingEl.style.display = 'none';
    
    window.__game = game;
    console.log('[Boot] Game initialized successfully');
  } catch(e) {
    console.error('[Boot] Failed to initialize game:', e);
    throw e;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootGame);
} else {
  // DOM already loaded, boot immediately
  bootGame();
}

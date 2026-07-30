// =============================================================================
// main.js — entry point. Creates the Game and kicks off the loop.
// =============================================================================

import { Logger } from './core/Logger.js';
import { Game } from './core/Game.js';

// Check for debug mode via URL query param
const params = new URLSearchParams(window.location.search);
if (params.get('log') === 'debug') {
  Logger.setThreshold('DEBUG');
} else {
  Logger.setThreshold('INFO');
}

Logger.info('Main', 'Mining Descent starting...');

const container = document.getElementById('game-container');
const game = new Game(container);

try {
  game.init();
} catch (err) {
  Logger.error('Main', 'FATAL: game init failed', err);
  // Show error in DOM
  const el = document.createElement('div');
  el.style.cssText = 'color:red;font-family:monospace;padding:40px;white-space:pre-wrap;';
  el.textContent = `INIT FAILED:\n${err.message}\n\n${err.stack}`;
  container.appendChild(el);
}

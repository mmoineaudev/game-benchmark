// VOID DRIFT — main.js
import { Game } from './core/Game.js';

const game = new Game('game-container');
game.init();

// Debug handle (used by verification scripts).
window.__game = game;

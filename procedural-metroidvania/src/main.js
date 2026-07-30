import Game from './core/Game.js';

console.log('[Boot] Starting Procedural Metroidvania...');
const game = new Game('app');
game.init();
console.log('[Boot] Game initialized. Ready.');
window._pmGame = game;

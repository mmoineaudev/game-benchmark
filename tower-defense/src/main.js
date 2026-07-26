import Game from './core/Game.js';
console.log('AFTER_GAME_IMPORT');
const game = new Game('app');
game.init();
console.log('GAME_INIT');
window._psGame = game;

import Game from './core/Game.js';

const game = new Game('app');
game.init();
window.game = game; // QA hook

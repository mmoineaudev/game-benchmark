import { Game } from './core/Game.js';

const game = new Game('app');
game.init();
window.game = game; // exposed for headless QA / debugging

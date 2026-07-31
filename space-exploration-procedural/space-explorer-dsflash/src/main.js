// Bootstrap: mounts Game onto the canvas container (spec §1.4, §3).
import * as THREE from 'three';
import { Game } from './core/Game.js';
import { Constants } from './core/Constants.js';

const container = document.getElementById('game-container');
const uiOverlay = document.getElementById('ui-overlay');

const game = new Game(container, uiOverlay);
game.init();

// Responsive resize handler (HiDPI capped).
function onResize() {
  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  game.resize(w, h);
}
window.addEventListener('resize', onResize);
onResize();

// WebGL context loss handling (spec §13).
const canvas = game.renderer.domElement;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  game.onContextLost();
});
canvas.addEventListener('webglcontextrestored', () => {
  game.onContextRestored();
});

// Expose for debugging / QA.
import { gameState } from './core/GameState.js';
window.__VOID_DRIFT__ = {
  game,
  state: gameState,
  three: THREE,
  constants: Constants,
  version: '2.0.0',
};

// Dev perf overlay (?perf=1)
if (new URLSearchParams(window.location.search).has('perf')) {
  import('./utils/PerfProbe.js').then((m) => m.installPerfProbe(game));
}

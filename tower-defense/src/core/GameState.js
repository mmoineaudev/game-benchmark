import { BUDGET, STATS_KEYS, GRID_COLS, GRID_ROWS } from './Constants.js';
import EventBus from './EventBus.js';

export const makeInitialState = () => ({
  money: BUDGET.startMoney,
  lives: BUDGET.lives,
  wave: 0,
  paused: false,
  over: false,
  buildableHover: null,
  selectedTowerType: null,
  selectedEntity: null,
  grid: new Array(GRID_COLS * GRID_ROWS).fill('empty'),
  path: new Set(),
  enemyPathTiles: [],
  tiles: new Map(),
  towers: [],
  enemies: [],
  projectiles: [],
  particles: [],
  stats: Object.fromEntries(STATS_KEYS.map((k) => [k, 0])),
  buildCooldown: 0,
});

export class GameState {
  constructor() { this._state = makeInitialState(); }
  get state() { return this._state; }
  patch(partial) {
    Object.assign(this._state, partial);
  }
  reset() {
    this._state = makeInitialState();
  }
}
export default GameState;

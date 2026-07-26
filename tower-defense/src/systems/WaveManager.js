import { BUDGET, WAVE } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';

export default class WaveManager {
  constructor() {
    this._current = 0;
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._spawnInterval = 1.5;
    this._active = false;
  }
  
  reset() { 
    this._current = 0; 
    this._spawnQueue = [];
    this._spawnTimer = 0;
    this._active = false;
  }
  
  startSpawning(state) {
    this._active = true;
    this._current = state.wave + 1;
    state.wave = this._current;
    
    // Build spawn queue
    this._spawnQueue = [];
    const count = Math.floor(WAVE.mobsBase + WAVE.mobsGrow * this._current);
    const unlocked = Math.min(7, 1 + Math.floor(this._current / 2));
    
    for (let i = 0; i < count; i++) {
      const idx = Math.min(i % unlocked, 6);
      this._spawnQueue.push({ type: 'mob', defIdx: idx });
    }
    
    const bossEvery = WAVE.bossEvery;
    if (this._current > 1 && this._current % bossEvery === 0) {
      const bossIdx = 7 + ((this._current / bossEvery - 1) % 3);
      this._spawnQueue.push({ type: 'boss', defIdx: bossIdx });
    }
    
    // Calculate spawn interval (decreases with wave, bounded by minimum)
    this._spawnInterval = Math.max(
      WAVE.spawnIntervalMin,
      WAVE.spawnIntervalBase - (this._current * 0.05)
    );
  }
  
  update(dt, state, enemies, pathSystem) {
    if (!this._active || this._spawnQueue.length === 0) return;

    this._spawnTimer += dt;

    // Spawn ONE enemy when timer fires (max one per frame)
    if (this._spawnTimer >= this._spawnInterval && this._spawnQueue.length > 0) {
      const item = this._spawnQueue.shift();
      enemies.spawnWave([item], pathSystem);
      this._spawnTimer = 0;

      // Apply wave bonus after last enemy spawns
      if (this._spawnQueue.length === 0) {
        this.waveBonus(state);
        this._active = false;
      }
    }
  }
  
  waveBonus(state) {
    state.money += BUDGET.waveBonus;
    state.stats.wavesSurvived += 1;
    if (this._current % BUDGET.waveMilestoneEvery === 0) state.money += 48;
    EventBus.emit('economy:changed', { money: state.money });
  }
}

// =============================================================================
// Minimap — canvas-based minimap showing dug tiles, ore markers, player position.
// =============================================================================

import { WORLD_WIDTH, WORLD_DEPTH, WORLD_HEIGHT, TILE, CAVE_ENTRANCE } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';

export class Minimap {
  constructor(container) {
    this._container = container;
    this._bus = getEventBus();
    this._state = getGameState();
    this._canvas = null;
    this._ctx = null;
    this._unsubs = [];
  }

  init() {
    const size = 200;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.style.cssText = `
      position: absolute; top: 12px; right: 12px;
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 4px;
      background: rgba(0,0,0,0.6);
      pointer-events: none;
    `;
    this._container.appendChild(canvas);
    this._canvas = canvas;
    this._ctx = canvas.getContext('2d');

    // Redraw when terrain changes or player moves
    this._unsubs.push(this._bus.on(Events.TILE_REMOVED, () => this.draw()));
    this._unsubs.push(this._bus.on(Events.PLAYER_MOVED, () => this.draw()));
    this._unsubs.push(this._bus.on(Events.TERRAIN_READY, () => this.draw()));

    this.draw();
    Logger.info('Minimap', 'initialized');
  }

  draw() {
    const ctx = this._ctx;
    const w = this._canvas.width;
    const h = this._canvas.height;
    const s = this._state;
    const tileW = w / WORLD_WIDTH;
    const tileH = h / WORLD_DEPTH;

    ctx.clearRect(0, 0, w, h);

    // Draw revealed tiles at current depth level
    for (let x = 0; x < WORLD_WIDTH; x++) {
      for (let z = 0; z < WORLD_DEPTH; z++) {
        const idx = x + z * WORLD_WIDTH + s.tileY * WORLD_WIDTH * WORLD_DEPTH;
        const revealed = s.discovered[idx];
        if (!revealed) {
          // Show surface layer info when at surface
          if (s.tileY === 0) {
            ctx.fillStyle = x === CAVE_ENTRANCE.x && z === CAVE_ENTRANCE.z
              ? 'rgba(30,30,30,0.8)' : 'rgba(40,80,30,0.4)';
            ctx.fillRect(x * tileW, z * tileH, tileW, tileH);
          }
          continue;
        }

        // Color based on depth layer
        const depthFrac = s.tileY / WORLD_HEIGHT;
        const r = Math.round(20 + depthFrac * 40);
        const g = Math.round(40 + (1 - depthFrac) * 30);
        const b = Math.round(30 + depthFrac * 60);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x * tileW, z * tileH, tileW, tileH);

        // Cave entrance marker on surface
        if (s.tileY === 0 && x === CAVE_ENTRANCE.x && z === CAVE_ENTRANCE.z) {
          ctx.fillStyle = 'rgba(150, 120, 60, 0.9)';
          ctx.fillRect(x * tileW, z * tileH, tileW, tileH);
        }
      }
    }

    // Player position (white dot)
    const px = s.tileX * tileW + tileW / 2;
    const pz = s.tileZ * tileH + tileH / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, pz, 3, 0, Math.PI * 2);
    ctx.fill();

    // Depth indicator at bottom
    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.fillText(`${s.tileY}m`, 4, h - 4);
  }

  setVisible(v) {
    if (this._canvas) this._canvas.style.display = v ? 'block' : 'none';
  }

  dispose() {
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    if (this._canvas) {
      this._canvas.remove();
      this._canvas = null;
    }
    Logger.info('Minimap', 'disposed');
  }
}

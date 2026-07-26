import { WORLD, TILE } from '../core/Constants.js';
import { getTile } from '../systems/TerrainGenerator.js';
import { state } from '../core/GameState.js';

// Minimap showing discovered tiles, player position, ores
export class Minimap {
  constructor() {
    this.canvas = document.getElementById('minimap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._terrainData = null;
  }

  setTerrainData(data) {
    this._terrainData = data;
  }

  update(playerX, playerZ) {
    if (!this._terrainData) return;
    const ctx = this.ctx;
    const { data, width, depth } = this._terrainData;
    const size = 140;
    const tileW = size / width;
    const tileH = size / depth;

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, size, size);

    // Draw discovered tiles at player's approximate depth
    const py = Math.floor(state.depth);
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        if (!state.tilesDiscovered.has(`${x},${z}`)) continue;
        const tile = getTile(data, x, Math.min(py, state.depth), z);

        let color = '#333';
        if (tile === TILE.AIR || tile === TILE.CAVE) color = '#111';
        else if (tile === TILE.COAL_ORE) color = '#444';
        else if (tile === TILE.COPPER_ORE) color = '#c64';
        else if (tile === TILE.SURFACE) color = '#4a7a3a';
        else if (tile === TILE.DIRT) color = '#8B5E3C';
        else if (tile === TILE.STONE) color = '#6B6B7B';
        else color = '#555';

        ctx.fillStyle = color;
        ctx.fillRect(x * tileW, z * tileH, tileW + 1, tileH + 1);
      }
    }

    // Player dot
    ctx.fillStyle = '#0ff';
    ctx.shadowColor = '#0ff';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(playerX * tileW + tileW / 2, playerZ * tileH + tileH / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ore markers (as small dots)
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        if (!state.tilesDiscovered.has(`${x},${z}`)) continue;
        const tile = getTile(data, x, Math.min(py, state.depth), z);
        if (tile === TILE.COAL_ORE) {
          ctx.fillStyle = '#888';
          ctx.beginPath();
          ctx.arc(x * tileW + tileW / 2, z * tileH + tileH / 2, 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (tile === TILE.COPPER_ORE) {
          ctx.fillStyle = '#f84';
          ctx.beginPath();
          ctx.arc(x * tileW + tileW / 2, z * tileH + tileH / 2, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Depth label
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '10px monospace';
    ctx.fillText(`${state.depth}m`, 4, 12);
  }
}

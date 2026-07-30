// =============================================================================
// TerrainGenerator — procedural 3D grid with ore veins, cave pockets, entrance.
// =============================================================================

import { WORLD_WIDTH, WORLD_DEPTH, WORLD_HEIGHT, TILE, ORE_DEFS, CAVE_ENTRANCE } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { Logger } from '../core/Logger.js';

const TOTAL = WORLD_WIDTH * WORLD_DEPTH * WORLD_HEIGHT;

const idx = (x, y, z) => x + z * WORLD_WIDTH + y * WORLD_WIDTH * WORLD_DEPTH;
const inBounds = (x, y, z) => x >= 0 && x < WORLD_WIDTH && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < WORLD_DEPTH;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class TerrainGenerator {
  constructor() {
    this._bus = getEventBus();
    this.data = new Uint8Array(TOTAL); // tile types
    this._seedAreas = [];              // debug: where ore veins were placed
  }

  /** Generate the entire terrain grid. */
  generate() {
    const t0 = performance.now();
    Logger.info('TerrainGen', 'generating...');

    this.data.fill(TILE.AIR); // start empty, fill selectively

    // --- Surface layer (y=0) ---
    for (let x = 0; x < WORLD_WIDTH; x++) {
      for (let z = 0; z < WORLD_DEPTH; z++) {
        this._set(x, 0, z, TILE.SURFACE);
      }
    }
    // Carve entrance
    this._set(CAVE_ENTRANCE.x, 0, CAVE_ENTRANCE.z, TILE.AIR);

    // --- Rock fill (y=1 to max) ---
    for (let y = 1; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < WORLD_WIDTH; x++) {
        for (let z = 0; z < WORLD_DEPTH; z++) {
          this._set(x, y, z, TILE.ROCK);
        }
      }
    }

    // --- Ore veins ---
    this._placeOreVeins();

    // --- Cave pockets ---
    this._carveCavePockets();

    // --- Fuel deadlock guarantee: coal within 5 tiles radius of entrance ---
    this._guaranteeCoalNearEntrance();

    const t1 = performance.now();
    Logger.info('TerrainGen', `done in ${(t1 - t0).toFixed(1)}ms`, {
      cells: TOTAL,
      solidCount: this._countSolid(),
      oreVeins: this._seedAreas.length,
    });
    this._bus.emit(Events.TERRAIN_READY);
  }

  _set(x, y, z, type) {
    this.data[idx(x, y, z)] = type;
  }

  get(x, y, z) {
    if (!inBounds(x, y, z)) return TILE.ROCK; // out of bounds acts as solid wall
    return this.data[idx(x, y, z)];
  }

  isSolid(x, y, z) {
    return this.get(x, y, z) !== TILE.AIR;
  }

  /** Dig a tile: set to AIR, return the previous type. */
  dig(x, y, z) {
    if (!inBounds(x, y, z)) return null;
    const i = idx(x, y, z);
    const prev = this.data[i];
    if (prev === TILE.AIR || prev === TILE.SURFACE) return null; // can't dig surface or air
    this.data[i] = TILE.AIR;
    return prev;
  }

  /** Count non-AIR tiles for debugging. */
  _countSolid() {
    let c = 0;
    for (let i = 0; i < TOTAL; i++) if (this.data[i] !== TILE.AIR) c++;
    return c;
  }

  // ---- Ore Vein Placement ----

  _placeOreVeins() {
    this._seedAreas = [];
    for (const [key, def] of Object.entries(ORE_DEFS)) {
      Logger.debug('TerrainGen', `placing ${def.veinCount} ${key} veins (depth ${def.depthMin}-${def.depthMax})`);
      for (let v = 0; v < def.veinCount; v++) {
        const sx = Math.floor(Math.random() * WORLD_WIDTH);
        const sz = Math.floor(Math.random() * WORLD_DEPTH);
        const sy = def.depthMin + Math.floor(Math.random() * (def.depthMax - def.depthMin + 1));
        const size = def.veinSizeMin + Math.floor(Math.random() * (def.veinSizeMax - def.veinSizeMin + 1));
        const placed = this._growVein(sx, sy, sz, def.tile, size);
        if (placed > 0) {
          this._seedAreas.push({ type: key, x: sx, y: sy, z: sz, size: placed });
        }
      }
    }
    Logger.debug('TerrainGen', `ore veins placed: ${this._seedAreas.length}`, this._seedAreas);
  }

  /** Cellular-automata blob growth from seed point. Returns number of tiles placed. */
  _growVein(sx, sy, sz, tileType, maxSize) {
    if (!inBounds(sx, sy, sz)) return 0;
    const visited = new Set();
    const queue = [{ x: sx, y: sy, z: sz }];
    let placed = 0;

    while (queue.length > 0 && placed < maxSize) {
      // BFS but with shuffled direction order for organic shape
      const p = queue.shift();
      const key = `${p.x},${p.y},${p.z}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (!inBounds(p.x, p.y, p.z)) continue;

      const cur = this.get(p.x, p.y, p.z);
      if (cur !== TILE.ROCK && cur !== TILE.SURFACE) continue;

      this._set(p.x, p.y, p.z, tileType);
      placed++;

      const dirs = shuffle([
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
      ]);

      for (const d of dirs) {
        queue.push({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
      }
    }
    return placed;
  }

  // ---- Cave Pockets ----

  _carveCavePockets() {
    const pocketCount = 15;
    Logger.debug('TerrainGen', `carving ${pocketCount} cave pockets`);
    for (let i = 0; i < pocketCount; i++) {
      const sx = 2 + Math.floor(Math.random() * (WORLD_WIDTH - 4));
      const sz = 2 + Math.floor(Math.random() * (WORLD_DEPTH - 4));
      const sy = 5 + Math.floor(Math.random() * (WORLD_HEIGHT - 10));
      const size = 25 + Math.floor(Math.random() * 50);
      this._carveCave(sx, sy, sz, size);
    }
  }

  _carveCave(sx, sy, sz, maxSize) {
    const visited = new Set();
    const queue = [{ x: sx, y: sy, z: sz }];
    let carved = 0;

    while (queue.length > 0 && carved < maxSize) {
      const p = queue.shift();
      const key = `${p.x},${p.y},${p.z}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (!inBounds(p.x, p.y, p.z)) continue;
      if (p.y === 0) continue; // don't carve surface

      this._set(p.x, p.y, p.z, TILE.AIR);
      carved++;

      const dirs = shuffle([
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
      ]);

      for (const d of dirs) {
        // Random skip for irregular caves
        if (Math.random() < 0.5) continue;
        queue.push({ x: p.x + d.x, y: p.y + d.y, z: p.z + d.z });
      }
    }
    return carved;
  }

  // ---- Fuel Deadlock Guarantee ----

  _guaranteeCoalNearEntrance() {
    // Search within 8-tile radius of entrance, within first 15 depth levels
    for (let y = 1; y <= 15; y++) {
      for (let dx = -8; dx <= 8; dx++) {
        for (let dz = -8; dz <= 8; dz++) {
          const x = CAVE_ENTRANCE.x + dx;
          const z = CAVE_ENTRANCE.z + dz;
          if (!inBounds(x, y, z)) continue;
          if (this.get(x, y, z) === TILE.COAL_ORE) {
            Logger.info('TerrainGen', `fuel guarantee: coal at (${x},${y},${z})`);
            return; // already have coal nearby
          }
        }
      }
    }
    // No coal found nearby — force-place one
    const gx = CAVE_ENTRANCE.x + 2;
    const gz = CAVE_ENTRANCE.z;
    const gy = 3;
    Logger.warn('TerrainGen', `fuel guarantee: force-placing coal at (${gx},${gy},${gz})`);
    this._growVein(gx, gy, gz, TILE.COAL_ORE, 5);
  }

  dispose() {
    this.data = new Uint8Array(0);
    Logger.info('TerrainGen', 'disposed');
  }
}

export { idx, inBounds };

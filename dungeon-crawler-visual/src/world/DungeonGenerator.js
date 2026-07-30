import { WORLD, DUNGEON } from '../core/Constants.js';

// Simple seeded RNG (mulberry32)
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class DungeonGenerator {
  constructor(seed) {
    this.rng = mulberry32(seed || Date.now());
    this.gridSize = WORLD.GRID_MIN + Math.floor(this.rng() * (WORLD.GRID_MAX - WORLD.GRID_MIN + 1));
    this.cellSize = WORLD.CELL_SIZE;
    this.grid = []; // 2D array of cell types: 'empty' | 'room' | 'corridor'
    this.metadata = []; // per-cell metadata: { type, roomId, ... }
    this.rooms = []; // { cx, cz, w, h, type } — grid coords
    this.entranceCell = null;
    this.exitCell = null;
  }

  generate() {
    this._initGrid();
    this._placeRooms();
    this._connectRooms();
    this._addDeadEnds();
    this._designateEntranceAndExit();
    return {
      grid: this.grid,
      metadata: this.metadata,
      rooms: this.rooms,
      gridSize: this.gridSize,
      cellSize: this.cellSize,
      entranceCell: this.entranceCell,
      exitCell: this.exitCell,
    };
  }

  _initGrid() {
    for (let z = 0; z < this.gridSize; z++) {
      this.grid[z] = [];
      this.metadata[z] = [];
      for (let x = 0; x < this.gridSize; x++) {
        this.grid[z][x] = 'empty';
        this.metadata[z][x] = { type: 'empty' };
      }
    }
  }

  _placeRooms() {
    const count = DUNGEON.MIN_ROOMS + Math.floor(this.rng() * (DUNGEON.MAX_ROOMS - DUNGEON.MIN_ROOMS + 1));
    let attempts = 0;
    const maxAttempts = 200;

    while (this.rooms.length < count && attempts < maxAttempts) {
      attempts++;
      const typeKey = this._pickRoomType();
      const cfg = DUNGEON.ROOM_TYPES[typeKey];
      const w = cfg.minSize + Math.floor(this.rng() * (cfg.maxSize - cfg.minSize + 1));
      const h = cfg.maxSize > 2 ? cfg.minSize + Math.floor(this.rng() * (cfg.maxSize - cfg.minSize + 1)) : 1;
      const cx = Math.floor(this.rng() * (this.gridSize - w));
      const cz = Math.floor(this.rng() * (this.gridSize - h));

      if (this._canPlaceRoom(cx, cz, w, h)) {
        this._carveRoom(cx, cz, w, h, typeKey);
        this.rooms.push({ cx, cz, w, h, type: typeKey });
      }
    }
  }

  _canPlaceRoom(cx, cz, w, h) {
    // Check bounds with margin
    if (cx < 1 || cz < 1 || cx + w >= this.gridSize || cz + h >= this.gridSize) return false;
    // Check overlap with margin
    const margin = DUNGEON.MIN_ROOM_DISTANCE;
    for (let z = cz - margin; z < cz + h + margin; z++) {
      for (let x = cx - margin; x < cx + w + margin; x++) {
        if (z >= 0 && z < this.gridSize && x >= 0 && x < this.gridSize) {
          if (this.grid[z][x] !== 'empty') return false;
        }
      }
    }
    return true;
  }

  _carveRoom(cx, cz, w, h, type) {
    for (let z = cz; z < cz + h; z++) {
      for (let x = cx; x < cx + w; x++) {
        this.grid[z][x] = 'room';
        this.metadata[z][x] = { type: 'room', roomType: type };
      }
    }
  }

  _pickRoomType() {
    const r = this.rng() * 100;
    if (r < 40) return 'CHAMBER';
    if (r < 75) return 'HALL';
    return 'VAULT';
  }

  _connectRooms() {
    // Connect rooms in placement order (simple nearest-neighbor chain)
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1];
      const b = this.rooms[i];
      this._carveCorridor(a, b);
    }
  }

  _carveCorridor(a, b) {
    // L-shaped corridor: horizontal then vertical
    let ax = a.cx + Math.floor(a.w / 2);
    let az = a.cz + Math.floor(a.h / 2);
    let bx = b.cx + Math.floor(b.w / 2);
    let bz = b.cz + Math.floor(b.h / 2);

    // Randomly choose horizontal-first or vertical-first
    if (this.rng() > 0.5) {
      this._carveH(ax, bx, az);
      this._carveV(az, bz, bx);
    } else {
      this._carveV(az, bz, ax);
      this._carveH(ax, bx, bz);
    }
  }

  _carveH(x1, x2, z) {
    const min = Math.min(x1, x2);
    const max = Math.max(x1, x2);
    for (let x = min; x <= max; x++) {
      if (this.grid[z][x] === 'empty') {
        this.grid[z][x] = 'corridor';
        this.metadata[z][x] = { type: 'corridor' };
      }
    }
  }

  _carveV(z1, z2, x) {
    const min = Math.min(z1, z2);
    const max = Math.max(z1, z2);
    for (let z = min; z <= max; z++) {
      if (this.grid[z][x] === 'empty') {
        this.grid[z][x] = 'corridor';
        this.metadata[z][x] = { type: 'corridor' };
      }
    }
  }

  _addDeadEnds() {
    // Add 0-2 short dead-end corridors branching off existing corridors
    const count = Math.floor(this.rng() * (DUNGEON.DEAD_END_MAX + 1));
    let added = 0;
    let attempts = 0;
    while (added < count && attempts < 50) {
      attempts++;
      const z = Math.floor(this.rng() * this.gridSize);
      const x = Math.floor(this.rng() * this.gridSize);
      if (this.grid[z][x] === 'corridor') {
        // Try extending 1-2 cells in a random direction
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const [dx, dz] = dirs[Math.floor(this.rng() * 4)];
        const len = 1 + Math.floor(this.rng() * 2);
        let ok = true;
        for (let i = 1; i <= len && ok; i++) {
          const nz = z + dz * i;
          const nx = x + dx * i;
          if (nz < 0 || nz >= this.gridSize || nx < 0 || nx >= this.gridSize) { ok = false; break; }
          if (this.grid[nz][nx] !== 'empty') { ok = false; break; }
        }
        if (ok) {
          for (let i = 1; i <= len; i++) {
            const nz = z + dz * i;
            const nx = x + dx * i;
            this.grid[nz][nx] = 'corridor';
            this.metadata[nz][nx] = { type: 'corridor' };
          }
          added++;
        }
      }
    }
  }

  _designateEntranceAndExit() {
    // Entrance: first room placed
    const entrance = this.rooms[0];
    this.entranceCell = {
      x: entrance.cx + Math.floor(entrance.w / 2),
      z: entrance.cz + Math.floor(entrance.h / 2),
    };
    // Exit: largest room farthest from entrance
    let best = this.rooms[0];
    let bestDist = 0;
    for (const room of this.rooms) {
      const size = room.w * room.h;
      const dx = room.cx - entrance.cx;
      const dz = room.cz - entrance.cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (size >= best.w * best.h && dist > bestDist) {
        best = room;
        bestDist = dist;
      }
    }
    this.exitCell = {
      x: best.cx + Math.floor(best.w / 2),
      z: best.cz + Math.floor(best.h / 2),
    };
  }
}

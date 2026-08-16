/**
 * DungeonGenerator.js — seeded grid dungeon generator (§5, binding order).
 *
 * All randomness flows through a mulberry32 PRNG seeded per level, so the
 * same seed always yields the same dungeon (§5).
 *
 * Output contract (§5.2 step 7):
 *   { grid, metadata, rooms, gridSize, cellSize, entranceCell, exitCell }
 *
 * grid[i][j]     — 'empty' | 'room' | 'corridor'
 * metadata[i][j] — { type: 'empty'|'room'|'corridor', roomType? }
 * rooms[]        — { cx, cz, w, h, type }
 * entranceCell / exitCell — { x, z } in cell coordinates
 */

import { DUNGEON, BIOMES, BIOME_ROOM_MODIFIERS } from '../core/Constants.js';

/**
 * mulberry32 — tiny fast 32-bit seeded PRNG.
 * Returns a function producing floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DungeonGenerator {
  constructor() {
    this.rng = Math.random;
    this.grid = null;
    this.metadata = null;
    this.rooms = [];
    this.gridSize = 0;
  }

  /**
   * Generate a full dungeon for the given seed and biome id.
   * @returns {{grid, metadata, rooms, gridSize, cellSize, entranceCell, exitCell}}
   */
  generate(seed, biomeId) {
    this.rng = mulberry32(seed);
    this.gridSize = DUNGEON.GRID_MIN + Math.floor(this.rng() * (DUNGEON.GRID_MAX - DUNGEON.GRID_MIN + 1));
    this.biomeId = biomeId;
    this.rooms = [];

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
      cellSize: DUNGEON.CELL_SIZE,
      entranceCell: this.entranceCell,
      exitCell: this.exitCell,
    };
  }

  // -------------------------------------------------------------------------
  // §5.2 step 1
  // -------------------------------------------------------------------------
  _initGrid() {
    const n = this.gridSize;
    this.grid = [];
    this.metadata = [];
    for (let i = 0; i < n; i++) {
      this.grid.push(new Array(n).fill('empty'));
      this.metadata.push(new Array(n).fill(null).map(() => ({ type: 'empty' })));
    }
  }

  // -------------------------------------------------------------------------
  // §5.2 step 2
  // -------------------------------------------------------------------------
  _placeRooms() {
    const count = DUNGEON.ROOMS_MIN + Math.floor(this.rng() * (DUNGEON.ROOMS_MAX - DUNGEON.ROOMS_MIN + 1));
    let attempts = 0;
    while (this.rooms.length < count && attempts < DUNGEON.MAX_PLACEMENT_ATTEMPTS) {
      attempts++;
      const type = this._pickRoomType();
      if (!type) continue;
      const spec = DUNGEON.ROOM_TYPES[type];

      // Size: w = minW + rnd*(maxW − minW + 1); h = maxH > 2 ? minH + rnd*(maxH − minH + 1) : 1
      const w = spec.minW + Math.floor(this.rng() * (spec.maxW - spec.minW + 1));
      const h = spec.maxH > 2 ? spec.minH + Math.floor(this.rng() * (spec.maxH - spec.minH + 1)) : 1;

      // Random top-left cell, leaving 1-cell margin on every side
      const minC = 1;
      const maxC = this.gridSize - 1 - w;
      const maxR = this.gridSize - 1 - h;
      if (maxC < minC || maxR < minC) continue;
      const cx = minC + Math.floor(this.rng() * (maxC - minC + 1));
      const cz = minC + Math.floor(this.rng() * (maxR - minC + 1));

      if (!this._canPlaceRoom(cx, cz, w, h)) continue;

      this._carveRoom(cx, cz, w, h, type);
      this.rooms.push({ cx, cz, w, h, type });
    }
  }

  /**
   * Weighted room-type sample for the current biome (§5.3).
   * weight = base × (BIOME_ROOM_MODIFIERS[biome][room] ?? 1); skip weight <= 0.
   */
  _pickRoomType() {
    const mods = BIOME_ROOM_MODIFIERS[this.biomeId] || {};
    const entries = [];
    let total = 0;
    for (const [room, spec] of Object.entries(DUNGEON.ROOM_TYPES)) {
      // eligibility
      const eligible = spec.eligible === 'all' || spec.eligible.includes(this.biomeId);
      if (!eligible) continue;
      const weight = spec.weight * (mods[room] ?? 1);
      if (weight <= 0) continue;
      entries.push([room, weight]);
      total += weight;
    }
    if (total <= 0) return null;
    let roll = this.rng() * total;
    for (const [room, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return room;
    }
    return entries[entries.length - 1][0];
  }

  /**
   * Bounds with 1-cell margin AND no overlap with any carved cell within margin 1.
   */
  _canPlaceRoom(cx, cz, w, h) {
    const n = this.gridSize;
    // 1-cell margin from grid bounds
    if (cx < 1 || cz < 1 || cx + w > n - 1 || cz + h > n - 1) return false;
    // expanded footprint: margin 1 around the room, and one past the top-left corner
    const x0 = cx - 1, z0 = cz - 1;
    const x1 = cx + w, z1 = cz + h;
    if (x0 < 0 || z0 < 0 || x1 >= n || z1 >= n) return false;
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        if (this.grid[i][j] !== 'empty') return false;
      }
    }
    return true;
  }

  _carveRoom(cx, cz, w, h, type) {
    for (let i = cx; i < cx + w; i++) {
      for (let j = cz; j < cz + h; j++) {
        this.grid[i][j] = 'room';
        this.metadata[i][j] = { type: 'room', roomType: type };
      }
    }
  }

  // -------------------------------------------------------------------------
  // §5.2 step 3
  // -------------------------------------------------------------------------
  _roomCenter(r) {
    return { x: r.cx + (r.w >> 1), z: r.cz + (r.h >> 1) };
  }

  _connectRooms() {
    const n = this.rooms.length;
    if (n === 0) return;
    const centers = this.rooms.map(r => this._roomCenter(r));
    const dist = (a, b) => Math.abs(centers[a].x - centers[b].x) + Math.abs(centers[a].z - centers[b].z);

    // Prim's MST over the complete graph (Manhattan distances)
    const inMST = new Array(n).fill(false);
    inMST[0] = true;
    const edges = [];
    for (let added = 1; added < n; added++) {
      // find closest in-tree → out-tree edge
      let best = -1, bestD = Infinity;
      for (let f = 0; f < n; f++) {
        if (!inMST[f]) continue;
        for (let t = 0; t < n; t++) {
          if (inMST[t]) continue;
          const d = dist(f, t);
          if (d < bestD) { bestD = d; best = t; }
        }
      }
      inMST[best] = true;
      // nearest in-tree neighbor for carving (any; pick in-tree with min dist)
      let nn = 0;
      for (let f = 0; f < n; f++) {
        if (inMST[f] && f !== best && dist(f, best) < dist(nn, best)) nn = f;
      }
      edges.push([nn, best]);
    }

    for (const [a, b] of edges) this._carveCorridor(centers[a], centers[b]);

    // Loop corridors: all remaining pairs by distance, keep dist <= gridSize,
    // up to min(3, floor(n/3))
    const mstKeys = new Set(edges.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)));
    const rest = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (mstKeys.has(`${i}-${j}`)) continue;
        rest.push({ i, j, d: dist(i, j) });
      }
    }
    rest.sort((p, q) => p.d - q.d);
    const maxLoops = Math.min(DUNGEON.MAX_LOOP_CORRIDORS, Math.floor(n / 3));
    let added = 0;
    for (const p of rest) {
      if (added >= maxLoops) break;
      if (p.d > this.gridSize) continue;
      this._carveCorridor(centers[p.i], centers[p.j]);
      added++;
    }
  }

  // -------------------------------------------------------------------------
  // §5.2 step 4
  // -------------------------------------------------------------------------
  _carveCorridor(a, b) {
    const roll = this.rng();
    if (roll < 0.35) {
      // horizontal-then-vertical L
      this._carveH(a.x, b.x, a.z);
      this._carveV(a.z, b.z, b.x);
    } else if (roll < 0.7) {
      // vertical-then-horizontal L
      this._carveV(a.z, b.z, a.x);
      this._carveH(a.x, b.x, b.z);
    } else {
      // Z: H-V-H through a midpoint ±1
      const mx = a.x + (this.rng() < 0.5 ? -1 : 1);
      const mz = a.z + (this.rng() < 0.5 ? -1 : 1);
      this._carveH(a.x, mx, a.z);
      this._carveV(a.z, b.z, mx);
      this._carveH(mx, b.x, b.z);
    }
  }

  _carveH(x0, x1, z) {
    const [lo, hi] = x0 < x1 ? [x0, x1] : [x1, x0];
    for (let x = lo; x <= hi; x++) {
      if (x < 0 || x >= this.gridSize || z < 0 || z >= this.gridSize) continue;
      if (this.grid[x][z] === 'empty') {
        this.grid[x][z] = 'corridor';
        this.metadata[x][z] = { type: 'corridor' };
      }
    }
  }

  _carveV(z0, z1, x) {
    const [lo, hi] = z0 < z1 ? [z0, z1] : [z1, z0];
    for (let z = lo; z <= hi; z++) {
      if (x < 0 || x >= this.gridSize || z < 0 || z >= this.gridSize) continue;
      if (this.grid[x][z] === 'empty') {
        this.grid[x][z] = 'corridor';
        this.metadata[x][z] = { type: 'corridor' };
      }
    }
  }

  // -------------------------------------------------------------------------
  // §5.2 step 5
  // -------------------------------------------------------------------------
  _addDeadEnds() {
    const stubs = Math.floor(this.rng() * (DUNGEON.DEAD_END_MAX + 1));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let s = 0; s < stubs; s++) {
      let attempts = 0;
      while (attempts < 50) {
        attempts++;
        // pick a random corridor cell
        const i = Math.floor(this.rng() * this.gridSize);
        const j = Math.floor(this.rng() * this.gridSize);
        if (this.grid[i][j] !== 'corridor') continue;
        const [dx, dz] = dirs[Math.floor(this.rng() * 4)];
        const len = 1 + Math.floor(this.rng() * 2); // 1–2 cells
        let ok = true;
        for (let k = 1; k <= len; k++) {
          const ni = i + dx * k, nj = j + dz * k;
          if (ni < 0 || nj < 0 || ni >= this.gridSize || nj >= this.gridSize || this.grid[ni][nj] !== 'empty') {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        for (let k = 1; k <= len; k++) {
          const ni = i + dx * k, nj = j + dz * k;
          this.grid[ni][nj] = 'corridor';
          this.metadata[ni][nj] = { type: 'corridor' };
        }
        break; // one stub placed
      }
    }
  }

  // -------------------------------------------------------------------------
  // §5.2 step 6
  // -------------------------------------------------------------------------
  _designateEntranceAndExit() {
    // Entrance: room with minimum cx + cz; entrance cell = its center
    let ent = this.rooms[0];
    for (const r of this.rooms) {
      if (r.cx + r.cz < ent.cx + ent.cz) ent = r;
    }
    const c = this._roomCenter(ent);
    this.entranceCell = { x: c.x, z: c.z };

    // BFS over non-empty cells from the entrance; exit = last room cell at max distance
    const n = this.gridSize;
    const key = (x, z) => x * n + z;
    const dist = new Map();
    const queue = [key(c.x, c.z)];
    dist.set(key(c.x, c.z), 0);
    let lastRoomCell = null;
    let maxD = -1;
    while (queue.length > 0) {
      const k = queue.shift();
      const x = Math.floor(k / n), z = k % n;
      const d = dist.get(k);
      if (this.metadata[x][z].type === 'room' && d > maxD) {
        maxD = d;
        lastRoomCell = { x, z };
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        if (this.grid[nx][nz] === 'empty') continue;
        const nk = key(nx, nz);
        if (dist.has(nk)) continue;
        dist.set(nk, d + 1);
        queue.push(nk);
      }
    }
    this.exitCell = lastRoomCell || this.entranceCell;
  }
}

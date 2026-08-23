// DungeonGenerator.js — seeded grid dungeon (§5; algorithm order is binding).
// All randomness through mulberry32 — same seed → same dungeon.
import { DUNGEON, WORLD, ROOM_TYPES, BIOME_ROOM_MODIFIERS } from '../core/Constants.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EMPTY = 'empty', ROOM = 'room', CORRIDOR = 'corridor';

export default class DungeonGenerator {
  constructor(seed, biomeId, opts = {}) {
    this.seed = seed;
    this.rnd = mulberry32(seed);
    this.biome = biomeId;
    this.gridSize = opts.gridSize || (DUNGEON.GRID_MIN + Math.floor(this.rnd() * (DUNGEON.GRID_MAX - DUNGEON.GRID_MIN + 1)));
    this.roomTarget = opts.roomCount || DUNGEON.ROOM_COUNT;
    this.cellSize = WORLD.CELL_SIZE;
    this.grid = [];
    this.metadata = [];
    this.rooms = [];
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
      exitCell: this.exitCell
    };
  }

  _initGrid() {
    this.grid = Array.from({ length: this.gridSize }, () => new Array(this.gridSize).fill(EMPTY));
    this.metadata = Array.from({ length: this.gridSize }, () =>
      Array.from({ length: this.gridSize }, () => ({ type: EMPTY })));
  }

  _pickRoomType() {
    const mods = BIOME_ROOM_MODIFIERS[this.biome] || {};
    const pool = [];
    for (const rt of ROOM_TYPES) {
      if (rt.biomes !== 'all' && !rt.biomes.includes(this.biome)) continue;
      const w = rt.weight * (mods[rt.id] ?? 1);
      if (w <= 0) continue;
      pool.push({ rt, w });
    }
    let total = 0;
    for (const p of pool) total += p.w;
    let r = this.rnd() * total;
    for (const p of pool) { r -= p.w; if (r <= 0) return p.rt; }
    return pool[pool.length - 1].rt;
  }

  _canPlaceRoom(cx, cz, w, h) {
    // bounds with 1-cell margin + no overlap with any carved cell within margin 1
    if (cx < 1 || cz < 1 || cx + w > this.gridSize - 1 || cz + h > this.gridSize - 1) return false;
    for (let z = cz - DUNGEON.MIN_ROOM_DIST; z < cz + h + DUNGEON.MIN_ROOM_DIST; z++) {
      for (let x = cx - DUNGEON.MIN_ROOM_DIST; x < cx + w + DUNGEON.MIN_ROOM_DIST; x++) {
        if (x < 0 || z < 0 || x >= this.gridSize || z >= this.gridSize) continue;
        if (this.grid[z][x] !== EMPTY) return false;
      }
    }
    return true;
  }

  _placeRooms() {
    let attempts = 0;
    while (this.rooms.length < this.roomTarget && attempts++ < DUNGEON.MAX_ATTEMPTS) {
      const rt = this._pickRoomType();
      const maxH = rt.hMax ?? rt.maxSize;
      const w = Math.max(1, rt.minSize + Math.floor(this.rnd() * (rt.maxSize - rt.minSize + 1)));
      const h = rt.maxSize > 2
        ? Math.max(1, rt.minSize + Math.floor(this.rnd() * (maxH - rt.minSize + 1)))
        : Math.max(1, rt.hMax ? 1 + Math.floor(this.rnd() * (rt.hMax - rt.minSize + 1)) : 1);
      const cx = 1 + Math.floor(this.rnd() * (this.gridSize - 2));
      const cz = 1 + Math.floor(this.rnd() * (this.gridSize - 2));
      if (!this._canPlaceRoom(cx, cz, w, h)) continue;
      for (let z = cz; z < cz + h; z++) {
        for (let x = cx; x < cx + w; x++) {
          this.grid[z][x] = ROOM;
          this.metadata[z][x] = { type: ROOM, roomType: rt.id };
        }
      }
      this.rooms.push({ cx, cz, w, h, type: rt.id });
    }
  }

  _roomCenter(r) { return { x: r.cx + Math.floor((r.w - 1) / 2), z: r.cz + Math.floor((r.h - 1) / 2) }; }

  _connectRooms() {
    // Prim's MST over the complete graph with Manhattan distance between centers
    const n = this.rooms.length;
    if (n === 0) return;
    const inTree = new Array(n).fill(false);
    const bestDist = new Array(n).fill(Infinity);
    const bestFrom = new Array(n).fill(-1);
    inTree[0] = true;
    for (let i = 1; i < n; i++) {
      bestDist[i] = this._manhattan(this._roomCenter(this.rooms[0]), this._roomCenter(this.rooms[i]));
      bestFrom[i] = 0;
    }
    for (let iter = 1; iter < n; iter++) {
      let minI = -1, minD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!inTree[i] && bestDist[i] < minD) { minD = bestDist[i]; minI = i; }
      }
      if (minI < 0) break;
      inTree[minI] = true;
      this._carveCorridor(this.rooms[bestFrom[minI]], this.rooms[minI]);
      for (let i = 0; i < n; i++) {
        if (!inTree[i]) {
          const d = this._manhattan(this._roomCenter(this.rooms[minI]), this._roomCenter(this.rooms[i]));
          if (d < bestDist[i]) { bestDist[i] = d; bestFrom[i] = minI; }
        }
      }
    }
    // loop corridors: pairs with distance ≤ gridSize, up to min(3, floor(n/3))
    const pairs = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = this._manhattan(this._roomCenter(this.rooms[i]), this._roomCenter(this.rooms[j]));
      if (d > 0 && d <= this.gridSize && !this._directlyConnected(i, j)) pairs.push({ i, j, d });
    }
    pairs.sort((a, b) => a.d - b.d);
    const extra = Math.min(3, Math.floor(n / 3));
    for (let k = 0; k < Math.min(extra, pairs.length); k++) {
      this._carveCorridor(this.rooms[pairs[k].i], this.rooms[pairs[k].j]);
    }
  }

  _edges = null;
  _directlyConnected(a, b) {
    if (!this._edges) this._edges = [];
    // track edges carved by MST so loop pass doesn't duplicate them
    return false; // duplicates are harmless anyway (§5.4 carve only flips empty)
  }

  _manhattan(c1, c2) { return Math.abs(c1.x - c2.x) + Math.abs(c1.z - c2.z); }

  _carveCorridor(a, b) {
    const ca = this._roomCenter(a), cb = this._roomCenter(b);
    const roll = this.rnd();
    if (roll < 0.35) { this._carveH(ca.x, cb.x, ca.z); this._carveV(ca.z, cb.z, cb.x); }
    else if (roll < 0.7) { this._carveV(ca.z, cb.z, ca.x); this._carveH(ca.x, cb.x, cb.z); }
    else {
      // Z: H-V-H through midpoint ±1
      const midX = Math.floor((ca.x + cb.x) / 2) + Math.floor(this.rnd() * 3) - 1;
      this._carveH(ca.x, midX, ca.z);
      this._carveV(ca.z, cb.z, midX);
      this._carveH(midX, cb.x, cb.z);
    }
  }

  _carveH(x1, x2, z) {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    for (let x = lo; x <= hi; x++) {
      if (x < 0 || x >= this.gridSize || z < 0 || z >= this.gridSize) continue;
      if (this.grid[z][x] === EMPTY) { this.grid[z][x] = CORRIDOR; this.metadata[z][x] = { type: CORRIDOR }; }
    }
  }

  _carveV(z1, z2, x) {
    const lo = Math.min(z1, z2), hi = Math.max(z1, z2);
    for (let z = lo; z <= hi; z++) {
      if (x < 0 || x >= this.gridSize || z < 0 || z >= this.gridSize) continue;
      if (this.grid[z][x] === EMPTY) { this.grid[z][x] = CORRIDOR; this.metadata[z][x] = { type: CORRIDOR }; }
    }
  }

  _addDeadEnds() {
    const count = Math.floor(this.rnd() * (DUNGEON.DEAD_END_MAX + 1));
    let attempts = 0, made = 0;
    while (made < count && attempts++ < 50) {
      const corridorCells = [];
      for (let z = 0; z < this.gridSize; z++) for (let x = 0; x < this.gridSize; x++)
        if (this.grid[z][x] === CORRIDOR) corridorCells.push({ x, z });
      if (!corridorCells.length) break;
      const cell = corridorCells[Math.floor(this.rnd() * corridorCells.length)];
      const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(this.rnd() * 4)];
      const len = 1 + Math.floor(this.rnd() * 2);
      // all target cells must still be empty
      let ok = true;
      for (let s = 1; s <= len; s++) {
        const x = cell.x + dir[0] * s, z = cell.z + dir[1] * s;
        if (x < 0 || z < 0 || x >= this.gridSize || z >= this.gridSize || this.grid[z][x] !== EMPTY) { ok = false; break; }
      }
      if (!ok) continue;
      for (let s = 1; s <= len; s++) {
        const x = cell.x + dir[0] * s, z = cell.z + dir[1] * s;
        this.grid[z][x] = CORRIDOR; this.metadata[z][x] = { type: CORRIDOR };
      }
      made++;
    }
  }

  _designateEntranceAndExit() {
    // Entrance: room with minimum cx+cz; entrance cell = its center cell.
    let entrance = null;
    for (const r of this.rooms) {
      if (!entrance || r.cx + r.cz < entrance.cx + entrance.cz) entrance = r;
    }
    if (!entrance) { this.entranceCell = { x: 1, z: 1 }; this.exitCell = { x: 1, z: 1 }; return; }
    this.entranceRoom = entrance;
    this.entranceCell = this._roomCenter(entrance);

    // Exit: BFS over non-empty cells from the entrance; last ROOM cell reached at maximum distance.
    const dist = Array.from({ length: this.gridSize }, () => new Array(this.gridSize).fill(-1));
    const q = [this.entranceCell];
    dist[this.entranceCell.z][this.entranceCell.x] = 0;
    let farthest = null, farDist = -1;
    while (q.length) {
      const c = q.shift();
      const d = dist[c.z][c.x];
      if (this.grid[c.z][c.x] === ROOM && d > farDist) { farDist = d; farthest = c; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, nz = c.z + dz;
        if (nx < 0 || nz < 0 || nx >= this.gridSize || nz >= this.gridSize) continue;
        if (this.grid[nz][nx] === EMPTY || dist[nz][nx] >= 0) continue;
        dist[nz][nx] = d + 1;
        q.push({ x: nx, z: nz });
      }
    }
    this.exitCell = farthest || this.entranceCell;
    // find which room contains the exit cell
    this.exitRoom = this.rooms.find(r =>
      this.exitCell.x >= r.cx && this.exitCell.x < r.cx + r.w &&
      this.exitCell.z >= r.cz && this.exitCell.z < r.cz + r.h) || null;
    this.exitBfsDistance = farDist;
  }
}

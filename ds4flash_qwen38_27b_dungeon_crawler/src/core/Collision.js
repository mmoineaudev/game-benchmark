/**
 * Collision.js — shared circle-vs-AABB collision math (§6).
 * Used identically by player, enemies, projectiles. Pure math, no three import.
 *
 * A box is an AABB in XZ: { minX, minZ, maxX, maxZ }.
 */

/**
 * True if any AABB's closest point to (x, z) is within `radius`.
 * @param {Array<{minX:number,minZ:number,maxX:number,maxZ:number}>} boxes
 * @param {number} x
 * @param {number} z
 * @param {number} radius
 * @returns {boolean}
 */
export function circleHitsBox(boxes, x, z, radius) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz <= radius * radius) return true;
  }
  return false;
}

/**
 * For each box, push the circle out along the closest-point normal by the
 * overlap. Mutates `pos` ({x, z}) in place and returns it.
 *
 * @param {Array<{minX:number,minZ:number,maxX:number,maxZ:number}>} boxes
 * @param {{x:number,z:number}} pos
 * @param {number} radius
 * @returns {{x:number,z:number}} the pushed-out position
 */
export function resolveCircleCollisions(boxes, pos, radius) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq > radius * radius) continue;

    if (distSq > 1e-12) {
      const dist = Math.sqrt(distSq);
      const overlap = radius - dist;
      pos.x += (dx / dist) * overlap;
      pos.z += (dz / dist) * overlap;
    } else {
      // Center is inside the box: push out along the nearest face.
      const left = pos.x - b.minX;
      const right = b.maxX - pos.x;
      const top = pos.z - b.minZ;
      const bottom = b.maxZ - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) { pos.x = b.minX - radius; }
      else if (m === right) { pos.x = b.maxX + radius; }
      else if (m === top) { pos.z = b.minZ - radius; }
      else { pos.z = b.maxZ + radius; }
    }
  }
  return pos;
}

/**
 * A lightweight uniform-grid spatial index over a STATIC set of XZ AABBs.
 * Replaces the O(boxes) linear scan in the per-frame hot paths (LOS ray
 * march, circle move, greedy pathing) with O(cells) — the dominant per-enemy
 * cost at high levels, where 100+ boxes × hundreds of LOS samples/frame
 * adds up fast. Built once per level (boxes are cached in Game / SkeletonSystem).
 *
 * Usage:
 *   const grid = new BoxGrid(boxes, 2.0);
 *   grid.circleHits(x, z, r)   // === circleHitsBox(boxes, x, z, r)
 *   grid.resolve(pos, r)       // === resolveCircleCollisions(boxes, pos, r)
 */
export class BoxGrid {
  /**
   * @param {Array<{minX:number,minZ:number,maxX:number,maxZ:number}>} boxes
   * @param {number} [cell] grid cell size in world units (default 2.0)
   */
  constructor(boxes, cell = 2.0) {
    this.boxes = boxes;
    this.cell = cell;
    this.boxCount = boxes.length;
    this._seen = new Uint8Array(boxes.length);
    this._cand = new Int32Array(Math.max(1, boxes.length));
    this.originX = 0;
    this.originZ = 0;
    this.cols = 0;
    this.rows = 0;
    // Flat Int array of per-cell box-index lists.
    this.counts = null;
    this.offsets = null;
    this.entries = null;
    if (!boxes.length) return;
    // Compute bounds.
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const b of boxes) {
      if (b.minX < minX) minX = b.minX;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }
    this.originX = minX;
    this.originZ = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
    this.counts = new Int32Array(this.cols * this.rows);
    // Pass 1: count box references per cell (a box can span multiple cells).
    for (const b of boxes) {
      const x0 = Math.max(0, Math.floor((b.minX - this.originX) / cell));
      const z0 = Math.max(0, Math.floor((b.minZ - this.originZ) / cell));
      const x1 = Math.min(this.cols - 1, Math.floor((b.maxX - this.originX) / cell));
      const z1 = Math.min(this.rows - 1, Math.floor((b.maxZ - this.originZ) / cell));
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++)
          this.counts[cz * this.cols + cx]++;
    }
    // Prefix-sum offsets (exclusive) for the flat entries array.
    this.offsets = new Int32Array(this.cols * this.rows + 1);
    let acc = 0;
    for (let i = 0; i < this.counts.length; i++) {
      this.offsets[i] = acc;
      acc += this.counts[i];
    }
    this.offsets[this.counts.length] = acc;
    this.entries = new Int32Array(acc);
    // Fill: cursor per cell.
    const cursor = this.offsets.slice(0, this.counts.length);
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi];
      const x0 = Math.max(0, Math.floor((b.minX - this.originX) / cell));
      const z0 = Math.max(0, Math.floor((b.minZ - this.originZ) / cell));
      const x1 = Math.min(this.cols - 1, Math.floor((b.maxX - this.originX) / cell));
      const z1 = Math.min(this.rows - 1, Math.floor((b.maxZ - this.originZ) / cell));
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const ci = cz * this.cols + cx;
          this.entries[cursor[ci]++] = bi;
        }
      }
    }
  }

  /**
   * True if any box's closest point to (x, z) is within `radius`.
   * Same result as `circleHitsBox(this.boxes, x, z, radius)` but O(cells).
   */
  circleHits(x, z, radius) {
    if (!this.entries) return false;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor((x - radius - this.originX) / this.cell));
    const z0 = Math.max(0, Math.floor((z - radius - this.originZ) / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((x + radius - this.originX) / this.cell));
    const z1 = Math.min(this.rows - 1, Math.floor((z + radius - this.originZ) / this.cell));
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const ci = cz * this.cols + cx;
        const start = this.offsets[ci], end = this.offsets[ci + 1];
        for (let k = start; k < end; k++) {
          const b = this.boxes[this.entries[k]];
          const cxp = Math.max(b.minX, Math.min(x, b.maxX));
          const czp = Math.max(b.minZ, Math.min(z, b.maxZ));
          const dx = x - cxp, dz = z - czp;
          if (dx * dx + dz * dz <= r2) return true;
        }
      }
    }
    return false;
  }

  /**
   * Push `pos` out of any box it overlaps. Produces the SAME result as
   * `resolveCircleCollisions(this.boxes, pos, radius)`:
   *
   * The linear reference visits every box exactly once, in ascending index
   * order, testing each against the *current* (possibly already-pushed)
   * position. Push-out moves the point at most `radius` from its start, so
   * the only boxes that can ever be touched are those within `2*radius` of
   * the START position. We collect exactly that candidate set (grid
   * accelerated), sort by ascending index, and process each once — a
   * provably-identical subset of the linear scan's work.
   */
  resolve(pos, radius) {
    if (!this.entries) return pos;
    const seen = this._seen;
    const r2 = radius * radius;
    // Candidate band: the point can never leave a 2*radius neighborhood of
    // its start, so any box it could touch is within (start ± 2*radius).
    const px0 = pos.x, pz0 = pos.z;
    const pad = 2 * radius;
    const x0 = Math.max(0, Math.floor((px0 - pad - this.originX) / this.cell));
    const z0 = Math.max(0, Math.floor((pz0 - pad - this.originZ) / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((px0 + pad - this.originX) / this.cell));
    const z1 = Math.min(this.rows - 1, Math.floor((pz0 + pad - this.originZ) / this.cell));
    let n = 0;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const ci = cz * this.cols + cx;
        const start = this.offsets[ci], end = this.offsets[ci + 1];
        for (let k = start; k < end; k++) {
          const bi = this.entries[k];
          if (!seen[bi]) { seen[bi] = 1; this._cand[n++] = bi; }
        }
      }
    }
    // Sort by ascending box index (insertion sort, n is small).
    for (let i = 1; i < n; i++) {
      const v = this._cand[i];
      let j = i - 1;
      while (j >= 0 && this._cand[j] > v) { this._cand[j + 1] = this._cand[j]; j--; }
      this._cand[j + 1] = v;
    }
    // Process each candidate once, in index order, against the moving pos —
    // identical to the linear scan's per-box behavior.
    for (let i = 0; i < n; i++) {
      const b = this.boxes[this._cand[i]];
      const cxp = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const czp = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cxp;
      const dz = pos.z - czp;
      const distSq = dx * dx + dz * dz;
      if (distSq > r2) continue;
      if (distSq > 1e-12) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist;
        pos.x += (dx / dist) * overlap;
        pos.z += (dz / dist) * overlap;
      } else {
        const left = pos.x - b.minX, right = b.maxX - pos.x;
        const top = pos.z - b.minZ, bottom = b.maxZ - pos.z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) pos.x = b.minX - radius;
        else if (m === right) pos.x = b.maxX + radius;
        else if (m === top) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
    for (let i = 0; i < n; i++) seen[this._cand[i]] = 0;
    return pos;
  }
}

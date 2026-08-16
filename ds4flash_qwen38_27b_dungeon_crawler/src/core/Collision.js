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

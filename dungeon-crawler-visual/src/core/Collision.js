// Shared circle-vs-AABB collision helpers (player, skeletons, projectiles).
// Mirrors the algorithm Game._resolveCollisions used so all actors behave identically.

// Push a circle (pos.x, pos.z, radius) out of AABB collision boxes.
export function resolveCircleCollisions(boxes, pos, radius) {
  for (const box of boxes) {
    const cx = Math.max(box.minX, Math.min(pos.x, box.maxX));
    const cz = Math.max(box.minZ, Math.min(pos.z, box.maxZ));
    const dx = pos.x - cx;
    const dz = pos.z - cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < radius) {
      const overlap = radius - dist;
      const nx = dist > 0.001 ? dx / dist : 0;
      const nz = dist > 0.001 ? dz / dist : 1;
      pos.x += nx * overlap;
      pos.z += nz * overlap;
    }
  }
}

// True if a circle at (x, z) intersects any AABB box.
export function circleHitsBox(boxes, x, z, radius) {
  for (const box of boxes) {
    const cx = Math.max(box.minX, Math.min(x, box.maxX));
    const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
    if ((x - cx) ** 2 + (z - cz) ** 2 < radius * radius) return true;
  }
  return false;
}

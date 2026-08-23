// Collision.js — shared circle-vs-AABB helpers (§6). Used by player, enemies, projectiles.
// Boxes: [{minX, maxX, minZ, maxZ}]

export function circleHitsBox(boxes, x, z, radius) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

export function resolveCircleCollisions(boxes, pos, radius) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    let dx = pos.x - cx, dz = pos.z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 < 1e-9) {
      // center inside the box: push out along the smallest penetration axis
      const px = Math.min(pos.x - b.minX, b.maxX - pos.x);
      const pz = Math.min(pos.z - b.minZ, b.maxZ - pos.z);
      if (px < pz) pos.x = (pos.x - b.minX < b.maxX - pos.x) ? b.minX - radius : b.maxX + radius;
      else pos.z = (pos.z - b.minZ < b.maxZ - pos.z) ? b.minZ - radius : b.maxZ + radius;
      continue;
    }
    const d = Math.sqrt(d2);
    const push = radius - d;
    pos.x += (dx / d) * push;
    pos.z += (dz / d) * push;
  }
}

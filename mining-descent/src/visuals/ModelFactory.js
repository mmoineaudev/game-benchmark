// =============================================================================
// ModelFactory — creates hub buildings and decorative objects.
// =============================================================================

import * as THREE from 'three';

export class ModelFactory {
  /**
   * Create the surface hub: a dome + landing pad.
   */
  static createHub() {
    const group = new THREE.Group();

    // Dome (hemisphere)
    const domeGeom = new THREE.SphereGeometry(1.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshLambertMaterial({ color: 0x8899aa, transparent: true, opacity: 0.7 });
    const dome = new THREE.Mesh(domeGeom, domeMat);
    dome.position.y = 0.01;
    group.add(dome);

    // Base ring
    const ringGeom = new THREE.TorusGeometry(1.5, 0.1, 8, 16);
    const ringMat = new THREE.MeshLambertMaterial({ color: 0x667788 });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    // Landing pad (flat box)
    const padGeom = new THREE.BoxGeometry(2, 0.05, 2);
    const padMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const pad = new THREE.Mesh(padGeom, padMat);
    pad.position.set(3, -0.45, 0);
    group.add(pad);

    // Pad markings
    const markGeom = new THREE.BoxGeometry(1.5, 0.005, 0.15);
    const markMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const mark = new THREE.Mesh(markGeom, markMat);
    mark.position.set(3, -0.42, 0);
    group.add(mark);

    return group;
  }

  /** Create a starfield: random points on a large sphere. */
  static createStarfield(count = 500) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      // Random on sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 120 + Math.random() * 40;
      positions[i] = Math.sin(phi) * Math.cos(theta) * r;
      positions[i + 1] = Math.abs(Math.sin(phi) * Math.sin(theta) * r); // only above
      positions[i + 2] = Math.cos(phi) * r;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.7 });
    return new THREE.Points(geom, mat);
  }

  /** Create ground plane for hub mode. */
  static createGround(width = 50, depth = 50) {
    const geom = new THREE.PlaneGeometry(width, depth);
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a7a2e });
    const plane = new THREE.Mesh(geom, mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(width / 2, -0.01, depth / 2);
    return plane;
  }
}

// ============================================================
// ShootingStarManager — rare lonely shooting stars with gas trails
// ============================================================
import * as THREE from 'three';

const COLORS = [0xffccaa, 0xaaccff, 0xccffee, 0xffddcc];

class ShootingStarManager {
  constructor(scene) {
    this.scene = scene;
    this._stars = new Map();
    this._pool = [];
    this._clock = new THREE.Clock();
    this._lastSpawnCheck = 0;
    this._spawnInterval = 3.5;
  }

  _acquire() {
    for (const p of this._pool) {
      if (!p.userData._active) return p;
    }
    const positions = new Float32Array(48 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      color: 0xffddaa,
      size: 0.12,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    points.userData = {
      _active: false,
      _life: 0,
      _maxLife: 0,
      velocity: new THREE.Vector3(),
      position: new THREE.Vector3(),
      _count: 0,
    };
    this.scene.add(points);
    this._pool.push(points);
    return points;
  }

  update(shipPos, dt) {
    const t = this._clock.getElapsedTime();
    if (t - this._lastSpawnCheck > this._spawnInterval) {
      this._lastSpawnCheck = t;
      this._maybeSpawn(shipPos);
    }

    for (const [key, star] of this._stars) {
      if (!star.userData._active) continue;
      star.userData._life += dt;
      if (star.userData._life >= star.userData._maxLife) {
        star.visible = false;
        star.userData._active = false;
        this._stars.delete(key);
        continue;
      }
      const ud = star.userData;
      ud.position.addScaledVector(ud.velocity, dt);
      const pos = star.geometry.attributes.position.array;
      const head = ud.position;
      const backDir = ud.velocity.clone().normalize().multiplyScalar(-0.4);
      for (let i = 0; i < ud._count; i++) {
        const along = backDir.clone().multiplyScalar(i);
        pos[i * 3] = head.x + along.x;
        pos[i * 3 + 1] = head.y + along.y;
        pos[i * 3 + 2] = head.z + along.z;
      }
      star.geometry.attributes.position.needsUpdate = true;
      star.geometry.setDrawRange(0, ud._count);
      star.visible = true;
    }
  }

  _maybeSpawn(shipPos) {
    if (Math.random() > 0.35) return;

    const points = this._acquire();
    const ud = points.userData;
    ud._active = true;
    ud._life = 0;
    ud._maxLife = 1.2 + Math.random() * 1.4;
    ud._count = 12 + Math.floor(Math.random() * 20);

    const dir = new THREE.Vector3(Math.random() - 0.5, 0.1 + Math.random() * 0.4, Math.random() - 0.5).normalize();
    const speed = 40 + Math.random() * 50;
    ud.velocity.copy(dir).multiplyScalar(speed);

    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 180,
      (Math.random() - 0.5) * 120,
      (Math.random() - 0.5) * 180
    );
    ud.position.copy(shipPos).add(offset);

    const col = COLORS[Math.floor(Math.random() * COLORS.length)];
    points.material.color.set(col);
    points.material.opacity = 0.55 + Math.random() * 0.3;

    const pos = points.geometry.attributes.position.array;
    for (let i = 0; i < ud._count; i++) {
      pos[i * 3 + 1] = -99999;
    }
    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.setDrawRange(0, ud._count);
  }

  clear() {
    for (const [, star] of this._stars) {
      if (star.geometry) star.geometry.dispose();
      if (star.material) star.material.dispose();
      this.scene.remove(star);
    }
    this._stars.clear();
  }

  destroy() {
    this.clear();
    for (const p of this._pool) {
      if (p.geometry) p.geometry.dispose();
      if (p.material) p.material.dispose();
      this.scene.remove(p);
    }
    this._pool.length = 0;
  }
}

export default ShootingStarManager;

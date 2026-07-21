// VOID DRIFT — ShootingStarManager.js
// Rare transient additive point-trails streaking across the sky.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

export class ShootingStarManager {
  constructor(scene) {
    this._scene = scene;
    this._stars = [];
    this._lastCheck = 0;
    this._tmpDir = new THREE.Vector3();
  }

  _maybeSpawn(shipPos, time) {
    if (Math.random() > Constants.SHOOTING_STAR.SPAWN_CHANCE) return;
    const S = Constants.SHOOTING_STAR;
    const count = S.MIN_POINTS + Math.floor(Math.random() * (S.MAX_POINTS - S.MIN_POINTS));
    const speed = S.MIN_SPEED + Math.random() * (S.MAX_SPEED - S.MIN_SPEED);
    const life = S.MIN_LIFE + Math.random() * (S.MAX_LIFE - S.MIN_LIFE);
    const opacity = S.MIN_OPACITY + Math.random() * (S.MAX_OPACITY - S.MIN_OPACITY);

    const dir = new THREE.Vector3(Math.random() * 2 - 1, (Math.random() - 0.5) * 0.4, Math.random() * 2 - 1).normalize();
    const origin = new THREE.Vector3(
      shipPos.x + (Math.random() - 0.5) * 400,
      shipPos.y + 40 + Math.random() * 160,
      shipPos.z + (Math.random() - 0.5) * 400);

    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = origin.x - dir.x * i * 1.5;
      positions[i * 3 + 1] = origin.y - dir.y * i * 1.5;
      positions[i * 3 + 2] = origin.z - dir.z * i * 1.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcceeff, size: 1.8, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this._scene.add(points);
    this._stars.push({ points, dir, speed, born: time, life, baseOpacity: opacity });
  }

  update(shipPos, time, dt) {
    if (time - this._lastCheck > Constants.SHOOTING_STAR.CHECK_INTERVAL) {
      this._lastCheck = time;
      this._maybeSpawn(shipPos, time);
    }
    for (let i = this._stars.length - 1; i >= 0; i--) {
      const s = this._stars[i];
      const age = time - s.born;
      if (age > s.life) {
        this._scene.remove(s.points);
        s.points.geometry.dispose();
        s.points.material.dispose();
        this._stars.splice(i, 1);
        continue;
      }
      // Advance the whole streak; fade near end of life.
      this._tmpDir.copy(s.dir).multiplyScalar(s.speed * dt);
      s.points.position.add(this._tmpDir);
      const fade = 1 - Math.pow(age / s.life, 2);
      s.points.material.opacity = s.baseOpacity * fade;
    }
  }

  destroy() {
    for (const s of this._stars) {
      this._scene.remove(s.points);
      s.points.geometry.dispose();
      s.points.material.dispose();
    }
    this._stars = [];
  }
}

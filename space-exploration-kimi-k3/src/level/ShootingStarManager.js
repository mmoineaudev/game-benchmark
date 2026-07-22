// VOID DRIFT — ShootingStarManager.js
// Longer, more visible meteor streaks with head glow, trail ribbon, and fadeout.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

export class ShootingStarManager {
  constructor(scene) {
    this._scene = scene;
    this._stars = [];
    this._lastCheck = 0;
  }

  _maybeSpawn(shipPos, time) {
    if (Math.random() > Constants.SHOOTING_STAR.SPAWN_CHANCE) return;
    const S = Constants.SHOOTING_STAR;
    const pointCount = S.MIN_POINTS + Math.floor(Math.random() * (S.MAX_POINTS - S.MIN_POINTS));
    const speed = S.MIN_SPEED + Math.random() * (S.MAX_SPEED - S.MIN_SPEED);
    const life = S.MIN_LIFE + Math.random() * (S.MAX_LIFE - S.MIN_LIFE);
    const baseOpacity = S.MIN_OPACITY + Math.random() * (S.MAX_OPACITY - S.MIN_OPACITY);

    const dir = new THREE.Vector3(Math.random() * 2 - 1, (Math.random() - 0.5) * 0.25, Math.random() * 2 - 1).normalize();

    // Far shell around ship: always apparent as a sky object.
    const dist = 5000 + Math.random() * 12000;
    const offset = dir.clone().multiplyScalar(dist).add(
      new THREE.Vector3(0, 200 + Math.random() * 1200, 0)
    );
    const origin = shipPos.clone().add(offset);

    // Trail ribbon.
    const positions = new Float32Array(pointCount * 3);
    const sizes = new Float32Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      const t = i / (pointCount - 1);
      const back = origin.clone().addScaledVector(dir, -t * 140);
      positions[i * 3] = back.x;
      positions[i * 3 + 1] = back.y;
      positions[i * 3 + 2] = back.z;
      sizes[i] = (1 - t) * 3.2 + 0.6;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trailGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const trailMat = new THREE.PointsMaterial({
      color: 0xcceeff,
      size: 1.8,
      transparent: true,
      opacity: baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: false,
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    trail.frustumCulled = false;
    this._scene.add(trail);

    // Head glow sprite.
    const glowMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: baseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(4.5);
    glow.position.copy(origin);
    this._scene.add(glow);

    this._stars.push({
      trail,
      trailMat,
      glow,
      glowMat,
      dir,
      speed,
      born: time,
      life,
      baseOpacity,
      origin: origin.clone(),
      forward: dir.clone(),
      positions,
    });
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
        this._scene.remove(s.trail);
        s.trail.geometry.dispose();
        s.trailMat.dispose();
        this._scene.remove(s.glow);
        s.glowMat.dispose();
        this._stars.splice(i, 1);
        continue;
      }

      // Whole streak advances.
      s.forward.copy(s.dir).multiplyScalar(s.speed * dt);
      s.trail.position.add(s.forward);
      s.glow.position.add(s.forward);

      // Slow fadeout.
      const fade = 1 - Math.pow(age / s.life, 2);
      s.trailMat.opacity = s.baseOpacity * fade;
      s.glowMat.opacity = s.baseOpacity * fade * 0.9;
      s.glow.scale.setScalar(4.5 * (0.6 + 0.4 * Math.max(age / s.life, 0)));

      // Trailing birth effect on trail head.
      const arr = s.trail.geometry.attributes.position.array;
      const len = arr.length / 3;
      for (let j = len - 1; j > 0; j--) {
        arr[j * 3] = arr[(j - 1) * 3];
        arr[j * 3 + 1] = arr[(j - 1) * 3 + 1];
        arr[j * 3 + 2] = arr[(j - 1) * 3 + 2];
      }
      const head = s.trail.position;
      arr[0] = head.x;
      arr[1] = head.y;
      arr[2] = head.z;
      s.trail.geometry.attributes.position.needsUpdate = true;
    }
  }

  destroy() {
    for (const s of this._stars) {
      this._scene.remove(s.trail);
      s.trail.geometry.dispose();
      s.trailMat.dispose();
      this._scene.remove(s.glow);
      s.glowMat.dispose();
    }
    this._stars = [];
  }
}

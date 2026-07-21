// ============================================================
// WeaponSystem — Laser projectiles, firing rate, cooldown
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import GameState from '../core/GameState.js';
import EventBus from '../core/EventBus.js';
import ParticleSystem from '../systems/ParticleSystem.js';

const _sharedLaserGeo = new THREE.CylinderGeometry(
  Constants.WEAPON.LASER_RADIUS,
  Constants.WEAPON.LASER_RADIUS,
  Constants.WEAPON.LASER_LENGTH,
  6
);
_sharedLaserGeo.rotateX(Math.PI / 2);
_sharedLaserGeo.translate(0, 0, -Constants.WEAPON.LASER_LENGTH / 2);

const _laserMat = new THREE.MeshStandardMaterial({
  color: Constants.WEAPON.LASER_COLOR,
  emissive: Constants.WEAPON.LASER_COLOR,
  emissiveIntensity: 1.25,
  roughness: 0,
  metalness: 1,
});

class WeaponSystem {
  constructor(scene) {
    this.scene = scene;
    this._projectiles = [];
    this._lastFireTime = 0;
  }

  init() {
    return this._projectiles;
  }

  fire(shipMesh, dt, particleSystem) {
    if (!shipMesh) return;

    const now = performance.now() / 1000;
    const fireInterval = 1 / Constants.WEAPON.FIRE_RATE;

    if (now - this._lastFireTime < fireInterval) return;
    if (!GameState.isAlive) return;

    this._lastFireTime = now;
    EventBus.emit('weapon:fire', {});

    // Play laser sound
    EventBus.emit('audio:laser', {});

    const laser = new THREE.Mesh(_sharedLaserGeo, _laserMat);

    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(shipMesh.quaternion);
    const origin = shipMesh.position.clone().add(forward.clone().multiplyScalar(2.2));
    origin.y += 0.3;

    laser.position.copy(origin);
    laser.lookAt(origin.clone().add(forward));

    this.scene.add(laser);

    const velocity = new THREE.Vector3(0, 0, -Constants.WEAPON.PROJECTILE_SPEED);
    velocity.applyQuaternion(shipMesh.quaternion);
    this._projectiles.push({
      mesh: laser,
      velocity,
      life: Constants.WEAPON.PROJECTILE_LIFETIME,
      range: 0,
    });

    const recoil = new THREE.Vector3(0, 0, 1);
    recoil.applyQuaternion(shipMesh.quaternion);
    shipMesh.userData.velocity.add(recoil.multiplyScalar(0.5));

    if (particleSystem) {
      particleSystem.spawnExhaust(origin, forward.clone().multiplyScalar(-1), 2, 0.6);
    }
  }

  update(dt, particleSystem) {
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const proj = this._projectiles[i];

      proj.mesh.position.addScaledVector(proj.velocity, dt);
      proj.life -= dt;
      proj.range += proj.velocity.length() * dt;

      if (proj.life <= 0 || proj.range >= Constants.WEAPON.PROJECTILE_RANGE) {
        this.scene.remove(proj.mesh);
        this._projectiles.splice(i, 1);
        GameState.removeProjectile(i);
      }
    }
  }

  getProjectiles() {
    return this._projectiles;
  }

  clear() {
    for (const proj of this._projectiles) {
      this.scene.remove(proj.mesh);
    }
    this._projectiles = [];
  }

  reset() {
    this._lastFireTime = 0;
  }
}

export default WeaponSystem;
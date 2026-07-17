// ============================================================
// WeaponSystem — Laser projectiles, firing rate, cooldown
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import GameState from '../core/GameState.js';
import EventBus from '../core/EventBus.js';
import ParticleSystem from '../systems/ParticleSystem.js';

class WeaponSystem {
  constructor(scene) {
    this.scene = scene;
    this._projectiles = [];
    this._laserPool = [];
    this._lastFireTime = 0;
  }

  init() {
    return this._projectiles;
  }

  /**
   * Attempt to fire a laser
   */
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

    // Create laser projectile
    const laser = this._createLaser(shipMesh);
    const velocity = new THREE.Vector3(0, 0, -Constants.WEAPON.PROJECTILE_SPEED);
    velocity.applyQuaternion(shipMesh.quaternion);
    this._projectiles.push({
      mesh: laser,
      velocity: velocity,
      life: Constants.WEAPON.PROJECTILE_LIFETIME,
      range: 0,
    });

    // Apply slight recoil
    const recoil = new THREE.Vector3(0, 0, 1);
    recoil.applyQuaternion(shipMesh.quaternion);
    shipMesh.userData.velocity.add(recoil.multiplyScalar(0.5));
  }

  _createLaser(shipMesh) {
    const geo = new THREE.CylinderGeometry(
      Constants.WEAPON.LASER_RADIUS,
      Constants.WEAPON.LASER_RADIUS,
      Constants.WEAPON.LASER_LENGTH,
      6
    );
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -Constants.WEAPON.LASER_LENGTH / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: Constants.WEAPON.LASER_COLOR,
      emissive: Constants.WEAPON.LASER_COLOR,
      emissiveIntensity: 3,
      roughness: 0,
      metalness: 1,
    });

    const laser = new THREE.Mesh(geo, mat);
    
    // Position at ship's front
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(shipMesh.quaternion);
    const origin = shipMesh.position.clone().add(forward.multiplyScalar(2));
    origin.y += 0.3; // Slightly above ship center
    
    laser.position.copy(origin);
    laser.lookAt(origin.clone().add(forward));
    
    this.scene.add(laser);
    return laser;
  }

  /**
   * Update projectiles
   */
  update(dt, particleSystem) {
    for (let i = this._projectiles.length - 1; i >= 0; i--) {
      const proj = this._projectiles[i];
      
      // Move
      proj.mesh.position.add(proj.velocity.clone().multiplyScalar(dt));
      proj.life -= dt;
      proj.range += proj.velocity.length() * dt;

      // Remove if expired or out of range
      if (proj.life <= 0 || proj.range >= Constants.WEAPON.PROJECTILE_RANGE) {
        this.scene.remove(proj.mesh);
        proj.mesh.geometry.dispose();
        proj.mesh.material.dispose();
        this._projectiles.splice(i, 1);
        GameState.removeProjectile(i);
      }
    }
  }

  /**
   * Get active projectiles
   */
  getProjectiles() {
    return this._projectiles;
  }

  /**
   * Clear all projectiles
   */
  clear() {
    for (const proj of this._projectiles) {
      this.scene.remove(proj.mesh);
      proj.mesh.geometry.dispose();
      proj.mesh.material.dispose();
    }
    this._projectiles = [];
  }

  /**
   * Reset firing cooldown
   */
  reset() {
    this._lastFireTime = 0;
  }
}

export default WeaponSystem;

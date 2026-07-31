import * as THREE from 'three';
import { Constants } from '../core/Constants.js';

// Laser projectiles: pooled glowing beams (spec §6.2).
export class WeaponSystem {
  constructor(scene, events, physics) {
    this.scene = scene;
    this.events = events;
    this.physics = physics;
    this.group = new THREE.Group();
    this.group.name = 'lasers';
    scene.add(this.group);

    this.pool = [];
    this._cooldown = 0;
    this._buildPool();
  }

  _buildPool() {
    const geo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6);
    geo.rotateX(Math.PI / 2); // length along Z
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff6644,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xffaa66,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < Constants.LASER_POOL; i++) {
      const laser = new THREE.Group();
      const core = new THREE.Mesh(geo, mat);
      laser.add(core);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), glowMat);
      laser.add(glow);
      laser.visible = false;
      this.group.add(laser);
      this.pool.push({
        mesh: laser,
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        travelled: 0,
        dir: new THREE.Vector3(),
      });
    }
  }

  /** Fire a laser from ship position along heading. */
  fire(position, heading) {
    if (this._cooldown > 0) return;
    this._cooldown = 1 / Constants.FIRE_RATE;
    const laser = this.pool.find((l) => !l.active);
    if (!laser) return;
    laser.active = true;
    laser.mesh.visible = true;
    laser.pos.copy(position);
    laser.dir.set(0, 0, -1).applyQuaternion(heading);
    laser.vel.copy(laser.dir).multiplyScalar(Constants.PROJECTILE_SPEED);
    laser.life = Constants.PROJECTILE_LIFETIME;
    laser.travelled = 0;
    laser.mesh.position.copy(position);
    laser.mesh.quaternion.copy(heading);
    this.events.emit('weapon:fired', { position: position.clone(), direction: laser.dir.clone() });
  }

  update(dt) {
    this._cooldown = Math.max(0, this._cooldown - dt);
    for (const l of this.pool) {
      if (!l.active) continue;
      l.life -= dt;
      l.travelled += Constants.PROJECTILE_SPEED * dt;
      if (l.life <= 0 || l.travelled >= Constants.PROJECTILE_RANGE) {
        this._despawn(l);
        continue;
      }
      l.pos.addScaledVector(l.vel, dt);
      l.mesh.position.copy(l.pos);

      // Collision vs world bodies (asteroid/debris/comet)
      const hit = this.physics.querySphere(l.pos, 1.0);
      if (hit.length > 0) {
        const target = hit[0];
        this._onHit(l, target);
      }
    }
  }

  _onHit(laser, collider) {
    const body = collider;
    this.events.emit('weapon:hit', { target: body.type, position: laser.pos.clone() });
    this._despawn(laser);
    if (body.hp !== undefined && body.owner) {
      body.hp -= Constants.PROJECTILE_DAMAGE;
      if (body.hp <= 0) {
        body.owner.remove(body);
        this.events.emit('weapon:targetDestroyed', { type: body.type, position: laser.pos.clone() });
      }
    }
  }

  _despawn(laser) {
    laser.active = false;
    laser.mesh.visible = false;
    this.events.emit('weapon:despawned');
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

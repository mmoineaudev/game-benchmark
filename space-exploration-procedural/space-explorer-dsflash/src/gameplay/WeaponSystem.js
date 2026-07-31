import * as THREE from 'three';
import { Constants } from '../core/Constants.js';
import { softDotTexture } from '../utils/ShaderHelpers.js';

// Laser projectiles: large green beams (spec §6.2).
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
    this._firing = false;
    this._childCount = 0;
    this._buildPool();
  }

  _buildPool() {
    const C = Constants;
    const coreGeo = new THREE.CylinderGeometry(C.LASER_RADIUS, C.LASER_RADIUS, C.LASER_LENGTH, 8);
    coreGeo.rotateX(Math.PI / 2); // length along Z
    const glowGeo = new THREE.CylinderGeometry(C.LASER_GLOW_RADIUS, C.LASER_GLOW_RADIUS, C.LASER_LENGTH, 10);
    glowGeo.rotateX(Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: C.LASER_COLOR,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: C.LASER_GLOW_COLOR,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tipMat = new THREE.SpriteMaterial({
      map: softDotTexture(),
      color: 0x88ffaa,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < C.LASER_POOL; i++) {
      const laser = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, coreMat);
      laser.add(core);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      laser.add(glow);
      const tip = new THREE.Sprite(tipMat);
      tip.position.set(0, 0, -C.LASER_LENGTH / 2);
      tip.scale.setScalar(C.LASER_GLOW_RADIUS * 6);
      laser.add(tip);
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
        isChild: false,
      });
    }
  }

  /** Hold-to-fire state: spawns a quad-beam volley every FIRE_RATE while on. */
  setFiring(on) {
    this._firing = on;
  }

  /**
   * Fire a volley from all 4 muzzles (2 cockpit cannons + 1 per wing end)
   * along the ship heading, rate-limited by FIRE_RATE. Emits ONE 'weapon:fired'
   * per volley (sound/flash feedback), not per beam.
   */
  fireVolley(shipPos, heading) {
    if (this._cooldown > 0) return;
    this._cooldown = 1 / Constants.FIRE_RATE;
    let first = true;
    for (const m of Constants.WEAPON_MUZZLES) {
      const off = new THREE.Vector3(m.x, m.y, m.z).applyQuaternion(heading);
      const pos = shipPos.clone().add(off);
      this._spawnBeam(pos, heading, false);
      if (first) {
        this.events.emit('weapon:fired', { position: pos.clone(), direction: new THREE.Vector3(0, 0, -1).applyQuaternion(heading) });
        first = false;
      }
    }
  }

  /** Single-shot fire (legacy edge path / touch tap). */
  fire(position, heading) {
    if (this._cooldown > 0) return;
    this._cooldown = 1 / Constants.FIRE_RATE;
    this._spawnBeam(position, heading, false);
    this.events.emit('weapon:fired', { position: position.clone(), direction: new THREE.Vector3(0, 0, -1).applyQuaternion(heading) });
  }

  /** Raw beam spawn (no cooldown) — also used for beam-split children (v2.0 §3.4.1). */
  _spawnBeam(position, heading, isChild) {
    const laser = this.pool.find((l) => !l.active);
    if (!laser) return;
    laser.active = true;
    laser.isChild = isChild;
    laser.mesh.visible = true;
    laser.pos.copy(position);
    laser.dir.set(0, 0, -1).applyQuaternion(heading);
    laser.vel.copy(laser.dir).multiplyScalar(Constants.PROJECTILE_SPEED);
    laser.life = Constants.PROJECTILE_LIFETIME;
    laser.travelled = 0;
    laser.mesh.position.copy(position);
    laser.mesh.quaternion.copy(heading);
    if (isChild) this._childCount++;
  }

  update(dt, shipPos, shipHeading) {
    this._cooldown = Math.max(0, this._cooldown - dt);
    if (this._firing && shipPos && shipHeading) this.fireVolley(shipPos, shipHeading);
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

      // Collision vs world bodies (asteroid/debris/comet) — large beam, generous radius
      const hit = this.physics.querySphere(l.pos, Constants.LASER_HIT_RADIUS);
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
        // Beam-split: a green beam through a crystal spawns 2 child beams (v2.0 §3.4.1)
        if (body.type === 'crystal' && !laser.isChild && this._childCount < Constants.CRYSTAL.childBeamMax) {
          this._splitBeam(laser, body);
        }
      }
    }
  }

  /** Spawn 2 child beams at ±splitAngle yaw from the impact direction. */
  _splitBeam(laser, crystal) {
    const angle = Constants.CRYSTAL.splitAngle;
    const axis = new THREE.Vector3(0, 1, 0);
    for (const sign of [-1, 1]) {
      const q = new THREE.Quaternion().setFromAxisAngle(axis, angle * sign);
      const childHeading = q.multiply(laser.mesh.quaternion.clone());
      this._spawnBeam(laser.pos.clone(), childHeading, true);
    }
  }

  _despawn(laser) {
    laser.active = false;
    laser.mesh.visible = false;
    if (laser.isChild) this._childCount = Math.max(0, this._childCount - 1);
    laser.isChild = false;
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

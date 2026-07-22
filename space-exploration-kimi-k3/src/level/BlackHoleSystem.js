// VOID DRIFT — BlackHoleSystem.js
// Supermassive black holes: visible from far, visually absorb light,
// and exert gravitational pull on the ship and nearby asteroids.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

const EVENT_HOLE_CREATED = 'blackhole:created';
const EVENT_HOLE_INTENSITY = 'blackhole:intensity';

export class BlackHoleSystem {
  constructor(scene) {
    this._scene = scene;
    this._holes = [];
    this._maxCount = Constants.BLACK_HOLE.MAX_ACTIVE;
    this._cooldown = 0;
    this._frame = 0;

    this._dir = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._grav = new THREE.Vector3();
    this._shipDir = new THREE.Vector3();
    this._lastHoleSpawnDir = null;
  }

  init() {
    // placeholder so Game can treat systems uniformly
  }

  _createBlackHole(position) {
    const group = new THREE.Group();
    group.position.copy(position);
    const eventHorizon = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    eventHorizon.renderOrder = 999;
    eventHorizon.material.depthTest = true;
    eventHorizon.material.depthWrite = true;

    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x0a0020,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    inner.renderOrder = 998;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.4, 0.18, 16, 96),
      new THREE.MeshBasicMaterial({
        color: 0xff7733,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.renderOrder = 997;

    const ring2 = new THREE.Mesh(
      new THREE.TorusGeometry(3.6, 0.12, 12, 120),
      new THREE.MeshBasicMaterial({
        color: 0x33aaff,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring2.renderOrder = 996;

    group.add(eventHorizon);
    group.add(inner);
    group.add(ring);
    group.add(ring2);

    // Larger accretion disk so the black hole is visually readable at long range.
    const diskGeo = new THREE.TorusGeometry(3.8, 0.22, 16, 120);
    const diskMat = new THREE.MeshBasicMaterial({
      color: 0x772200,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const disk = new THREE.Mesh(diskGeo, diskMat);
    disk.renderOrder = 995;
    group.add(disk);

    // Bright inner rim to mark the edge of the event horizon.
    const rimGeo = new THREE.TorusGeometry(1.25, 0.06, 16, 80);
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0xff7314,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.renderOrder = 1000;
    group.add(rim);

    const scaleBase = 9 + Math.random() * 8;
    group.scale.setScalar(scaleBase);
    const hole = {
      group,
      eventHorizon,
      inner,
      rim,
      ring,
      ring2,
      disk,
      scaleBase,
      age: 0,
      lifetime: 12 + Math.random() * 18,
      spawned: false,
      spawnDistance: 2500 + Math.random() * 9000,
      activeRadius: 300 + Math.random() * 700,
      direction: new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize(),
      phaseOffset: Math.random() * Math.PI * 2,
    };

    this._holes.push(hole);
    this._scene.add(group);
    return hole;
  }

  _remove(hole) {
    this._scene.remove(hole.group);
    hole.eventHorizon.geometry.dispose();
    hole.eventHorizon.material.dispose();
    hole.inner.geometry.dispose();
    hole.inner.material.dispose();
    hole.ring.geometry.dispose();
    hole.ring.material.dispose();
    hole.ring2.geometry.dispose();
    hole.ring2.material.dispose();
    const idx = this._holes.indexOf(hole);
    if (idx !== -1) this._holes.splice(idx, 1);
  }

  _trySpawn(shipPos, time) {
    if (this._holes.length >= this._maxCount) return;
    if (this._cooldown > 0) {
      this._cooldown--;
      return;
    }

    const baseDir = new THREE.Vector3(
      Math.sin(time * 0.17 + this._frame),
      Math.cos(time * 0.13 + this._frame),
      Math.sin(time * 0.11 + this._frame * 0.5)
    ).normalize();
    const dir = this._lastHoleSpawnDir
      ? baseDir.clone().multiplyScalar(-1)
      : baseDir;
    const dist = Constants.BLACK_HOLE.SPAWN_MIN + Math.random() * (Constants.BLACK_HOLE.SPAWN_MAX - Constants.BLACK_HOLE.SPAWN_MIN);
    const pos = shipPos.clone().addScaledVector(dir, dist);
    this._lastHoleSpawnDir = pos.clone().sub(shipPos).normalize();
    this._createBlackHole(pos);
    this._cooldown = 300 + Math.floor(Math.random() * 500);
  }

  update(shipPos, time, dt) {
    this._frame++;

    if (this._holes.length < this._maxCount && this._frame % 90 === 0) {
      this._trySpawn(shipPos, time);
    }

    for (let i = this._holes.length - 1; i >= 0; i--) {
      const hole = this._holes[i];
      hole.age += dt;

      if (hole.age > hole.lifetime) {
        this._remove(hole);
        continue;
      }

      const fadeIn = Math.min(hole.age / 1.5, 1);
      const fadeOut = Math.min((hole.lifetime - hole.age) / 2.5, 1);
      let intensity = fadeIn * fadeOut;
      if (intensity <= 0) {
        this._remove(hole);
        continue;
      }

      const dx = shipPos.x - hole.group.position.x;
      const dy = shipPos.y - hole.group.position.y;
      const dz = shipPos.z - hole.group.position.z;
      const distToShipSq = dx * dx + dy * dy + dz * dz;
      const distToShip = Math.sqrt(distToShipSq);
      const viewDist = 18000;
      const viewDistSq = viewDist * viewDist;

      const visible = distToShipSq <= viewDistSq;
      hole.group.visible = visible;
      if (!visible) continue;

      const pulse = 1 + Math.sin(time * 1.1 + hole.phaseOffset) * 0.25;
      const scale = hole.scaleBase + 0.15 * (1 - distToShip / viewDist);
      hole.group.scale.setScalar(scale * pulse);
      hole.group.lookAt(shipPos);

      hole.inner.material.opacity = 0.78 * intensity * (0.7 + 0.3 * pulse);
      hole.ring.material.opacity = 0.85 * intensity * (0.8 + 0.2 * Math.sin(time * 0.7 + hole.phaseOffset));
      hole.ring2.material.opacity = 0.55 * intensity * (0.85 + 0.15 * Math.cos(time * 0.5 - hole.phaseOffset));

      if (distToShip < hole.activeRadius && hole.spawned) {
        const force = (1 - distToShip / hole.activeRadius) * Constants.BLACK_HOLE.PULL * intensity * dt;
        this._grav.copy(hole.group.position).sub(shipPos).normalize();
        this._shipDir.copy(shipPos).sub(hole.group.position);
        if (this._shipDir.lengthSq() > 0.1) {
          this._shipDir.normalize();
          hole.group.lookAt(hole.group.position.clone().add(this._shipDir));
        }

        if (shipPos.userData && shipPos.userData.velocity) {
          this._tmp.copy(this._grav).multiplyScalar(force);
          shipPos.userData.velocity.add(this._tmp);
        } else if (shipPos.isVector3) {
          shipPos.addScaledVector(this._grav, force);
        }
      }
      if (distToShip < hole.spawnDistance * 0.5) {
        hole.spawned = true;
      }
    }
  }

  /** Expose force for arbitrary world objects (asteroids). */
  applyGravityToWorld(position, radius, dt, out) {
    const target = out || new THREE.Vector3();
    target.set(0, 0, 0);
    const pos = position instanceof THREE.Vector3 ? position : new THREE.Vector3(position.x, position.y, position.z);
    for (const hole of this._holes) {
      if (!hole.spawned) continue;
      const dx = hole.group.position.x - pos.x;
      const dy = hole.group.position.y - pos.y;
      const dz = hole.group.position.z - pos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq) + 0.0001;
      if (dist > hole.activeRadius) continue;
      const strength = (1 - dist / hole.activeRadius) * Constants.BLACK_HOLE.PULL * dt;
      target.x += (dx / dist) * strength;
      target.y += (dy / dist) * strength;
      target.z += (dz / dist) * strength;
    }
    return target;
  }

  /** Return active hole positions for light-absorption or shader influence. */
  getActiveHoles() {
    return this._holes.filter(h => h.spawned).map(h => ({ position: h.group.position, intensity: Math.min((h.lifetime - h.age) / 2.5, 1) }));
  }

  clearAll() {
    for (const hole of this._holes.slice()) this._remove(hole);
    this._lastHoleSpawnDir = null;
  }

  destroy() {
    this.clearAll();
  }
}

import * as THREE from 'three';
import { VEHICLE } from '../core/Constants.js';
import { bus } from '../core/EventBus.js';
import { EVENTS } from '../core/Constants.js';

// Player vehicle as a composite THREE.Group
export class Vehicle {
  constructor() {
    this.group = new THREE.Group();
    this._digTime = 0;
    this._isDigging = false;
    this._bobPhase = 0;
    this._targetPos = new THREE.Vector3(10, 0.5, 10);
    this.group.position.copy(this._targetPos);

    this._buildModel();
    this._buildHeadlight();

    // Track tile-position for grid-locked movement
    this._tileX = 10;
    this._tileY = 0;
    this._tileZ = 10;
    this._moveProgress = 1; // 1 = arrived
  }

  _buildModel() {
    const bodyGeo = new THREE.BoxGeometry(0.7, 0.25, 0.9);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.7, metalness: 0.3 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.name = '_body';
    body.position.y = 0.15;
    this.group.add(body);

    // Cockpit
    const cockpitGeo = new THREE.SphereGeometry(0.3, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const cockpitMat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.2, metalness: 0.1 });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.35, -0.1);
    cockpit.scale.set(0.8, 0.4, 0.6);
    this.group.add(cockpit);

    // Drill
    const drillGeo = new THREE.ConeGeometry(0.15, 0.4, 6);
    const drillMat = new THREE.MeshStandardMaterial({ color: 0xcc8844, roughness: 0.9, metalness: 0.5 });
    const drill = new THREE.Mesh(drillGeo, drillMat);
    drill.name = '_drill';
    drill.position.set(0, -0.1, 0.55);
    drill.rotation.x = Math.PI / 2;
    this.group.add(drill);

    // 4 wheels (small spheres)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.9 });
    const wheelPositions = [
      [-0.35, 0, -0.3], [0.35, 0, -0.3],
      [-0.35, 0, 0.3], [0.35, 0, 0.3],
    ];
    for (const wp of wheelPositions) {
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), wheelMat);
      wheel.position.set(wp[0], wp[1], wp[2]);
      this.group.add(wheel);
    }

    // Headlight visual (small cone at front)
    const lightGeo = new THREE.ConeGeometry(0.08, 0.15, 6);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
    const hl = new THREE.Mesh(lightGeo, lightMat);
    hl.name = '_headlight';
    hl.position.set(0, 0.2, 0.5);
    hl.rotation.x = Math.PI / 2;
    this.group.add(hl);
  }

  _buildHeadlight() {
    this.headlight = new THREE.SpotLight(0xffeedd, 1.5, VEHICLE.HEADLIGHT_RANGE, Math.PI / 6, 0.5, 1);
    this.headlight.position.set(0, 0.3, 0.6);
    this.headlight.target.position.set(0, -1, 2);
    this.group.add(this.headlight);
    this.group.add(this.headlight.target);

    // Small ambient point light around the vehicle
    this.ambientGlow = new THREE.PointLight(0x88aaff, 0.3, 4);
    this.ambientGlow.position.set(0, 0.5, 0);
    this.group.add(this.ambientGlow);
  }

  setTilePosition(x, y, z) {
    this._tileX = x;
    this._tileY = y;
    this._tileZ = z;
    this._targetPos.set(x + 0.5, y + 0.5, z + 0.5);
    this._moveProgress = 0;
  }

  snapTo(x, y, z) {
    this._tileX = x;
    this._tileY = y;
    this._tileZ = z;
    this._targetPos.set(x + 0.5, y + 0.5, z + 0.5);
    this.group.position.copy(this._targetPos);
    this._moveProgress = 1;
  }

  getTilePos() {
    return { x: this._tileX, y: this._tileY, z: this._tileZ };
  }

  getWorldPos() {
    return this.group.position.clone();
  }

  startDig() {
    this._isDigging = true;
    this._digTime = 0;
  }

  stopDig() {
    this._isDigging = false;
    this._digTime = 0;
  }

  update(dt) {
    // Smooth movement toward target
    if (this._moveProgress < 1) {
      this._moveProgress = Math.min(1, this._moveProgress + VEHICLE.MOVE_SPEED * dt);
      const t = this._easeOutCubic(this._moveProgress);
      this.group.position.lerp(this._targetPos, t);
      // Snap at the end to avoid floating point drift
      if (this._moveProgress >= 1) {
        this.group.position.copy(this._targetPos);
      }
    }

    // Drill rotation when digging
    if (this._isDigging) {
      this._digTime += dt;
      const drill = this.group.getObjectByName('_drill');
      if (drill) drill.rotation.z += dt * 20;
    }

    // Idle bob
    this._bobPhase += dt * 1.5;
    const bob = Math.sin(this._bobPhase) * 0.02;
    const body = this.group.getObjectByName('_body');
    if (body && !this._isDigging) {
      body.position.y = 0.15 + bob;
    }
  }

  _easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
}

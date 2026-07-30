// =============================================================================
// Vehicle — player entity with grid-based movement, dig, climb, smooth lerp.
// =============================================================================

import * as THREE from 'three';
import { VEHICLE, COLORS } from '../core/Constants.js';
import { getGameState } from '../core/GameState.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { Logger } from '../core/Logger.js';

export class Vehicle {
  constructor(scene) {
    this._scene = scene;
    this._state = getGameState();
    this._bus = getEventBus();
    this.group = new THREE.Group();

    this._targetPos = new THREE.Vector3();
    this._moveProgress = 1; // 1 = arrived
    this._moveFrom = new THREE.Vector3();
    this._digTimer = 0;

    this._buildModel();
    this._scene.add(this.group);
    Logger.info('Vehicle', 'created');
  }

  _buildModel() {
    // Large drilling vehicle (2x), base sits at y=0.

    // Treads (side cylinders)
    const treadGeom = new THREE.CylinderGeometry(0.22, 0.22, 1.4, 8);
    const treadMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (const sx of [-0.55, 0.55]) {
      const tread = new THREE.Mesh(treadGeom, treadMat);
      tread.rotation.z = Math.PI / 2;
      tread.position.set(sx, 0.25, 0);
      this.group.add(tread);
    }

    // Chassis body
    const bodyGeom = new THREE.BoxGeometry(1.3, 0.6, 1.6);
    const bodyMat = new THREE.MeshLambertMaterial({ color: COLORS.PLAYER, emissive: 0x443300, emissiveIntensity: 0.5 });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.6;
    this.group.add(body);

    // Cockpit canopy
    const canopyGeom = new THREE.BoxGeometry(0.5, 0.25, 0.7);
    const canopyMat = new THREE.MeshLambertMaterial({ color: 0x88ccff, emissive: 0x224466, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 });
    const canopy = new THREE.Mesh(canopyGeom, canopyMat);
    canopy.position.set(0, 0.95, -0.05);
    this.group.add(canopy);

    // Drill bit
    const drillGeom = new THREE.CylinderGeometry(0.1, 0.3, 0.7, 8);
    const drillMat = new THREE.MeshLambertMaterial({ color: 0xcccccc, emissive: 0x222222, emissiveIntensity: 0.2 });
    const drill = new THREE.Mesh(drillGeom, drillMat);
    drill.position.y = -0.2;
    this.group.add(drill);

    // Headlights
    const lightGeom = new THREE.BoxGeometry(0.18, 0.14, 0.1);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
    for (const lx of [-0.35, 0.35]) {
      const light = new THREE.Mesh(lightGeom, lightMat);
      light.position.set(lx, 0.6, -0.85);
      this.group.add(light);
    }

    // Top beacon — large bright red sphere
    const beaconGeom = new THREE.SphereGeometry(0.18, 8, 4);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
    const beacon = new THREE.Mesh(beaconGeom, beaconMat);
    beacon.position.set(0, 1.15, 0);
    this.group.add(beacon);
    this._beacon = beacon;
  }

  /** Set initial grid position. */
  setGridPosition(x, y, z) {
    this._state.tileX = x;
    this._state.tileY = y;
    this._state.tileZ = z;
    const wp = this._gridToWorld(x, y, z);
    this.group.position.copy(wp);
    this._targetPos.copy(wp);
    this._moveProgress = 1;
  }

  /** Get world position from grid coords (vehicle sits ON TOP of tile). */
  _gridToWorld(x, y, z) {
    return new THREE.Vector3(x + 0.5, -y, z + 0.5);
  }

  get worldPos() {
    return this.group.position;
  }

  /** Move one tile in direction (dx, 0, dz). Returns true if movement initiated. */
  moveBy(dx, dz) {
    if (this._moveProgress < 1 || this._state.isDigging || this._state.isClimbing) return false;
    const nx = this._state.tileX + Math.round(dx);
    const nz = this._state.tileZ + Math.round(dz);
    const ny = this._state.tileY;

    this._moveFrom.copy(this._gridToWorld(this._state.tileX, this._state.tileY, this._state.tileZ));
    this._state.tileX = nx;
    this._state.tileZ = nz;
    this._targetPos.copy(this._gridToWorld(nx, ny, nz));
    this._moveProgress = 0;
    this._state.isMoving = true;

    Logger.debug('Vehicle', `move to grid (${nx},${ny},${nz})`);
    this._bus.emit(Events.PLAYER_MOVED, { x: nx, y: ny, z: nz });
    return true;
  }

  /** Move down one tile (fall or descent). */
  moveDown() {
    const ny = this._state.tileY + 1;
    this._moveFrom.copy(this._gridToWorld(this._state.tileX, this._state.tileY, this._state.tileZ));
    this._state.tileY = ny;
    this._targetPos.copy(this._gridToWorld(this._state.tileX, ny, this._state.tileZ));
    this._moveProgress = 0;
    this._state.isMoving = true;

    Logger.debug('Vehicle', `move down to (${this._state.tileX},${ny},${this._state.tileZ})`);
    this._bus.emit(Events.PLAYER_MOVED, { x: this._state.tileX, y: ny, z: this._state.tileZ });
  }

  /** Climb up one tile. */
  climbUp(dx, dz) {
    const nx = this._state.tileX + Math.round(dx);
    const ny = this._state.tileY - 1;
    const nz = this._state.tileZ + Math.round(dz);
    this._moveFrom.copy(this._gridToWorld(this._state.tileX, this._state.tileY, this._state.tileZ));
    this._state.tileX = nx;
    this._state.tileY = ny;
    this._state.tileZ = nz;
    this._targetPos.copy(this._gridToWorld(nx, ny, nz));
    this._moveProgress = 0;
    this._state.isClimbing = true;
    this._state.isMoving = true;
  }

  update(dt) {
    // Lerp movement
    if (this._moveProgress < 1) {
      this._moveProgress = Math.min(1, this._moveProgress + VEHICLE.MOVE_SPEED * dt);
      const t = 1 - Math.pow(1 - this._moveProgress, 3); // ease-out cubic
      this.group.position.lerpVectors(this._moveFrom, this._targetPos, t);
      if (this._moveProgress >= 1) {
        this.group.position.copy(this._targetPos);
        this._state.isMoving = false;
        this._state.isClimbing = false;
      }
    }
  }

  /** Whether vehicle is currently animating between tiles. */
  get isMoving() { return this._moveProgress < 1; }

  dispose() {
    this._scene.remove(this.group);
    // Dispose geometries and materials
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    Logger.info('Vehicle', 'disposed');
  }
}

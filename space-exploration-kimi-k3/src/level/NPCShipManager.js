// VOID DRIFT — NPCShipManager.js
// Rare wandering geometric NPC ships with a shared trail Points pool.
// Deterministic per-cell spawn, per-ship wander seed. Hittable (15 pts).

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { mulberry32, hashKey, randomUnitVector } from '../utils/MathHelpers.js';

const NPC_COLORS = [0x8899ff, 0xffaa77, 0x77ffcc, 0xdd88ff, 0xffee88];

export class NPCShipManager {
  constructor(scene) {
    this._scene = scene;
    this._npcs = new Map();    // key -> { mesh, velocity, ... }
    this._trailCapacity = Constants.NPC.TRAIL_POOL * Constants.NPC.MAX_COUNT;
    this._trailPositions = null;
    this._trailLife = null;
    this._trailPoints = null;
    this._trailCursor = 0;
    this._tmpVec = new THREE.Vector3();
  }

  init() {
    this._trailPositions = new Float32Array(this._trailCapacity * 3);
    this._trailLife = new Float32Array(this._trailCapacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x66aaff, size: 0.6, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this._trailPoints = new THREE.Points(geo, mat);
    this._trailPoints.frustumCulled = false;
    this._scene.add(this._trailPoints);
    for (let i = 0; i < this._trailCapacity; i++) this._trailPositions[i * 3 + 1] = -99999;
  }

  _buildShipMesh(rng) {
    const type = Math.floor(rng() * 4);
    let geo;
    switch (type) {
      case 0: geo = new THREE.ConeGeometry(0.9, 2.4, 6); geo.rotateX(-Math.PI / 2); break;
      case 1: geo = new THREE.BoxGeometry(1.2, 0.8, 2.6); break;
      case 2: geo = new THREE.DodecahedronGeometry(1.0, 0); break;
      default: geo = new THREE.CylinderGeometry(0.5, 0.7, 2.4, 8); geo.rotateX(Math.PI / 2); break;
    }
    const color = NPC_COLORS[Math.floor(rng() * NPC_COLORS.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222833, metalness: 0.7, roughness: 0.4,
      emissive: color, emissiveIntensity: 0.8,
    });
    return new THREE.Mesh(geo, mat);
  }

  _spawnNPC(gx, gy, gz, key) {
    if (this._npcs.size >= Constants.NPC.MAX_COUNT) return;
    const rng = mulberry32(hashKey(key) * 1e9 + 7);
    const grid = Constants.NPC.GRID_SIZE;
    const mesh = this._buildShipMesh(rng);
    mesh.position.set(
      gx * grid + (rng() - 0.5) * grid * 0.6,
      gy * grid + (rng() - 0.5) * grid * 0.6,
      gz * grid + (rng() - 0.5) * grid * 0.6);
    const velocity = randomUnitVector(rng).multiplyScalar(Constants.NPC.SPEED * (0.6 + rng() * 0.5));
    mesh.userData = {
      isChunkObject: true, isNPC: true,
      radius: Constants.NPC.COLLISION_RADIUS,
      size: Constants.NPC.COLLISION_RADIUS,
      velocity,
      wanderRng: mulberry32(hashKey(key) * 1e9 + 999),
      wanderAccum: rng() * 2,
      rotSpeedY: (rng() - 0.5) * 0.5,
      rotSpeedX: (rng() - 0.5) * 0.25,
      trailAccum: 0,
    };
    this._scene.add(mesh);
    this._npcs.set(key, { mesh });
  }

  killNPC(mesh) {
    for (const [key, npc] of this._npcs) {
      if (npc.mesh === mesh) {
        this._scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this._npcs.delete(key);
        return;
      }
    }
  }

  _emitTrail(pos) {
    const i = this._trailCursor;
    this._trailCursor = (this._trailCursor + 1) % this._trailCapacity;
    this._trailPositions[i * 3] = pos.x;
    this._trailPositions[i * 3 + 1] = pos.y;
    this._trailPositions[i * 3 + 2] = pos.z;
    this._trailLife[i] = 1;
  }

  update(shipPos, dt) {
    const grid = Constants.NPC.GRID_SIZE;
    const view = Constants.NPC.VIEW_DISTANCE;
    const cgx = Math.round(shipPos.x / grid);
    const cgy = Math.round(shipPos.y / grid);
    const cgz = Math.round(shipPos.z / grid);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `n${cgx + dx},${cgy + dy},${cgz + dz}`;
          if (!this._npcs.has(key) && hashKey(key) < Constants.NPC.SPAWN_CHANCE) {
            this._spawnNPC(cgx + dx, cgy + dy, cgz + dz, key);
          }
        }
      }
    }

    for (const [key, npc] of this._npcs) {
      const mesh = npc.mesh;
      const ud = mesh.userData;
      // Wander: periodically pick a new wish direction.
      ud.wanderAccum -= dt;
      if (ud.wanderAccum <= 0) {
        ud.wanderAccum = 0.8 + ud.wanderRng() * 1.5;
        randomUnitVector(ud.wanderRng, this._tmpVec).multiplyScalar(Constants.NPC.SPEED * (0.6 + ud.wanderRng() * 0.5));
        ud.velocity.lerp(this._tmpVec, 0.7);
      }
      mesh.position.addScaledVector(ud.velocity, dt);
      mesh.rotation.y += ud.rotSpeedY * dt;
      mesh.rotation.x += ud.rotSpeedX * dt;
      // Face velocity roughly.
      this._tmpVec.copy(mesh.position).add(ud.velocity);
      mesh.lookAt(this._tmpVec);

      // Trail emission (time-based cadence).
      ud.trailAccum += dt;
      if (ud.trailAccum > Constants.NPC.TRAIL_CADENCE) {
        ud.trailAccum = 0;
        this._emitTrail(mesh.position);
      }

      // Prune by distance.
      if (mesh.position.distanceTo(shipPos) > view) {
        this._scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        this._npcs.delete(key);
      }
    }

    // Trail decay.
    if (this._trailPoints) {
      const decay = Math.pow(1 - Constants.NPC.TRAIL_DECAY, dt);
      for (let i = 0; i < this._trailCapacity; i++) {
        if (this._trailLife[i] > 0) {
          this._trailLife[i] *= decay;
          if (this._trailLife[i] < 0.02) {
            this._trailLife[i] = 0;
            this._trailPositions[i * 3 + 1] = -99999;
          }
        }
      }
      this._trailPoints.geometry.attributes.position.needsUpdate = true;
    }
  }

  /** Expose NPC meshes as collidables. */
  getCollidables() {
    const list = [];
    for (const [, npc] of this._npcs) list.push(npc.mesh);
    return list;
  }

  clearAll() {
    for (const [, npc] of this._npcs) {
      this._scene.remove(npc.mesh);
      npc.mesh.geometry.dispose();
      npc.mesh.material.dispose();
    }
    this._npcs.clear();
    if (this._trailPositions) {
      for (let i = 0; i < this._trailCapacity; i++) {
        this._trailLife[i] = 0;
        this._trailPositions[i * 3 + 1] = -99999;
      }
      if (this._trailPoints) this._trailPoints.geometry.attributes.position.needsUpdate = true;
    }
  }

  destroy() {
    this.clearAll();
    if (this._trailPoints) {
      this._scene.remove(this._trailPoints);
      this._trailPoints.geometry.dispose();
      this._trailPoints.material.dispose();
      this._trailPoints = null;
    }
  }
}

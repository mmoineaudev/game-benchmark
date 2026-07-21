// ============================================================
// NPCShipManager — rare wandering ships with trails
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { mulberry32, chunkSeed } from '../utils/MathHelpers.js';

const COLORS = [0x00ff88, 0xff8833, 0x33aaff, 0xff33aa, 0xffff33, 0xff2222];
const TYPES = [
  (mat,col,rng)=> new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 6), mat),
  (mat,col,rng)=> new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 1.6), mat),
  (mat,col,rng)=> new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), mat),
  (mat,col,rng)=> {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 1.7, 8), mat);
    m.rotation.x = Math.PI / 2;
    return m;
  },
];

class NPCShipManager {
  constructor(scene) {
    this.scene = scene;
    this._ships = new Map();
    this._maxShips = 12;
    this._spacing = 2400;
    this._viewDistance = 11250;
    this._trails = new Map();
    this._trailPositions = [];
    this._trailGeo = null;
    this._trailMat = null;
    this._buildTrailPool(256);
  }

  _buildTrailPool(capacity) {
    this._trailPositions = new Float32Array(capacity * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: 0.22,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this._trailPoints = new THREE.Points(geo, mat);
    this._trailPoints.visible = false;
    this.scene.add(this._trailPoints);

    this._trailIndex = 0;
    this._trailCapacity = capacity;
    this._trailLifes = new Float32Array(capacity).fill(0);
  }

  _spawnTrailAt(position, velocity) {
    const i = this._trailIndex;
    this._trailPositions[i * 3] = position.x;
    this._trailPositions[i * 3 + 1] = position.y;
    this._trailPositions[i * 3 + 2] = position.z;
    this._trailLifes[i] = 1.0;
    this._trailIndex = (this._trailIndex + 1) % this._trailCapacity;
    this._trailPoints.geometry.attributes.position.needsUpdate = true;
    this._trailPoints.geometry.setDrawRange(0, this._trailCapacity);
    this._trailPoints.visible = true;
  }

  update(shipPos, dt) {
    const gx = Math.round(shipPos.x / this._spacing);
    const gy = Math.round(shipPos.y / this._spacing);
    const gz = Math.round(shipPos.z / this._spacing);
    const needed = new Set();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${gx+dx},${gy+dy},${gz+dz}`;
          needed.add(key);
          if (!this._ships.has(key) && this._ships.size < this._maxShips) this._spawnNPC(gx+dx, gy+dy, gz+dz, key);
        }
      }
    }
    for (const [key, npc] of this._ships) {
      if (!needed.has(key) || npc.position.distanceToSquared(shipPos) > this._viewDistance * this._viewDistance) {
        this._removeNPC(key);
      } else {
        this._moveNPC(npc, dt, shipPos);
      }
    }
    this._decayTrails(dt);
  }

  _wander(currentVelocity, dt, rng) {
    const wanderStrength = 8;
    const wanderRate = 0.6;
    const angle = rng() * Math.PI * 2;
    const lift = (rng() - 0.5) * 0.55;
    const wish = new THREE.Vector3(
      Math.cos(angle) * wanderStrength,
      lift * 6,
      Math.sin(angle) * wanderStrength
    );
    currentVelocity.lerp(wish, Math.min(dt * wanderRate, 0.5)).normalize().multiplyScalar(10);
    return currentVelocity;
  }

  _spawnNPC(gx, gy, gz, key) {
    const seed = chunkSeed(gx * 1013, gy * 1009, gz * 997);
    const rng = mulberry32(seed);
    const x = gx * this._spacing + (rng() - 0.5) * this._spacing * 0.6;
    const y = gy * this._spacing + (rng() - 0.5) * this._spacing * 0.6;
    const z = gz * this._spacing + (rng() - 0.5) * this._spacing * 0.6;

    const heading = rng() * Math.PI * 2;
    const climb = (rng() - 0.5) * 0.25;
    const velocity = new THREE.Vector3(Math.cos(climb) * Math.sin(heading) * 10, Math.sin(climb) * 10, Math.cos(climb) * Math.cos(heading) * 10);
    this._wander(velocity, 1, rng);

    const typeIndex = Math.floor(rng() * TYPES.length);
    const color = COLORS[Math.floor(rng() * COLORS.length)];
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.5, metalness: 0.4 });
    const mesh = TYPES[typeIndex](mat, color, rng);
    mesh.position.set(x, y, z);
    mesh.userData = {
      velocity,
      rotSpeedY: (rng() - 0.5) * 0.5,
      rotSpeedX: (rng() - 0.5) * 0.25,
      type: typeIndex,
      trailAccum: 0,
      isChunkObject: true,
      isNPC: true,
      wanderRng: mulberry32(seed + 999),
      wanderAccum: Math.random() * 2,
    };
    this.scene.add(mesh);
    this._ships.set(key, mesh);
  }

  _moveNPC(npc, dt, towardShip) {
    const ud = npc.userData;
    ud.wanderAccum -= dt;
    if (ud.wanderAccum <= 0) {
      ud.wanderAccum = 0.8 + Math.random() * 1.5;
      this._wander(ud.velocity, 1, ud.wanderRng);
    }
    npc.position.addScaledVector(ud.velocity, dt);
    npc.rotation.y += ud.rotSpeedY * dt;
    npc.rotation.x += ud.rotSpeedX * dt;

    ud.trailAccum += dt;
    if (ud.trailAccum > 0.05) {
      ud.trailAccum = 0;
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(npc.quaternion);
      const pos = npc.position.clone().addScaledVector(back, -1.2);
      this._spawnTrailAt(pos, ud.velocity);
    }
  }

  _decayTrails(dt) {
    for (let i = 0; i < this._trailCapacity; i++) {
      if (this._trailLifes[i] <= 0) {
        this._trailPositions[i * 3 + 1] = -99999;
        continue;
      }
      this._trailLifes[i] -= dt * 0.9;
      if (this._trailLifes[i] < 0) this._trailLifes[i] = 0;
    }
    this._trailPoints.geometry.attributes.position.needsUpdate = true;
  }

  _removeNPC(key) {
    const npc = this._ships.get(key);
    if (!npc) return;
    if (npc.geometry) npc.geometry.dispose();
    if (npc.material) npc.material.dispose();
    this.scene.remove(npc);
    this._ships.delete(key);
  }

  clear() { for (const key of [...this._ships.keys()]) this._removeNPC(key); }
  destroy() {
    this.clear();
    if (this._trailPoints) {
      this.scene.remove(this._trailPoints);
      if (this._trailPoints.geometry) this._trailPoints.geometry.dispose();
      if (this._trailPoints.material) this._trailPoints.material.dispose();
    }
  }
}

export default NPCShipManager;

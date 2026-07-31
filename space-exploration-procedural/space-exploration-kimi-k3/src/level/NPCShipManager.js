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
    this._wanderAccum = 0;
    this._trailCapacity = Constants.NPC.TRAIL_POOL * Constants.NPC.MAX_COUNT;
    this._trailPositions = null;
    this._trailLife = null;
    this._trailPoints = null;
    this._trailCursor = 0;
    this._tmpVec = new THREE.Vector3();
    this._presetIndex = 0;
  }

  init() {
    this._trailPositions = new Float32Array(this._trailCapacity * 3);
    this._trailLife = new Float32Array(this._trailCapacity);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._trailPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x66aaff, size: 0.6, transparent: true, opacity: 0.6,
      blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: false,
    });
    this._trailPoints = new THREE.Points(geo, mat);
    this._trailPoints.frustumCulled = false;
    this._scene.add(this._trailPoints);
    for (let i = 0; i < this._trailCapacity; i++) this._trailPositions[i * 3 + 1] = -99999;
  }

  _buildShipMesh(rng) {
    const preset = rng.__preset || Constants.SHIP.PRESETS[Math.floor(rng() * Constants.SHIP.PRESETS.length)];
    const bodyMat = new THREE.MeshStandardMaterial({ color: preset.body, metalness: 0.75, roughness: 0.35 });
    const trimMat = new THREE.MeshStandardMaterial({ color: preset.trim, metalness: 0.6, roughness: 0.5 });
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: preset.tail, emissiveIntensity: 2.0 });
    const wingtipEmissive = preset.wingtipEmissive == null ? 1.0 : preset.wingtipEmissive;
    const wingtipMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: preset.accent, emissiveIntensity: wingtipEmissive });

    const shape = preset.shape || 'interceptor';
    const group = new THREE.Group();
    const geo = (g) => g;
    const add = (m) => group.add(m);

    if (shape === 'claymore') {
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(2.2, 1.2, 5.2)), bodyMat); fuselage.position.set(0, 0.1, 0); add(fuselage);
      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(1.05, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat); nose.rotation.x = -Math.PI / 2; nose.scale.set(1.05, 1.05, 0.95); nose.position.set(0, 0.1, -2.7); add(nose);
      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(1.8, 0.18, 1.9)), trimMat); hood.position.set(0, 0.85, -1.5); add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(1.8, 0.18, 1.2)), trimMat); trunk.position.set(0, 0.85, 1.9); add(trunk);
      const wingGeo = geo(new THREE.BoxGeometry(4.2, 0.18, 1.6));
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(wingGeo, bodyMat); wing.position.set(side * 2.7, -0.15, 0.7); wing.rotation.z = side * -0.08; add(wing);
        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.2, 0.7)), wingtipMat); tip.position.set(side * 5.1, -0.15, 0.7); add(tip);
        const nacelle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.47, 0.53, 2.3, 12)), trimMat); nacelle.rotation.x = Math.PI / 2; nacelle.position.set(side * 4.5, -0.15, 0.7); add(nacelle);
        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 1.05, 1.15)), bodyMat); fin.position.set(side * 0.85, 0.72, 2.25); fin.rotation.x = -0.25; add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.11, 8, 6)), tailMat); tailLight.position.set(side * 0.95, -0.05, 2.55); add(tailLight);
      }
      for (const side of [-1, 1]) { const v = new THREE.Mesh(geo(new THREE.BoxGeometry(0.12, 1.2, 1.4)), trimMat); v.position.set(side * 0.7, 1.25, 2.1); v.rotation.x = -0.2; add(v); }
    } else if (shape === 'vanguard') {
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(1.1, 0.55, 5.8)), bodyMat); fuselage.position.set(0, 0, 0); add(fuselage);
      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(0.65, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat); nose.rotation.x = -Math.PI / 2; nose.scale.set(1.0, 1.0, 1.05); nose.position.set(0, 0, -2.95); add(nose);
      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.1, 2.0)), trimMat); hood.position.set(0, 0.38, -1.7); add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(0.9, 0.1, 1.4)), trimMat); trunk.position.set(0, 0.38, 2.0); add(trunk);
      const podGeo = geo(new THREE.BoxGeometry(0.95, 0.95, 2.9)); const podWingGeo = geo(new THREE.BoxGeometry(2.9, 0.12, 1.4));
      for (const side of [-1, 1]) {
        const pod = new THREE.Mesh(podGeo, bodyMat); pod.position.set(side * 1.85, -0.05, 0.1); add(pod);
        const podWing = new THREE.Mesh(podWingGeo, trimMat); podWing.position.set(side * 1.85, -0.45, 0.6); podWing.rotation.z = side * 0.08; add(podWing);
        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.6, 0.14, 0.5)), wingtipMat); tip.position.set(side * 3.35, -0.45, 0.6); add(tip);
        const nacelle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.34, 0.40, 1.8, 12)), trimMat); nacelle.rotation.x = Math.PI / 2; nacelle.position.set(side * 1.85, -0.05, 1.65); add(nacelle);
        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.1, 0.65, 0.85)), bodyMat); fin.position.set(side * 0.9, 0.5, 2.35); fin.rotation.x = -0.25; add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.09, 8, 6)), tailMat); tailLight.position.set(side * 1.0, 0.05, 2.7); add(tailLight);
      }
    } else if (shape === 'sprinter') {
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(0.8, 0.52, 3.35)), bodyMat); fuselage.position.set(0, 0, 0); add(fuselage);
      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(0.5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat); nose.rotation.x = -Math.PI / 2; nose.scale.set(1.0, 1.0, 1.05); nose.position.set(0, 0, -1.8); add(nose);
      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(0.65, 0.1, 1.45)), trimMat); hood.position.set(0, 0.36, -1.2); add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(0.65, 0.1, 0.9)), trimMat); trunk.position.set(0, 0.36, 1.25); add(trunk);
      const canardGeo = geo(new THREE.BoxGeometry(1.35, 0.09, 0.72));
      for (const side of [-1, 1]) {
        const canard = new THREE.Mesh(canardGeo, trimMat); canard.position.set(side * 1.05, 0.05, -0.55); canard.rotation.z = side * -0.22; add(canard);
        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.26, 0.11, 0.55)), wingtipMat); tip.position.set(side * 2.05, 0.05, 0.15); add(tip);
        const nacelle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.30, 0.36, 1.6, 12)), trimMat); nacelle.rotation.x = Math.PI / 2; nacelle.position.set(side * 1.25, 0.05, 0.15); add(nacelle);
        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.09, 0.55, 0.72)), bodyMat); fin.position.set(side * 0.65, 0.45, 1.7); fin.rotation.x = -0.22; add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.07, 8, 6)), tailMat); tailLight.position.set(side * 0.75, 0.0, 2.05); add(tailLight);
      }
    } else {
      const fuselage = new THREE.Mesh(geo(new THREE.BoxGeometry(1.6, 0.7, 4.2)), bodyMat); fuselage.position.set(0, 0, 0); add(fuselage);
      const nose = new THREE.Mesh(geo(new THREE.SphereGeometry(0.8, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), bodyMat); nose.rotation.x = -Math.PI / 2; nose.scale.set(1.0, 1.0, 0.9); nose.position.set(0, 0, -2.1); add(nose);
      const hood = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.12, 1.6)), trimMat); hood.position.set(0, 0.4, -1.3); add(hood);
      const trunk = new THREE.Mesh(geo(new THREE.BoxGeometry(1.3, 0.12, 1.0)), trimMat); trunk.position.set(0, 0.4, 1.6); add(trunk);
      const wingGeo = geo(new THREE.BoxGeometry(2.6, 0.1, 1.1));
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(wingGeo, bodyMat); wing.position.set(side * 1.9, -0.05, 0.9); wing.rotation.z = side * -0.06; add(wing);
        const tip = new THREE.Mesh(geo(new THREE.BoxGeometry(0.18, 0.14, 0.5)), wingtipMat); tip.position.set(side * 3.2, -0.05, 0.9); add(tip);
        const nacelle = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.34, 0.40, 1.8, 12)), trimMat); nacelle.rotation.x = Math.PI / 2; nacelle.position.set(side * 2.9, -0.05, 0.9); add(nacelle);
        const fin = new THREE.Mesh(geo(new THREE.BoxGeometry(0.1, 0.7, 0.9)), bodyMat); fin.position.set(side * 0.6, 0.55, 1.9); fin.rotation.x = -0.2; add(fin);
        const tailLight = new THREE.Mesh(geo(new THREE.SphereGeometry(0.09, 8, 6)), tailMat); tailLight.position.set(side * 0.7, 0.1, 2.15); add(tailLight);
      }
    }

    group.position.set(0, 0, 0);
    return group;
  }

  buildShipHull(preset) {
    const rng = { __preset: preset, value: () => 0.5 };
    const mesh = this._buildShipMesh(rng);
    mesh.scale.setScalar(preset.scale || 1);
    mesh.userData = { velocity: new THREE.Vector3() };
    return mesh;
  }

  _spawnNPC(gx, gy, gz, key) {
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

  _spawnWanderer(pos, key) {
    if (this._npcs.size >= Constants.NPC.MAX_COUNT) return;
    const rng = mulberry32(hashKey(key) * 1e9 + 101);
    const mesh = this._buildShipMesh(rng);
    mesh.position.copy(pos);
    const speed = Constants.NPC.SPEED * (0.6 + rng() * 0.5);
    const velocity = randomUnitVector(rng).multiplyScalar(speed);
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
      kind: 'wanderer',
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

    // Deterministic sparse grid placement (±2).
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const key = `n${cgx + dx},${cgy + dy},${cgz + dz}`;
          if (!this._npcs.has(key) && hashKey(key) < Constants.NPC.SPAWN_CHANCE) {
            this._spawnNPC(cgx + dx, cgy + dy, cgz + dz, key);
          }
        }
      }
    }

    // Random wandering encounters near the flight path.
    this._wanderAccum += dt;
    if (this._wanderAccum > 1.0) {
      this._wanderAccum -= 1.0;
      if (Math.random() < Constants.NPC.WANDER_SPAWN_CHANCE && this._npcs.size < Constants.NPC.MAX_COUNT) {
        const offset = new THREE.Vector3(
          (Math.random() - 0.5) * view * 0.6,
          (Math.random() - 0.5) * view * 0.6,
          (Math.random() - 0.5) * view * 0.6,
        ).add(shipPos);
        const key = `w${Math.floor(offset.x)}_${Math.floor(offset.y)}_${Math.floor(offset.z)}`;
        if (!this._npcs.has(key)) {
          this._spawnWanderer(offset, key);
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
        if (mesh.isGroup || mesh.type === 'Group') {
          mesh.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
              else child.material.dispose();
            }
          });
        } else {
          if (mesh.geometry) mesh.geometry.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
            else mesh.material.dispose();
          }
        }
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

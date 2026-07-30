import * as THREE from 'three';
import { ROOM, COLORS, LAYERS, LOG, LOG_ERR } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';
import { createPlatformMaterial } from '../visuals/Shaders.js';

/**
 * RoomManager — generates/loads rooms, manages transitions, provides collision data.
 * MVP: 3 hand-built rooms in JSON. Procedural generation is phase 2.
 */

// ═══════════════════════════════════════════════════════════════════════════
// MVP Room Data — hand-built, 22 tiles wide × 16 tiles tall
// World coordinates: x∈[0, 22], y∈[-8, 8] (center at 0)
// ═══════════════════════════════════════════════════════════════════════════
const MVP_ROOMS = {
  spawn: {
    id: 'spawn',
    label: 'Awakening Chamber',
    worldX: 0,         // room origin in world space
    worldY: 0,
    bgColor: 0x0d1020,
    platforms: [
      // floor
      { x: -11, y: -7, w: 22, h: 2, kind: 'floor' },
      // left platform
      { x: -9, y: -3, w: 4, h: 0.3, kind: 'platform' },
      // high ledge (requires double jump to reach)
      { x: 7, y: -0.5, w: 5, h: 0.3, kind: 'platform' },
      // walls (left/right boundaries)
      { x: -12, y: 0, w: 1, h: 16, kind: 'wall' },
      { x: 12, y: 0, w: 1, h: 16, kind: 'wall' },
      // ceiling
      { x: 0, y: 8.5, w: 22, h: 0.5, kind: 'ceiling' },
    ],
    doors: [
      { x: 0, y: -5.5, kind: 'spawn' },
      { x: 11.5, y: -5, direction: 'right', dest: 'ability', requiresAbility: null, locked: false },
      { x: 9, y: 0.5, direction: 'up', dest: 'boss', requiresAbility: 'doubleJump', locked: true },
    ],
    enemies: [
      { type: 'drone', x: -4, y: -5, patrolDx: 4 },
    ],
    pickups: [],
  },

  ability: {
    id: 'ability',
    label: 'Crystalline Vault',
    worldX: 1,   // offset by 1 room width (22 tiles)
    worldY: 0,
    bgColor: 0x101520,
    platforms: [
      { x: -11, y: -7, w: 22, h: 2, kind: 'floor' },
      { x: -12, y: 0, w: 1, h: 16, kind: 'wall' },
      { x: 12, y: 0, w: 1, h: 16, kind: 'wall' },
      { x: 0, y: 8.5, w: 22, h: 0.5, kind: 'ceiling' },
      // some platforms for variety
      { x: -6, y: -3, w: 3, h: 0.3, kind: 'platform' },
      { x: 5, y: -1.5, w: 4, h: 0.3, kind: 'platform' },
      // pedestal for ability pickup
      { x: 0, y: -3.5, w: 2, h: 0.3, kind: 'platform' },
    ],
    doors: [
      { x: -11.5, y: -5, direction: 'left', dest: 'spawn', requiresAbility: null, locked: false },
    ],
    enemies: [
      { type: 'drone', x: 3, y: -5, patrolDx: 2 },
      { type: 'drone', x: -7, y: -5, patrolDx: 3 },
    ],
    pickups: [
      { type: 'ability', ability: 'doubleJump', x: 0, y: -2 },
    ],
  },

  boss: {
    id: 'boss',
    label: 'Guardian\'s Sanctum',
    worldX: 0,
    worldY: 1,   // above spawn room (vertical)
    bgColor: 0x150d10,
    platforms: [
      { x: -11, y: -7, w: 22, h: 2, kind: 'floor' },
      { x: -12, y: 0, w: 1, h: 16, kind: 'wall' },
      { x: 12, y: 0, w: 1, h: 16, kind: 'wall' },
      { x: 0, y: 8.5, w: 22, h: 0.5, kind: 'ceiling' },
      // upper platforms for boss fight mobility
      { x: -6, y: -1, w: 3, h: 0.3, kind: 'platform' },
      { x: 6, y: -1, w: 3, h: 0.3, kind: 'platform' },
    ],
    doors: [
      { x: 9, y: -7, direction: 'down', dest: 'spawn', requiresAbility: null, locked: false },
    ],
    enemies: [],
    pickups: [],
    isBossRoom: true,
    bossSpawn: { x: 6, y: -5 },
  },
};

// Convert room-local coords to world coords
function roomToWorld(room, localX, localY) {
  return {
    x: localX + room.worldX * ROOM.WIDTH,
    y: localY + room.worldY * ROOM.HEIGHT,
  };
}

export default class RoomManager {
  constructor(scene) {
    this._scene = scene;
    this._rooms = {};
    this._meshes = [];    // for disposal
    this._materials = []; // for disposal
    LOG('RoomManager', 'Initialized');
  }

  generate(state) {
    LOG('RoomManager', 'Generating MVP rooms...');
    this._rooms = {};

    for (const [id, data] of Object.entries(MVP_ROOMS)) {
      const room = { ...data, platforms: [...data.platforms], doors: [...data.doors], enemies: [...data.enemies] };

      // Convert platforms to world coordinates
      for (const p of room.platforms) {
        const w = roomToWorld(data, p.x, p.y);
        p.worldX = w.x;
        p.worldY = w.y;
      }

      // Convert doors to world coordinates
      for (const d of room.doors) {
        const w = roomToWorld(data, d.x, d.y);
        d.worldX = w.x;
        d.worldY = w.y;
      }

      // Convert enemy spawn positions to world
      for (const e of room.enemies) {
        const w = roomToWorld(data, e.x, e.y);
        e.worldX = w.x;
        e.worldY = w.y;
      }

      // Convert pickup positions
      if (room.pickups) {
        for (const p of room.pickups) {
          const w = roomToWorld(data, p.x, p.y);
          p.worldX = w.x;
          p.worldY = w.y;
        }
      }

      // Convert boss spawn
      if (room.bossSpawn) {
        const w = roomToWorld(data, room.bossSpawn.x, room.bossSpawn.y);
        room.bossSpawn = { x: w.x, y: w.y };
      }

      this._rooms[id] = room;
      this._buildRoomVisuals(room);
    }

    // Store graph on state
    state.roomGraph = this._buildGraph();

    LOG('RoomManager', `Generated ${Object.keys(this._rooms).length} rooms`);
  }

  /** Build the room connection graph for minimap */
  _buildGraph() {
    const graph = {};
    for (const [id, room] of Object.entries(this._rooms)) {
      graph[id] = { id, label: room.label, exits: [], worldX: room.worldX, worldY: room.worldY };
      for (const d of room.doors) {
        if (d.dest && d.kind !== 'spawn') {
          graph[id].exits.push({ dest: d.dest, direction: d.direction, requiresAbility: d.requiresAbility || null });
        }
      }
    }
    return graph;
  }

  /** Build 3D visuals for a room — platforms, walls, doors */
  _buildRoomVisuals(room) {
    const group = new THREE.Group();
    group.name = `room_${room.id}`;

    for (const p of room.platforms) {
      let color = COLORS.PLATFORM;
      let edgeColor = COLORS.PLATFORM_LIGHT;
      if (p.kind === 'wall') {
        color = COLORS.WALL;
        edgeColor = 0x2a3a4a;
      } else if (p.kind === 'ceiling') {
        color = COLORS.WALL;
        edgeColor = 0x2a3a4a;
      } else if (p.kind === 'floor') {
        edgeColor = 0x445577;
      }

      const geo = new THREE.BoxGeometry(p.w, p.h, 1);
      const mat = createPlatformMaterial(color, edgeColor);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.worldX, p.worldY, LAYERS.PLATFORMS);
      mesh.userData = { kind: p.kind, roomId: room.id };
      group.add(mesh);
      this._meshes.push(mesh);
      this._materials.push(mat);
    }

    // Doors — glowing portals with pulsing emissive
    for (const d of room.doors) {
      if (d.kind === 'spawn') continue;
      const doorGeo = new THREE.BoxGeometry(0.3, 2, 0.5);
      const doorColor = d.locked ? COLORS.DOOR_LOCKED : COLORS.DOOR;
      const doorMat = new THREE.MeshStandardMaterial({
        color: doorColor,
        emissive: doorColor,
        emissiveIntensity: 0.5,
        roughness: 0.25,
        metalness: 0.2,
      });
      const doorMesh = new THREE.Mesh(doorGeo, doorMat);
      doorMesh.position.set(d.worldX, d.worldY, LAYERS.DOORS);
      doorMesh.userData = {
        kind: 'door',
        doorData: d,
        roomId: room.id,
        _baseEmissive: 0.5,
        _locked: d.locked,
      };
      group.add(doorMesh);
      this._meshes.push(doorMesh);
      this._materials.push(doorMat);

      // Door glow halo (additive plane behind door)
      const haloGeo = new THREE.PlaneGeometry(0.8, 2.5);
      const haloMat = new THREE.MeshBasicMaterial({
        color: doorColor,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(doorMesh.position);
      halo.position.z -= 0.3;
      halo.userData = { _isHalo: true };
      group.add(halo);
      this._meshes.push(halo);
      this._materials.push(haloMat);
    }

    this._scene.add(group);
    room._group = group;
  }

  getRoom(id) { return this._rooms[id] || null; }

  getRooms() { return this._rooms; }

  getRoomBounds(id) {
    const room = this._rooms[id];
    if (!room) return null;
    return {
      minX: room.worldX * ROOM.WIDTH - ROOM.WIDTH / 2,
      maxX: room.worldX * ROOM.WIDTH + ROOM.WIDTH / 2,
      minY: room.worldY * ROOM.HEIGHT - ROOM.HEIGHT / 2,
      maxY: room.worldY * ROOM.HEIGHT + ROOM.HEIGHT / 2,
    };
  }

  /** Check which room a world position falls in */
  getRoomAt(wx, wy) {
    for (const [id, room] of Object.entries(this._rooms)) {
      const bounds = this.getRoomBounds(id);
      if (wx >= bounds.minX && wx <= bounds.maxX && wy >= bounds.minY && wy <= bounds.maxY) {
        return id;
      }
    }
    return null;
  }

  /** Get world-coords platforms for collision */
  getAllPlatforms() {
    const all = [];
    for (const room of Object.values(this._rooms)) {
      all.push(...room.platforms);
    }
    return all;
  }

  dispose() {
    for (const room of Object.values(this._rooms)) {
      if (room._group) {
        this._scene.remove(room._group);
        room._group.traverse(c => {
          if (c.geometry) c.geometry.dispose();
          if (c.material) {
            if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
            else c.material.dispose();
          }
        });
      }
    }
    this._meshes.length = 0;
    this._materials.length = 0;
    this._rooms = {};
    LOG('RoomManager', 'Disposed');
  }
}

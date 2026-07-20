// ============================================================
// ChunkManager — Chunk/segment spawn & cleanup for infinite world
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import GameState from '../core/GameState.js';
import EventBus from '../core/EventBus.js';
import BiomeGenerator from './BiomeGenerator.js';
import NebulaSystem from './NebulaSystem.js';
import AsteroidField from './AsteroidField.js';
import DebrisSystem from './DebrisSystem.js';
import { mulberry32, chunkSeed } from '../utils/MathHelpers.js';

class ChunkManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.biome = new BiomeGenerator();
    this.nebula = new NebulaSystem(scene);
    this.asteroids = new AsteroidField(scene);
    this.debris = new DebrisSystem(scene);
    this._activeChunks = new Map();
    this._lastShipPos = new THREE.Vector3();
    this._totalDistance = 0;
    this._lastShipChunkX = -999;
    this._lastShipChunkZ = -999;
  }

  init() {
    // Create initial chunk — pass ship's starting position (0,0,0)
    this._updateChunks(new THREE.Vector3(0, 0, 0));
    this._lastShipPos.set(0, 0, 0);
  }

  /**
   * Update chunks based on ship position
   */
  update(shipPosition, dt) {
    // Track total distance from absolute position
    this._totalDistance = Math.max(
      this._totalDistance,
      Math.abs(shipPosition.x) + Math.abs(shipPosition.y) + Math.abs(shipPosition.z)
    );

    // Spawn chunks ahead, remove chunks behind
    this._updateChunks(shipPosition);

    // Update nebula shader uniforms and billboarding
    this.nebula.update(GameState.time, this.camera);

    // Update asteroid drift
    this.asteroids.update(dt, GameState.time);

    // Update debris drift
    this.debris.update(dt);

    // Remove destroyed asteroids
    this.asteroids.removeDestroyed();
  }

  _getChunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _updateChunks(shipPosition) {
    const shipChunkX = Math.floor(shipPosition.x / Constants.CHUNK.WIDTH);
    const shipChunkZ = Math.floor(shipPosition.z / Constants.CHUNK.LENGTH);

    const spawnAhead = Constants.CHUNK.SPAWN_AHEAD;
    const cleanupBehind = Constants.CHUNK.CLEANUP_BEHIND;

    // Determine which chunks need to exist
    const neededChunks = new Set();
    for (let dx = -1; dx <= spawnAhead; dx++) {
      for (let dz = -spawnAhead; dz <= spawnAhead; dz++) {
        const cx = shipChunkX + dx;
        const cz = shipChunkZ + dz;
        const key = `${cx},${cz}`;
        neededChunks.add(key);
      }
    }

    // Spawn new chunks (pass ship position for safety zone)
    for (const key of neededChunks) {
      if (!this._activeChunks.has(key)) {
        const [cx, cz] = key.split(',').map(Number);
        const chunkEntry = { cx, cz, objects: [] };
        this._activeChunks.set(key, chunkEntry);
        this._spawnChunk(cx, cz, chunkEntry, shipPosition);
      }
    }

    // Remove chunks behind
    for (const [key, chunk] of this._activeChunks) {
      const distBehind = (shipChunkX - chunk.cx);
      if (distBehind > cleanupBehind) {
        this._removeChunk(key);
        this._activeChunks.delete(key);
      }
    }
  }

  _spawnChunk(cx, cz, chunkEntry, shipPosition = null) {
    const center = new THREE.Vector3(
      cx * Constants.CHUNK.WIDTH + Constants.CHUNK.WIDTH / 2,
      0,
      cz * Constants.CHUNK.LENGTH + Constants.CHUNK.LENGTH / 2
    );

    // Get biome params based on total distance traveled
    const biomeParams = this.biome.getBiomeParams(this._totalDistance);

    // Create seeded RNG for this chunk (deterministic)
    const seed = chunkSeed(cx, cz);
    const rng = mulberry32(seed);

    // Get ship position for safety zone (only near origin)
    let safetyShipPos = null;
    if (shipPosition && shipPosition.length() < 10) {
      safetyShipPos = shipPosition;
    }

    // Use the already-created chunk entry for tracking objects
    const chunkObjects = chunkEntry.objects;

    // Spawn nebula
    for (let i = 0; i < biomeParams.nebulaCount; i++) {
      const offset = new THREE.Vector3(
        (rng() - 0.5) * 60,
        (rng() - 0.5) * 40,
        (rng() - 0.5) * 60
      );
      const nebulaPos = new THREE.Vector3(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      const cluster = this.nebula.createCluster(nebulaPos, biomeParams, rng);
      chunkObjects.push(cluster);
    }

    // Spawn asteroids (pass ship position for safety zone)
    const asteroidCount = 5 + Math.floor(rng() * 45);
    const asteroids = this.asteroids.createAsteroids(center, asteroidCount, biomeParams, rng, safetyShipPos);
    chunkObjects.push(...asteroids);

    // Spawn debris
    const debrisCount = 10 + Math.floor(rng() * 90);
    const debrisPieces = this.debris.createDebris(center, debrisCount, rng);
    chunkObjects.push(...debrisPieces);

    // Add point lights for nebula cores (limited count)
    if (biomeParams.nebulaCount > 0) {
      const lightCount = Math.min(biomeParams.nebulaCount, 2);
      for (let i = 0; i < lightCount; i++) {
        const lightColor = new THREE.Color(
          biomeParams.nebulaColors.c1[0] + rng() * 0.3,
          biomeParams.nebulaColors.c1[1] + rng() * 0.3,
          biomeParams.nebulaColors.c1[2] + rng() * 0.3
        );
        const light = new THREE.PointLight(lightColor, 0.4, 35);
        const offset = new THREE.Vector3(
          (rng() - 0.5) * 30,
          (rng() - 0.5) * 20,
          (rng() - 0.5) * 30
        );
        light.position.set(center.x + offset.x, offset.y, center.z + offset.z);
        light.userData.isChunkObject = true;
        this.scene.add(light);
        chunkObjects.push(light);
      }
    }

    // Wormhole tunnel geometry
    if (biomeParams.wormholeActive) {
      const tunnel = this._createWormholeTunnel(center);
      chunkObjects.push(tunnel);
    }

    // Chunk objects tracked via chunkEntry.objects (set before spawn)
  }

  _createWormholeTunnel(center) {
    const tunnelLength = Constants.CHUNK.LENGTH;
    const tunnelRadius = 25;
    const segments = 32;

    const tunnelGeo = new THREE.CylinderGeometry(tunnelRadius, tunnelRadius, tunnelLength, segments, 1, true);
    tunnelGeo.rotateX(Math.PI / 2);

    const tunnelMat = new THREE.MeshStandardMaterial({
      color: 0x332266,
      emissive: 0x221144,
      emissiveIntensity: 0.3,
      roughness: 0.5,
      metalness: 0.5,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.6,
    });

    const tunnel = new THREE.Mesh(tunnelGeo, tunnelMat);
    tunnel.position.set(center.x, 0, center.z);
    tunnel.userData.isWormhole = true;
    tunnel.userData.isChunkObject = true;
    this.scene.add(tunnel);
    return tunnel;
  }

  /**
   * Remove a chunk's objects from the scene with proper disposal
   */
  _removeChunk(key) {
    const chunk = this._activeChunks.get(key);
    if (!chunk || !chunk.objects) return;

    for (const obj of chunk.objects) {
      if (!obj) continue;

      // Handle groups (nebula clusters)
      if (obj.isGroup) {
        obj.traverse((child) => {
          if (child.isMesh || child.isPoints) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
              } else {
                child.material.dispose();
              }
            }
          }
        });
        this.scene.remove(obj);
        continue;
      }

      // Handle meshes (asteroids, debris, wormhole)
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
        this.scene.remove(obj);
      }

      // Handle InstancedMesh
      if (obj.isInstancedMesh) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
        this.scene.remove(obj);
      }

      // Handle lights
      if (obj.isLight) {
        this.scene.remove(obj);
      }
    }

    chunk.objects = [];
  }

  /**
   * Get all destructible objects in scene (non-instanced only)
   */
  getDestructibles() {
    const destructibles = [];

    // Add individual asteroids
    for (const a of this.asteroids._asteroids) {
      if (!a.isInstanced && a.visible) {
        destructibles.push(a);
      }
    }

    // Add individual debris pieces
    for (const d of this.debris._debris) {
      if (d.visible) {
        destructibles.push(d);
      }
    }

    return destructibles;
  }

  /**
   * Destroy a specific asteroid (for shooting)
   */
  destroyAsteroid(asteroid) {
    if (!asteroid.isInstanced && asteroid.userData) {
      asteroid.userData.isDestroyed = true;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this._clearAllChunks();
  }

  _clearAllChunks() {
    // Clear all chunk objects
    for (const [key] of this._activeChunks) {
      this._removeChunk(key);
    }
    this._activeChunks.clear();

    // Clear nebula, asteroids, debris systems
    this.nebula.clear();
    this.asteroids.clear();
    this.debris.clear();

    // Remove all leftover chunk objects from scene
    const toRemove = [];
    this.scene.traverse(obj => {
      if (obj.userData.isChunkObject || obj.userData.isWormhole) {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
  }
}

export default ChunkManager;

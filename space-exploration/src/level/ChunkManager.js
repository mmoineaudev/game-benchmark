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
import { mulberry32, chunkSeed, randomInCylinder } from '../utils/MathHelpers.js';

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
  }

  init() {
    // Create initial chunk
    this._updateChunks(new THREE.Vector3(0, 0, 0));
    this._lastShipPos.set(0, 0, 0);

    EventBus.on('game:restart', () => {
      this._totalDistance = 0;
      this._clearAllChunks();
      this._updateChunks(new THREE.Vector3(0, 0, 0));
      this._lastShipPos.set(0, 0, 0);
    });
  }

  /**
   * Update chunks based on ship position
   */
  update(shipPosition, dt) {
    // Track total distance
    this._totalDistance += shipPosition.distanceTo(this._lastShipPos);
    this._lastShipPos.copy(shipPosition);

    // Check if we need to regenerate chunks
    const chunkKey = this._getChunkKey(shipPosition);
    const currentChunk = this._activeChunks.get(chunkKey);

    // Spawn chunks ahead, remove chunks behind
    this._updateChunks(shipPosition);

    // Update nebula shader uniforms
    this.nebula.update(GameState.time);

    // Update asteroid drift
    this.asteroids.update(dt, GameState.time);

    // Update debris drift
    this.debris.update(dt);

    // Remove destroyed asteroids
    this.asteroids.removeDestroyed();
  }

  _getChunkKey(pos) {
    const cx = Math.floor(pos.x / Constants.CHUNK.WIDTH);
    const cz = Math.floor(pos.z / Constants.CHUNK.LENGTH);
    return `${cx},${cz}`;
  }

  _updateChunks(shipPosition) {
    const shipChunkX = Math.floor(shipPosition.x / Constants.CHUNK.WIDTH);
    const shipChunkZ = Math.floor(shipPosition.z / Constants.CHUNK.LENGTH);

    // Determine chunks to spawn
    const spawnAhead = Constants.CHUNK.SPAWN_AHEAD;
    const cleanupBehind = Constants.CHUNK.CLEANUP_BEHIND;

    // Spawn chunks ahead
    for (let dx = -1; dx <= spawnAhead; dx++) {
      for (let dz = -spawnAhead; dz <= spawnAhead; dz++) {
        const cx = shipChunkX + dx;
        const cz = shipChunkZ + dz;
        const key = `${cx},${cz}`;

        if (!this._activeChunks.has(key)) {
          this._spawnChunk(cx, cz);
          this._activeChunks.set(key, { cx, cz });
        }
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

  _spawnChunk(cx, cz) {
    const center = new THREE.Vector3(
      cx * Constants.CHUNK.WIDTH + Constants.CHUNK.WIDTH / 2,
      0,
      cz * Constants.CHUNK.LENGTH + Constants.CHUNK.LENGTH / 2
    );

    // Get biome params
    const biomeParams = this.biome.getBiomeParams(GameState.distance);
    
    // Create seeded RNG for this chunk
    const seed = chunkSeed(cx, cz);
    const rng = mulberry32(seed);

    // Spawn nebula
    for (let i = 0; i < biomeParams.nebulaCount; i++) {
      const offset = randomInCylinder(50, 30);
      const nebulaPos = new THREE.Vector3(center.x + offset.x, offset.y, center.z + offset.z);
      this.nebula.createCluster(nebulaPos, biomeParams, rng);
    }

    // Spawn asteroids
    const asteroidCount = 5 + Math.floor(rng() * 45) * biomeParams.asteroidDensity;
    const asteroids = this.asteroids.createAsteroids(center, asteroidCount, biomeParams, rng);

    // Spawn debris
    const debrisCount = Math.floor(10 + rng() * 90 * biomeParams.asteroidDensity);
    this.debris.createDebris(center, debrisCount, rng);

    // Add point lights for nebula cores (limited count)
    if (biomeParams.nebulaCount > 0) {
      const lightCount = Math.min(biomeParams.nebulaCount, 4);
      for (let i = 0; i < lightCount; i++) {
        const offset = randomInCylinder(30, 15);
        const lightColor = new THREE.Color(
          biomeParams.nebulaColors.c1[0] + rng() * 0.3,
          biomeParams.nebulaColors.c1[1] + rng() * 0.3,
          biomeParams.nebulaColors.c1[2] + rng() * 0.3
        );
        const light = new THREE.PointLight(lightColor, 0.5, 40);
        light.position.set(center.x + offset.x, offset.y, center.z + offset.z);
        this.scene.add(light);
      }
    }

    // Wormhole tunnel geometry
    if (biomeParams.wormholeActive) {
      this._createWormholeTunnel(center);
    }
  }

  _createWormholeTunnel(center) {
    // Create curved tunnel geometry
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
    this.scene.add(tunnel);
  }

  _removeChunk(key) {
    // Remove visual elements for this chunk
    // (Simplified — in a full implementation, we'd track which objects belong to which chunk)
  }

  _clearAllChunks() {
    this.nebula.clear();
    this.asteroids.clear();
    this.debris.clear();
    this._activeChunks.clear();

    // Remove all wormhole tunnels
    const toRemove = [];
    this.scene.traverse(obj => {
      if (obj.isMesh && obj.userData.isWormhole) {
        toRemove.push(obj);
      }
      if (obj.isPointLight && obj.parent === this.scene) {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  /**
   * Get all destructible objects in scene
   */
  getDestructibles() {
    const destructibles = [...this.asteroids._asteroids.filter(a => !a.isInstanced)];
    // Add asteroid instances as targets
    for (const mesh of this.asteroids._instancedMeshes) {
      destructibles.push(mesh);
    }
    return destructibles;
  }

  /**
   * Destroy a specific asteroid (for shooting)
   */
  destroyAsteroid(asteroid) {
    if (!asteroid.isInstanced) {
      asteroid.userData.isDestroyed = true;
    }
    // For instanced, we'd need to remove the instance from the InstancedMesh
  }

  /**
   * Cleanup
   */
  destroy() {
    this._clearAllChunks();
  }
}

export default ChunkManager;

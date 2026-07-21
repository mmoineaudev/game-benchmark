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
import CollectibleSystem from './CollectibleSystem.js';
import { mulberry32, chunkSeed } from '../utils/MathHelpers.js';

class ChunkManager {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.biome = new BiomeGenerator();
    this.nebula = new NebulaSystem(scene);
    this.asteroids = new AsteroidField(scene);
    this.debris = new DebrisSystem(scene);
    this.collectibles = new CollectibleSystem(scene);
    this._activeChunks = new Map();
    this._lastShipPos = new THREE.Vector3();
    this._totalDistance = 0;
    this._lastShipChunk = new THREE.Vector3(999, 999, 999);
  }

  init() {
    this._lastShipChunk.set(999, 999, 999);
    this._lastShipPos.set(0, 0, 0);
    this._updateChunks(new THREE.Vector3(0, 0, 0));
  }

  update(shipPosition, dt) {
    const originToShip = Math.abs(shipPosition.x) + Math.abs(shipPosition.y) + Math.abs(shipPosition.z);
    this._totalDistance = Math.max(this._totalDistance, originToShip);

    this._updateChunks(shipPosition);
    this.nebula.update(GameState.time, this.camera);
    this.asteroids.update(dt, GameState.time);
    this.debris.update(dt);
    this.collectibles.update(shipPosition);
    this.asteroids.removeDestroyed();
  }

  _getChunkKey(cx, cy, cz) {
    return `${cx},${cy},${cz}`;
  }

  _updateChunks(shipPosition) {
    const cw = Constants.CHUNK.WIDTH;
    const ch = Constants.CHUNK.HEIGHT;
    const cl = Constants.CHUNK.LENGTH;
    const shipChunkX = Math.floor(shipPosition.x / cw);
    const shipChunkY = Math.floor(shipPosition.y / ch);
    const shipChunkZ = Math.floor(shipPosition.z / cl);
    const spawnAhead = Constants.CHUNK.SPAWN_AHEAD;
    const cleanupBehind = Constants.CHUNK.CLEANUP_BEHIND;

    const neededChunks = new Set();
    for (let dx = -1; dx <= spawnAhead; dx++) {
      for (let dy = (shipPosition.y < 10 ? -1 : -spawnAhead); dy <= spawnAhead; dy++) {
        for (let dz = -spawnAhead; dz <= spawnAhead; dz++) {
          const cx = shipChunkX + dx;
          const cy = shipChunkY + dy;
          const cz = shipChunkZ + dz;
          neededChunks.add(`${cx},${cy},${cz}`);
        }
      }
    }

    for (const key of neededChunks) {
      if (!this._activeChunks.has(key)) {
        const [cx, cy, cz] = key.split(',').map(Number);
        const chunkEntry = { cx, cy, cz, objects: [] };
        this._activeChunks.set(key, chunkEntry);
        this._spawnChunk(cx, cy, cz, chunkEntry, shipPosition);
      }
    }

    const toRemove = [];
    for (const [key, chunk] of this._activeChunks) {
      const dx = chunk.cx - shipChunkX;
      const dy = chunk.cy - shipChunkY;
      const dz = chunk.cz - shipChunkZ;
      if (dx < -1 || dy < -1 || dz < -1 || dx > spawnAhead || dy > spawnAhead || dz > spawnAhead) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this._removeChunk(key);
      this._activeChunks.delete(key);
    }
  }

  _spawnChunk(cx, cy, cz, chunkEntry, shipPosition = null) {
    const cw = Constants.CHUNK.WIDTH;
    const ch = Constants.CHUNK.HEIGHT;
    const cl = Constants.CHUNK.LENGTH;
    const center = new THREE.Vector3(
      cx * cw + cw / 2,
      cy * ch + ch / 2,
      cz * cl + cl / 2,
    );

    const biomeParams = this.biome.getBiomeParams(this._totalDistance);
    const seed = chunkSeed(cx, cy, cz);
    const rng = mulberry32(seed);

    let safetyShipPos = null;
    if (shipPosition && shipPosition.length() < 10) {
      safetyShipPos = shipPosition;
    }

    const chunkObjects = chunkEntry.objects;

    for (let i = 0; i < biomeParams.nebulaCount; i++) {
      const offset = new THREE.Vector3(
        (rng() - 0.5) * cw,
        (rng() - 0.5) * ch,
        (rng() - 0.5) * cl,
      );
      const nebulaPos = center.clone().add(offset);
      const cluster = this.nebula.createCluster(nebulaPos, biomeParams, rng);
      chunkObjects.push(cluster);
    }

    const asteroidCount = 1 + Math.floor(rng() * 12);
    const asteroids = this.asteroids.createAsteroids(center, asteroidCount, biomeParams, rng, safetyShipPos);
    chunkObjects.push(...asteroids);

    const debrisCount = 10 + Math.floor(rng() * 90);
    const debrisPieces = this.debris.createDebris(center, debrisCount, rng);
    chunkObjects.push(...debrisPieces);

    const crystalCount = 1 + Math.floor(rng() * 3);
    this.collectibles.spawnCrystals(center, crystalCount, rng);

    const ruinCount = 1 + Math.floor(rng() * 2);
    this.collectibles.spawnRuins(center, ruinCount, rng);

    if (biomeParams.wormholeActive) {
      const tunnel = this._createWormholeTunnel(center);
      chunkObjects.push(tunnel);
    }
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
    tunnel.position.copy(center);
    tunnel.userData.isWormhole = true;
    tunnel.userData.isChunkObject = true;
    this.scene.add(tunnel);
    return tunnel;
  }

  _removeChunk(key) {
    const chunk = this._activeChunks.get(key);
    if (!chunk || !chunk.objects) return;

    for (const obj of chunk.objects) {
      if (!obj) continue;

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

      if (obj.isLight) {
        this.scene.remove(obj);
      }
    }

    chunk.objects = [];
  }

  getDestructibles() {
    const destructibles = [];
    for (const a of this.asteroids._asteroids) {
      if (!a.isInstanced && a.visible) {
        destructibles.push(a);
      }
    }

    for (const d of this.debris._debris) {
      if (d.visible) {
        destructibles.push(d);
      }
    }
    return destructibles;
  }

  destroyAsteroid(asteroid) {
    if (!asteroid.isInstanced && asteroid.userData) {
      asteroid.userData.isDestroyed = true;
    }
  }

  destroy() {
    this._clearAllChunks();
  }

  _clearAllChunks() {
    for (const [key] of this._activeChunks) {
      this._removeChunk(key);
    }
    this._activeChunks.clear();

    this.nebula.clear();
    this.asteroids.clear();
    this.debris.clear();
    this.collectibles.clear();

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

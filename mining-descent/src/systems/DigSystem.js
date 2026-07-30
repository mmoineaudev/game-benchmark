// =============================================================================
// DigSystem — handles tile removal, falling detection, and climbing from grid.
// =============================================================================

import { TILE, VEHICLE, WORLD_HEIGHT, WORLD_WIDTH, WORLD_DEPTH } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';

export class DigSystem {
  constructor(terrainGen) {
    this._gen = terrainGen;
    this._bus = getEventBus();
    this._state = getGameState();
  }

  /** Attempt to dig the tile below the player. Returns tile type or null. */
  digDown() {
    const { tileX, tileY, tileZ } = this._state;
    const targetY = tileY + 1;

    // Don't dig below the world
    if (targetY >= WORLD_HEIGHT) return null;

    const tileType = this._gen.get(tileX, targetY, tileZ);
    if (tileType === TILE.AIR || tileType === TILE.SURFACE) return null; // can't dig air or surface

    const removed = this._gen.dig(tileX, targetY, tileZ);
    if (removed !== null) {
      Logger.debug('DigSys', `dug tile at (${tileX},${targetY},${tileZ}) type=${removed}`);
      this._bus.emit(Events.TILE_REMOVED, { x: tileX, y: targetY, z: tileZ });
      this._bus.emit(Events.PLAYER_DIG, { x: tileX, y: targetY, z: tileZ, tileType: removed });

      // Reveal the dug tile on minimap
      const didx = targetY * WORLD_WIDTH * WORLD_DEPTH + tileZ * WORLD_WIDTH + tileX;
      this._state.discovered[didx] = 1;

      return removed;
    }
    return null;
  }

  /**
   * Check if player should fall: tile below is AIR and player not climbing.
   * Returns the distance fallen, or 0.
   */
  checkFall() {
    const { tileX, tileY, tileZ } = this._state;
    const below = tileY + 1;
    if (below >= WORLD_HEIGHT) return 0;

    if (this._gen.get(tileX, below, tileZ) === TILE.AIR) {
      // Count fall distance
      let fallDist = 0;
      for (let fy = tileY + 1; fy < WORLD_HEIGHT; fy++) {
        if (this._gen.get(tileX, fy, tileZ) !== TILE.AIR) break;
        fallDist++;
        if (fy === WORLD_HEIGHT - 1) { fallDist = 999; break; } // bottomless
      }
      return fallDist;
    }
    return 0;
  }

  /**
   * Check if player can climb: facing a wall with AIR above it.
   * Returns true if climbing is possible.
   */
  canClimb(dirX, dirZ) {
    const { tileX, tileY, tileZ } = this._state;
    if (tileY <= 0) return false; // can't climb above surface

    const tx = tileX + Math.round(dirX);
    const tz = tileZ + Math.round(dirZ);

    // Is there a solid wall in the direction we're facing?
    const wall = this._gen.get(tx, tileY, tz);
    if (wall === TILE.AIR) return false;

    // Is there air above the wall? This is where we'd end up after climbing.
    const spaceAbove = this._gen.get(tx, tileY - 1, tz);
    if (spaceAbove !== TILE.AIR) return false;

    return true;
  }

  /**
   * Execute climb: move player up one tile, consuming extra O2.
   * State is updated by Vehicle.climbUp — this just validates and emits.
   */
  executeClimb(dirX, dirZ) {
    const { tileX, tileY, tileZ } = this._state;
    const tx = tileX + Math.round(dirX);
    const tz = tileZ + Math.round(dirZ);
    const ty = tileY - 1;

    Logger.debug('DigSys', `climb to (${tx},${ty},${tz})`);
    this._bus.emit(Events.PLAYER_CLIMB, { x: tx, y: ty, z: tz });
  }

  dispose() {
    Logger.info('DigSys', 'disposed');
  }
}

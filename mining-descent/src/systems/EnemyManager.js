// =============================================================================
// EnemyManager — spawns and manages Stone Mites (MVP: 1 enemy type).
// =============================================================================

import { ENEMIES, WORLD_WIDTH, WORLD_DEPTH, WORLD_HEIGHT, TILE } from '../core/Constants.js';
import { getEventBus, Events } from '../core/EventBus.js';
import { getGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';
import { Creature } from '../entities/Creature.js';

const MAX_MITES = 12;
const SPAWN_CHECK_INTERVAL = 3; // seconds between spawn attempts

export class EnemyManager {
  constructor(scene, terrainGen) {
    this._scene = scene;
    this._gen = terrainGen;
    this._bus = getEventBus();
    this._state = getGameState();
    this._creatures = [];
    this._spawnTimer = 0;
  }

  /** Spawn one Stone Mite near the player if conditions met. */
  _trySpawn() {
    if (this._creatures.length >= MAX_MITES) return;
    if (this._state.phase !== 'descent' || !this._state.isAlive) return;

    // Spawn distance: 8-15 tiles from player
    const { tileX, tileY, tileZ } = this._state;
    const dist = 8 + Math.floor(Math.random() * 8);
    const angle = Math.random() * Math.PI * 2;
    const sx = Math.round(tileX + Math.cos(angle) * dist);
    const sz = Math.round(tileZ + Math.sin(angle) * dist);
    const sy = tileY + Math.floor((Math.random() - 0.5) * 4);

    // Clamp
    const x = Math.max(1, Math.min(WORLD_WIDTH - 2, sx));
    const z = Math.max(1, Math.min(WORLD_DEPTH - 2, sz));
    const y = Math.max(1, Math.min(WORLD_HEIGHT - 2, sy));

    // Must be an air tile (walkable) with solid floor below
    if (this._gen.get(x, y, z) !== TILE.AIR) return;
    if (!this._gen.isSolid(x, y + 1, z)) return; // no floor
    if (!this._gen.isSolid(x, y - 1, z)) return; // no ceiling (in cave, skip)

    const creature = new Creature(this._scene, ENEMIES.stone_mite, x, y, z);
    this._creatures.push(creature);
    this._bus.emit(Events.ENEMY_SPAWNED, { type: 'stone_mite', count: this._creatures.length });
    Logger.debug('EnemyMgr', `spawned stone_mite at (${x},${y},${z}) total=${this._creatures.length}`);
  }

  update(dt) {
    if (this._state.phase !== 'descent' || !this._state.isAlive) return;

    this._spawnTimer += dt;
    if (this._spawnTimer >= SPAWN_CHECK_INTERVAL) {
      this._spawnTimer = 0;
      this._trySpawn();
    }

    const playerPos = {
      x: this._state.tileX + 0.5,
      y: -(this._state.tileY),
      z: this._state.tileZ + 0.5,
    };

    for (let i = this._creatures.length - 1; i >= 0; i--) {
      const c = this._creatures[i];
      c.update(dt, playerPos, this._gen);

      // Check death
      if (c.hp <= 0) {
        Logger.debug('EnemyMgr', `stone_mite killed at (${c.tileX},${c.tileY},${c.tileZ})`);
        c.dispose();
        this._creatures.splice(i, 1);
        this._state.enemiesKilledThisRun++;
        this._bus.emit(Events.ENEMY_KILLED, { type: 'stone_mite' });
        continue;
      }

      // Check damage to player (adjacent tile)
      if (this._state.isAlive) {
        const dx = Math.abs(c.tileX - this._state.tileX);
        const dy = Math.abs(c.tileY - this._state.tileY);
        const dz = Math.abs(c.tileZ - this._state.tileZ);
        if (dx <= 1 && dy <= 1 && dz <= 1) {
          this._state.hull -= c.config.damage * dt * 0.5; // damage per second when adjacent
          this._bus.emit(Events.PLAYER_DAMAGED, { amount: Math.round(c.config.damage * dt * 0.5 * 100) / 100, source: 'stone_mite' });
          this._bus.emit(Events.HULL_CHANGED, { hull: this._state.hull, maxHull: this._state.maxHull });

          if (this._state.hull <= 0) {
            this._state.hull = 0;
            this._state.isAlive = false;
            Logger.info('EnemyMgr', 'HULL DEPLETED by enemy');
            this._bus.emit(Events.HULL_DEPLETED);
            this._bus.emit(Events.PLAYER_DIED, { cause: 'destroyed' });
          }
        }
      }
    }
  }

  dispose() {
    for (const c of this._creatures) c.dispose();
    this._creatures = [];
    Logger.info('EnemyMgr', 'disposed');
  }
}

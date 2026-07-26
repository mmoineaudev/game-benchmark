import { ENEMY, EVENTS } from '../core/Constants.js';
import { Creature } from '../entities/Creature.js';
import { bus } from '../core/EventBus.js';

export class EnemyManager {
  constructor(scene) {
    this.scene = scene;
    this.creatures = [];
    this._spawnCooldown = 0;
  }

  spawnInitial(terrainData) {
    const { data, width, depth, height } = terrainData;
    // Spawn 3-5 Stone Mites in stone layer (y 3-20) at random positions that are AIR or STONE
    const count = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      let attempts = 0;
      while (attempts < 30) {
        attempts++;
        const x = Math.floor(Math.random() * width);
        const z = Math.floor(Math.random() * depth);
        const y = 3 + Math.floor(Math.random() * 18);
        const idx = x + z * width + y * width * depth;
        // Spawn on solid ground
        const below = data[idx - width * depth];
        if (below !== 0 && below !== undefined) {
          this._spawnAt(x, y, z);
          break;
        }
      }
    }
  }

  _spawnAt(x, y, z) {
    const creature = new Creature(ENEMY.STONE_MITE, x, y, z);
    this.creatures.push(creature);
    this.scene.add(creature.group);
  }

  update(dt, playerPos, terrainData) {
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (!c.alive) {
        // Death dissolve
        c.group.scale.lerp(new THREE.Vector3(0, 0, 0), 5 * dt);
        if (c.group.scale.x < 0.01) {
          this.scene.remove(c.group);
          this.creatures.splice(i, 1);
          bus.emit(EVENTS.ENEMY_KILLED);
        }
        continue;
      }
      c.update(dt, playerPos);

      // Check distance to player for collision (within 0.6 units)
      const dx = c.getWorldPos().x - playerPos.x;
      const dz = c.getWorldPos().z - playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.6) {
        bus.emit(EVENTS.PLAYER_HURT, { amount: c.damage, source: 'mite' });
        // Push creature back
        c.group.position.x -= dx * 0.3;
        c.group.position.z -= dz * 0.3;
      }
    }

    // Periodic respawn if population low
    this._spawnCooldown -= dt;
    if (this._spawnCooldown <= 0 && this.creatures.length < 2) {
      this._spawnCooldown = 8;
      // Spawn near but not on player
      let attempts = 0;
      while (attempts < 20) {
        attempts++;
        const ox = Math.floor(Math.random() * 6) - 3;
        const oz = Math.floor(Math.random() * 6) - 3;
        if (ox === 0 && oz === 0) continue;
        const sx = Math.floor(playerPos.x - 0.5) + ox;
        const sz = Math.floor(playerPos.z - 0.5) + oz;
        const sy = Math.floor(playerPos.y - 0.5);
        if (sx >= 0 && sx < 20 && sz >= 0 && sz < 20 && sy > 2 && sy < 48) {
          this._spawnAt(sx, sy, sz);
          break;
        }
      }
    }
  }

  clear() {
    for (const c of this.creatures) {
      this.scene.remove(c.group);
    }
    this.creatures = [];
  }
}

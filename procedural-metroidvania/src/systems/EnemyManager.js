import * as THREE from 'three';
import { ENEMY, COLORS, LAYERS, LOG } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';
import ModelFactory from '../visuals/ModelFactory.js';

let _idSeq = 0;

/**
 * Single enemy instance — simple patrolling drone for MVP.
 * Patrols left-right between patrolMinX and patrolMaxX.
 */
class EnemyInstance {
  constructor(scene, spec, id) {
    this.id = id;
    this.type = spec.type || 'drone';
    this.x = spec.worldX || 0;
    this.y = spec.worldY || 0;
    this.startX = this.x;
    this.patrolMinX = this.x - (spec.patrolDx || 3);
    this.patrolMaxX = this.x + (spec.patrolDx || 3);
    this.dir = 1; // 1 = right, -1 = left
    this.speed = ENEMY.DRONE.speed;
    this.hp = ENEMY.DRONE.hp;
    this.maxHp = ENEMY.DRONE.hp;
    this.dead = false;
    this.hitInvincible = 0;
    this.patrolTimer = 0;
    this._knockbackVx = 0;
    this._knockbackVy = 0;
    this._knockbackTime = 0;
    this._flashTime = 0;

    // 3D mesh
    this.mesh = ModelFactory.buildDrone(COLORS.ENEMY, ENEMY.DRONE.scale);
    this.mesh.position.set(this.x, this.y, LAYERS.ENEMIES);
    this.mesh.userData.enemyId = id;
    scene.add(this.mesh);
  }

  takeDamage(amount, fromDir) {
    if (this.dead || this.hitInvincible > 0) return;
    this.hp -= amount;
    this.hitInvincible = 0.3;
    this._flashTime = 0.15;
    this._knockbackVx = fromDir * 5;
    this._knockbackVy = 2;
    this._knockbackTime = 0.2;

    // Flash enemy white via shader uniform
    ModelFactory.flashEnemy(this.mesh);

    if (this.hp <= 0) {
      this.die();
    }
  }

  die() {
    this.dead = true;
    this.mesh.visible = false;
    // Scale down dissolve effect
    const dissolve = () => {
      const s = Math.max(0, this.mesh.scale.x - 0.1);
      this.mesh.scale.setScalar(s);
      if (s <= 0) {
        this.mesh.parent?.remove(this.mesh);
        this.mesh.geometry?.dispose();
        if (this.mesh.material) {
          if (Array.isArray(this.mesh.material)) this.mesh.material.forEach(m => m.dispose());
          else this.mesh.material.dispose();
        }
      } else {
        requestAnimationFrame(dissolve);
      }
    };
    dissolve();
  }

  update(dt, player) {
    if (this.dead) return;

    // Hit invincibility timer
    if (this.hitInvincible > 0) this.hitInvincible -= dt;
    if (this._flashTime > 0) this._flashTime -= dt;

    // Knockback
    if (this._knockbackTime > 0) {
      this.x += this._knockbackVx * dt;
      this.y += this._knockbackVy * dt;
      this._knockbackTime -= dt;
      this.mesh.position.set(this.x, this.y, LAYERS.ENEMIES);
      return;
    }

    // Patrol behavior
    this.patrolTimer -= dt;
    if (this.patrolTimer <= 0) {
      this.x += this.dir * this.speed * dt;
      if (this.x >= this.patrolMaxX) {
        this.x = this.patrolMaxX;
        this.dir = -1;
        this.patrolTimer = ENEMY.DRONE.patrolPause;
      } else if (this.x <= this.patrolMinX) {
        this.x = this.patrolMinX;
        this.dir = 1;
        this.patrolTimer = ENEMY.DRONE.patrolPause;
      }
    }

    this.mesh.position.set(this.x, this.y, LAYERS.ENEMIES);
    this.mesh.rotation.y = this.dir === 1 ? 0 : Math.PI;

    // ── Mesh animations ────────────────────────────────────────────
    const t = performance.now() / 1000;

    // Core pulse
    const core = this.mesh.getObjectByName('_core');
    if (core) core.scale.setScalar(1 + Math.sin(t * 3) * 0.08);

    // Rotate horizontal ring
    const ringH = this.mesh.getObjectByName('_ringH');
    if (ringH) ringH.rotation.y += dt * 1.5;

    // Rotate vertical ring
    const ringV = this.mesh.getObjectByName('_ringV');
    if (ringV) ringV.rotation.z += dt * 1.2;

    // Eye bob and pulse
    const eye = this.mesh.getObjectByName('_eye');
    if (eye?.material) eye.material.opacity = 0.5 + Math.sin(t * 5) * 0.3;

    // Inner glow pulse
    const innerGlow = this.mesh.getObjectByName('_innerGlow');
    if (innerGlow?.material) innerGlow.material.opacity = 0.3 + Math.sin(t * 4) * 0.2;

    // Enemy light pulse
    const light = this.mesh.getObjectByName('_enemyLight');
    if (light) light.intensity = 0.2 + Math.sin(t * 3.5) * 0.1;

    // Update shader time uniforms
    this.mesh.traverse(c => {
      if (c.material?.uniforms?.uTime) c.material.uniforms.uTime.value = t;
    });
  }

  getAABB() {
    return { x: this.x, y: this.y, hw: 0.3, hh: 0.4 };
  }
}

/**
 * EnemyManager — spawns, updates, and cleans up enemies per room.
 */
export default class EnemyManager {
  constructor(scene) {
    this._scene = scene;
    this._enemies = [];
    this._activeRoomId = null;
    LOG('EnemyManager', 'Initialized');
  }

  /** Load enemies for a room (called on room enter) */
  loadRoom(roomId, specs) {
    // Despawn current enemies
    this._clearEnemies();
    this._activeRoomId = roomId;

    for (const spec of specs) {
      const enemy = new EnemyInstance(this._scene, spec, ++_idSeq);
      this._enemies.push(enemy);
    }
    LOG('EnemyManager', `Loaded ${specs.length} enemies for room "${roomId}"`);
  }

  _clearEnemies() {
    for (const e of this._enemies) {
      if (!e.dead) {
        e.mesh.parent?.remove(e.mesh);
        if (e.mesh.geometry) e.mesh.geometry.dispose();
        if (e.mesh.material) {
          if (Array.isArray(e.mesh.material)) e.mesh.material.forEach(m => m.dispose());
          else e.mesh.material.dispose();
        }
      }
    }
    this._enemies.length = 0;
  }

  update(dt, player, currentRoomId) {
    // Only update enemies in active room
    for (const e of this._enemies) {
      e.update(dt, player);

      // Check if enemy touches player (damage)
      if (!e.dead && player.isAlive && !player.hitInvincible) {
        const aabb = e.getAABB();
        if (Math.abs(player.x - e.x) < 0.6 && Math.abs(player.y - e.y) < 0.8) {
          const dir = player.x > e.x ? 1 : -1;
          player.takeDamage(ENEMY.DRONE.damage, dir);
          LOG('EnemyManager', `Enemy ${e.id} hit player`);
        }
      }
    }
  }

  getActive() {
    return this._enemies.filter(e => !e.dead);
  }

  dispose() {
    this._clearEnemies();
  }
}

// ============================================================
// GameState — Centralized state: player, combat, game
// ============================================================
import * as THREE from 'three';
import Constants from './Constants.js';

class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    // Player domain
    this.player = {
      position: null,       // THREE.Vector3
      velocity: null,       // THREE.Vector3
      rotation: null,       // THREE.Euler
      health: Constants.HEALTH.MAX,
      score: 0,
      distance: 0,
      isAlive: true,
      isRestarting: false,
    };

    // Combat domain
    this.combat = {
      lastFireTime: 0,
      projectiles: [],      // array of projectile data
      explosions: [],       // array of explosion data
    };

    // Game domain
    this.game = {
      time: 0,
      isGameOver: false,
      isPaused: false,
      highScore: this._loadHighScore(),
    };

    // Buffs domain
    this.buffs = [];

    // Reset vectors
    this.player.position = new THREE.Vector3(0, 0, 0);
    this.player.velocity = new THREE.Vector3(0, 0, 0);
    this.player.rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  }

  _loadHighScore() {
    try {
      const val = localStorage.getItem('space_exploration_highscore');
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }

  _saveHighScore() {
    try {
      localStorage.setItem('space_exploration_highscore', String(this.game.highScore));
    } catch {
      // silently fail — not critical
    }
  }

  // --- Player accessors ---
  get playerPosition() { return this.player.position; }
  get playerVelocity() { return this.player.velocity; }
  get playerRotation() { return this.player.rotation; }
  get health() { return this.player.health; }
  get score() { return this.player.score; }
  get distance() { return this.player.distance; }
  get isAlive() { return this.player.isAlive; }
  get isGameOver() { return this.game.isGameOver; }
  get time() { return this.game.time; }
  get highScore() { return this.game.highScore; }

  // --- Player mutations ---
  setPlayerPosition(pos) {
    this.player.position.copy(pos);
  }

  setPlayerVelocity(vel) {
    this.player.velocity.copy(vel);
  }

  setPlayerRotation(rot) {
    this.player.rotation.copy(rot);
  }

  addHealth(amount) {
    this.player.health = Math.min(Constants.HEALTH.MAX, this.player.health + amount);
  }

  takeDamage(amount) {
    this.player.health = Math.max(0, this.player.health - amount);
    if (this.player.health <= 0) {
      this.player.isAlive = false;
      this.game.isGameOver = true;
      if (this.player.score > this.game.highScore) {
        this.game.highScore = this.player.score;
        this._saveHighScore();
      }
    }
  }

  addScore(amount) {
    this.player.score += amount;
  }

  addDistance(amount) {
    this.player.distance += amount;
  }

  // --- Buff management ---
  addBuff(buff) {
    this.buffs.push({ ...buff, remaining: buff.duration });
  }

  updateBuffs(dt) {
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      this.buffs[i].remaining -= dt;
      if (this.buffs[i].remaining <= 0) {
        this.buffs[i].onExpire?.();
        this.buffs.splice(i, 1);
      }
    }
  }

  // --- Projectile management ---
  addProjectile(proj) {
    this.combat.projectiles.push(proj);
  }

  removeProjectile(index) {
    if (index >= 0 && index < this.combat.projectiles.length) {
      this.combat.projectiles.splice(index, 1);
    }
  }

  // --- Explosion management ---
  addExplosion(explosion) {
    this.combat.explosions.push(explosion);
  }

  clearExplosions() {
    this.combat.explosions = [];
  }

  // --- Full reset ---
  restart() {
    this.reset();
  }
}

export default new GameState();

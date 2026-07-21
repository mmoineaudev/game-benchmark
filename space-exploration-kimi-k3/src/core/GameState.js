// VOID DRIFT — GameState.js
// Singleton mutable game state. Projectiles keyed by UUID (never by array index).

import * as THREE from 'three';
import * as Constants from './Constants.js';

let _uuidCounter = 0;
export function nextUUID() {
  return `p${++_uuidCounter}_${Date.now().toString(36)}`;
}

class GameStateClass {
  constructor() {
    this.restart();
    this.game.highScore = this._loadHighScore();
  }

  restart() {
    this.player = {
      position: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      health: Constants.HEALTH.MAX,
      score: 0,
      distance: 0,
      isAlive: true,
    };
    this.combat = {
      lastFireTime: 0,
      projectiles: new Map(),   // uuid -> { id, mesh, velocity, bornAt, distanceTraveled }
      explosions: [],
    };
    this.game = {
      time: 0,
      isGameOver: false,
      isPaused: true,
      highScore: this.game ? this.game.highScore : 0,
    };
    this.muted = this._loadMuted();
  }

  takeDamage(n) {
    if (!this.player.isAlive) return;
    this.player.health = Math.max(0, this.player.health - n);
    if (this.player.health <= 0) {
      this.player.isAlive = false;
      this.game.isGameOver = true;
      this._maybeSaveHighScore();
    }
  }

  heal(n) {
    this.player.health = Math.min(Constants.HEALTH.MAX, this.player.health + n);
  }

  addScore(n) {
    this.player.score += Math.floor(n);
  }

  addDistance(d) {
    this.player.distance += d;
  }

  addProjectile(p) {
    this.combat.projectiles.set(p.id, p);
  }

  removeProjectile(id) {
    this.combat.projectiles.delete(id);
  }

  get isLowHealth() {
    return this.player.health <= Constants.HEALTH.WARNING_THRESHOLD && this.player.isAlive;
  }

  _loadHighScore() {
    try {
      const v = parseInt(localStorage.getItem(Constants.STORAGE.HIGH_SCORE) || '0', 10);
      return Number.isFinite(v) ? v : 0;
    } catch { return 0; }
  }

  _maybeSaveHighScore() {
    if (this.player.score > this.game.highScore) {
      this.game.highScore = this.player.score;
      this.game.newHighScore = true;
      try { localStorage.setItem(Constants.STORAGE.HIGH_SCORE, String(this.player.score)); } catch { /* ignore */ }
    } else {
      this.game.newHighScore = false;
    }
  }

  _loadMuted() {
    try { return localStorage.getItem(Constants.STORAGE.MUTED) === '1'; } catch { return false; }
  }

  saveMuted() {
    try { localStorage.setItem(Constants.STORAGE.MUTED, this.muted ? '1' : '0'); } catch { /* ignore */ }
  }
}

export const GameState = new GameStateClass();

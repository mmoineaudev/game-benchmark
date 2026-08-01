import * as THREE from 'three';
import GameState from './GameState.js';
import EventBus from './EventBus.js';
import RenderSystem from '../systems/RenderSystem.js';
import InputSystem from '../systems/InputSystem.js';
import PostProcessingSystem from '../systems/PostProcessingSystem.js';
import PathSystem from '../systems/PathSystem.js';
import WaveManager from '../systems/WaveManager.js';
import TowerManager from '../systems/TowerManager.js';
import EnemyManager from '../systems/EnemyManager.js';
import ProjectileSystem from '../systems/ProjectileSystem.js';
import CollisionSystem from '../systems/CollisionSystem.js';
import ParticleSystem from '../systems/ParticleSystem.js';
import AudioSystem from '../systems/AudioSystem.js';
import ContextMenuSystem from '../systems/ContextMenuSystem.js';
import HUD from '../ui/HUD.js';
import PauseOverlay from '../ui/PauseOverlay.js';
import deathOverlay from '../ui/DeathOverlay.js';
import GameplaySystem from '../systems/GameplaySystem.js';
import StarfieldSystem from '../systems/StarfieldSystem.js';
import VisualFX from '../systems/VisualFX.js';
import ModelFactory from '../systems/ModelFactory.js';
import { TOWER_DEFS } from './Constants.js';
export default class Game {
  constructor(containerId) {
    this._running = false;
    this._paused = false;
    this._speed = 1;
    this._lastTime = 0;
    this._containerId = containerId;
    this._unsubscribers = [];
  }
  init() {
    const gs = (this._gs = new GameState());
    const state = gs.state;

    const _unsub = EventBus.on.bind(EventBus);
    this._unsubscribers.push(_unsub('game:paused', () => this._setPaused(true)));
    this._unsubscribers.push(_unsub('game:resumed', () => this._setPaused(false)));
    this._unsubscribers.push(_unsub('game:restart', () => this.restart()));
    this._unsubscribers.push(_unsub('game:over', () => {
      state.over = true;
      this._setPaused(true);
      deathOverlay.show(state);
    }));
    this._unsubscribers.push(_unsub('ui:regenerateMap', () => this.regenerateMap()));
    this._unsubscribers.push(_unsub('ui:setSpeed', (s) => { this._speed = s; }));

    this._renderSystem = new RenderSystem();
    this._renderSystem.init();
    this._visualFX = new VisualFX(this._renderSystem.camera);
    this._visualFX.bind(this._renderSystem.scene);
    this._postProcessing = new PostProcessingSystem(this._renderSystem.renderer, this._renderSystem.scene, this._renderSystem.camera);
    this._audio = new AudioSystem();
    this._pathSystem = new PathSystem(this._renderSystem.scene);
    this._wave = new WaveManager();
    this._towers = new TowerManager(this._renderSystem.scene, this._audio);
    this._enemies = new EnemyManager(this._renderSystem.scene, this._audio, gs);
    this._projectiles = new ProjectileSystem(this._renderSystem.scene, this._audio);
    this._collisions = new CollisionSystem();
    this._collisions.fx = this._visualFX;
    this._particles = new ParticleSystem(this._renderSystem.scene);
    this._context = new ContextMenuSystem();
    this._hud = new HUD(gs);
    this._pause = new PauseOverlay();
    this._input = new InputSystem(this._renderSystem.camera, this._renderSystem.dom);
    this._raycaster = new THREE.Raycaster();

    // Path generation — store pathSet on state
    this._pathSystem.rebuild();
    state.path = this._pathSystem.pathTiles;
    state.enemyPathTiles = this._pathSystem._orderedPath;

    // Add starfield background
    this._starfield = new StarfieldSystem(this._renderSystem.scene);

    // Wire up projectiles to scene/audio
    this._projectiles.bind(this._renderSystem.scene, this._audio);

    // Gameplay system — needs raycaster + camera + dom
    this._gameplay = new GameplaySystem(
      gs, this._pathSystem, this._towers, this._enemies, this._wave,
      this._context, this._raycaster,
      this._renderSystem.camera, this._renderSystem.dom
    );

    // Keyboard handlers
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePause();
      }
      if (e.code === 'KeyR' && state.over) {
        this.restart();
      }
    });

    this._running = true;
    this._lastTime = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }
  _setPaused(v) {
    if (this._paused === v) return; // guard against re-entry from event emit
    this._paused = v;
    this._gs.patch({ paused: v });
    if (v) {
      this._pause.show(this._gs.state);
      EventBus.emit('game:paused');
    } else {
      this._pause.hide();
      EventBus.emit('game:resumed');
    }
  }
  togglePause() {
    this._setPaused(!this._paused);
  }
  regenerateMap() {
    // Save current game state
    const currentWave = this._gs.state.wave;
    const currentMoney = this._gs.state.money;
    const currentLives = this._gs.state.lives;
    const currentStats = { ...this._gs.state.stats };

    // Reset game state
    this._gs.reset();
    const state = this._gs.state;

    // Keep progression
    state.wave = currentWave;
    state.money = currentMoney;
    state.lives = currentLives;
    state.stats = currentStats;

    // Rebuild path
    this._pathSystem.rebuild();
    state.path = this._pathSystem.pathTiles;
    state.enemyPathTiles = this._pathSystem._orderedPath;

    // Clear all towers
    this._towers.reset();

    // Clear all enemies
    this._enemies.reset();

    // Clear projectiles
    this._projectiles.reset();

    // Clear particles
    this._particles.reset();

    // Clear build mode
    if (this._gameplay) {
      this._gameplay._buildPending = false;
      this._gameplay._clearHover();
    }

    // Regenerate starfield for visual variety
    if (this._starfield) {
      this._starfield.dispose();
    }
    this._starfield = new StarfieldSystem(this._renderSystem.scene);
  }
  restart() {
    location.reload();
  }
  _loop(now) {
    if (!this._running) return;
    requestAnimationFrame(this._loop);
    const dt = Math.min((now - this._lastTime) / 1000, 0.1) * this._speed;
    this._lastTime = now;
    const state = this._gs.state;
    this._input.update(dt, state, this._renderSystem.camera, this._renderSystem.dom);
    if (!this._paused) {
      if (!state.over) {
        // Wave spawning (staggered over time via WaveManager)
        this._wave.update(dt, state, this._enemies, this._pathSystem);
        // Tower update (cooldown ticks)
        this._towers.update(dt, state);
        this._enemies.update(dt, state, this._pathSystem, this._towers.towers);
        this._projectiles.update(dt, this._enemies, state);
        this._towerFire(dt, state);
        this._collisions.update(dt, state, this._projectiles, this._enemies, this._towers, this._particles);
        this._particles.update(dt);
        this._hud.update(state, this);
        this._context.update();
      }
    }
    this._gameplay.update();
    this._pathSystem.update(dt, this._enemies.enemies, this._towers.towers, state.wave);
    if (this._starfield) this._starfield.update(dt);
    this._visualFX.setHealthBars(this._enemies.enemies);
    this._visualFX.update(dt);
    this._postProcessing.update(dt);
  }
  _towerFire(dt, state) {
    const fx = this._visualFX;
    this._towers.towers.forEach(t => {
      const def = TOWER_DEFS[t.defIdx];

      // ── Chrono Prism: passive aura slow (no projectile) ──────────────
      if (def.auraSlow) {
        for (const e of this._enemies.enemies) {
          if (e.dead) continue;
          if (e.mesh.position.distanceTo(t.pos) <= t.range) {
            e.slowUntil = Math.max(e.slowUntil, performance.now() + 400);
          }
        }
        // faint periodic aura pulse
        if (Math.random() < dt * 0.6) fx.auraPulse(t.pos.clone().setY(0.05), def.color, t.range);
        return;
      }

      // Find target: prioritize enemy with highest pathIndex (furthest along path)
      let target = null;
      let bestIdx = -1;
      for (const e of this._enemies.enemies) {
        if (e.dead) continue;
        if (e.mesh.position.distanceTo(t.pos) <= t.range && e.pathIndex > bestIdx) {
          target = e;
          bestIdx = e.pathIndex;
        }
      }
      // Aim continuously at the focused enemy (single-target towers only)
      if (target) this._towers.aimAt(t, target.mesh.position);

      t.cooldown -= dt;
      if (t.cooldown > 0) return;
      if (!target) return;
      t.cooldown = t.rate;

      // Recoil + tower flash
      this._towers.recoil(t);
      this._towers.flashTower(t, 1.5);

      // ── Per-tower firing visuals ────────────────────────────────────
      const muzzlePos = new THREE.Vector3(t.pos.x, 0.6, t.pos.z);
      if (def.beam) {
        fx.beam(t.pos, target.mesh.position, def.color, 0.14, 0.16);
        fx.muzzle(muzzlePos, def.color, 0.45);
        target.hp -= t.damage;
        ModelFactory.flashEnemy(target.mesh);
        if (target.hp <= 0) this._enemies.kill(target, state);
      } else {
        if (def.arc) fx.arc(t.pos.clone().setY(0.55), target.mesh.position, def.color);
        if (def.id === 2 || def.id === 7 || def.id === 11) {
          fx.tracer(muzzlePos, target.mesh.position, def.color);
          fx.muzzle(muzzlePos, def.color, 0.5);
        } else if (def.id === 14) {
          fx.shockwave(muzzlePos, def.color, 1.2);
        } else if (def.splash) {
          fx.muzzle(muzzlePos, def.color, 0.55);
        } else {
          fx.muzzle(muzzlePos, def.color, 0.4);
        }
        const dir = target.mesh.position.clone().sub(t.pos);
        dir.y = 0; // level flight — projectiles travel at a fixed height, not along the tower-base line
        dir.normalize();
        this._projectiles.spawn({
          pos: t.pos.clone().setY(0.45), dir, damage: t.damage, speed: def.projSpeed || 10,
          color: def.color, splash: def.splash || 0,
          slow: def.stun || def.slow || 0,
          dot: !!def.dot, gravity: !!def.gravity, chain: def.chain || 0,
          parallel: def.parallel || 0,
          pierce: !!def.pierce, corrode: def.corrode || 0,
        });
      }
    });
  }
}

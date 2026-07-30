import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { SCENE, CAMERA, VISUAL, DEBUG, LOG, LOG_ERR, PLAYER as PLAYER_CFG } from './Constants.js';
import EventBus from './EventBus.js';
import GameState from './GameState.js';
import Input from '../systems/Input.js';
import CameraSystem from '../systems/Camera.js';
import RoomManager from '../systems/RoomManager.js';
import EnemyManager from '../systems/EnemyManager.js';
import AbilityManager from '../systems/AbilityManager.js';
import Player from '../entities/Player.js';
import Boss from '../entities/Boss.js';
import ModelFactory from '../visuals/ModelFactory.js';
import VisualFX from '../visuals/VisualFX.js';
import BackgroundLayers from '../visuals/BackgroundLayers.js';
import HUD from '../ui/HUD.js';

export default class Game {
  constructor(containerId) {
    this._containerId = containerId;
    this._running = false;
    this._paused = false;
    this._dt = 0;
    this._lastTime = 0;
    this._unsubscribers = [];
    this._disposables = []; // geometries, materials, meshes to clean on restart
  }

  // ═════════════════════════════════════════════════════════════════════════
  // INIT
  // ═════════════════════════════════════════════════════════════════════════
  init() {
    LOG('Game', 'Initializing...');

    this._gs = new GameState();
    this._state = this._gs.state;

    // ── renderer ──────────────────────────────────────────────────────────
    const canvas = document.getElementById('gameCanvas');
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;
    this._disposables.push(this._renderer);

    // ── scene ─────────────────────────────────────────────────────────────
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(SCENE.BG_COLOR);
    this._scene.fog = new THREE.Fog(SCENE.FOG_COLOR, SCENE.FOG_NEAR, SCENE.FOG_FAR);

    // ── lighting ──────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(VISUAL.AMBIENT_COLOR, VISUAL.AMBIENT_INTENSITY);
    this._scene.add(ambient);

    // ── camera ────────────────────────────────────────────────────────────
    this._camera = new THREE.OrthographicCamera(
      -CAMERA.BASE_ZOOM * (window.innerWidth / window.innerHeight),
       CAMERA.BASE_ZOOM * (window.innerWidth / window.innerHeight),
       CAMERA.BASE_ZOOM,
      -CAMERA.BASE_ZOOM,
      CAMERA.NEAR, CAMERA.FAR
    );
    this._camera.position.set(0, 0, 20);

    // ── post-processing ───────────────────────────────────────────────────
    this._composer = new EffectComposer(this._renderer);
    this._composer.addPass(new RenderPass(this._scene, this._camera));
    this._bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      VISUAL.BLOOM_STRENGTH, VISUAL.BLOOM_RADIUS, VISUAL.BLOOM_THRESHOLD
    );
    this._composer.addPass(this._bloomPass);
    this._composer.addPass(new OutputPass());

    // ── systems ───────────────────────────────────────────────────────────
    this._input = new Input();
    this._input.init();
    this._cameraSys = new CameraSystem(this._camera);
    this._roomManager = new RoomManager(this._scene);
    this._enemyManager = new EnemyManager(this._scene);
    this._abilityManager = new AbilityManager(this._scene);
    this._player = new Player(this._scene);
    this._boss = new Boss();
    this._bgLayers = new BackgroundLayers(this._scene);
    this._visualFX = new VisualFX(this._scene, this._camera);
    this._hud = new HUD(this._gs);
    this._modelFactory = new ModelFactory();

    // ── event listeners ───────────────────────────────────────────────────
    this._setupEvents();

    // ── window resize ─────────────────────────────────────────────────────
    this._onResize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      this._renderer.setSize(w, h);
      this._camera.left = -CAMERA.BASE_ZOOM * (w / h);
      this._camera.right = CAMERA.BASE_ZOOM * (w / h);
      this._camera.top = CAMERA.BASE_ZOOM;
      this._camera.bottom = -CAMERA.BASE_ZOOM;
      this._camera.updateProjectionMatrix();
      this._composer.setSize(w, h);
    };
    window.addEventListener('resize', this._onResize);

    // ── start ─────────────────────────────────────────────────────────────
    this._startRun();
    this._running = true;
    this._lastTime = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);

    LOG('Game', 'Init complete. Starting loop.');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // START RUN — generates world, spawns player
  // ═════════════════════════════════════════════════════════════════════════
  _startRun() {
    LOG('Game', 'Starting new run...');
    const state = this._state;

    // Generate rooms
    this._roomManager.generate(state);
    state.roomsVisited.add('spawn');

    // Spawn player in spawn room, at spawn door position
    const spawnRoom = this._roomManager.getRoom('spawn');
    const spawnDoor = spawnRoom?.doors?.find(d => d.kind === 'spawn');
    let px = spawnDoor ? (spawnDoor.worldX ?? spawnDoor.x) : 0;
    let py = spawnDoor ? (spawnDoor.worldY ?? spawnDoor.y + 1) : 2;

    // Snap player onto the nearest floor platform beneath spawn point
    const playerHalfH = PLAYER_CFG.HEIGHT / 2;
    if (spawnRoom?.platforms) {
      let bestFloorY = -Infinity;
      for (const p of spawnRoom.platforms) {
        if (p.kind === 'floor' || p.kind === 'platform') {
          const topY = p.worldY + p.h / 2;
          if (topY <= py + playerHalfH && topY > bestFloorY) {
            bestFloorY = topY;
          }
        }
      }
      if (bestFloorY > -Infinity) {
        py = bestFloorY + playerHalfH;
      }
    }

    this._player.spawn(px, py);
    this._cameraSys.snap(px, py);

    // Set initial camera bounds
    const bounds = this._roomManager.getRoomBounds('spawn');
    this._cameraSys.setBounds(bounds);

    // Init enemies for spawn room
    this._enemyManager.loadRoom('spawn', spawnRoom?.enemies || []);

    // Init boss (iff boss room exists)
    const bossRoom = this._roomManager.getRoom('boss');
    if (bossRoom) {
      this._boss.init(this._scene, bossRoom);
    }

    // Init abilities in their rooms
    this._abilityManager.init(state, this._roomManager);

    // Background layers
    this._bgLayers.init();

    // HUD
    this._hud.init();

    this._state.gameOver = false;
    this._state.victory = false;
    this._state.paused = false;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // EVENT SETUP
  // ═════════════════════════════════════════════════════════════════════════
  _setupEvents() {
    const unsub = EventBus.on.bind(EventBus);
    this._unsubscribers.push(unsub('player:died', () => this._onPlayerDeath()));
    this._unsubscribers.push(unsub('boss:defeated', () => this._onVictory()));
    this._unsubscribers.push(unsub('ability:acquired', (name) => this._onAbilityAcquired(name)));
    this._unsubscribers.push(unsub('room:enter', ({ roomId }) => this._onRoomEnter(roomId)));
    this._unsubscribers.push(unsub('game:restart', () => this.restart()));
    this._unsubscribers.push(unsub('game:pause', () => this._setPaused(true)));
    this._unsubscribers.push(unsub('game:resume', () => this._setPaused(false)));

    // Keyboard shortcuts
    this._onKeyDown = (e) => {
      if (e.code === 'Escape') {
        if (this._state.gameOver) return;
        this._setPaused(!this._paused);
      }
      if (e.code === 'KeyR' && this._state.gameOver) {
        this.restart();
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // MAIN LOOP
  // ═════════════════════════════════════════════════════════════════════════
  _loop(now) {
    if (!this._running) return;
    requestAnimationFrame(this._loop);

    try {
      this._dt = Math.min((now - this._lastTime) / 1000, 0.05);
      this._lastTime = now;

      this._input.update();

      if (!this._paused && !this._state.gameOver) {
        this._tick(this._dt);
      }

      this._render();
    } catch (err) {
      LOG_ERR('Game', 'Fatal tick error:', err);
    }
  }

  _tick(dt) {
    const state = this._state;

    // ── player ────────────────────────────────────────────────────────────
    const room = this._roomManager.getRoom(state.currentRoomId);
    if (room) {
      const platforms = room.platforms || [];
      const doors = room.doors || [];
      this._player.update(dt, this._input, platforms, doors);
      this._cameraSys.follow(this._player, dt);
    }

    // ── enemies ───────────────────────────────────────────────────────────
    this._enemyManager.update(dt, this._player, state.currentRoomId);

    // ── boss ──────────────────────────────────────────────────────────────
    if (state.currentRoomId === 'boss') {
      this._boss.update(dt, this._player);
    } else {
      this._boss.pause();
    }

    // ── abilities ─────────────────────────────────────────────────────────
    this._abilityManager.update(dt, this._player);

    // ── combat: player attack vs enemies ─────────────────────────────────
    this._checkPlayerAttack();

    // ── visuals ──────────────────────────────────────────────────────────
    this._bgLayers.update(dt, this._player.x, this._player.y);

    // ── HUD ──────────────────────────────────────────────────────────────
    this._hud.update();

    // ── timing ────────────────────────────────────────────────────────────
    state.playTime += dt;
    state.roomTime += dt;
  }

  _render() {
    const t = performance.now() / 1000;

    // Update shader time uniforms globally
    this._scene.traverse(c => {
      if (c.material?.uniforms?.uTime) {
        c.material.uniforms.uTime.value = t;
      }
    });

    // Pulse door emissive
    for (const room of Object.values(this._roomManager._rooms || {})) {
      if (room._group) {
        room._group.traverse(c => {
          if (c.userData?.kind === 'door' && c.userData._baseEmissive != null) {
            const base = c.userData._locked ? 0.25 : c.userData._baseEmissive;
            c.material.emissiveIntensity = base + Math.sin(t * 3 + c.position.x) * 0.15;
          }
        });
      }
    }

    this._visualFX.update(1 / 60);
    this._composer.render();
    if (DEBUG.SHOW_FPS) {
      // FPS shown via HUD
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // COMBAT
  // ═════════════════════════════════════════════════════════════════════════
  _checkPlayerAttack() {
    if (!this._player.isAlive || !this._player.isAttacking) return;

    const px = this._player.x;
    const py = this._player.y;
    const dir = this._player.facingDir;
    const attackX = px + dir * 0.6;
    const attackW = 1.0;
    const attackH = 0.8;

    // Check enemies
    const enemies = this._enemyManager.getActive();
    for (const enemy of enemies) {
      if (enemy.dead || enemy.hitInvincible) continue;
      if (this._player._hitEnemiesThisSwing?.has(enemy.id)) continue;

      const ex = enemy.x, ey = enemy.y;
      const ew = 0.6, eh = 0.8;
      if (Math.abs(attackX - ex) < (attackW + ew) / 2 &&
          Math.abs(attackY - ey) < (attackH + eh) / 2) {
        this._player._hitEnemiesThisSwing.add(enemy.id);
        enemy.takeDamage(1, dir);
        this._visualFX.hitFlash(enemy.mesh);
        this._visualFX.emit('hitSpark', (attackX + ex) / 2, (attackY + ey) / 2, 4);
        LOG('Combat', `Player hit enemy ${enemy.type} id=${enemy.id}`);
      }
    }

    // Check boss
    if (this._state.currentRoomId === 'boss' && this._boss.isAlive) {
      const bx = this._boss.x, by = this._boss.y;
      const bw = 1.0, bh = 1.4;
      if (Math.abs(attackX - bx) < (attackW + bw) / 2 &&
          Math.abs(attackY - by) < (attackH + bh) / 2) {
        if (!this._boss.hitInvincible && !this._player._hitBossThisSwing) {
          this._player._hitBossThisSwing = true;
          this._boss.takeDamage(1, dir);
          this._visualFX.hitFlash(this._boss.mesh);
          LOG('Combat', 'Player hit boss');
        }
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═════════════════════════════════════════════════════════════════════════
  _onPlayerDeath() {
    LOG('Game', 'Player died.');
    this._state.gameOver = true;
    this._state.playerAlive = false;
    this._visualFX.screenShake(0.4, 8);
    this._hud.showGameOver();
  }

  _onVictory() {
    LOG('Game', 'Victory!');
    this._state.victory = true;
    this._state.gameOver = true;
    this._hud.showVictory();
  }

  _onAbilityAcquired(name) {
    LOG('Game', `Ability acquired: ${name}`);
    this._state.abilities.add(name);
    this._abilityManager._pickups = this._abilityManager._pickups.filter(p => !p.collected || p.group.visible);
    this._hud.showAbilityPopup(name);

    // Grant ability to player
    this._player.grantAbility(name);

    // Unlock any doors gated by this ability
    for (const [roomId, room] of Object.entries(this._roomManager._rooms || {})) {
      for (const d of room.doors || []) {
        if (d.requiresAbility === name && d.locked) {
          d.locked = false;
          LOG('Game', `Unlocked door in "${roomId}" → ${d.dest}`);
          // Update door visual color
          if (room._group) {
            room._group.traverse(c => {
              if (c.userData?.kind === 'door' && c.userData.doorData === d) {
                c.material.color.set(0x2266aa);
                c.material.emissive.set(0x2266aa);
              }
            });
          }
        }
      }
    }
  }

  _onRoomEnter(roomId) {
    LOG('Game', `Entering room: ${roomId}`);
    const prevRoom = this._state.currentRoomId;
    this._state.currentRoomId = roomId;
    this._state.roomsVisited.add(roomId);
    this._state.roomTime = 0;

    // Load enemies for this room
    const room = this._roomManager.getRoom(roomId);
    this._enemyManager.loadRoom(roomId, room?.enemies || []);

    // Update camera bounds
    const bounds = this._roomManager.getRoomBounds(roomId);
    this._cameraSys.setBounds(bounds);

    // Teleport player to the entry door of this room
    // Find the door that connects back to prevRoom
    const entryDoor = room?.doors?.find(d => d.dest === prevRoom || d.kind === 'spawn');
    if (entryDoor) {
      // Place player near the door, offset in the entry direction
      let px = entryDoor.worldX;
      let py = entryDoor.worldY;
      if (entryDoor.direction === 'left') px += 1.5;
      else if (entryDoor.direction === 'right') px -= 1.5;
      else if (entryDoor.direction === 'up') py -= 1.5;
      else if (entryDoor.direction === 'down') py += 1.5;
      else if (entryDoor.kind === 'spawn') { px = entryDoor.x; py = entryDoor.y; }

      this._player.spawn(px, py);
      this._cameraSys.snap(px, py);
    }
  }

  _setPaused(v) {
    if (this._paused === v) return;
    this._paused = v;
    this._state.paused = v;
    if (v) {
      this._hud.showPause();
    } else {
      this._hud.hidePause();
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // RESTART
  // ═════════════════════════════════════════════════════════════════════════
  restart() {
    LOG('Game', 'Restarting...');

    // Dispose Three.js resources
    this._bgLayers.dispose();
    this._enemyManager.dispose();
    this._abilityManager.dispose();
    this._player.dispose();
    this._boss.dispose();
    this._roomManager.dispose();
    this._hud.dispose();
    this._visualFX.reset();

    // Clear scene (except camera and lights)
    while (this._scene.children.length > 0) {
      const child = this._scene.children[0];
      this._scene.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }

    // Re-add ambient light
    const ambient = new THREE.AmbientLight(VISUAL.AMBIENT_COLOR, VISUAL.AMBIENT_INTENSITY);
    this._scene.add(ambient);

    // Reset state
    this._gs.reset();
    this._state = this._gs.state;
    EventBus.clear();

    // Re-init systems
    this._input.reset();
    this._player = new Player(this._scene);
    this._enemyManager = new EnemyManager(this._scene);
    this._abilityManager = new AbilityManager(this._scene);
    this._boss = new Boss();
    this._bgLayers = new BackgroundLayers(this._scene);
    this._visualFX = new VisualFX(this._scene, this._camera);
    this._hud = new HUD(this._gs);

    // Re-setup events
    this._unsubscribers = [];
    this._setupEvents();

    this._startRun();
    LOG('Game', 'Restart complete.');
  }
}

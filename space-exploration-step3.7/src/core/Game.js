// ============================================================
// Game — Orchestrator: init, loop, shutdown, restart
// ============================================================
import * as THREE from 'three';
import InputSystem from '../systems/InputSystem.js';
import CameraSystem from '../systems/CameraSystem.js';
import PhysicsSystem from '../systems/PhysicsSystem.js';
import AudioSystem from '../systems/AudioSystem.js';
import ParticleSystem from '../systems/ParticleSystem.js';
import PostProcessingSystem from '../systems/PostProcessingSystem.js';
import PlayerShip from '../gameplay/PlayerShip.js';
import WeaponSystem from '../gameplay/WeaponSystem.js';
import ScoreSystem from '../gameplay/ScoreSystem.js';
import BuffSystem from '../gameplay/BuffSystem.js';
import Starfield from '../level/Starfield.js';
import ChunkManager from '../level/ChunkManager.js';
import HUD from '../ui/HUD.js';
import Crosshair from '../ui/Crosshair.js';
import GameState from './GameState.js';
import EventBus from './EventBus.js';
import Constants from './Constants.js';
import { Events } from './EventBus.js';

class Game {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this._isRunning = false;
    this._isPaused = true;
    this._clock = performance.now();
    this._delta = 0;
    this._fpsCounter = { frames: 0, lastTime: 0 };
    this._unsubscribers = [];
    this._lastHealth = 100;
    this._projectileHitsProcessed = new Set();
  }

  init() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(Constants.SCENE.BACKGROUND_COLOR);
    this.scene.fog = new THREE.FogExp2(Constants.SCENE.FOG_COLOR, Constants.SCENE.FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(
      Constants.CAMERA.START_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, Constants.CAMERA.FOLLOW_HEIGHT, -Constants.CAMERA.FOLLOW_DISTANCE);

    this._setupLighting();
    this._initSystems();
    this._setupEvents();
    this._showPauseScreen();

    console.log('[Game] Initialized (paused). Press SPACE to start.');
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0x0b1020, 0.5);
    this.scene.add(ambient);

    this.sunLight = new THREE.DirectionalLight(0xaaccff, 0.9);
    this.sunLight.position.set(-60, 40, -40);
    this.scene.add(this.sunLight);

    const fill = new THREE.DirectionalLight(0x446688, 0.4);
    fill.position.set(40, 15, 50);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x224477, 0.25);
    rim.position.set(-20, -10, 20);
    this.scene.add(rim);
  }

  _initSystems() {
    this.input = new InputSystem();
    this.input.init();

    this.cameraSystem = new CameraSystem(this.camera, this.scene);
    this.cameraSystem.init();

    this.physics = new PhysicsSystem();

    this.audio = new AudioSystem();
    this.audio.init();

    this.particles = new ParticleSystem(this.scene);
    this.particles.init();

    this.postProcessing = new PostProcessingSystem(this.renderer, this.camera, this.scene);
    this.postProcessing.init();

    this.playerShip = new PlayerShip(this.scene);
    this.playerShip.init();

    this.weapon = new WeaponSystem(this.scene);
    this.weapon.init();

    this.score = new ScoreSystem();
    this.score.init();

    this.buffs = new BuffSystem();
    this.buffs.init();

    this.starfield = new Starfield(this.scene);
    this.starfield.init();

    this.chunkManager = new ChunkManager(this.scene, this.camera);
    this.chunkManager.init();

    this.hud = new HUD();
    this.hud.init();

    this.crosshair = new Crosshair();
    this.crosshair.init();
  }

  _setupEvents() {
    const onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postProcessing.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    this._unsubscribers.push(() => window.removeEventListener('resize', onResize));

    this._unsubscribers.push(EventBus.on('input:keydown', (code) => {
      if (code === Constants.INPUT.RESTART && !GameState.isAlive) {
        this._restart();
      }
      if (code === 'KeyM') {
        this.audio.toggleMute();
      }
    }));

    this._unsubscribers.push(EventBus.on('audio:laser', () => this.audio.playLaser()));
    this._unsubscribers.push(EventBus.on('audio:collision', () => this.audio.playCollision()));
    this._unsubscribers.push(EventBus.on('audio:explosion', (size) => this.audio.playExplosion(size)));
    this._unsubscribers.push(EventBus.on('audio:warning', () => this.audio.playWarning()));

    this._unsubscribers.push(EventBus.on('physics:collision', () => {
      this.hud.damageFlash();
      this.hud.screenFlash('#ff4444', 150);
    }));

    this._unsubscribers.push(EventBus.on('camera:shake', (amount) => this.cameraSystem.triggerShake(amount)));

    this._unsubscribers.push(EventBus.on('weapon:destroy', (data) => this.score.awardDestruction(data.type, data.size)));
  }

  _attemptFire() {
    if (!GameState.isAlive) return;
    this.weapon.fire(this.playerShip.mesh, this._delta, this.particles);
  }

  _animate() {
    if (!this._isRunning) return;
    requestAnimationFrame(() => this._animate());

    const now = performance.now();
    this._delta = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    GameState.game.time += this._delta;
    this.input.update(this._delta);
    EventBus.emit('game:tick');

    const isThrusting = this.physics.updatePlayerPhysics(
      this.playerShip.mesh,
      this.input,
      this._delta
    );

    this.playerShip.updateRotation(this._delta, this.input);
    this.playerShip.updateEngineFlames(isThrusting);
    this.playerShip.updateHitFlash(this._delta);

    this.cameraSystem.update(this.playerShip.mesh, this._delta);

    const speedRatio = Math.min(
      this.playerShip.mesh.userData.velocity.length() / Constants.SHIP.MAX_SPEED,
      1
    );
    this.audio.updateEngine(isThrusting, speedRatio);

    if (this.input.isPressed(Constants.INPUT.FIRE)) {
      this._attemptFire();
    }
    this.weapon.update(this._delta, this.particles);

    this.starfield.update(this.playerShip.mesh.position, speedRatio, this._delta);
    this.chunkManager.update(this.playerShip.mesh.position, this._delta);

    if (isThrusting) {
      if (!this._exhaustDir) {
        this._exhaustDir = new THREE.Vector3(0, 0, 1);
        this._exhaustOrigin = new THREE.Vector3();
        this._exhaustOffset = new THREE.Vector3();
      }
      this._exhaustDir.set(0, 0, 1).applyQuaternion(this.playerShip.mesh.quaternion);
      this._exhaustOrigin.copy(this.playerShip.mesh.position).add(
        this._exhaustOffset.copy(this._exhaustDir).multiplyScalar(1.5)
      );
      this.particles.spawnExhaust(
        this._exhaustOrigin,
        this._exhaustDir,
        Math.ceil(3 + speedRatio * 5),
        speedRatio
      );
    }
    this.particles.update(this._delta);

    const destructibles = this.chunkManager.getDestructibles();
    const shipCollisions = this.physics.checkShipCollisions(
      this.playerShip.mesh, destructibles
    );

    for (const collision of shipCollisions) {
      this.physics.handleCollision(this.playerShip.mesh, collision);
      EventBus.emit('audio:collision', {});
    }

    const projectiles = this.weapon.getProjectiles();
    const hits = this.physics.checkProjectileCollisions(projectiles, destructibles);

    for (const hit of hits) {
      const hitKey = `${hit.projectileIndex}-${hit.targetIndex}`;
      if (this._projectileHitsProcessed.has(hitKey)) continue;
      this._projectileHitsProcessed.add(hitKey);

      const proj = projectiles[hit.projectileIndex];
      if (!proj || !proj.mesh || !this.scene.children.includes(proj.mesh)) continue;

      if (!hit.target.isInstanced && hit.target.userData) {
        const isAsteroid = hit.target.userData.size > 0.3;
        const type = isAsteroid ? 'asteroid' : 'debris';
        const size = hit.target.userData.size || 1;

        hit.target.userData.isDestroyed = true;
        this.particles.createExplosion(hit.target.position.clone(), size);
        EventBus.emit('audio:explosion', size);
        EventBus.emit('weapon:destroy', { type, size });
        EventBus.emit('camera:shake', isAsteroid ? 0.5 : 0.2);
        this.hud.screenFlash(isAsteroid ? '#ffaa00' : '#888888', isAsteroid ? 80 : 50);
        this.chunkManager.destroyAsteroid(hit.target);
      }

      if (proj.mesh && this.scene.children.includes(proj.mesh)) {
        this.scene.remove(proj.mesh);
        proj.mesh.geometry.dispose();
        proj.mesh.material.dispose();
      }
      const idx = this.weapon._projectiles.indexOf(proj);
      if (idx >= 0) {
        this.weapon._projectiles.splice(idx, 1);
      }

      this.particles.createSparks(proj.mesh.position.clone());
    }

    this.postProcessing.updateChromaticAberration(speedRatio);
    this.postProcessing.updateBloom(speedRatio);
    this.postProcessing.updateFilmGrain(GameState.game.time);

    this.score.updateHUD();
    this.score.updateDistanceScore(this._delta);

    this.buffs.update(this._delta);

    if (GameState.health <= 0 && GameState.isAlive) {
      GameState.takeDamage(0);
      EventBus.emit('game:gameover');
    }

    if (!GameState.isAlive) {
      this.hud.showGameOver(GameState.score, GameState.highScore);
      this._isRunning = false;
    }

    this.postProcessing.render();
  }

  _showPauseScreen() {
    const pauseDiv = document.createElement('div');
    pauseDiv.id = 'pause-screen';
    pauseDiv.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.35); z-index: 50; display: flex; align-items: center; justify-content: center; flex-direction: column; color: #aaccff; font-family: Courier New, monospace; text-shadow: 0 0 12px rgba(100,150,255,0.8); pointer-events: none;';
    pauseDiv.innerHTML = '<h1 style="font-size: 44px; margin-bottom: 18px;">PAUSED - Press SPACE to start</h1><p style="font-size: 18px; opacity: 0.8;">Mouse to steer | Z=forward, S=backward | Q/D=strafe | A/E=up/down | Space=fire</p>';
    document.body.appendChild(pauseDiv);

    this._unpauseHandler = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        const el = document.getElementById('pause-screen');
        if (el) document.body.removeChild(el);
        window.removeEventListener('keydown', this._unpauseHandler);
        this._isPaused = false;
        this._isRunning = true;
        this._lastTime = performance.now();
        this._animate();
      }
    };
    window.addEventListener('keydown', this._unpauseHandler);

    this.renderer.render(this.scene, this.camera);
  }

  _restart() {
    this._isRunning = false;
    this.hud.hideGameOver();
    this.playerShip.destroy();
    this.weapon.clear();
    this.particles.destroy();
    this.starfield.destroy();
    this.chunkManager.destroy();
    this.postProcessing.composer?.dispose();
    this._disposeScene();

    this.scene.clear();
    this._setupLighting();

    GameState.restart();
    EventBus.emit('game:restart');
    this.score.reset();
    this.buffs.clearAll();
    this._projectileHitsProcessed.clear();
    this._lastTime = performance.now();

    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
    this._setupEvents();

    this._isRunning = true;
    this._animate();
  }

  _disposeScene() {
    const toDispose = [];
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.scene.clear();
  }

  shutdown() {
    this._isRunning = false;
    this.input.destroy();
    this.audio.destroy();
    this.particles.destroy();
    this.playerShip.destroy();
    this.weapon.clear();
    this.starfield.destroy();
    this.chunkManager.destroy();
    for (const unsub of this._unsubscribers) unsub();
    this._unsubscribers = [];
  }
}

export default Game;

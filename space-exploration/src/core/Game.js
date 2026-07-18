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

class Game {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this._isRunning = false;
    this._clock = new THREE.Clock();
    this._delta = 0;
    this._fpsCounter = { frames: 0, lastTime: 0 };
    this._isMouseDown = false;
    this._projectileHitsProcessed = new Set();
  }

  /**
   * Initialize all systems in order
   */
  init() {
    // 1. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.container.appendChild(this.renderer.domElement);

    // 2. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(Constants.SCENE.BACKGROUND_COLOR);
    this.scene.fog = new THREE.FogExp2(Constants.SCENE.FOG_COLOR, Constants.SCENE.FOG_DENSITY);

    // 3. Camera
    this.camera = new THREE.PerspectiveCamera(
      Constants.CAMERA.START_FOV,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, Constants.CAMERA.FOLLOW_HEIGHT, -Constants.CAMERA.FOLLOW_DISTANCE);

    // 4. Lighting
    this._setupLighting();

    // 5. Systems
    this._initSystems();

    // 6. Event listeners
    this._setupEvents();

    // 7. Start loop
    this._isRunning = true;
    this._lastTime = performance.now();
    this._animate();

    // Emit game start
    EventBus.emit('game:start', {});

    console.log('[Game] Initialized successfully');
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

  _setupLighting() {
    // Ambient (very dim)
    const ambient = new THREE.AmbientLight(0x112244, 0.05);
    this.scene.add(ambient);

    // Directional (sun)
    this.sunLight = new THREE.DirectionalLight(0x8899cc, 0.8);
    this.sunLight.position.set(50, 30, -50);
    this.scene.add(this.sunLight);

    // Secondary fill light
    const fill = new THREE.DirectionalLight(0x334466, 0.2);
    fill.position.set(-30, -20, 30);
    this.scene.add(fill);
  }

  _setupEvents() {
    // Resize handler
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postProcessing.resize(window.innerWidth, window.innerHeight);
    });

    // Input: fire
    EventBus.on('input:keydown', (code) => {
      if (code === Constants.INPUT.FIRE) {
        this._attemptFire();
      }
      if (code === Constants.INPUT.RESTART && GameState.isGameOver) {
        this._restart();
      }
    });

    // Input: mouse fire (continuous while held)
    EventBus.on('input:mouse_down', () => {
      this._isMouseDown = true;
    });

    EventBus.on('input:mouse_up', () => {
      this._isMouseDown = false;
    });

    // Audio events
    EventBus.on('audio:laser', () => {
      this.audio.playLaser();
    });

    EventBus.on('audio:collision', () => {
      this.audio.playCollision();
    });

    EventBus.on('audio:warning', () => {
      this.audio.playWarning();
    });

    // Physics collision
    EventBus.on('physics:collision', (data) => {
      this.hud.damageFlash();
      this.hud.screenFlash('#ff4444', 150);
    });

    // Camera shake
    EventBus.on('camera:shake', (amount) => {
      this.cameraSystem.triggerShake(amount);
    });

    // Score destruction
    EventBus.on('weapon:destroy', (type) => {
      this.score.awardDestruction(type);
    });

    // Game over
    EventBus.on('game:gameover', () => {
      this._isRunning = false;
    });
  }

  _attemptFire() {
    if (!GameState.isAlive) return;
    const dt = this._delta;
    this.weapon.fire(this.playerShip.mesh, dt, this.particles);
  }

  /**
   * Main game loop
   */
  _animate() {
    if (!this._isRunning) return;

    requestAnimationFrame(() => this._animate());

    // Delta time calculation
    const now = performance.now();
    this._delta = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Update game time
    GameState.game.time += this._delta;

    // --- Input ---
    const thrusting = this.input.shouldFire() ||
                      this.input.isPressed(Constants.INPUT.FORWARD);

    // --- Player Physics ---
    const isThrusting = this.physics.updatePlayerPhysics(
      this.playerShip.mesh, this.input, this._delta
    );

    // --- Ship Rotation ---
    this.playerShip.updateRotation(this._delta, this.input.getRollInput());
    this.playerShip.updateEngineFlames(isThrusting);
    this.playerShip.updateHitFlash(this._delta);

    // --- Camera ---
    this.cameraSystem.update(this.playerShip.mesh, this._delta);

    // --- Engine Rumble ---
    const speedRatio = this.playerShip.mesh.userData.velocity.length() / Constants.SHIP.MAX_SPEED;
    this.audio.updateEngine(isThrusting, speedRatio);

    // --- Weapon ---
    if (this.input.shouldFire()) {
      this._attemptFire();
    }
    this.weapon.update(this._delta, this.particles);

    // --- Starfield ---
    this.starfield.update(this.playerShip.mesh.position, speedRatio, this._delta);

    // --- Chunk/World ---
    this.chunkManager.update(this.playerShip.mesh.position, this._delta);

    // --- Particles ---
    if (isThrusting) {
      const exhaustDir = new THREE.Vector3(0, 0, 1);
      exhaustDir.applyQuaternion(this.playerShip.mesh.quaternion);
      this.particles.spawnExhaust(
        this.playerShip.mesh.position.clone().add(exhaustDir.clone().multiplyScalar(1.5)),
        exhaustDir,
        Math.ceil(3 + speedRatio * 5),
        speedRatio
      );
    }
    this.particles.update(this._delta);

    // --- Collision Detection ---
    const destructibles = this.chunkManager.getDestructibles();
    const shipCollisions = this.physics.checkShipCollisions(this.playerShip.mesh, destructibles);

    for (const collision of shipCollisions) {
      this.physics.handleCollision(this.playerShip.mesh, collision);
      EventBus.emit('audio:collision', {});
    }

    // --- Projectile Collisions ---
    const projectiles = this.weapon.getProjectiles();
    const hits = this.physics.checkProjectileCollisions(projectiles, destructibles);

    for (const hit of hits) {
      // Skip if already processed this hit
      const hitKey = `${hit.projectileIndex}-${hit.targetIndex}`;
      if (this._projectileHitsProcessed.has(hitKey)) continue;
      this._projectileHitsProcessed.add(hitKey);

      const proj = projectiles[hit.projectileIndex];
      if (!proj || !this.scene.children.includes(proj.mesh)) continue;

      // Destroy target (only non-instanced)
      if (!hit.target.isInstanced && hit.target.userData) {
        hit.target.userData.isDestroyed = true;
        // Explosion particles
        this.particles.createExplosion(hit.target.position.clone(), hit.target.userData.size || 1);
        EventBus.emit('audio:explosion', {});
        this.audio.playExplosion(hit.target.userData.size || 1);
        // Score
        EventBus.emit('weapon:destroy', 'asteroid');
        this.score.awardDestruction('asteroid');
        // Camera shake
        EventBus.emit('camera:shake', 0.5);
        this.hud.screenFlash('#ffaa00', 80);
        // Remove from scene
        this.chunkManager.destroyAsteroid(hit.target);
      }

      // Remove projectile
      if (this.scene.children.includes(proj.mesh)) {
        this.scene.remove(proj.mesh);
        proj.mesh.geometry.dispose();
        proj.mesh.material.dispose();
      }
      this.weapon._projectiles.splice(hit.projectileIndex, 1);

      // Spark impact
      this.particles.createSparks(proj.mesh.position.clone());
    }

    // --- Post-Processing ---
    this.postProcessing.updateChromaticAberration(speedRatio);
    this.postProcessing.updateBloom(speedRatio);
    this.postProcessing.updateFilmGrain(GameState.game.time);

    // --- Score HUD ---
    // Distance is tracked in PhysicsSystem based on actual position delta

    // --- Game Over check ---
    if (GameState.health <= 0 && GameState.isAlive) {
      GameState.takeDamage(0); // triggers game over
    }

    // --- Game Over UI ---
    if (!GameState.isAlive) {
      this.hud.showGameOver(GameState.score, GameState.highScore);
    }

    // --- Render ---
    this.postProcessing.render();

    // --- FPS counter ---
    this._fpsCounter.frames++;
    if (now - this._fpsCounter.lastTime >= 1000) {
      // Uncomment for FPS debugging:
      // console.log(`FPS: ${this._fpsCounter.frames}`);
      this._fpsCounter.frames = 0;
      this._fpsCounter.lastTime = now;
    }
  }

  /**
   * Restart the game
   */
  _restart() {
    // Stop the loop
    this._isRunning = false;

    // Hide game over screen
    this.hud.hideGameOver();

    // Clean up all systems
    this.playerShip.destroy();
    this.weapon.clear();
    this.particles.destroy();
    this.starfield.destroy();
    this.chunkManager.destroy();
    this.postProcessing.composer?.dispose();

    // Clear scene
    this.scene.clear();
    this._setupLighting();

    // Reset state
    GameState.restart();
    this.score.reset();
    this._projectileHitsProcessed.clear();
    this._lastTime = performance.now();

    // Re-initialize all systems
    this._initSystems();

    // Restart the loop
    this._isRunning = true;
    this._animate();
  }

  /**
   * Shutdown all systems
   */
  shutdown() {
    this._isRunning = false;
    this.input.destroy();
    this.audio.destroy();
    this.particles.destroy();
    this.playerShip.destroy();
    this.weapon.clear();
    this.starfield.destroy();
    this.chunkManager.destroy();
  }
}

export default Game;

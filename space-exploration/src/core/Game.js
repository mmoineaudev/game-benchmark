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
    this._unsubscribers = [];
    this._lastHealth = 100;
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
    const onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.postProcessing.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    this._unsubscribers.push(() => window.removeEventListener('resize', onResize));

    // Input: fire (spacebar only) — handled via isPressed in game loop, not event
    this._unsubscribers.push(EventBus.on('input:keydown', (code) => {
      if (code === Constants.INPUT.RESTART && !GameState.isAlive) {
        this._restart();
      }
      // Mute toggle
      if (code === 'KeyM') {
        this.audio.toggleMute();
      }
    }));

    // Audio events
    this._unsubscribers.push(EventBus.on('audio:laser', () => {
      this.audio.playLaser();
    }));

    this._unsubscribers.push(EventBus.on('audio:collision', () => {
      this.audio.playCollision();
    }));

    // Audio: explosion
    this._unsubscribers.push(EventBus.on('audio:explosion', (size) => {
      this.audio.playExplosion(size);
    }));

    // Audio: warning beep
    this._unsubscribers.push(EventBus.on('audio:warning', () => {
      this.audio.playWarning();
    }));

    // Physics collision
    this._unsubscribers.push(EventBus.on('physics:collision', (data) => {
      this.hud.damageFlash();
      this.hud.screenFlash('#ff4444', 150);
    }));

    // Camera shake
    this._unsubscribers.push(EventBus.on('camera:shake', (amount) => {
      this.cameraSystem.triggerShake(amount);
    }));

    // Score destruction
    this._unsubscribers.push(EventBus.on('weapon:destroy', (data) => {
      this.score.awardDestruction(data.type, data.size);
    }));

    // Game over
    this._unsubscribers.push(EventBus.on('game:gameover', () => {
      this._isRunning = false;
    }));

    // Mute feedback
    this._unsubscribers.push(EventBus.on('audio:mute', (muted) => {
      console.log(`[Game] Audio ${muted ? 'muted' : 'unmuted'}`);
    }));
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

    // Delta time calculation (capped to prevent death spiral on tab-out)
    const now = performance.now();
    this._delta = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    // Update game time
    GameState.game.time += this._delta;

    // --- Input ---
    const thrusting = this.input.isPressed(Constants.INPUT.FORWARD);

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
    const speedRatio = Math.min(
      this.playerShip.mesh.userData.velocity.length() / Constants.SHIP.MAX_SPEED,
      1
    );
    this.audio.updateEngine(isThrusting, speedRatio);

    // --- Weapon ---
    if (this.input.isPressed(Constants.INPUT.FIRE)) {
      this._attemptFire();
    }
    this.weapon.update(this._delta, this.particles);

    // --- Starfield ---
    this.starfield.update(this.playerShip.mesh.position, speedRatio, this._delta);

    // --- Chunk/World ---
    this.chunkManager.update(this.playerShip.mesh.position, this._delta);

    // --- Exhaust particles ---
    if (isThrusting) {
      const exhaustDir = new THREE.Vector3(0, 0, 1);
      exhaustDir.applyQuaternion(this.playerShip.mesh.quaternion);
      this.particles.spawnExhaust(
        this.playerShip.mesh.position.clone().add(
          exhaustDir.clone().multiplyScalar(1.5)
        ),
        exhaustDir,
        Math.ceil(3 + speedRatio * 5),
        speedRatio
      );
    }
    this.particles.update(this._delta);

    // --- Collision Detection ---
    const destructibles = this.chunkManager.getDestructibles();
    const shipCollisions = this.physics.checkShipCollisions(
      this.playerShip.mesh, destructibles
    );

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
      if (!proj || !proj.mesh || !this.scene.children.includes(proj.mesh)) continue;

      // Destroy target (only non-instanced)
      if (!hit.target.isInstanced && hit.target.userData) {
        const isAsteroid = hit.target.userData.size > 0.3;
        const type = isAsteroid ? 'asteroid' : 'debris';
        const size = hit.target.userData.size || 1;

        hit.target.userData.isDestroyed = true;
        // Explosion particles
        this.particles.createExplosion(hit.target.position.clone(), size);
        EventBus.emit('audio:explosion', size);
        this.audio.playExplosion(size);
        // Score
        EventBus.emit('weapon:destroy', { type, size });
        this.score.awardDestruction(type, size);
        // Camera shake
        EventBus.emit('camera:shake', isAsteroid ? 0.5 : 0.2);
        this.hud.screenFlash(isAsteroid ? '#ffaa00' : '#888888', isAsteroid ? 80 : 50);
        // Remove from scene
        if (isAsteroid) {
          this.chunkManager.destroyAsteroid(hit.target);
        }
      }

      // Remove projectile
      if (proj.mesh && this.scene.children.includes(proj.mesh)) {
        this.scene.remove(proj.mesh);
        proj.mesh.geometry.dispose();
        proj.mesh.material.dispose();
      }
      // Remove from projectile array
      const idx = this.weapon._projectiles.indexOf(proj);
      if (idx >= 0) {
        this.weapon._projectiles.splice(idx, 1);
      }

      // Spark impact
      this.particles.createSparks(proj.mesh.position.clone());
    }

    // --- Post-Processing ---
    this.postProcessing.updateChromaticAberration(speedRatio);
    this.postProcessing.updateBloom(speedRatio);
    this.postProcessing.updateFilmGrain(GameState.game.time);

    // --- Score HUD (distance + score) ---
    this.score.updateHUD();
    this.score.updateDistanceScore(this._delta);

    // --- Buffs ---
    this.buffs.update(this._delta);

    // --- Health System ---
    this._checkHealth();
    if (GameState.health <= 0 && GameState.isAlive) {
      GameState.takeDamage(0); // ensure game over state
      EventBus.emit('game:gameover');
    }
    EventBus.emit('game:tick');

    // --- Game Over check ---
    if (!GameState.isAlive && this._isRunning) {
      this._isRunning = false;
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
      this._fpsCounter.frames = 0;
      this._fpsCounter.lastTime = now;
    }
  }

  /**
   * Health system — check for game over and warning beeps
   */
  _checkHealth() {
    const health = GameState.health;
    // Warning beep when health drops below threshold
    if (health <= Constants.HEALTH.WARNING_THRESHOLD && GameState.isAlive) {
      EventBus.emit('audio:warning', {});
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

    // Clear scene and dispose everything
    this._disposeScene();

    // Re-setup lighting
    this.scene.clear();
    this._setupLighting();

    // Reset state
    GameState.restart();
    EventBus.emit('game:restart');
    this.score.reset();
    this.buffs.clearAll();
    this._projectileHitsProcessed.clear();
    this._lastHealth = 100;
    this._lastTime = performance.now();

    // Re-initialize all systems
    this._initSystems();

    // Re-setup event listeners (remove old ones, add new ones)
    for (const unsub of this._unsubscribers) {
      unsub();
    }
    this._unsubscribers = [];
    this._setupEvents();

    // Restart the loop
    this._isRunning = true;
    this._animate();
  }

  /**
   * Dispose all objects in the scene
   */
  _disposeScene() {
    const toDispose = [];
    this.scene.traverse(obj => {
      toDispose.push(obj);
    });
    for (const obj of toDispose) {
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    }
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
    for (const unsub of this._unsubscribers) {
      unsub();
    }
    this._unsubscribers = [];
  }
}

export default Game;

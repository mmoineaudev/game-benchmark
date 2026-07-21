// VOID DRIFT — Game.js
// God-object orchestrator: renderer, systems, frame loop, restart, overlays.

import * as THREE from 'three';
import * as Constants from './Constants.js';
import { EventBus } from './EventBus.js';
import { GameState } from './GameState.js';
import { InputSystem } from '../systems/InputSystem.js';
import { CameraSystem } from '../systems/CameraSystem.js';
import { PhysicsSystem } from '../systems/PhysicsSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { PostProcessingSystem } from '../systems/PostProcessingSystem.js';
import { PlayerShip } from '../gameplay/PlayerShip.js';
import { WeaponSystem } from '../gameplay/WeaponSystem.js';
import { ScoreSystem } from '../gameplay/ScoreSystem.js';
import { Starfield } from '../level/Starfield.js';
import { ShootingStarManager } from '../level/ShootingStarManager.js';
import { ChunkManager } from '../level/ChunkManager.js';
import { AsteroidField } from '../level/AsteroidField.js';
import { DebrisSystem } from '../level/DebrisSystem.js';
import { CollectibleSystem } from '../level/CollectibleSystem.js';
import { NebulaSystem } from '../level/NebulaSystem.js';
import { PlanetManager } from '../level/PlanetManager.js';
import { NPCShipManager } from '../level/NPCShipManager.js';
import { HUD } from '../ui/HUD.js';
import { Crosshair } from '../ui/Crosshair.js';

export class Game {
  constructor(containerId) {
    this._container = document.getElementById(containerId);
    this._isRunning = false;
    this._lastTime = 0;
    this._unsubscribers = [];
    // Scratch vectors.
    this._backDir = new THREE.Vector3();
    this._rightDir = new THREE.Vector3();
    this._exhaustOrigin = new THREE.Vector3();
  }

  init() {
    this._initRenderer();
    this._initScene();
    this._initSystems();
    this._setupEvents();
    this._showPauseScreen();
    this._lastTime = performance.now();
    this._isRunning = true;
    this._animate();
  }

  // ---------------------------------------------------------------- setup
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this._container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      Constants.CAMERA.MIN_FOV, window.innerWidth / window.innerHeight, 0.1, 5000);
    this.camera.position.set(0, 8, 16);

    this._onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.postProcessing) this.postProcessing.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', this._onResize);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(Constants.SCENE.BACKGROUND_COLOR);
    this.scene.fog = new THREE.FogExp2(Constants.SCENE.FOG_COLOR, Constants.SCENE.FOG_DENSITY);
    this._setupLighting();
  }

  _setupLighting() {
    const L = Constants.LIGHTING;
    this.scene.add(new THREE.AmbientLight(L.AMBIENT_COLOR, L.AMBIENT_INTENSITY));
    const sun = new THREE.DirectionalLight(L.SUN_COLOR, L.SUN_INTENSITY);
    sun.position.set(50, 80, 30);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(L.FILL_COLOR, L.FILL_INTENSITY);
    fill.position.set(-60, 20, -40);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(L.RIM_COLOR, L.RIM_INTENSITY);
    rim.position.set(0, -40, 60);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(L.HEMI_SKY, L.HEMI_GROUND, L.HEMI_INTENSITY));
  }

  _initSystems() {
    this.input = new InputSystem();
    this.input.init(this._container);

    this.cameraSystem = new CameraSystem(this.camera);
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
    this.weapon.init(EventBus);

    this.score = new ScoreSystem();
    this.score.init();

    this.starfield = new Starfield(this.scene);
    this.starfield.init();

    this.shootingStars = new ShootingStarManager(this.scene);

    this.asteroids = new AsteroidField(this.scene);
    this.debris = new DebrisSystem(this.scene);
    this.collectibles = new CollectibleSystem(this.scene);
    this.nebula = new NebulaSystem(this.scene);
    this.planets = new PlanetManager(this.scene);
    this.npcs = new NPCShipManager(this.scene);
    this.npcs.init();

    this.chunkManager = new ChunkManager(this.scene, {
      asteroids: this.asteroids,
      debris: this.debris,
      collectibles: this.collectibles,
      nebula: this.nebula,
      npcs: this.npcs,
    });
    this.chunkManager.init();

    this.hud = new HUD();
    this.hud.init(this.camera);

    this.crosshair = new Crosshair();
    this.crosshair.init();
  }

  _setupEvents() {
    this._unsubscribers.push(EventBus.on('camera:zoom', (d) => this.cameraSystem.applyZoom(d)));
    this._unsubscribers.push(EventBus.on('input:keydown', (code) => {
      if (code === Constants.INPUT.MUTE) {
        const muted = this.audio.toggleMute();
        this.hud.showToast(muted ? 'MUTED' : 'SOUND ON');
      }
      if (code === Constants.INPUT.FIRE && GameState.game.isPaused && !GameState.game.isGameOver) {
        this._startRun();
      }
      if (code === Constants.INPUT.RESTART && !GameState.player.isAlive) {
        this._restart();
      }
    }));
    // Click also starts the run from pause (and captures pointer lock).
    this._onClickStart = () => {
      if (GameState.game.isPaused && !GameState.game.isGameOver) this._startRun();
    };
    this._container.addEventListener('click', this._onClickStart);
  }

  // ---------------------------------------------------------------- overlays
  _showPauseScreen() {
    const legend = document.getElementById('controls-legend');
    if (legend && legend.childElementCount === 0) {
      legend.innerHTML = Constants.CONTROLS_LEGEND
        .map(([k, v]) => `<div><b>${k}</b> ${v}</div>`).join('');
    }
    document.getElementById('pause-screen').classList.remove('hidden');
  }

  _hidePauseScreen() {
    document.getElementById('pause-screen').classList.add('hidden');
  }

  _startRun() {
    GameState.game.isPaused = false;
    this._hidePauseScreen();
    this.audio.resume();
    EventBus.emit('input:request-pointer-lock');
  }

  // ---------------------------------------------------------------- loop
  _animate() {
    if (!this._isRunning) return;
    requestAnimationFrame(() => this._animate());

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    try {
      this._tick(dt, now / 1000);
    } catch (err) {
      console.error('[Game] Fatal tick error:', err);
    }

    this.postProcessing.render();
  }

  _tick(dt, time) {
    if (GameState.game.isPaused) return;
    if (!GameState.player.isAlive) return;

    GameState.game.time += dt;
    const gameTime = GameState.game.time;

    // Input.
    this.input.update(dt);

    // Physics + rotation.
    this.physics.updatePlayerPhysics(this.playerShip.mesh, this.input, dt);
    this.playerShip.updateRotation(dt, this.input);
    this.playerShip.updateEngineFlames(dt, this.input, gameTime);

    // Camera.
    this.cameraSystem.update(this.playerShip.mesh, dt);

    // Weapons.
    const fired = this.weapon.tryFire(
      this.playerShip.mesh, gameTime, this.input.isPressed(Constants.INPUT.FIRE));
    if (fired) this.audio.playLaser();
    this.weapon.update(dt, gameTime);

    // World.
    const shipPos = this.playerShip.mesh.position;
    const vel = this.playerShip.mesh.userData.velocity;
    const speedRatio = Math.min(vel.length() / Constants.SHIP.MAX_SPEED, 1);

    this.starfield.update(shipPos, speedRatio);
    this.chunkManager.update(shipPos, gameTime);
    this.shootingStars.update(shipPos, gameTime, dt);
    this.planets.update(shipPos, dt);
    this.npcs.update(shipPos, dt);
    this.asteroids.update(dt);
    this.nebula.update(dt, this.camera);
    const pickups = this.collectibles.update(dt, gameTime, shipPos);
    for (const p of pickups) {
      this.score.awardCollectible(p.type);
      this.particles.spawnSparkle(p.position, p.type === 'crystal' ? 0x55ffaa : 0xddbb77);
      this.audio.playPickup();
    }

    // Exhaust while thrusting: two jets from the nacelles.
    if (this.input.thrust && speedRatio > 0.02) {
      this._backDir.set(0, 0, 1).applyQuaternion(this.playerShip.mesh.quaternion);
      this._rightDir.set(1, 0, 0).applyQuaternion(this.playerShip.mesh.quaternion); // right vector
      this._exhaustOrigin.copy(shipPos).addScaledVector(this._backDir, 2.4);
      this.particles.spawnExhaust(
        this._exhaustOrigin.clone().addScaledVector(this._rightDir, 2.9), this._backDir, vel.length());
      this.particles.spawnExhaust(
        this._exhaustOrigin.clone().addScaledVector(this._rightDir, -2.9), this._backDir, vel.length());
    }
    this.particles.update(dt);

    // Collisions.
    const collidables = this.chunkManager.getCollidables(shipPos);

    const shipHits = this.physics.checkShipCollisions(this.playerShip.mesh, collidables);
    for (const hit of shipHits) {
      GameState.takeDamage(Constants.HEALTH.COLLISION_DAMAGE);
      this.physics.handleCollision(this.playerShip.mesh, hit);
      this.playerShip.hitFlash();
      this.cameraSystem.addShake(hit.size > 2 ? 0.8 : 0.3);
      this.hud.damageFlash();
      this.audio.playCollision();
      if (GameState.isLowHealth) this.audio.playWarning();
    }

    const projHits = this.physics.checkProjectileCollisions(
      GameState.combat.projectiles, collidables);
    for (const hit of projHits) {
      this.weapon.kill(hit.projectileId);
      const destroyedKind = this.chunkManager.destroyTarget(hit);
      this.score.awardDestruction(destroyedKind, hit.size);
      this.particles.spawnExplosion(
        hit.position, Math.max(hit.size, 0.5),
        destroyedKind === 'debris' ? 0x999999 : 0xffaa44);
      this.cameraSystem.addShake(hit.size > 2 ? 0.5 : 0.15);
      this.audio.playExplosion(Math.max(hit.size * 0.5, 0.5));
      if (hit.size > 2) this.hud.screenFlash('rgba(255,170,68,0.3)');
    }

    // Audio + biome ambience.
    this.audio.updateEngine(speedRatio, this.input.thrust);
    this.audio.setBiome(this.chunkManager.currentBiomeName);
    if (GameState.isLowHealth) this.audio.playWarning();

    // Post FX.
    this.postProcessing.updateSpeedEffects(speedRatio, gameTime);

    // HUD + scoring.
    this.hud.update();
    this.score.updateDistanceScore();

    // Death check.
    if (!GameState.player.isAlive) {
      this._onDeath();
    }
  }

  _onDeath() {
    this.input.releasePointerLock();
    this.hud.update();
    this.score.showGameOver();
  }

  // ---------------------------------------------------------------- restart
  _restart() {
    // Tear down gameplay state, rebuild world. Systems are NOT recreated —
    // restart is idempotent: clear content, reset state, no new listeners.
    this.chunkManager.clearAll();
    this.planets.clearAll();
    this.weapon.clear();
    this.particles.clear();
    this.shootingStars.destroy();
    this.shootingStars = new ShootingStarManager(this.scene);

    GameState.restart();
    this.playerShip.reset();
    this.physics.reset();
    this.cameraSystem.reset();
    this.score.reset();
    this.hud.update();

    // Snap camera behind ship.
    this.camera.position.set(0, Constants.CAMERA.FOLLOW_HEIGHT, Constants.CAMERA.FOLLOW_DISTANCE);
    this._lastTime = performance.now();
  }

  shutdown() {
    this._isRunning = false;
    window.removeEventListener('resize', this._onResize);
    this._container.removeEventListener('click', this._onClickStart);
    for (const u of this._unsubscribers) u();
    this._unsubscribers = [];
    this.input.destroy();
    this.audio.destroy();
    this.particles.destroy();
    this.postProcessing.dispose();
    this.playerShip.destroy();
    this.weapon.destroy();
    this.starfield.destroy();
    this.shootingStars.destroy();
    this.chunkManager.destroy();
    this.planets.destroy();
    this.asteroids.destroy();
    this.debris.destroy();
    this.collectibles.destroy();
    this.nebula.destroy();
    this.npcs.destroy();
    this.hud.destroy();
    this.renderer.dispose();
  }
}

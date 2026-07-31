import * as THREE from 'three';
import { Constants } from './Constants.js';
import { eventBus, Events } from './EventBus.js';
import { gameState } from './GameState.js';

import { InputSystem } from '../systems/InputSystem.js';
import { CameraSystem } from '../systems/CameraSystem.js';
import { PhysicsSystem } from '../systems/PhysicsSystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { PostProcessingSystem } from '../systems/PostProcessingSystem.js';
import { LightManager } from '../systems/LightManager.js';
import { AdaptiveQuality } from '../systems/AdaptiveQuality.js';

import { PlayerShip } from '../gameplay/PlayerShip.js';
import { WeaponSystem } from '../gameplay/WeaponSystem.js';
import { ScoreSystem } from '../gameplay/ScoreSystem.js';
import { BuffSystem } from '../gameplay/BuffSystem.js';

import { Starfield } from '../level/Starfield.js';
import { NebulaSystem } from '../level/NebulaSystem.js';
import { AsteroidField } from '../level/AsteroidField.js';
import { DebrisSystem } from '../level/DebrisSystem.js';
import { CometSystem } from '../level/CometSystem.js';
import { BlackHoleSystem } from '../level/BlackHoleSystem.js';
import { DeadStarSystem } from '../level/DeadStarSystem.js';
import { StationSystem } from '../level/StationSystem.js';
import { CrystalSystem } from '../level/CrystalSystem.js';
import { PulsarSystem } from '../level/PulsarSystem.js';
import { StormSystem } from '../level/StormSystem.js';
import { HulkSystem } from '../level/HulkSystem.js';
import { CitySystem } from '../level/CitySystem.js';
import { ChunkManager } from '../level/ChunkManager.js';
import { BiomeGenerator } from '../level/BiomeGenerator.js';

import { HUD } from '../ui/HUD.js';
import { DeathScreen } from '../ui/DeathScreen.js';
import { Crosshair } from '../ui/Crosshair.js';
import { LadderChart } from '../ui/LadderChart.js';

// Orchestrator (spec §3): init, loop, shutdown, restart.
export class Game {
  constructor(container, uiOverlay) {
    this.container = container;
    this.uiOverlay = uiOverlay;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Constants.DPR_MAX));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(Constants.FOG_COLOR);
    this.scene.fog = new THREE.FogExp2(Constants.FOG_COLOR, Constants.FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(Constants.CAMERA_FOV_REST, 1, 0.1, 4000);

    // Lights (spec §5.3)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12);
    this.scene.add(this.ambient);
    this.directional = new THREE.DirectionalLight(0xffffff, 0.5);
    this.directional.position.set(30, 50, 20);
    this.scene.add(this.directional);

    this.clock = new THREE.Clock();
    this._raf = 0;
    this._running = false;
    this._contextLost = false;
    this._deathTimer = 0;
    this._scoreFrac = 0;
    this._unsubs = [];

    this.ship = null;
    this.worldSystems = {};
    this.post = null;
  }

  init() {
    this.input = new InputSystem(this.renderer.domElement);
    this.audio = new AudioSystem();
    this.particles = new ParticleSystem(this.scene);
    this.cameraSystem = new CameraSystem(this.camera);
    this.biomeGen = new BiomeGenerator();
    this.physics = new PhysicsSystem(this);
    this.scoreSystem = new ScoreSystem();
    this.buffSystem = new BuffSystem();
    this.hud = new HUD(this.uiOverlay);
    this.deathScreen = new DeathScreen(this.uiOverlay);
    this.crosshair = new Crosshair(this.uiOverlay);
    this.ladderChart = new LadderChart(this.uiOverlay);
    this._unsubs.push(eventBus.on('input:throttleSet', (e) => {
      if (this.ship) this.ship.throttle = e.value;
    }));

    this.starfield = new Starfield(this.scene);
    this.nebulaSystem = new NebulaSystem(this.scene);

    this.worldSystems = {
      asteroidField: new AsteroidField(this.scene, eventBus),
      debrisSystem: new DebrisSystem(this.scene, eventBus),
      cometSystem: new CometSystem(this.scene, eventBus, this.particles),
      blackHoleSystem: new BlackHoleSystem(this.scene, eventBus),
      deadStarSystem: new DeadStarSystem(this.scene, eventBus, this.particles),
      stationSystem: new StationSystem(this.scene, eventBus),
      crystalSystem: new CrystalSystem(this.scene, eventBus),
      pulsarSystem: new PulsarSystem(this.scene, eventBus),
      stormSystem: new StormSystem(this.scene, eventBus),
      hulkSystem: new HulkSystem(this.scene, eventBus),
      citySystem: new CitySystem(this.scene, eventBus),
      nebulaSystem: this.nebulaSystem,
    };

    this.chunkManager = new ChunkManager(this.scene, eventBus, this.worldSystems, this.biomeGen);
    this.worldSystems.chunkManager = this.chunkManager;

    this.ship = new PlayerShip(this.scene);
    this.weaponSystem = new WeaponSystem(this.scene, eventBus, this.physics);
    this.post = new PostProcessingSystem(this.renderer, this.scene, this.camera);
    this.lightManager = new LightManager(this.scene);
    this.adaptiveQuality = new AdaptiveQuality(this);
    const savedProfile = (() => { try { return localStorage.getItem(Constants.LIGHT_MANAGER.storageKey); } catch { return null; } })();
    if (savedProfile === 'eco') {
      gameState.lightProfile = 'eco';
      this.lightManager.setProfile('eco');
    }

    this._wireEvents();
    this._spawnInitialWorld();

    // Initial HUD values
    this.hud.reset();
    this.hud.setDistance(0);

    eventBus.emit(Events.GAME_STARTED);
    this._running = true;
    this._loop();
  }

  _wireEvents() {
    const on = (ev, fn) => this._unsubs.push(eventBus.on(ev, fn));

    // Feedback: particles / shake / audio
    on(Events.WEAPON_FIRED, (e) => {
      this.audio.play('laser', { volume: 0.35 });
      // green muzzle flash
      this.particles.burst('laserSpark', e.position.x, e.position.y, e.position.z, 8, 10, { size: 0.3, color: [0.3, 1.0, 0.55] });
    });
    on(Events.WEAPON_HIT, (e) => {
      this.particles.burst('laserSpark', e.position.x, e.position.y, e.position.z, 10, 6, { size: 0.15 });
      this.particles.impactGlow(e.position.x, e.position.y, e.position.z);
    });
    on(Events.ASTEROID_DESTROYED, (e) => {
      this.particles.burst('explosion', e.position.x, e.position.y, e.position.z, 50, 10, { size: 0.4 });
      this.particles.burstRing(e.position.x, e.position.y, e.position.z);
      this.particles.burstShards(e.position.x, e.position.y, e.position.z, 4);
      this.cameraSystem.addShake(Constants.SHAKE_EXPLOSION_INTENSITY, Constants.SHAKE_EXPLOSION_DURATION);
      this.audio.play('explosion', { volume: 0.5 });
    });
    on(Events.DEBRIS_DESTROYED, (e) => {
      this.particles.burst('explosion', e.position.x, e.position.y, e.position.z, 20, 6, { size: 0.25 });
      this.audio.play('explosion', { volume: 0.3 });
    });
    on(Events.COMET_DESTROYED, (e) => {
      this.particles.burst('explosion', e.position.x, e.position.y, e.position.z, 90, 22, { size: 0.55 });
      this.particles.burstRing(e.position.x, e.position.y, e.position.z);
      this.particles.burstShards(e.position.x, e.position.y, e.position.z, 6);
      this.cameraSystem.addShake(1.0, 0.6);
      this.audio.play('comet', { volume: 0.7 });
    });
    on(Events.CRYSTAL_DESTROYED, (e) => {
      this.particles.burst('laserSpark', e.position.x, e.position.y, e.position.z, 18, 10, { size: 0.3, color: [0.5, 1.0, 0.9] });
      this.audio.play('explosion', { volume: 0.25 });
    });
    on(Events.HULK_DESTROYED, (e) => {
      this.particles.burst('explosion', e.position.x, e.position.y, e.position.z, 60, 14, { size: 0.5 });
      this.particles.burst('laserSpark', e.position.x, e.position.y, e.position.z, 12, 8, { size: 0.25, color: [0.55, 0.45, 0.3] });
      this.cameraSystem.addShake(0.7, 0.5);
      this.audio.play('comet', { volume: 0.5 });
    });
    on(Events.WRECK_DESTROYED, (e) => {
      this.particles.burst('explosion', e.position.x, e.position.y, e.position.z, 50, 12, { size: 0.45 });
      this.particles.burst('laserSpark', e.position.x, e.position.y, e.position.z, 16, 9, { size: 0.25, color: [0.4, 0.9, 0.8] });
      this.cameraSystem.addShake(0.6, 0.4);
      this.audio.play('explosion', { volume: 0.5 });
    });
    on(Events.OBJECT_CONSUMED, (e) => {
      this.audio.play('consumption', { volume: 0.5 });
    });
    on(Events.BLACK_HOLE_COLLAPSED, (e) => {
      const p = e.position;
      // Huge flash + shockwave
      this.particles.burst('explosion', p.x, p.y, p.z, 120, 40, { size: 0.8, color: [1, 1, 1] });
      this.cameraSystem.addShake(2.0, 1.0);
      this.hud.flash('rgba(255,255,255,0.6)');
      this.audio.play('collapse', { volume: 1.0 });
      // Heavy damage if the ship is caught in the shockwave
      const d = Math.hypot(p.x - this.ship.position.x, p.y - this.ship.position.y, p.z - this.ship.position.z);
      if (d < Constants.BLACK_HOLE_COLLAPSE_RADIUS && this.ship.alive) {
        const res = gameState.takeDamage(50, 'collapse');
        if (res === 'dead') {
          this._startDeathSequence();
        } else {
          eventBus.emit(Events.PLAYER_DAMAGED, { amount: 50, source: 'blackHoleCollapse', newHealth: res });
          eventBus.emit(Events.PLAYER_HEALTH_CHANGED, { health: res, maxHealth: Constants.MAX_HEALTH });
        }
      }
    });
    on(Events.BIOME_CHANGED, (e) => {
      this.audio.play('biome', { volume: 0.4 });
    });
    on(Events.AUDIO_MUTED, (e) => this.audio.setMuted(e.muted));
    on(Events.SCREEN_SHAKE, (e) => this.cameraSystem.addShake(e.intensity, e.duration));
    on(Events.PLAYER_HEALTH_CHANGED, (e) => {
      if (e.health <= 0) return;
      this.cameraSystem.addShake(Constants.SHAKE_DAMAGE_INTENSITY, Constants.SHAKE_DAMAGE_DURATION);
      this.hud.flash();
      this.audio.play('collision', { volume: 0.5 });
      if (this.ship.setDamageLevel) this.ship.setDamageLevel(e.health, e.maxHealth); // ship remaster v2.0
    });
    on(Events.PLAYER_HEALTH_REGEN, (e) => {
      // passive repair: no damage feedback, just fade the scorch as the hull recovers
      if (this.ship.setDamageLevel) this.ship.setDamageLevel(e.health, e.maxHealth);
      // heal sparkles: gentle green repair motes drifting off the hull
      const p = this.ship.position;
      this.particles.burst('sparkle', p.x, p.y, p.z, 8, 4, { size: 0.45, lifetime: 0.7, color: [0.55, 1.0, 0.8] });
    });
  }

  _spawnInitialWorld() {
    this.chunkManager.update(this.ship.position, gameState.distance);
  }

  // ------------------------------------------------------------------ loop

  _loop() {
    if (!this._running) return;
    this._raf = requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), Constants.MAX_DELTA);

    if (this._contextLost) return;
    if (gameState.gameState === 'paused') {
      // Paused: only pause toggle (Esc) and mute (M) are live
      this.input.update(dt);
      const frame = this.input.consumeFrame();
      if (frame.pausePressed) this._togglePause();
      else if (frame.mutePressed) this._toggleMute();
      this.post.update(dt, 0, 0);
      return;
    }

    if (gameState.gameState === 'playing') this._updatePlaying(dt);
    else if (gameState.gameState === 'dying') this._updateDying(dt);
    else if (gameState.gameState === 'dead') this._updateDead();

    this._render();

    // Adaptive quality (v2.0 §7.2.5)
    if (this.adaptiveQuality) {
      const level = this.adaptiveQuality.update(dt);
      if (level !== gameState.adaptiveQualityLevel) {
        gameState.adaptiveQualityLevel = level;
        this.hud.setAQ(level);
      }
    }
  }

  _updatePlaying(dt) {
    this.input.update(dt);
    const frame = this.input.consumeFrame();

    // Edge inputs
    if (frame.pausePressed) { this._togglePause(); return; }
    if (frame.mutePressed) this._toggleMute();
    if (frame.restartPressed && gameState.gameState === 'dead') { this.restart(); return; }
    if (frame.ladderChartPressed) this.ladderChart.setOpen(!this.ladderChart.open);
    if (frame.lightProfilePressed) this._cycleLightProfile();

    // Touch look
    const yawDelta = frame.yawDelta + (frame.touchLook ? frame.touchLook.x : 0);
    const pitchDelta = frame.pitchDelta + (frame.touchLook ? frame.touchLook.y : 0);

    const mv = this.input.movement;
    const move = {
      pitchUp: mv.pitchUp || this.input.touchMove.y < -0.3,
      pitchDown: mv.pitchDown || this.input.touchMove.y > 0.3,
      left: mv.left || this.input.touchMove.x < -0.3,
      right: mv.right || this.input.touchMove.x > 0.3,
      rollLeft: mv.rollLeft || this.input.touchRoll < -0.3,
      rollRight: mv.rollRight || this.input.touchRoll > 0.3,
      yawDelta,
      pitchDelta,
      throttleDelta: frame.throttleDelta,
    };
    if (frame.throttleDelta !== 0) {
      eventBus.emit(Events.PLAYER_THRUST, { thrustFraction: this.ship.throttle });
    }

    this.ship.update(dt, move);
    const thrustFraction = this.ship.thrustFraction;

    // Odometer + distance score
    const dist = this.ship.speed * dt;
    gameState.addDistance(dist);
    this._scoreFrac += dist / Constants.SCORE_DISTANCE_DIVISOR;
    if (this._scoreFrac >= 1) {
      const pts = Math.floor(this._scoreFrac);
      this._scoreFrac -= pts;
      const score = gameState.addScore(pts, 'distance');
      if (score !== undefined) eventBus.emit(Events.SCORE_CHANGED, { score, delta: pts, reason: 'distance' });
    }
    this.hud.setDistance(gameState.distance);

    // Biomes (monotonic odometer)
    const biome = this.biomeGen.getBiome(gameState.distance);
    if (biome.key !== gameState.biomeName) {
      eventBus.emit(Events.BIOME_CHANGED, { from: gameState.biomeName, to: biome.key });
      gameState.biomeName = biome.key;
    }

    // Ladder (v2.0 §3): rung state, events, HUD, chart
    const contentRung = this.biomeGen.contentRungForDistance(gameState.distance);
    const progress = this.biomeGen.progressForDistance(gameState.distance);
    gameState.rungKey = biome.key;
    gameState.rungName = biome.name;
    gameState.rungProgress = progress;
    gameState.scoreMult = biome.scoreMult;
    this.hud.setRungNumber(contentRung);
    this.hud.setRung(biome.name, progress, biome.key === 'SPATIAL_GRAVEYARD');
    this.ladderChart.update(gameState.distance, biome.key, progress);
    // Per-rung bloom threshold (v2.0 §5)
    if (this.post && this.post.setBloomThreshold) {
      const thresholds = { CRYSTAL_FIELDS: 0.12, PULSAR_REGION: 0.13, PLASMA_STORM: 0.11, SPATIAL_GRAVEYARD: 0.12 };
      this.post.setBloomThreshold(thresholds[biome.key] ?? Constants.BLOOM.threshold);
    }
    if (contentRung !== gameState.rungIndex) {
      const prevRung = gameState.rungIndex;
      gameState.rungIndex = contentRung;
      eventBus.emit(Events.LADDER_RUNG_CHANGED, {
        rung: contentRung, key: biome.key, name: biome.name,
        fromKey: gameState.biomeName, distance: gameState.distance,
      });
      this.audio.play(contentRung === 9 ? 'finale' : 'biome', { volume: 0.4 });
      if (contentRung === 9 && !gameState.finaleReached) {
        gameState.finaleReached = true;
        eventBus.emit(Events.LADDER_FINALE_REACHED, { distance: gameState.distance });
        this.hud.announce('SECTOR: DEAD CITY — you should not be here', 5);
        this.cameraSystem.addShake(0.6, 0.8);
      }
    }

    // World
    this.chunkManager.update(this.ship.position, gameState.distance);
    this.chunkManager.updateTunnelTime(dt);
    this.worldSystems.asteroidField.update(dt);
    this.worldSystems.debrisSystem.update(dt);
    this.worldSystems.cometSystem.update(dt, this.ship.position);
    this.nebulaSystem.update(dt, this.camera);
    this.worldSystems.deadStarSystem.update(dt, this.camera.position);
    this.worldSystems.stationSystem.update(dt, this.ship.position);
    this.worldSystems.blackHoleSystem.update(dt);
    if (this.worldSystems.crystalSystem) this.worldSystems.crystalSystem.update(dt);
    if (this.worldSystems.pulsarSystem) this.worldSystems.pulsarSystem.update(dt, this.ship.position);
    if (this.worldSystems.stormSystem) this.worldSystems.stormSystem.update(dt, this.ship.position);
    if (this.worldSystems.hulkSystem) this.worldSystems.hulkSystem.update(dt);
    if (this.worldSystems.citySystem) this.worldSystems.citySystem.update(dt);

    // Physics (collisions, gravity, consumption, wormhole blur)
    this.physics.update(dt, this.ship, gameState);
    if (!this.ship.alive) {
      this._startDeathSequence();
      return;
    }

    // Weapons + particles
    if (frame.firePressed) this.weaponSystem.fire(this._muzzlePos(), this.ship.heading);
    if (frame.shieldPressed && this.ship.shieldReady) this._fireDeflagration();
    this.weaponSystem.update(dt);
    this.particles.update(dt);

    // Exhaust trail (throttle-driven)
    if (thrustFraction > 0) {
      const f = this.ship.forward;
      const perFrame = Math.max(2, Math.round(10 * thrustFraction)); // v2.0 denser trail
      this.particles.emitStream('exhaust',
        this.ship.position.x - f.x * 2.2, this.ship.position.y - f.y * 2.2, this.ship.position.z - f.z * 2.2,
        -f.x * 8, -f.y * 8, -f.z * 8,
        { perFrame, jitter: 0.15, size: 0.3, color: [0.5, 0.7, 1.0] });
    }

    // Engine audio follows throttle
    this.audio.setThrust(thrustFraction);
    this.hud.setShield(1 - this.ship.shieldCooldown / Constants.SHIELD.cooldown, this.ship.shieldCooldown <= 0);

    // Camera
    this.cameraSystem.update(dt, this.ship, thrustFraction);
    this.starfield.update(dt, this.ship.position);
    if (this.lightManager) this.lightManager.update(this.camera.position);

    // State ticking
    gameState.tickInvulnerability(dt);
    gameState.regenHealth(dt);

    // Warnings
    this._updateWarnings();

    // Health warning beep
    this.audio.setWarning(gameState.player.health > 0 && gameState.player.health < Constants.WARNING_HEALTH_THRESHOLD);

    // HUD + post
    this.hud.setThrust(thrustFraction);
    if (this.hud.throttleSlider && document.activeElement !== this.hud.throttleSlider) {
      this.hud.throttleSlider.value = String(Math.round(thrustFraction * 100));
    }
    const speedFraction = this.ship.speed / Constants.MAX_SHIP_SPEED;
    // Speed lines at high throttle (v2.0 §5)
    if (speedFraction > 0.9 && this.cameraSystem.camera.fov > 88) {
      this.particles.emitSpeedLines(this.camera.position, this.camera.quaternion, 3);
    }
    if (this.worldSystems.stormSystem) {
      this.post.stormCA = this.worldSystems.stormSystem.getShipDist() < 200 ? 0.002 : 0;
    }
    this.post.update(dt, speedFraction, this.physics.wormholeBlurIntensity);
  }

  _updateDead() {
    // Death screen: only restart (R) and mute (M) are live
    this.input.update(0);
    const frame = this.input.consumeFrame();
    if (frame.restartPressed) { this.restart(); return; }
    if (frame.mutePressed) this._toggleMute();
  }

  _updateDying(dt) {
    // Slow-mo dissolve: keep particles/camera alive, freeze gameplay
    this.particles.update(dt * 0.4);
    this.cameraSystem.update(dt * 0.4, this.ship, 0);
    this._deathTimer += dt;
    if (this._deathTimer >= Constants.DEATH_SCREEN_DELAY) {
      gameState.gameState = 'dead';
      const isNew = this.scoreSystem.saveHighScore();
      this.deathScreen.show({
        reason: gameState.deathReason,
        score: gameState.score,
        distance: gameState.distance,
        highScore: gameState.highScore,
        isNew,
      });
    }
    const speedFraction = 0;
    this.post.update(dt * 0.4, speedFraction, 0);
  }

  _render() {
    this.renderer.render(this.scene, this.camera);
  }

  _muzzlePos() {
    const f = this.ship.forward;
    return new THREE.Vector3(
      this.ship.position.x - f.x * 5.0,
      this.ship.position.y - f.y * 5.0,
      this.ship.position.z - f.z * 5.0,
    );
  }

  _updateWarnings() {
    const shipPos = this.ship.position;
    let horizonWarn = false;
    let starWarn = false;
    let pulsarWarn = false;

    for (const h of this.worldSystems.blackHoleSystem.holes) {
      const d = Math.hypot(h.x - shipPos.x, h.y - shipPos.y, h.z - shipPos.z);
      if (d < Constants.BLACK_HOLE_RADIUS + Constants.BLACK_HOLE_WARNING_RANGE) horizonWarn = true;
    }
    for (const s of this.worldSystems.deadStarSystem.stars) {
      const d = Math.hypot(s.x - shipPos.x, s.y - shipPos.y, s.z - shipPos.z);
      if (d < s.radius + Constants.DEAD_STAR_WARNING_RANGE) starWarn = true;
    }
    if (this.worldSystems.pulsarSystem) {
      for (const b of this.worldSystems.pulsarSystem.getBeams()) {
        const px = shipPos.x - b.x, py = shipPos.y - b.y, pz = shipPos.z - b.z;
        const t = px * b.ax + py * b.ay + pz * b.az;
        if (t < 0 || t > b.length) continue;
        const qx = px - b.ax * t, qy = py - b.ay * t, qz = pz - b.az * t;
        if (qx * qx + qy * qy + qz * qz < 60 * 60) pulsarWarn = true;
      }
    }
    this.hud.setWarning('eventHorizon', horizonWarn);
    this.hud.setWarning('stellarRemnant', starWarn);
    this.hud.setWarning('pulsarBeam', pulsarWarn);
  }

  // ------------------------------------------------------------- game flow

  _togglePause() {
    if (gameState.gameState === 'paused') {
      gameState.gameState = 'playing';
      eventBus.emit(Events.GAME_RESUMED);
      this.clock.getDelta(); // discard accumulated time
    } else if (gameState.gameState === 'playing') {
      gameState.gameState = 'paused';
      eventBus.emit(Events.GAME_PAUSED);
      this.ladderChart.setOpen(false); // spec v2.0 §12: chart closes on pause
    }
    this.hud.showPause(gameState.gameState === 'paused');
    if (this._running) this.post.update(0, 0, 0);
  }

  /** L key: cycle LightManager profile auto → eco → auto (v2.0 §6.3). */
  _cycleLightProfile() {
    gameState.lightProfile = gameState.lightProfile === 'auto' ? 'eco' : 'auto';
    try {
      localStorage.setItem(Constants.LIGHT_MANAGER.storageKey, gameState.lightProfile);
    } catch { /* private mode */ }
    if (this.lightManager) this.lightManager.setProfile(gameState.lightProfile);
    eventBus.emit(Events.INPUT_LIGHT_PROFILE, { profile: gameState.lightProfile });
  }

  _toggleMute() {
    const muted = !this.audio.muted;
    this.audio.setMuted(muted);
    eventBus.emit(Events.AUDIO_MUTED, { muted });
  }

  /** Called by PhysicsSystem on ship collision damage. */
  onShipCollision(collider, damage) {
    const hp = gameState.player.health;
    eventBus.emit(Events.PLAYER_DAMAGED, { amount: damage, source: collider.type, newHealth: hp });
    eventBus.emit(Events.PLAYER_HEALTH_CHANGED, { health: hp, maxHealth: Constants.MAX_HEALTH });
  }

  /** Called by PhysicsSystem on player death (any cause). */
  onPlayerDeath(reason, source) {
    this._startDeathSequence();
  }

  /** Electronic deflagration (right-click burst): shove asteroids/debris away
   *  with a radial electric discharge. 1s cooldown (see Constants.SHIELD). */
  _fireDeflagration() {
    this.ship.shieldCooldown = Constants.SHIELD.cooldown;
    const p = this.ship.position;
    this.physics.deflagrationPush(p, Constants.SHIELD.radius);
    this.particles.burstRing(p.x, p.y, p.z);
    this.particles.burst('laserSpark', p.x, p.y, p.z, 26, 34, { size: 0.25, color: [0.7, 0.9, 1.0] });
    if (this.ship.shieldPulse) this.ship.shieldPulse(p.x, p.y, p.z);
    this.ship.burstArcs();
    this.hud.flash('rgba(190,225,255,0.35)');
    this.cameraSystem.addShake(0.5, 0.35);
    this.audio.play('shield', { volume: 0.7 });
  }

  _startDeathSequence() {
    if (gameState.gameState !== 'playing') return;
    gameState.gameState = 'dying';
    this._deathTimer = 0;
    this.ladderChart.setOpen(false);
    eventBus.emit(Events.PLAYER_DIED, { reason: gameState.deathReason });
    eventBus.emit(Events.PLAYER_HEALTH_CHANGED, { health: 0, maxHealth: Constants.MAX_HEALTH });

    // Death dissolve: explosion + hide ship
    const p = this.ship.position;
    this.particles.burst('explosion', p.x, p.y, p.z, 80, 18, { size: 0.5 });
    this.cameraSystem.addShake(1.2, 0.6);
    this.audio.play('explosion', { volume: 0.9 });
    this.ship.group.visible = false;
    this.audio.setThrust(0);
    this.audio.setWarning(false);
  }

  restart() {
    gameState.reset();
    this._scoreFrac = 0;
    if (this.adaptiveQuality) {
      this.adaptiveQuality.level = 0;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Constants.DPR_MAX));
      if (this.post) {
        this.post.caPass.enabled = true;
        this.post.grainPass.enabled = true;
      }
      if (this.lightManager) this.lightManager.setProfile(gameState.lightProfile);
    }
    this.chunkManager.clearAll();
    this.deathScreen.hide();
    this.hud.reset();
    this.physics.reset();
    this.buffSystem.reset();

    this.ship.position.set(Constants.SHIP_SPAWN.x, Constants.SHIP_SPAWN.y, Constants.SHIP_SPAWN.z);
    this.ship.velocity.set(0, 0, 0);
    this.ship.heading.identity();
    this.ship.throttle = 0;
    this.ship.thrustFraction = 0;
    this.ship.shieldCooldown = 0;
    this.ship.alive = true;
    this.ship.group.visible = true;
    if (this.ship.setDamageLevel) this.ship.setDamageLevel(Constants.MAX_HEALTH, Constants.MAX_HEALTH);
    this.cameraSystem.reset();

    this._spawnInitialWorld();
    gameState.gameState = 'playing';
    eventBus.emit(Events.GAME_RESTART);
    this.clock.getDelta();
  }

  // ---------------------------------------------------------------- resize

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.post) this.post.setSize(w, h);
  }

  onContextLost() {
    this._contextLost = true;
  }

  onContextRestored() {
    this._contextLost = false;
    if (this.post) {
      this.post.dispose();
      this.post = new PostProcessingSystem(this.renderer, this.scene, this.camera);
    }
  }

  dispose() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
    this.chunkManager.dispose();
    this.starfield.dispose();
    this.nebulaSystem.dispose();
    this.worldSystems.asteroidField.dispose();
    this.worldSystems.debrisSystem.dispose();
    this.worldSystems.cometSystem.dispose();
    this.worldSystems.blackHoleSystem.dispose();
    this.worldSystems.deadStarSystem.dispose();
    this.worldSystems.stationSystem.dispose();
    this.worldSystems.crystalSystem.dispose();
    this.worldSystems.pulsarSystem.dispose();
    this.worldSystems.stormSystem.dispose();
    this.worldSystems.hulkSystem.dispose();
    this.worldSystems.citySystem.dispose();
    this.particles.dispose();
    this.weaponSystem.dispose();
    this.ship.dispose(this.scene);
    this.audio.dispose();
    this.post?.dispose();
    this.scoreSystem.dispose();
    this.hud.dispose();
    this.deathScreen.dispose();
    this.crosshair.dispose();
    this.ladderChart.dispose();
  }
}

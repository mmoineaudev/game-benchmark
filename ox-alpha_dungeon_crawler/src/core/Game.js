// Game.js — orchestrator: init, level lifecycle, update loop, combat, HUD, meta (§4)
import * as THREE from 'three';
import GameState from './GameState.js';
import EventBus from './EventBus.js';
import Leaderboard from './Leaderboard.js';
import {
  WORLD, PLAYER, CAMERA, BIOMES, BIOME_SEQUENCE, DUNGEON, TIMED_RUN,
  LIGHTING,
  EVOLUTION, weaponTier, swordHitDamage, damageMult, totalSwordScale,
  attackSpeedFromSouls, orbDirectDamage, orbExplodeDamage, ORB_WEAPON,
  BUFF, HUNTER, DROP, SAVE_KEY, SAVE_SERVER, biomeForLevel, MAX_TIER
} from './Constants.js';
import DungeonGenerator from '../world/DungeonGenerator.js';
import WorldBuilder from '../world/WorldBuilder.js';
import BiomeSystem from '../world/BiomeSystem.js';
import PropSystem from '../world/PropSystem.js';
import LightingSystem from '../systems/LightingSystem.js';
import SmokeSystem from '../systems/SmokeSystem.js';
import ParticleSystem from '../systems/ParticleSystem.js';
import RuneSystem from '../systems/RuneSystem.js';
import PostProcessing from '../systems/PostProcessing.js';
import InputSystem from '../systems/InputSystem.js';
import PlayerSword from '../entities/PlayerSword.js';
import OrbShooter from '../entities/OrbShooter.js';
import OrbSystem from '../entities/OrbSystem.js';
import SkeletonSystem from '../entities/SkeletonSystem.js';
import Hunter from '../entities/Hunter.js';
import { circleHitsBox, resolveCircleCollisions } from './Collision.js';

export default class Game {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = new GameState();
    this.bus = new EventBus();
    this.leaderboard = new Leaderboard();
    this.biomes = new BiomeSystem();
    this._isRunning = false;
    this._degraded = false;
    this._bossPortalOpen = true;
    this._dungeon = null;
    this._lastTime = 0;
    this._elapsed = 0;
    this._titleMode = true;
    this._deathShown = false;
    this._fpsWindow = [];
    this._fpsHold = 0;
    this._lowFpsTimer = 0;
    this._msgTimers = [];
    this._noAmmoShown = false;
    this._hintAccum = 0;
    this._hazardAccum = 0;
    this._regenAccum = 0;
    this._shakeT = 0;
    this._burnSpawnedThisLevel = false;
    this._saveAvailableOnDeath = false;
  }

  // ============================== INIT ==============================
  init() {
    this._initRenderer();
    this._initCamera();
    this._initPostProcessing();
    this._initInput();
    this._bindEventToasts();
    this._initSaveBootstrap();
    this._initTitleScene();
    this._bindMenus();
    window.addEventListener('resize', () => this._onResize());
    // clocks start when a run begins (the title screen never ticks the timer)
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(CAMERA.FOV, innerWidth / innerHeight, CAMERA.NEAR, CAMERA.FAR);
    this.camera.layers.enable(2);          // sword layer
    this.camera.position.y = PLAYER.EYE ?? 1.6;
    // headlight on layer 0 — never lights the sword (wide + low decay: the
    // playable corridor around the player; your standing "wider, less decay" fix)
    this.headlight = new THREE.PointLight(0xfff2dd, LIGHTING.HEADLIGHT_INTENSITY,
      LIGHTING.HEADLIGHT_DISTANCE, LIGHTING.HEADLIGHT_DECAY);
    this.headlight.layers.set(0);
    this.camera.add(this.headlight);
    this.scene = new THREE.Scene();
    this.scene.add(this.camera);
    // the floating sword (camera child, layer 2)
    this.sword = new PlayerSword(this.camera);
  }

  _initPostProcessing() {
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
    this.post.enabled = true;
  }

  _initInput() {
    this.input = new InputSystem();
    this.input.attach(this.renderer.domElement);
  }

  _bindEventToasts() {
    this.bus.on('sword:hit', ({ enemiesHit }) => {
      if (enemiesHit > 0) this.state.hitStop = Math.max(this.state.hitStop, 0.06);
    });
    this.bus.on('prop:broken', () => {});
    this.bus.on('prop:opened', () => {});
  }

  _bindMenus() {
    document.getElementById('btn-new').onclick = () => this._beginRun();
    document.getElementById('btn-load').onclick = () => this._beginRun({ loadSave: true });
    document.getElementById('btn-restart').onclick = () => this._restart();
    document.getElementById('btn-ngplus').onclick = () => this._ngPlus();
    document.getElementById('btn-save').onclick = () => this._saveForLater();
    document.getElementById('btn-ledger2').onclick = () => this._toggleLedger();

    // death/menu keys: the in-game Tab handler lives in _update which stops when
    // _isRunning=false — so death-screen keys need a window-level listener
    window.addEventListener('keydown', (e) => {
      if (!this._deathShown) return;
      if (e.code === 'Tab') { e.preventDefault(); this._toggleLedger(); }
      else if (e.code === 'KeyN') this._restart();
      else if (e.code === 'KeyY') this._ngPlus();
      else if (e.code === 'KeyS') this._saveForLater();
    });
  }

  // ============================== SAVES ==============================
  _initSaveBootstrap() {
    let local = null;
    try { local = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { /* corrupt → dropped */ }
    if (!local) {
      // fall back to the file-backed server copy
      fetch(`${SAVE_SERVER}/save`).then(r => r.ok ? r.json() : null).then(remote => {
        if (remote && remote.level && !this._runStarted) {
          this._serverSave = remote;
          const btn = document.getElementById('btn-load');
          btn.style.display = 'block';
        }
      }).catch(() => {});
    } else {
      document.getElementById('btn-load').style.display = 'block';
    }
  }

  async _writeSave(state) {
    const payload = { ...state.toJSON(), savedAt: Date.now() };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(payload)); } catch { }
    try { await fetch(`${SAVE_SERVER}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch { }
  }

  _readSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
  }

  _clearSaveEntry() { /* the save persists until a new death-save overwrites it */ }

  // ============================== TITLE SCENE ==============================
  _initTitleScene() {
    // living spectral-court showcase: golden portal + hovering soul orbs + idling boss + cold flames
    const s = this.titleScene = new THREE.Scene();
    s.background = new THREE.Color(0x08060f);
    s.fog = new THREE.FogExp2(0x08060f, 0.02);
    const tCam = this.titleCamera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
    tCam.position.set(0, 2.2, 9);

    s.add(new THREE.AmbientLight(0x443366, 0.7));
    const key = new THREE.PointLight(0xffd700, 2.2, 30, 1.3); key.position.set(0, 5, -3); s.add(key);
    const cold = new THREE.PointLight(0x88aaff, 1.4, 25, 1.4); cold.position.set(-5, 3, 3); s.add(cold);

    // golden exit portal
    const portal = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.14, 12, 48),
      new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xaa8800, emissiveIntensity: 1, metalness: 0.8, roughness: 0.3 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.3;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    disc.position.y = 1.3;
    portal.add(ring, disc);
    portal.position.z = -4;
    s.add(portal);
    this._titlePortalRing = ring;

    // hovering soul orbs
    this._titleOrbs = [];
    for (let i = 0; i < 7; i++) {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xaaddff }));
      orb.userData.seed = Math.random() * 10;
      s.add(orb);
      this._titleOrbs.push(orb);
    }

    // idling Spectral Lord
    const lordMat = new THREE.MeshStandardMaterial({ color: 0x99aadd, emissive: 0x4455aa, emissiveIntensity: 0.9, transparent: true, opacity: 0.92 });
    const lord = new THREE.Group();
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(1, 2.4, 10), lordMat); cloak.position.y = 1.2;
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.38, 12, 8), lordMat); headM.position.y = 2.7;
    lord.add(cloak, headM);
    lord.position.set(3.2, 0, -1.5);
    s.add(lord);
    this._titleLord = lord;

    // cold pillar flames
    this._titleFlames = [];
    for (const x of [-6, -3.5, 3.5, 6]) {
      for (const z of [2, -2]) {
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x88bbff }));
        flame.position.set(x, 2.4, z * 1.4);
        s.add(flame);
        this._titleFlames.push(flame);
      }
    }

    this._showStartMenu();
    this._animateTitleScene();
  }

  _showStartMenu() {
    document.getElementById('title-overlay').classList.add('visible');
    const hasSave = !!this._readSave() || !!this._serverSave;
    document.getElementById('btn-load').style.display = hasSave ? 'block' : 'none';
  }

  _animateTitleScene() {
    const loop = () => {
      if (!this._titleMode) return;
      requestAnimationFrame(loop);
      const t = performance.now();
      for (const orb of this._titleOrbs) {
        const s = orb.userData.seed;
        orb.position.set(Math.sin(t * 0.0004 + s) * 4.5, 1.8 + Math.sin(t * 0.001 + s * 2) * 0.5, Math.cos(t * 0.0004 + s) * 2.5 - 1);
      }
      this._titlePortalRing.rotation.z += 0.01;
      this._titleLord.position.y = Math.sin(t * 0.0008) * 0.15;
      this._titleLord.rotation.y = Math.sin(t * 0.0003) * 0.4;
      for (let i = 0; i < this._titleFlames.length; i++) {
        this._titleFlames[i].scale.setScalar(0.85 + Math.sin(t * 0.004 + i) * 0.15);
      }
      this.titleCamera.position.x = Math.sin(t * 0.00013) * 1.2;
      this.titleCamera.lookAt(0, 1.8, -2);
      this.renderer.render(this.titleScene, this.titleCamera);
    };
    loop();
  }

  _stopTitleScene() {
    this._titleMode = false;
    document.getElementById('title-overlay').classList.remove('visible');
    // scene torn down by the first _disposeScene
    this.titleScene = null; this.titleCamera = null;
  }

  // ============================== RUN / LEVEL LIFECYCLE ==============================
  _beginRun(opts = {}) {
    this._runStarted = true;
    this._stopTitleScene();

    let startState = null;
    if (opts.loadSave) {
      const raw = this._readSave() || this._serverSave;
      startState = raw ? GameState.fromJSON(raw) : null;
      if (startState) {
        // loading restarts the SAVED LEVEL fresh with ALL meta intact; buff never carries
        startState.buffEffect = 0; startState.buffTime = 0;
      }
    }
    this.state = startState || new GameState();
    this._regenerateDungeon({ newRun: !opts.loadSave });
  }

  _restart() {
    this._deathShown = false;
    document.getElementById('death-overlay').classList.remove('visible');
    this.state = new GameState(); // level 1, 0 orbs, ngPlus 0, bossKills 0, max health 3
    this._regenerateDungeon({ newRun: true });
  }

  _ngPlus() {
    this._deathShown = false;
    document.getElementById('death-overlay').classList.remove('visible');
    const s = this.state;
    const keptSouls = Math.floor(s.collectedOrbs * 0.25);   // heavy 75% toll
    const nextLevel = Math.max(1, Math.floor(s.level / 2));
    const ng = new GameState({
      level: nextLevel,
      collectedOrbs: keptSouls,
      weaponTier: weaponTier(keptSouls),                     // RECALCULATED from the kept bank
      ngPlus: s.ngPlus + 1,
      bossKills: s.bossKills,
      maxHealth: s.maxHealth,                                // permanent hearts kept
      runTime: s.runTime
    });
    ng.health = ng.maxHealth;
    this.state = ng;
    this._regenerateDungeon({});
  }

  async _saveForLater() {
    await this._writeSave(this.state);
    this._message('Run saved — it will be there when you return.');
    document.getElementById('btn-save').disabled = true;
  }

  async _regenerateDungeon({ newRun = false, nextState = null, startMessage = null } = {}) {
    this._isRunning = false;
    this._showLevelTitle(this.state.level + (nextState ? 1 : 0));

    // teardown every level-owned system in order
    this._teardownLevel();
    await frame();

    // capture carried buff BEFORE replacing state (level advance only)
    let carriedBuff = null;
    if (nextState && this.state.buffEffect > 0 && this.state.buffTime > 0) {
      carriedBuff = { effect: this.state.buffEffect, time: Math.min(BUFF.MAX_DURATION, this.state.buffTime * BUFF.CARRY_MULT) };
    }

    // rebuild state
    if (newRun) this.state = new GameState();
    else if (nextState) this.state = nextState;
    this.state.health = this.state.maxHealth; // health always starts full
    await frame();

    // biome
    const { changed } = this.biomes.applyLevel(this.state.level, this.state);
    if (changed) this.bus.emit('biome:change', { biome: this.state.biome, biomeIndex: this.state.biomeIndex });

    // build phases, each followed by a yield
    this._generateDungeon();
    await frame();
    this._buildWorld();
    await frame();
    this.lighting = new LightingSystem();
    this.lighting.sceneRef = this.scene;
    this.lighting.init(this.scene, this._dungeon, this.state.biome);
    await frame();
    this._initProps();
    await frame();
    this.smoke = new SmokeSystem(this.scene);
    this.smoke.clearEmitters();
    await frame();
    this.particles = new ParticleSystem(this.scene, this.lighting.torchLights.map(l => l.position));
    await frame();
    this.runes = new RuneSystem(this.scene, this._dungeon, this.state.biome);
    await frame();
    this.orbsUI = new OrbSystem(this.scene);
    this.orbsUI.onBuffCollected = (x, z) => this._rollBuff(x, z);
    this.orbsUI.onHealth = () => this._collectHealth();
    await frame();
    this._initCombat();
    await frame();
    this._placeWaterPuddles();
    this._setupPlayerStart();

    // messages & events
    this._emitLevelStart();
    if (startMessage) this._message(startMessage);
    this._goalToasts();

    // re-apply carried buff side effects AFTER systems rebuilt (or clear stuck visuals)
    if (carriedBuff) {
      this.state.buffEffect = carriedBuff.effect;
      this.state.buffTime = carriedBuff.time;
    } else {
      this.state.buffEffect = 0; this.state.buffTime = 0; // clear stuck visuals (gone-fireball fix)
    }

    // safe spawn: rooted + invincible, mobs idle
    this.state.safeSpawn = PLAYER.SAFE_SPAWN_TIME;
    this.state.invulnTimer = PLAYER.SAFE_SPAWN_TIME;

    this._isRunning = true;
    this._lastTime = performance.now();
    this._fpsWindow = [];
    // precompile ALL shader programs while the loading overlay is still up —
    // without this, first contact with each material (first orb, first torch
    // combo) stalls the frame on a synchronous GLSL compile mid-combat
    try {
      this.renderer.compile(this.scene, this.camera);
      await frame();
      // post.compile() precompiles the effect chain (bloom etc.) too
      this.post?.compile?.();
      await frame();
    } catch { /* non-fatal — worst case we compile lazily as before */ }
    this._hideLevelTitleWhenReady();
    this._updateHUD();
    if (!this._loopStarted) { this._loopStarted = true; this._animate(); }
  }

  _generateDungeon() {
    const seed = Date.now() ^ (Math.random() * 0xffffffff);
    this.state.dungeonSeed = seed;
    this._dungeon = new DungeonGenerator(seed, this.state.biome).generate();
  }

  _buildWorld() {
    this.world = new WorldBuilder();
    this.world.build(this.scene, this._dungeon, this.biomes.textures());
  }

  _initProps() {
    this.props = new PropSystem();
    const rng = Math.random;
    const res = this.props.build(this.scene, this._dungeon, this.state.biome, rng);
    this.world.addCollisionBoxes(this.props.collisionBoxes || []);
    // sarcophagi collision boxes
    const boxes = [];
    for (const sarco of this.props.sarcophagi) {
      boxes.push({ minX: sarco.pos.x - 0.55, maxX: sarco.pos.x + 0.55, minZ: sarco.pos.z - 1.15, maxZ: sarco.pos.z + 1.15 });
    }
    this.world.addCollisionBoxes(boxes);
    if (this._degraded) this.props.reduceDecorations(0.5);
  }

  _initCombat() {
    // shooter
    this.shooter = new OrbShooter(this.scene);
    this.shooter.onExplode = (x, y, z, dmg, radius) => this._applyExplosion(x, y, z, dmg, radius);
    this.shooter.onHitEnemy = (enemy, dmg) => this._hitSkeleton(enemy, dmg, 'orb');
    this.shooter.enemiesRef = () => this.skeletons.enemies;
    this.shooter.collisionBoxesRef = () => this.world.collisionBoxes;

    // skeleton system
    this.skeletons = new SkeletonSystem(this.scene);
    this.skeletons.onKill = (e, kind) => this._onEnemyKilled(e, kind);
    this.skeletons.onPlayerDamaged = (dmg, source) => this._damagePlayer(dmg);
    this.skeletons.onBurn = () => this._message('Something stirs in the ashes...');
    this.skeletons.onBlinkHit = (x, z, radius, dmg) => {
      const p = this.playerPos();
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < radius ** 2) this._damagePlayer(dmg);
    };
    this.skeletons.onSmokeTick = (dmg) => this._damagePlayer(dmg);

    const isBossLevel = this.state.level % 7 === 0;
    if (isBossLevel) {
      this._bossPortalOpen = false;
      this.skeletons.spawnBoss(this._dungeon, this.state.level, this.state.ngPlus,
        this.state.collectedOrbs, this.state.maxHealth,
        null,
        this.skeletons.onBlinkHit, null);
      document.getElementById('boss-bar-wrap').style.display = 'block';
      document.getElementById('boss-label').textContent = this.skeletons.boss.label;
    } else {
      this._bossPortalOpen = true;
      const hasArena = this._dungeon.rooms.some(r => r.type === 'ARENA');
      this.skeletons.buildSpawnPlan(this.state.level, this.state.collectedOrbs,
        this._dungeon, this.state.biome, null, hasArena);
      document.getElementById('boss-bar-wrap').style.display = 'none';
      this._burnSpawnedThisLevel = false;
    }

    // hunter
    if (this.state.buffEffect === 5 && !this.hunter) {
      this.hunter = new Hunter(this.scene);
    }
  }

  _placeWaterPuddles() {
    // VAULT rooms only — centered plane y 0.02, sine-wave vertex displacement per frame
    this.waterMeshes = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a6a8a, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.75 });
    for (const room of this._dungeon.rooms) {
      if (room.type !== 'VAULT') continue;
      const w = room.w * WORLD.CELL_SIZE * 0.8, h = room.h * WORLD.CELL_SIZE * 0.8;
      const geo = new THREE.PlaneGeometry(w, h, 8, 8);
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set((room.cx + (room.w - 1) / 2) * WORLD.CELL_SIZE, 0.02, (room.cz + (room.h - 1) / 2) * WORLD.CELL_SIZE);
      this.scene.add(mesh);
      this.waterMeshes.push(mesh);
    }
  }

  _setupPlayerStart() {
    const e = this._dungeon.entranceCell;
    const cs = WORLD.CELL_SIZE;
    this.state.player.x = e.x * cs;
    this.state.player.z = e.z * cs;
    this.state.player.yaw = Math.PI; // face into the dungeon
    this.state.player.pitch = 0;
    // CRITICAL: sync the camera itself — the update loop moves camera.position,
    // so a stale camera at the origin leaves the player outside the dungeon
    this.camera.position.set(this.state.player.x, PLAYER.EYE ?? 1.6, this.state.player.z);
    this._exitCellCenter = { x: this._dungeon.exitCell.x * cs, z: this._dungeon.exitCell.z * cs };
  }

  _teardownLevel() {
    this.hunter?.dispose?.(this.scene); this.hunter = null;
    this.orbsUI?.dispose(this.scene); this.orbsUI = null;
    this.runes?.dispose(this.scene); this.runes = null;
    this.particles?.dispose(this.scene); this.particles = null;
    this.lighting?.dispose(this.scene); this.lighting = null;
    this.props?.dispose(this.scene); this.props = null;
    this.smoke?.dispose(this.scene); this.smoke = null;
    this.skeletons?.dispose(this.scene); this.skeletons = null;
    this.shooter?.dispose(this.scene); this.shooter = null;
    for (const m of this.waterMeshes ?? []) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.waterMeshes = null;
    this.world?.dispose(this.scene); this.world = null;
    this.portalMesh = null;
    this._disposeScene();
  }

  _disposeScene() {
    if (this.camera.parent === this.scene) this.scene.remove(this.camera); // detach camera (+children survive)
    this.scene.traverse(o => {
      if (o.geometry && o.geometry.__shared !== true) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map && !m.map.userData?.biomeCached) m.map.dispose();
          m.dispose();
        }
      }
    });
    this.scene.clear();
    this.scene.add(this.camera); // re-attach
  }

  // ============================== UPDATE LOOP ==============================
  _animate() {
    requestAnimationFrame(() => this._animate());
    const now = performance.now();
    const rawDt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;
    const hitching = rawDt > 0.25;
    if (!this._titleMode && this._isRunning && !hitching) this._trackFps(rawDt);

    let dt = rawDt;
    // hit-stop: world dt zeroed while active; camera shake still runs
    if (this.state.hitStop > 0) {
      this.state.hitStop -= rawDt;
      dt = 0;
    }

    const frozenAll = !this._isRunning;

    if (this._isRunning) this._update(dt, rawDt, frozenAll);
    this._render(now);
  }

  _update(dt, rawDt, frozenAll) {
    const input = this.input;
    const p = this.state.player;

    // ---- look ----
    if (input.isPointerLocked()) {
      const { dx, dy } = input.consumeMouse();
      p.yaw -= dx * PLAYER.SENSITIVITY;
      p.pitch -= dy * PLAYER.SENSITIVITY;
      p.pitch = Math.max(-PLAYER.PITCH_CLAMP, Math.min(PLAYER.PITCH_CLAMP, p.pitch));
    } else {
      input.consumeMouse();
      document.getElementById('prompt').style.display = 'block';
      document.getElementById('prompt').textContent = 'Click to explore';
    }

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch;

    // safe spawn clock
    if (this.state.safeSpawn > 0) {
      this.state.safeSpawn -= rawDt;
      this.state.invulnTimer = Math.max(this.state.invulnTimer, this.state.safeSpawn);
      const el = document.getElementById('safe-spawn');
      el.style.display = this.state.safeSpawn > 0 ? 'block' : 'none';
      el.textContent = `Protected — ${Math.ceil(this.state.safeSpawn)}s`;
    } else {
      document.getElementById('safe-spawn').style.display = 'none';
    }

    // ---- movement (sub-stepped, anti-tunneling) ----
    const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
    const rightX = Math.cos(p.yaw), rightZ = -Math.sin(p.yaw);
    let mx = 0, mz = 0;
    if (input.isPressed('KeyW')) { mx += fwdX; mz += fwdZ; }
    if (input.isPressed('KeyS')) { mx -= fwdX; mz -= fwdZ; }
    if (input.isPressed('KeyA')) { mx -= rightX; mz -= rightZ; }
    if (input.isPressed('KeyD')) { mx += rightX; mz += rightZ; }
    const moving = (mx !== 0 || mz !== 0) && this.state.safeSpawn <= 0;
    if (moving) {
      const len = Math.hypot(mx, mz); mx /= len; mz /= len;
    }
    const sprintHeld = (input.isPressed('ShiftLeft') || input.isPressed('ShiftRight'));
    const sprinting = sprintHeld && moving;
    this.state.updateSprint(rawDt, sprintHeld, moving && sprintHeld, this.state.safeSpawn > 0);
    const buffMoveMult = this.state.buffEffect === 3 ? 1.2 : this.state.buffEffect === 4 ? 1.5 : 1;
    const speed = PLAYER.BASE_SPEED * (sprinting ? this.state.sprintSpeedMult() : 1) * buffMoveMult;
    const camPos = this.camera.position;
    if (moving) {
      let remaining = speed * dt;
      while (remaining > 0) {
        const s = Math.min(ENEMY_SPAWN_SUBSTEP, remaining);
        remaining -= s;
        camPos.x += mx * s;
        camPos.z += mz * s;
        resolveCircleCollisions(this.world.collisionBoxes, camPos, PLAYER.RADIUS);
      }
    }
    this.state.player.x = camPos.x;
    this.state.player.z = camPos.z;

    // FOV kick while sprinting
    const targetFov = CAMERA.FOV + (sprinting ? CAMERA.SPRINT_FOV_KICK : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * 0.15;
      this.camera.updateProjectionMatrix();
    }

    // ---- toggles (edge-triggered by consumer comparing previous-frame state) ----
    if (input.isPressed('KeyP') && !this._prevP) this._togglePost();
    this._prevP = input.isPressed('KeyP');
    if (input.isPressed('Tab') && !this._prevTab) this._toggleLedger();
    this._prevTab = input.isPressed('Tab');

    // ---- timers ----
    this.state.levelTime += dt;
    this.state.runTime += dt;
    if (this.state.levelTime >= TIMED_RUN.LEVEL_TIME_LIMIT) { this._endRun('time'); return; }

    // ---- world systems ----
    const time = performance.now();
    this.lighting?.update(time);
    this.particles?.update(dt, camPos);
    this.smoke?.update(dt);
    this.runes?.update(performance.now());
    this.orbsUI?.update(dt, camPos);
    this.props?.update(dt);

    // hazards tick (lava/acid): 1 dmg per 0.8 s within 1.2 u, i-frames respected
    this._tickHazards(dt);

    // breakables: step-on within 0.45 u
    this._tickBreakables();

    // sarcophagi proximity
    this._tickSarcophagi();

    // ---- combat ----
    const canFight = this.state.safeSpawn <= 0 && !frozenAll;
    if (canFight) {
      this._updateShooting(dt);
      this._updateSwordCombat(dt);
    }

    // ---- buffs ----
    if (dt > 0 && this.state.updateBuff(dt)) this._onBuffExpired();
    // BRIGHT visual: ambient ×2 while active (applyBRIGHT is edge-safe, cheap to call every frame)
    this.lighting?.applyBRIGHT?.(this.state.buffEffect === 1, BIOMES[this.state.biome]);

    // ---- skeletons / boss / hunter ----
    const brightActive = this.state.buffEffect === 1;
    this.skeletons?.drainQueue(dt, camPos, this.state.level, this.state.ngPlus, this.state.collectedOrbs, this.state.bossKills, frozenAll || this.state.safeSpawn > 0);
    this.skeletons?.update(dt, {
      playerPos: camPos,
      dt,
      collisionBoxes: () => this.world.collisionBoxes,
      losFn: (x1, z1, x2, z2) => this._hasLineOfSight(x1, z1, x2, z2),
      pathStepFn: (x1, z1, x2, z2) => this._pathStep(x1, z1, x2, z2),
      invuln: this.state.invulnTimer > 0,
      safeSpawn: this.state.safeSpawn > 0,
      brightActive,
      frozenAll,
      playerMaxHealth: this.state.maxHealth,
      level: this.state.level, ngPlus: this.state.ngPlus, souls: this.state.collectedOrbs,
      bossKills: this.state.bossKills,
      swordBreakCheck: (pos) => this._swordBreaksProjectile(pos)
    });
    if (this.hunter && this.state.buffEffect === 5) {
      this.hunter.update(dt, camPos, this.skeletons?.enemies ?? [],
        (x1, z1, x2, z2) => this._hasLineOfSight(x1, z1, x2, z2),
        (e, dmg) => this._hitSkeleton(e, dmg, 'hunter'),
        this.state.collectedOrbs);
    } else if (this.hunter && this.state.buffEffect !== 5) {
      this.hunter.dispose(this.scene); this.hunter = null;
    }
    this.shooter?.update(dt, this.skeletons?.enemies ?? []);

    // BURN spawn: entire level cleared (non-boss, non-arena)
    if (!this._bossLevel() && !this._hasArena() && !this._burnSpawnedThisLevel &&
        this.skeletons && this.skeletons.queue.length === 0 &&
        this.skeletons.enemies.every(e => e.state === 'DEAD')) {
      this._burnSpawnedThisLevel = true;
      this.skeletons.spawnBURN(this._dungeon, camPos, this.state.ngPlus);
    }

    // ---- invuln / regen ----
    if (this.state.invulnTimer > 0) this.state.invulnTimer -= dt;
    this._regenAccum += dt;
    if (this._regenAccum >= PLAYER.REGEN_INTERVAL) {
      this._regenAccum = 0;
      if (this.state.health < this.state.maxHealth) this.state.health++;
    }

    // ---- camera shake ----
    if (this._shakeT > 0) {
      this._shakeT -= rawDt;
      const k = this._shakeT / PLAYER.SHAKE_TIME;
      this.camera.position.x += (Math.random() - .5) * 0.08 * k;
      this.camera.position.y = (PLAYER.EYE ?? 1.6) + (Math.random() - .5) * 0.08 * k;
    } else {
      this.camera.position.y = PLAYER.EYE ?? 1.6;
    }

    // ---- water animation ----
    if (this.waterMeshes) {
      const t = performance.now() * 0.001;
      for (const mesh of this.waterMeshes) {
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          pos.setZ(i, Math.sin(t * 1.5 + i) * 0.03);
        }
        pos.needsUpdate = true;
      }
    }

    // ---- exit check ----
    this._checkExitRoom();

    // ---- directional hint every 8 s ----
    this._hintAccum += dt;
    if (this._hintAccum >= 8) {
      this._hintAccum = 0;
      const ex = this._exitCellCenter.x - camPos.x, ez = this._exitCellCenter.z - camPos.z;
      const dist = Math.round(Math.hypot(ex, ez));
      this._message(`Golden exit lies ${this._compassDir(ex, ez)} (${dist}m)`);
    }

    // ---- boss bar / portal ----
    if (this.skeletons?.boss) {
      const b = this.skeletons.boss;
      document.getElementById('boss-fill').style.width = `${Math.max(0, b.hp / b.maxHp * 100)}%`;
      if (b.state === 'DEAD' && !this._bossPortalOpen) this._openBossPortal();
    }

    // ---- HUD & evolution ----
    this._updateHUD();
    this._checkWeaponEvolution();

    // enemy glow targets
    const alive = (this.skeletons?.enemies ?? []).filter(e => e.state !== 'DEAD');
    this.post.setEnemyTargets(alive.map(e => e.group));
    this._nearestEnemyDist = alive.length ? Math.min(...alive.map(e => Math.hypot(e.pos.x - camPos.x, e.pos.z - camPos.z))) : null;
  }

  _render(time) {
    this.sword.group.visible = this.state.buffEffect !== 2; // sword hidden during FIREBALL
    if (this._titleMode) return; // title loop renders itself
    this.post.render(time, this._nearestEnemyDist);
  }

  // ============================== COMBAT ==============================
  _updateShooting(dt) {
    const shooting = this.input.isMouseDown(0);
    if (shooting && !this._prevLMB) this._fireStep(true);
    else if (shooting) {
      this._lmbAccum = (this._lmbAccum ?? 0) + dt;
      if (this._lmbAccum >= ORB_WEAPON.STEP_INTERVAL) { this._lmbAccum = 0; this._fireStep(false); }
    } else this._lmbAccum = ORB_WEAPON.STEP_INTERVAL;
    this._prevLMB = shooting;

    // sequence expiry
    if (this._seqStep > 0 && performance.now() - this._seqLastAt > ORB_WEAPON.SEQUENCE_WINDOW * 1000) {
      this._seqStep = 0;
    }

    // fireball buff: RMB held
    if (this.state.buffEffect === 2 && this.input.isMouseDown(2)) {
      this._fbCooldown = (this._fbCooldown ?? 0) - dt;
      if (this._fbCooldown <= 0) {
        this._fbCooldown = ORB_WEAPON.FIREBALL_COOLDOWN;
        this._fireProjectile(3, true);
      }
    } else if (!this.input.isMouseDown(2)) this._fbCooldown = 0;

    // RMB sword edge press (only when no fireball)
    if (this.state.buffEffect !== 2) {
      const rmb = this.input.isMouseDown(2);
      if (rmb && !this._prevRMB) this.sword.pressAttack();
      this._prevRMB = rmb;
    }
  }

  _fireStep(isClick) {
    // only the FIRST step of a NEW sequence costs 1 orb; steps 2–3 free
    if (this._seqStep === undefined || this._seqStep === 0 || performance.now() - this._seqLastAt > ORB_WEAPON.SEQUENCE_WINDOW * 1000) {
      if (this.state.collectedOrbs <= 0) {
        if (!this._noAmmoShown) { this._message('No orbs! Slay skeletons to gather orbs'); this._noAmmoShown = true; }
        return;
      }
      this.state.collectedOrbs--;
      this._seqStep = 1;
      this._noAmmoShown = false;
    } else {
      this._seqStep = Math.min(3, this._seqStep + 1);
    }
    this._seqLastAt = performance.now();
    this._fireProjectile(this._seqStep, false);
  }

  _fireProjectile(step, fireball) {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = new THREE.Vector3().copy(this.camera.position).addScaledVector(dir, 0.6);
    const slot = this.shooter.fire(origin, dir, step, this.state.collectedOrbs, fireball);
    if (slot) {
      slot.damage = fireball ? orbExplodeDamage(this.state.collectedOrbs)
        : step === 3 ? orbExplodeDamage(this.state.collectedOrbs)
        : orbDirectDamage(this.state.collectedOrbs);
    }
  }

  _applyExplosion(x, y, z, dmg, radius) {
    for (const e of this.skeletons?.enemies ?? []) {
      if (e.state === 'DEAD') continue;
      if ((e.pos.x - x) ** 2 + (e.pos.z - z) ** 2 < radius ** 2) this._hitSkeleton(e, dmg, 'explosion');
    }
    // breakables too
    for (const br of this.props?.breakables ?? []) {
      if (!br.alive) continue;
      if ((br.pos.x - x) ** 2 + (br.pos.z - z) ** 2 < radius ** 2) this._breakProp(br);
    }
  }

  _updateSwordCombat(dt) {
    this.sword.onDamage = (stepIdx) => {
      const scale = totalSwordScale(this.state.weaponTier, this.state.buffEffect === 3 ? 1.5 : 1);
      const range = 2.2 * scale * (1 + 0.04 * this.state.weaponTier) * (stepIdx === 2 ? 1.25 : 1);
      const arcDot = SWORD_COMBO_ARC[stepIdx];
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const origin = this.camera.position;
      let hitCount = 0;
      const tier = this.state.weaponTier;
      const dmgBase = swordHitDamage(stepIdx, tier);
      const sizePart = (1 + (scale - 1) * 0.5);
      const dmgMult = sizePart * Math.pow(1.1, tier) * Math.pow(1.1, Math.floor(this.state.level / 5));
      const currentDamage = dmgBase * dmgMult;
      for (const e of this.skeletons?.enemies ?? []) {
        if (e.state === 'DEAD' || e.frozen) continue;
        const toE = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
        const d = toE.length();
        if (d > range + 0.5) continue;
        toE.normalize();
        const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        if (flat.dot(toE) >= arcDot) {
          this._hitSkeleton(e, currentDamage, 'sword');
          hitCount++;
        }
      }
      // breakables in a slightly looser cone over full reach
      for (const br of this.props?.breakables ?? []) {
        if (!br.alive) continue;
        const toB = new THREE.Vector3(br.pos.x - origin.x, 0, br.pos.z - origin.z);
        if (toB.length() > range) continue;
        toB.normalize();
        const flat = new THREE.Vector3(dir.x, 0, dir.z).normalize();
        if (flat.dot(toB) >= arcDot - 0.12) this._breakProp(br);
      }
      // break enemy projectiles in the cone
      this.skeletons?.breakProjectilesInCone((pos) => {
        const toP = new THREE.Vector3(pos.x - origin.x, 0, pos.z - origin.z);
        if (toP.length() > range) return false;
        toP.normalize();
        return new THREE.Vector3(dir.x, 0, dir.z).normalize().dot(toP) >= arcDot;
      });
      if (hitCount > 0) {
        this.state.hitStop = Math.max(this.state.hitStop, 0.06);
        this.bus.emit('sword:hit', { step: stepIdx, enemiesHit: hitCount, damage: currentDamage });
        this._rollSwordProcs(tier);
      }
    };
    this.sword.update(dt, this._attackSpeed());
  }

  _attackSpeed() {
    const buffMult = this.state.buffEffect === 3 ? 1.2 : this.state.buffEffect === 4 ? 1.5 : 1;
    return buffMult * attackSpeedFromSouls(this.state.collectedOrbs);
  }

  _rollSwordProcs(tier) {
    // electric proc (all tiers): 5% chance, blast 5× orb damage within 20 u
    if (Math.random() < 0.05) {
      const blast = 5 * (1 + 0.02 * this.state.collectedOrbs) * 2; // ×5 orb damage (base 2)
      let count = 0;
      const p = this.camera.position;
      for (const e of this.skeletons?.enemies ?? []) {
        if (e.state === 'DEAD') continue;
        if ((e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2 < 20 ** 2) { this._hitSkeleton(e, blast, 'electric'); count++; }
      }
      if (count > 0) {
        this.state.hitStop = 0.12;
        this._message(`ELECTRIC CHAIN — ${count} foes blasted!`);
        this.skeletons?.firePatch(p.x, p.z);
      }
    }
    // arc bolts (tiers 3–5): pooled homing projectiles doing orb damage frozen at fire time
    const chance = [0, 0, 0, 0.10, 0.35, 1.0][tier] ?? 0;
    if (chance > 0 && Math.random() < chance) {
      const bolts = tier === 5 ? 2 : 1;
      this._spawnArcBolts(bolts);
    }
  }

  _spawnArcBolts(n) {
    if (!this.arcBolts) {
      this.arcBolts = [];
      for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.12),
          new THREE.MeshBasicMaterial({ color: 0x99eeff }));
        m.visible = false;
        this.scene.add(m);
        this.arcBolts.push({ mesh: m, vel: new THREE.Vector3(), life: -1, target: null, dmg: 0 });
      }
    }
    const p = this.camera.position;
    const candidates = (this.skeletons?.enemies ?? []).filter(e =>
      e.state !== 'DEAD' && (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2 < 20 ** 2)
      .sort((a, b) => (a.pos.x - p.x) ** 2 + (a.pos.z - p.z) ** 2 - ((b.pos.x - p.x) ** 2 + (b.pos.z - p.z) ** 2));
    const dmg = Math.round((1 + 0.02 * this.state.collectedOrbs) * 2);
    let fired = 0;
    for (const bolt of this.arcBolts) {
      if (bolt.life >= 0 || fired >= n) continue;
      const target = candidates[fired % Math.max(1, candidates.length)];
      if (!target) break;
      bolt.target = target;
      bolt.dmg = dmg;
      bolt.life = 1.2;
      bolt.mesh.position.copy(p);
      bolt.mesh.visible = true;
      fired++;
    }
    this._arcBoltTargetsDirty = candidates.length > 0;
  }

  _updateArcBolts(dt) {
    if (!this.arcBolts) return;
    for (const bolt of this.arcBolts) {
      if (bolt.life < 0) continue;
      bolt.life -= dt;
      if (!bolt.target || bolt.target.state === 'DEAD') {
        // re-target nearest alive enemy
        const p = this.camera.position;
        bolt.target = (this.skeletons?.enemies ?? []).filter(e => e.state !== 'DEAD')
          .sort((a, b) => ((a.pos.x - p.x) ** 2 + (a.pos.z - p.z) ** 2) - ((b.pos.x - p.x) ** 2 + (b.pos.z - p.z) ** 2))[0] || null;
        if (!bolt.target) { bolt.life = -1; bolt.mesh.visible = false; continue; }
      }
      const t = bolt.target;
      const to = new THREE.Vector3(t.pos.x - bolt.mesh.position.x, 1.2 - bolt.mesh.position.y, t.pos.z - bolt.mesh.position.z);
      const d = to.length();
      if (d < 0.6) {
        this._hitSkeleton(t, bolt.dmg, 'arcBolt');
        bolt.life = -1; bolt.mesh.visible = false;
        continue;
      }
      to.normalize().multiplyScalar(24 * dt); // 24 u/s homing
      bolt.mesh.position.add(to);
      if (bolt.life <= 0) { bolt.life = -1; bolt.mesh.visible = false; }
    }
  }

  _hitSkeleton(enemy, damage, sourceKind) {
    this.skeletons?.hitEnemy(enemy, damage, sourceKind);
  }

  _swordBreaksProjectile(pos) {
    // cheap: only break when very close to the blade plane — approximated by distance to camera
    const d = pos.distanceTo(this.camera.position);
    return d < 1.6 && this.sword.phase === 'swing';
  }

  // ============================== KILLS / DROPS / BUFFS ==============================
  _onEnemyKilled(enemy, sourceKind) {
    this.orbsUI?.deathBurst(enemy.pos.x, 1.2, enemy.pos.z);
    const drops = enemy.drops ?? 0;
    for (let i = 0; i < drops; i++) {
      this.orbsUI.spawnOrb(
        enemy.pos.x + (Math.random() - .5) * 0.8, 0.6, enemy.pos.z + (Math.random() - .5) * 0.8,
        () => { this.state.collectedOrbs++; });   // INSTANT credit — orbs ARE souls
    }
    if (Math.random() < DROP.HEALTH_CHANCE) {
      this.orbsUI.spawnHealth(enemy.pos.x, enemy.pos.z);
    }
    // boss defeat
    if (enemy.isBoss || enemy === this.skeletons?.boss) {
      this._onBossDefeated();
    }
  }

  _onBossDefeated() {
    const s = this.state;
    s.bossKills++;                                   // permanent +10% move AND attack speed for mobs
    s.maxHealth++;                                   // +1 permanent heart
    s.health = s.maxHealth;                          // heal +1
    s.applyBuff(this._pickBuffNotCurrent(), BUFF.BOSS_DURATION); // 5 min uncapped buff
    const reward = s.level * Math.max(1, s.ngPlus);  // soul reward loops into pressure & ladder
    s.collectedOrbs += reward;
    this._openBossPortal();
    this._message(`The Spectral Lord falls — +${reward} souls, a heart and a blessing are yours. The portal opens!`);
  }

  _openBossPortal() {
    this._bossPortalOpen = true;
    if (this.lighting?.markerExit) this.lighting.markerExit.beam.visible = true;
  }

  _collectHealth() {
    this.state.health = Math.min(this.state.maxHealth, this.state.health + DROP.HEALTH_RESTORE); // adds 3, capped at max
  }

  _buffPool() { return [1, 2, 3, 4, 5]; }

  _pickBuffNotCurrent() {
    const pool = this._buffPool().filter(b => b !== this.state.buffEffect); // never repeat back-to-back
    return pool[(Math.random() * pool.length) | 0];
  }

  _rollBuff(x, z) {
    const effect = this._pickBuffNotCurrent();
    this.state.applyBuff(effect, BUFF.MAX_DURATION);
    const names = { 1: 'BRIGHT', 2: 'FIREBALL', 3: 'EMPOWERED', 4: 'GODSPEED', 5: 'HUNTER' };
    this._message(`${names[effect]}!`);
    if (effect === 5) this.hunter = new Hunter(this.scene);
  }

  _onBuffExpired() {
    if (this.hunter) { this.hunter.dispose(this.scene); this.hunter = null; }
  }

  // ============================== PROPS / HAZARDS ==============================
  _tickHazards(dt) {
    this._hazardAccum += dt;
    if (this._hazardAccum < 0.8) return;
    this._hazardAccum = 0;
    const p = this.camera.position;
    for (const hz of this.props?.hazards ?? []) {
      if ((p.x - hz.x) ** 2 + (p.z - hz.z) ** 2 < 1.2 ** 2) {
        this._damagePlayer(1);
        break;
      }
    }
  }

  _tickBreakables() {
    const p = this.camera.position;
    for (const br of this.props?.breakables ?? []) {
      if (!br.alive) continue;
      if ((p.x - br.pos.x) ** 2 + (p.z - br.pos.z) ** 2 < 0.45 ** 2) this._breakProp(br);
    }
  }

  _breakProp(br) {
    br.alive = false;
    br.mesh.visible = false;
    this.smoke?.puff(br.pos.x, 0.6, br.pos.z);
    this.bus.emit('prop:broken', {});
    // 6% buff roll (+0.05%/orb above 100); 20% chance to drop 1–5 soul orbs
    const bonus = this.state.collectedOrbs > BUFF.EXCESS_ORB_THRESHOLD
      ? (this.state.collectedOrbs - BUFF.EXCESS_ORB_THRESHOLD) * BUFF.EXCESS_ORB_BONUS : 0;
    if (Math.random() < BUFF.CHANCE + bonus) {
      this.orbsUI.spawnBuff(br.pos.x, br.pos.z);
    } else if (Math.random() < BUFF.ORB_DROP_CHANCE) {
      const n = BUFF.ORB_DROP_MIN + Math.floor(Math.random() * (BUFF.ORB_DROP_MAX - BUFF.ORB_DROP_MIN + 1));
      for (let i = 0; i < n; i++) this.orbsUI.spawnOrb(br.pos.x, 0.6, br.pos.z, () => { this.state.collectedOrbs++; });
    }
  }

  _tickSarcophagi() {
    const p = this.camera.position;
    for (const sarco of this.props?.sarcophagi ?? []) {
      if (sarco.opened) continue;
      if ((p.x - sarco.pos.x) ** 2 + (p.z - sarco.pos.z) ** 2 < 2.5 ** 2) {
        sarco.opened = true;
        this.bus.emit('prop:opened', {});
        // lid slides open over 0.6 s (simple immediate shift acceptable visually via tween below)
        const lid = sarco.lid;
        const start = performance.now();
        const slide = () => {
          const k = Math.min(1, (performance.now() - start) / 600);
          lid.position.x = k * 1.0;
          lid.rotation.z = -k * 0.4;
          if (k < 1) requestAnimationFrame(slide);
        };
        slide();
        this.orbsUI.spawnOrb(sarco.pos.x, 0.8, sarco.pos.z, () => { this.state.collectedOrbs++; }); // guaranteed 1 orb
        if (Math.random() < 0.3) {
          // spawn a Wraith (level-scaled)
          this.skeletons.summonMinion(
            { x: Math.round(sarco.pos.x / WORLD.CELL_SIZE), z: Math.round(sarco.pos.z / WORLD.CELL_SIZE) },
            this.state.level, this.state.ngPlus, this.state.collectedOrbs, this.state.bossKills);
        }
      }
    }
  }

  // ============================== NAV HELPERS ==============================
  _hasLineOfSight(x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / 0.4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (circleHitsBox(this.world.collisionBoxes, x1 + dx * t, z1 + dz * t, 0.25)) return false;
    }
    return true;
  }

  _pathStep(x1, z1, x2, z2) {
    // greedy 4-neighbor step toward the player's CELL, skipping colliding centers
    const cs = WORLD.CELL_SIZE;
    const cx = Math.round(x1 / cs), cz = Math.round(z1 / cs);
    const px = Math.round(x2 / cs), pz = Math.round(z2 / cs);
    let best = null, bestD = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= this._dungeon.gridSize || nz >= this._dungeon.gridSize) continue;
      if (this._dungeon.grid[nz][nx] === 'empty') continue;
      const wx = nx * cs, wz = nz * cs;
      if (circleHitsBox(this.world.collisionBoxes, wx, wz, 0.35)) continue;
      const d = (wx - x2) ** 2 + (wz - z2) ** 2;
      if (d < bestD) { bestD = d; best = { x: wx, z: wz }; }
    }
    return best;
  }

  _compassDir(dx, dz) {
    // 8-way compass, atan2 sectors of 45°; north = -z
    const ang = Math.atan2(dx, -dz); // 0 = north, clockwise east
    const dirs = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
    const idx = Math.round(ang / (Math.PI / 4));
    return dirs[((idx % 8) + 8) % 8];
  }

  // ============================== EXIT / META ==============================
  _checkExitRoom() {
    const p = this.camera.position;
    const inExit = (p.x - this._exitCellCenter.x) ** 2 + (p.z - this._exitCellCenter.z) ** 2 < PLAYER.EXIT_ROOM_DIST2;
    this.state.inExitRoom = inExit;
    const ep = document.getElementById('exit-prompt');
    if (inExit && this._bossPortalOpen) {
      ep.style.display = 'block';
      ep.textContent = 'The depths beckon further... [E] to descend';
      if (this.input.isPressed('KeyE') && !this._prevE) this._descend();
    } else {
      ep.style.display = 'none';
    }
    this._prevE = this.input.isPressed('KeyE');
  }

  _descend() {
    const s = this.state;
    const next = new GameState({
      level: s.level + 1,
      runTime: s.runTime,
      collectedOrbs: s.collectedOrbs,
      weaponTier: s.weaponTier,     // locked at max reached within a run
      ngPlus: s.ngPlus,
      bossKills: s.bossKills,
      maxHealth: s.maxHealth
    });
    this._regenerateDungeon({ nextState: next, startMessage: `Level ${next.level} — descend!` });
  }

  _bossLevel() { return this.state.level % 7 === 0; }
  _hasArena() { return this._dungeon?.rooms.some(r => r.type === 'ARENA') ?? false; }

  _endRun(reason) {
    if (this._deathShown) return;
    this._deathShown = true;
    this._isRunning = false;
    const entry = {
      level: this.state.level, time: this.state.runTime,
      orbs: this.state.collectedOrbs, ngPlus: this.state.ngPlus
    };
    this.leaderboard.submit(entry);
    this._lastDeathEntry = entry;
    this._writeSave(this.state); // Save-for-later data written at death; Load restores it
    this._saveAvailableOnDeath = true;
    document.getElementById('btn-save').disabled = false;
    const rank = this.leaderboard.rankOf(entry);
    const mm = Math.floor(this.state.runTime / 60), ss = String(Math.floor(this.state.runTime % 60)).padStart(2, '0');
    const ngTxt = this.state.ngPlus > 0 ? ` · NG+${this.state.ngPlus}` : '';
    document.getElementById('death-title').textContent = reason === 'dead' ? 'The dead claim you' : 'The darkness consumes you';
    document.getElementById('death-stats').textContent =
      `Level reached: ${this.state.level}${ngTxt} · Total time: ${mm}:${ss} · Souls: ${this.state.collectedOrbs}${rank ? ` · Rank #${rank}` : ''}`;
    // NG+ button preview: post-toll bank AND the tier that bank buys
    const kept = Math.floor(this.state.collectedOrbs * 0.25);
    const t = weaponTier(kept);
    const half = Math.max(1, Math.floor(this.state.level / 2));
    document.getElementById('btn-ngplus').innerHTML =
      `New Game+ [Y] — Level ${half} (keep ${kept} of ${this.state.collectedOrbs} Souls${t > 0 ? ` → T${t}` : ' → Dagger'} · mobs +${200 * (this.state.ngPlus + 1)}% HP)`;
    document.getElementById('death-overlay').classList.add('visible');
  }

  _damagePlayer(dmg) {
    if (this.state.invulnTimer > 0) return; // i-frames respected
    this.state.health -= dmg;
    this.state.invulnTimer = PLAYER.INVULN_TIME;
    this._shakeT = PLAYER.SHAKE_TIME;
    this._regenAccum = 0;
    const flash = document.getElementById('damage-flash');
    flash.style.opacity = 1;
    setTimeout(() => flash.style.opacity = 0, 120);
    this._updateHUD();
    if (this.state.health <= 0) this._endRun('dead');
  }

  // ============================== EVOLUTION ==============================
  _checkWeaponEvolution() {
    const t = weaponTier(this.state.collectedOrbs);
    if (t <= this.state.weaponTier) return; // only upgrades
    this.state.weaponTier = t;
    this.sword.setTier(t);
    this.state.hitStop = 0.1;
    this._message(t === MAX_TIER ? 'Your blade is whole — the lightsaber sings' : `Your blade awakens — Tier ${t}`);
    this._updateHUD();
  }

  // ============================== HUD ==============================
  _updateHUD() {
    const s = this.state;
    document.getElementById('orb-count').textContent = s.collectedOrbs;
    document.getElementById('weapon-slot').textContent =
      `${EVOLUTION.TIER_NAMES[s.weaponTier].toUpperCase()} — T${s.weaponTier}`;
    document.getElementById('hp-fill').style.width = `${Math.max(0, s.health / s.maxHealth * 100)}%`;
    document.getElementById('hp-num').textContent = `${s.health} / ${s.maxHealth}`;
    const mm = Math.floor(Math.max(0, TIMED_RUN.LEVEL_TIME_LIMIT - s.levelTime) / 60);
    const ss = String(Math.floor(Math.max(0, TIMED_RUN.LEVEL_TIME_LIMIT - s.levelTime) % 60)).padStart(2, '0');
    const timerEl = document.getElementById('timer');
    timerEl.textContent = `${mm}:${ss}${s.ngPlus > 0 ? ' NG+' + s.ngPlus : ''}`;
    timerEl.classList.toggle('low', TIMED_RUN.LEVEL_TIME_LIMIT - s.levelTime < 30);
    document.getElementById('biome-label').textContent = `LEVEL ${s.level} · ${BIOMES[s.biome].label}`;
    const pips = document.querySelectorAll('#combo-pips .pip');
    pips.forEach((el, i) => el.classList.toggle('on', i < s.swordCombo || i < this.sword.comboStep));
    const badge = document.getElementById('buff-badge');
    if (s.buffEffect > 0) {
      badge.style.display = 'block';
      const names = { 1: 'BRIGHT', 2: 'FIREBALL', 3: 'EMPOWERED', 4: 'GODSPEED', 5: 'HUNTER' };
      badge.textContent = `${names[s.buffEffect]} ${Math.ceil(s.buffTime)}s`;
    } else badge.style.display = 'none';
    const sb = document.getElementById('sprint-bonus');
    // show only the ACCELERATION BONUS above the base ×1.55 (tier 0 = hidden)
    if (s.sprintTier > 0) {
      sb.style.display = 'block';
      sb.textContent = `SPRINT +${Math.round((s.sprintSpeedMult() / PLAYER.SPRINT_MULT - 1) * 100)}%`;
    } else sb.style.display = 'none';

    // danger glow: alpha = min(1, Σ(1/d)/2) per sector, living enemies within 40 m
    const p = this.camera.position;
    const sectors = { top: 0, bottom: 0, left: 0, right: 0 };
    for (const e of this.skeletons?.enemies ?? []) {
      if (e.state === 'DEAD') continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 40 || d < 0.5) continue;
      // sector relative to view direction
      const yaw = this.state.player.yaw;
      const rel = Math.atan2(dx, dz) - (yaw + Math.PI);
      let a = ((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2); // 0..2π, 0=behind? define: 0 = front
      const contrib = 1 / d;
      if (a < Math.PI / 4 || a > Math.PI * 7 / 4) sectors.top += contrib;      // behind → top border
      else if (a < Math.PI * 3 / 4) sectors.right += contrib;
      else if (a < Math.PI * 5 / 4) sectors.bottom += contrib;                  // front → bottom
      else sectors.left += contrib;
    }
    document.getElementById('danger-top').style.opacity = Math.min(1, sectors.top / 2);
    document.getElementById('danger-bottom').style.opacity = Math.min(1, sectors.bottom / 2);
    document.getElementById('danger-left').style.opacity = Math.min(1, sectors.left / 2);
    document.getElementById('danger-right').style.opacity = Math.min(1, sectors.right / 2);

    // stats panel content (live coefficients)
    const sp = document.getElementById('stats-panel');
    if (sp.style.display === 'block') sp.textContent = this._liveStats();
    // persistent right-side combat panel
    const side = document.getElementById('side-stats');
    if (side) {
      const txt = this._liveStats();
      if (side.dataset.txt !== txt) {
        side.dataset.txt = txt;
        let body = side.querySelector('.ss-body');
        if (!body) { body = document.createElement('div'); body.className = 'ss-body'; side.appendChild(body); }
        body.textContent = txt;
      }
    }
  }

  _liveStats() {
    const s = this.state;
    const scale = totalSwordScale(s.weaponTier, s.buffEffect === 3 ? 1.5 : 1);
    const dmgMult = damageMult(scale, s.weaponTier, s.level);
    return [
      `DMG ×${dmgMult.toFixed(2)}`,
      `Orb DMG ${(1 + 0.02 * s.collectedOrbs).toFixed(2)}`,
      `Reach ${(2.2 * scale * (1 + 0.04 * s.weaponTier)).toFixed(1)}`,
      `Enemy HP ×${(1 + 3 * s.ngPlus).toFixed(1)}`,
      `Mob speed ×${((1 + 0.02 * (s.level - 1)) * (1 + 0.1 * s.bossKills)).toFixed(2)}`,
      `Spawns ×${Math.min(1 + (s.level + s.collectedOrbs) / 10, 100).toFixed(2)}`,
      `Regen +1/${PLAYER.REGEN_INTERVAL}s`
    ].join('\n');
  }

  _togglePost() {
    this.post.enabled = !this.post.enabled;
  }

  // QA hook (smoke test): jump straight to the adaptive-resolution tier
  _forceAdaptiveResolution() {
    if (this._resScaled) return false;
    this._resScaled = true;
    const s = Math.min(devicePixelRatio, 2) * 0.75;
    this.renderer.setPixelRatio(s);
    this.post.setSize(Math.round(innerWidth * s), Math.round(innerHeight * s));
    return true;
  }

  _toggleLedger() {
    const lb = document.getElementById('leaderboard');
    const showing = lb.style.display === 'flex';
    lb.style.display = showing ? 'none' : 'flex';
    if (!showing) {
      const rows = document.getElementById('ledger-rows');
      const entries = this.leaderboard.top();
      rows.innerHTML = entries.length
        ? entries.map(e => `<div><span>NG+${e.ngPlus} · L${e.level}</span><span>${Math.floor(e.time / 60)}:${String(Math.floor(e.time % 60)).padStart(2, '0')}</span><span>${e.orbs} souls</span></div>`).join('')
        : '<div>No runs yet — descend!</div>';
    }
  }

  // ============================== MESSAGES / LOADING ==============================
  _goalToasts() {
    if (this.state.level === 1 && this.state.ngPlus === 0) {
      this._message('Skeletons hunt you — reach the golden exit!');
      this._message('Slay them for orbs — shoot or swing');
    } else if (this.state.ngPlus > 0 && this._wasNewNg) {
      this._message(`New Game+ ${this.state.ngPlus} — the depths grow stronger`);
    } else {
      this._message(`Level ${this.state.level} — descend!`);
    }
    this._wasNewNg = false;
  }

  _message(text) {
    const box = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'msg';
    div.textContent = text;
    box.appendChild(div);
    setTimeout(() => div.remove(), 3300);
    while (box.children.length > 4) box.firstChild.remove();
  }

  _showLevelTitle(levelNum) {
    const ov = document.getElementById('loading-overlay');
    ov.classList.add('visible');
    const ng = this.state.ngPlus > 0 ? ` · NG+${this.state.ngPlus}` : '';
    document.getElementById('loading-level').textContent = `LEVEL ${levelNum}${ng}`;
    document.getElementById('loading-biome').textContent = BIOMES[this.state.biome]?.label ?? '';
    const names = { 1: 'BRIGHT', 2: 'FIREBALL', 3: 'EMPOWERED', 4: 'GODSPEED', 5: 'HUNTER' };
    const descs = {
      0: 'No active buff',
      1: 'BRIGHT — the level lights up, enemies flee from you',
      2: 'FIREBALL — right-click hurls an explosive fireball',
      3: 'EMPOWERED — longer reach, faster movement & attacks',
      4: 'GODSPEED — +50% attack speed and +50% move speed',
      5: 'HUNTER — a spectral boss companion follows and attacks mobs'
    };
    document.getElementById('loading-buff').textContent = descs[this.state.buffEffect] ?? 'No active buff';
    document.getElementById('loading-stats').textContent = this._liveStats();
  }

  _hideLevelTitleWhenReady() {
    // lifts when rolling ~3 s avg fps ≥ 30 AND the spawn queue is drained; hard 8 s max-hold
    const start = performance.now();
    const check = () => {
      if (!this._isRunning) { requestAnimationFrame(check); return; }
      const heldLongEnough = performance.now() - start > 8000;
      const fpsOk = this._avgFps() >= 30;
      const drained = !this.skeletons || this.skeletons.queue.length === 0;
      if (heldLongEnough || (fpsOk && drained)) {
        document.getElementById('loading-overlay').classList.remove('visible');
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  // adaptive resolution: tiered pixel-ratio drops when sustained fps < 30.
  // Runs from level start (no 10s/15s grace) so weak GPUs get relief DURING the
  // first seconds of play instead of after the player is already dead.
  _trackFps(dt) {
    this._fpsWindow.push(1 / Math.max(dt, 0.0001));
    if (this._fpsWindow.length > 90) this._fpsWindow.shift(); // ~3 s at 30 fps
    if (this._avgFps() < 30) {
      this._lowFpsTimer += dt;
      if (this._lowFpsTimer > 2 && !this._resScaled) {
        this._resScaled = true;
        const s = Math.min(devicePixelRatio, 2) * 0.75;
        this.renderer.setPixelRatio(s);
        this.post.setSize(Math.round(innerWidth * s), Math.round(innerHeight * s));
      }
      if (this._lowFpsTimer > 6 && !this._degraded) {
        this._degraded = true;
        this.props?.reduceDecorations(0.5);
        this.world?.setDegraded(0.5);
        document.getElementById('perf-warning').style.display = 'block';
      }
    } else this._lowFpsTimer = Math.max(0, this._lowFpsTimer - dt);
  }

  _avgFps() {
    if (!this._fpsWindow.length) return 60;
    let sum = 0;
    for (const f of this._fpsWindow) sum += f;
    return sum / this._fpsWindow.length;
  }

  _emitLevelStart() {
    this.bus.emit('level:start', { level: this.state.level, biome: this.state.biome });
    this._updateHUD();
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post?.setSize(innerWidth, innerHeight);
  }
}

function frame() { return new Promise(r => requestAnimationFrame(r)); }
function time_ms() { return performance.now(); }
const ENEMY_SPAWN_SUBSTEP = 0.08;
const SWORD_COMBO_ARC = [Math.cos(0.38 * Math.PI), Math.cos(0.38 * Math.PI), Math.cos(0.09 * Math.PI)];

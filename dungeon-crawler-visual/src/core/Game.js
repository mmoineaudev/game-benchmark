import * as THREE from 'three';
import { WORLD, PLAYER, CAMERA, RENDERER, TIMED_RUN, ORB_WEAPON, SWORD, PROPS, HIT_STOP, LIGHTING, DROP } from './Constants.js';
import { GameState } from './GameState.js';
import { Leaderboard } from './Leaderboard.js';
import { EventBus } from './EventBus.js';
import { DungeonGenerator } from '../world/DungeonGenerator.js';
import { WorldBuilder } from '../world/WorldBuilder.js';
import { BiomeSystem } from '../world/BiomeSystem.js';
import { PropSystem } from '../world/PropSystem.js';
import { LightingSystem } from '../systems/LightingSystem.js';
import { InputSystem } from '../systems/InputSystem.js';
import { PostProcessing } from '../systems/PostProcessing.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { RuneSystem } from '../systems/RuneSystem.js';
import { OrbSystem } from '../entities/OrbSystem.js';
import { SmokeSystem } from '../systems/SmokeSystem.js';
import { SkeletonSystem } from '../entities/SkeletonSystem.js';
import { OrbShooter } from '../entities/OrbShooter.js';
import { PlayerSword } from '../entities/PlayerSword.js';
import { resolveCircleCollisions } from './Collision.js';

export class Game {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = new GameState();
    this._isRunning = false;
    this._lastTime = 0;
    this._delta = 0;
    this._pKeyWasDown = false;
    this._eKeyWasDown = false;
    this._promptEl = document.getElementById('prompt');
    this._orbCountEl = document.getElementById('orb-count');
    this._biomeLabelEl = document.getElementById('biome-label');
    this._comboPipsEl = document.getElementById('combo-pips');
    this._exitEl = document.getElementById('exit-prompt');
    this._messagesEl = document.getElementById('messages');
    this._prevOrbCount = 0;
    this._prevInExit = false;
    this._welcomeShown = false;
    this._lastHintTime = 0;
    this._sprinting = false;
    this.leaderboard = new Leaderboard();
    this.events = new EventBus();
    this.biomes = new BiomeSystem();
    this.smoke = null;
    this._tabWasDown = false;
    this._gameOverActive = false;
    this._lastEntry = null;
    this._onGameOverClick = null;
    this._timerEl = document.getElementById('timer');
    this._lbPanel = document.getElementById('leaderboard-panel');
    this._lbList = document.getElementById('leaderboard-list');
    this._gameOverEl = document.getElementById('game-over');
    this._goStats = document.getElementById('go-stats');
    this._goList = document.getElementById('go-leaderboard-list');
    this._heartsEl = document.getElementById('hearts');
    this._damageFlashEl = document.getElementById('damage-flash');
    this.skeletons = null;
    this.shooter = null;
    this.sword = null;
    this.props = null;
    this._noAmmoWarned = false;
    this._shakeTime = 0;
    this._fireCooldown = 0;
    this._swordHitApplied = false;
    this._rmbWasDown = false;
  }

  init() {
    this._initRenderer();
    this._initCamera();
    this._initPostProcessing();
    this._initInput();
    this.biomes.applyLevel(this.state.level, this.state);
    this._generateDungeon();
    this._buildWorld();
    this._initLighting();
    this._initProps();
    this._initSmoke();
    this._initParticles();
    this._initRunes();
    this._initOrbs();
    this._initCombat();
    this._placeWaterPuddles();
    this._setupPlayerStart();
    this._showMessage('Skeletons hunt you — reach the golden exit!', 'goal');
    this._showMessage('Slay them for orbs — shoot or swing', 'goal');
    this._bindEventToasts();
    this._emitLevelStart();
    this._updateHUD();
    this._isRunning = true;
    this._lastTime = performance.now();
    this._animate();
  }

  _showMessage(text, className) {
    if (!this._messagesEl) return;
    const el = document.createElement('div');
    el.className = 'msg' + (className ? ' ' + className : '');
    el.textContent = text;
    this._messagesEl.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, 4200);
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: RENDERER.ANTIALIAS });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDERER.EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(RENDERER.BACKGROUND_COLOR);

    this._onResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      if (this.post) this.post.resize(w, h);
    };
    window.addEventListener('resize', this._onResize);
  }

  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR,
    );
    this.scene.add(this.camera);
    this.sword = new PlayerSword(this.camera);
    // Each new slash (hit 1 or hit 2) re-arms the damage window
    this.sword.onSlash = () => { this._swordHitApplied = false; };
    // Headlight: warm point light attached to the camera, slightly above and
    // in front of the eye. No shadows (the 8-torch budget is untouched).
    // A camera child, so it survives level regens like the sword.
    this.headlight = new THREE.PointLight(
      LIGHTING.PLAYER_LIGHT_COLOR,
      LIGHTING.PLAYER_LIGHT_INTENSITY,
      LIGHTING.PLAYER_LIGHT_DISTANCE,
      LIGHTING.PLAYER_LIGHT_DECAY,
    );
    this.headlight.position.set(0, 0.15, -0.4);
    this.headlight.castShadow = false;
    this.camera.add(this.headlight);
  }

  _initPostProcessing() {
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
    this.post.init();
    this.state.effectsEnabled = true;
  }

  _initInput() {
    this.input = new InputSystem(this.renderer.domElement);
    this.input.init();
  }

  _generateDungeon() {
    this.state.dungeonSeed = Date.now();
    const gen = new DungeonGenerator(this.state.dungeonSeed, this.state.biome);
    this.dungeonData = gen.generate();
    this.state.entranceCell = this.dungeonData.entranceCell;
    this.state.exitCell = this.dungeonData.exitCell;
  }

  _buildWorld() {
    const textures = this.biomes.texturesFor(this.state.biome);
    this.worldBuilder = new WorldBuilder(this.scene, this.dungeonData, textures);
    const result = this.worldBuilder.build();
    this._collisionBoxes = result.collisionBoxes || [];
  }

  _initLighting() {
    this.lighting = new LightingSystem(this.scene, this.biomes.current.palette);
    this.lighting.init(this.dungeonData);
  }

  _initProps() {
    this.props = new PropSystem(this.scene, this.dungeonData, this.state.biome, this.events);
    const result = this.props.place();
    // Merge prop AABBs into the collision list BEFORE enemies spawn
    this._collisionBoxes.push(...(result.collisionBoxes || []));
    this.props.lavaHazard = ({ x, z }) => this._lavaDamage(x, z);
  }

  _lavaDamage(x, z) {
    if (this._gameOverActive) return;
    if (this.state.invulnTimer > 0 || this.state.health <= 0) return;
    if (!this._lastLavaHit || performance.now() - this._lastLavaHit > PROPS.LAVA_INTERVAL * 1000) {
      this._lastLavaHit = performance.now();
      this.state.health -= PROPS.LAVA_DAMAGE;
      this.state.invulnTimer = PLAYER.INVULN_TIME;
      this._flashDamage();
      if (this.state.health <= 0) this._gameOver('dead');
    }
  }

  _initSmoke() {
    this.smoke = new SmokeSystem(this.scene);
    this.smoke.init();
    this._rebindSmokeEmitters();
  }

  _rebindSmokeEmitters() {
    if (!this.smoke) return;
    this.smoke.clearEmitters();
    for (const s of (this.lighting.smokeSources || [])) {
      this.smoke.addEmitter(s.x, s.y, s.z, s.rate);
    }
  }

  _initParticles() {
    this.particles = new ParticleSystem(this.scene);
    this.particles.init();
  }

  _initRunes() {
    this.runes = new RuneSystem(this.scene, this.dungeonData);
    this.runes.init();
  }

  _initOrbs() {
    this.orbs = new OrbSystem(this.scene, this.dungeonData, this.state);
    this.orbs.init();
  }

  _initCombat() {
    this.shooter = new OrbShooter(this.scene);
    this.shooter.init();

    this.skeletons = new SkeletonSystem(this.scene, this.state);
    this.skeletons.init(this.dungeonData, this.state);
    this.skeletons.onKill = (x, z, orbs = 1) => {
      if (orbs > 0) this.orbs.spawnDrop(x, z, orbs);
      // 15% chance the kill also drops a full health reset
      if (Math.random() < DROP.HEALTH_CHANCE) this.orbs.spawnHealth(x, z);
      this.smoke.addTransient(x, 0.6, z, 10, 0.4);
    };
    this.skeletons.onPlayerDamaged = () => this._flashDamage();
    this.skeletons.onPlayerDeath = () => this._gameOver('dead');
    this.shooter.hitSkeleton = (skel) => this.skeletons.hitSkeleton(skel, ORB_WEAPON.DAMAGE);
    // Explosive orb (last of the volley): AOE damage around the blast point.
    // Only counts when the blast is low enough to reach ground-level enemies.
    this.shooter.onExplode = (x, y, z) => {
      if (!this.skeletons || y > 2.6) return;
      const range = ORB_WEAPON.EXPLODE_RADIUS;
      for (const s of this.skeletons.skeletons) {
        if (s.skel.state === 'DEAD') continue;
        const dx = s.x - x;
        const dz = s.z - z;
        if (dx * dx + dz * dz < range * range) {
          this.skeletons.hitSkeleton(s.skel, ORB_WEAPON.EXPLODE_DAMAGE);
        }
      }
    };
    this.shooter.onHitProp = (x, z) => {
      if (!this.props) return false;
      return this.props.hitBreakables(x, z);
    };
  }

  _placeWaterPuddles() {
    this._waterPuddles = [];
    const cs = this.dungeonData.cellSize;
    for (const room of this.dungeonData.rooms) {
      if (room.type !== 'VAULT') continue;
      const x = (room.cx + room.w / 2) * cs;
      const z = (room.cz + room.h / 2) * cs;
      const geo = new THREE.PlaneGeometry(3, 2);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x1a2a4a, roughness: 0.15, metalness: 0.9,
        transparent: true, opacity: 0.7,
      });
      const puddle = new THREE.Mesh(geo, mat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.position.set(x, 0.02, z);
      puddle.receiveShadow = true;
      this.scene.add(puddle);
      this._waterPuddles.push({ mesh: puddle, vertices: geo.attributes.position.array.slice() });
    }
  }

  _setupPlayerStart() {
    const { x, z } = this.dungeonData.entranceCell;
    const cs = this.dungeonData.cellSize;
    this.state.player.x = x * cs + cs / 2;
    this.state.player.z = z * cs + cs / 2;
    this.state.player.yaw = Math.PI;
    this.state.player.pitch = 0;
  }

  _emitLevelStart() {
    this.events.emit('level:start', {
      level: this.state.level,
      biome: this.state.biome,
    });
  }

  _bindEventToasts() {
    // Prop/interaction toasts (idempotent — subscribe once per Game lifetime)
    if (this._toastsBound) return;
    this._toastsBound = true;
    this.events.on('prop:opened', () => {
      this._showMessage('A sarcophagus stirs…', 'goal');
    });
  }

  _animate() {
    if (!this._isRunning) return;
    requestAnimationFrame(() => this._animate());

    const now = performance.now();
    this._delta = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;
    const t = now * 0.001;

    this._updateInput();
    this._updateCamera();
    this._handleToggles();
    this._handleExitRegeneration();
    this._updateRunTimer();
    this.lighting.update(t, this.state.player);
    this.particles.update(this._delta, this.state.player, this.lighting.torches);
    this.smoke.update(this._delta, this.state.player);
    this.runes.update(t);
    this.orbs.update(t, this.state.player);
    if (this.props) this.props.update(this._delta, t, this.state.player);
    this._handleShooting();
    this._handleSwordAttack();
    if (this.skeletons) this.skeletons.update(this._delta, t, this.state.player, this._collisionBoxes);
    if (this.shooter) this.shooter.update(this._delta, this._collisionBoxes, this.skeletons.skeletons || []);
    if (this.state.invulnTimer > 0) this.state.invulnTimer -= this._delta;
    if (this._shakeTime > 0) this._shakeTime -= this._delta;

    this._animateWater(t);
    this._checkMessages();
    this._updateHUD();
    this._eKeyWasDown = this.input.isPressed('KeyE');
    this.post.render();
  }

  _updateInput() {
    const dt = this._delta;
    const p = this.state.player;
    this._sprinting = this.input.isPressed('ShiftLeft') || this.input.isPressed('ShiftRight');
    const speed = PLAYER.SPEED * (this._sprinting ? PLAYER.SPRINT_MULTIPLIER : 1) * dt;

    const mouse = this.input.consumeMouse();
    p.yaw -= mouse.x * PLAYER.MOUSE_SENSITIVITY;
    p.pitch -= mouse.y * PLAYER.MOUSE_SENSITIVITY;
    p.pitch = Math.max(-PLAYER.PITCH_CLAMP, Math.min(PLAYER.PITCH_CLAMP, p.pitch));

    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));

    if (this.input.isPressed('KeyW')) { p.x += forward.x * speed; p.z += forward.z * speed; }
    if (this.input.isPressed('KeyS')) { p.x -= forward.x * speed; p.z -= forward.z * speed; }
    if (this.input.isPressed('KeyA')) { p.x -= right.x * speed; p.z -= right.z * speed; }
    if (this.input.isPressed('KeyD')) { p.x += right.x * speed; p.z += right.z * speed; }

    // Collision resolution
    this._resolveCollisions(p);

    const exit = this.dungeonData.exitCell;
    const cs = this.dungeonData.cellSize;
    const ex = exit.x * cs + cs / 2;
    const ez = exit.z * cs + cs / 2;
    const dx = p.x - ex;
    const dz = p.z - ez;
    this.state.inExitRoom = (dx * dx + dz * dz) < 4;
  }

  _resolveCollisions(p) {
    const margin = 0.35; // player radius
    resolveCircleCollisions(this._collisionBoxes, p, margin);
  }

  _updateCamera() {
    const p = this.state.player;

    // Smooth FOV kick while sprinting
    const targetFov = CAMERA.FOV + (this._sprinting ? CAMERA.SPRINT_FOV_BOOST : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, this._delta * 8);
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.set(p.x, WORLD.PLAYER_EYE_HEIGHT, p.z);
    // Damage shake
    if (this._shakeTime > 0) {
      const s = this._shakeTime * 4;
      this.camera.position.x += Math.sin(performance.now() * 0.045) * 0.06 * s;
      this.camera.position.y += Math.sin(performance.now() * 0.05) * 0.05 * s;
      this.camera.position.z += Math.cos(performance.now() * 0.04) * 0.06 * s;
    }
    const dir = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch),
    );
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  _handleToggles() {
    const pDown = this.input.isPressed('KeyP');
    if (pDown && !this._pKeyWasDown) {
      this.state.effectsEnabled = this.post.toggle();
    }
    this._pKeyWasDown = pDown;

    const tabDown = this.input.isPressed('Tab');
    if (tabDown && !this._tabWasDown && this._lbPanel) {
      this._lbPanel.classList.toggle('hidden');
      if (!this._lbPanel.classList.contains('hidden')) this._renderLeaderboard(this._lbList);
    }
    this._tabWasDown = tabDown;
  }

  _handleExitRegeneration() {
    if (!this.state.inExitRoom) return;
    const eDown = this.input.isPressed('KeyE');
    if (eDown && !this._eKeyWasDown) {
      this._regenerateDungeon();
    }
  }

  _handleShooting() {
    if (this._gameOverActive) return;
    if (this._fireCooldown > 0) this._fireCooldown -= this._delta;
    if (!this.input.isMouseDown(0) || !this.input.isPointerLocked()) return;
    if (this._fireCooldown > 0) return;

    if (this.state.collectedOrbs <= 0) {
      if (!this._noAmmoWarned) {
        this._showMessage('No orbs! Slay skeletons to gather orbs', 'goal');
        this._noAmmoWarned = true;
      }
      return;
    }
    this._noAmmoWarned = false;
    this.state.collectedOrbs--;
    const p = this.state.player;
    this.shooter.fire(
      p.x,
      WORLD.PLAYER_EYE_HEIGHT - 0.1,
      p.z,
      p.yaw,
      p.pitch,
    );
    this._fireCooldown = 0.18; // ~5.5 shots/s max — tunable
  }

  _handleSwordAttack() {
    if (this._gameOverActive) return;
    if (!this.sword) return;

    // Right mouse = combo. Edge-triggered: a new press starts the attack or
    // buffers the second hit inside the combo window.
    if (this.input.isMouseDown(2) && this.input.isPointerLocked()) {
      if (!this._rmbWasDown) {
        if (this.sword.state !== 'idle') {
          this.sword.bufferCombo();
        } else if (this.sword.attack()) {
          this._swordHitApplied = false;
        }
      }
      this._rmbWasDown = true;
    } else {
      this._rmbWasDown = false;
    }
    this.sword.update(this._delta, this._nearestSkeletonDist());

    // Damage lands once per slash, during the slash hit window.
    // Range scales with the sword size bonus (longer sword = longer reach).
    if (this.sword.isSwinging && !this._swordHitApplied && this.skeletons) {
      this._swordHitApplied = true;
      const p = this.state.player;
      const fx = -Math.sin(p.yaw);
      const fz = -Math.cos(p.yaw);
      const maxDot = Math.cos(this.sword.currentArc);
      const range = this.sword.currentRange;
      const damage = this.sword.currentDamage;
      let enemiesHit = 0;

      // Breakable props in the arc
      if (this.props) {
        for (const b of this.props.breakables) {
          const dx = b.x - p.x;
          const dz = b.z - p.z;
          if (Math.hypot(dx, dz) <= range + 0.5) this.props.hitBreakables(b.x, b.z);
        }
      }

      for (const s of this.skeletons.skeletons) {
        if (s.skel.state === 'DEAD') continue;
        const dx = s.x - p.x;
        const dz = s.z - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist > range || dist < 0.001) continue;
        const dot = (dx / dist) * fx + (dz / dist) * fz;
        if (dot < maxDot) continue; // outside the hit cone
        const wasAlive = s.skel.state !== 'DEAD';
        this.skeletons.hitSkeleton(s.skel, damage);
        if (wasAlive) enemiesHit++;
      }

      if (enemiesHit > 0) {
        // Hit feedback: hit-stop, blade flash, sparks at nearest hit
        this.state.hitStop = HIT_STOP;
        this.sword.flashBlade();
        const p0 = this.state.player;
        this.sword.burstSparks(new THREE.Vector3(
          p0.x + fx * 1.5, 1.2, p0.z + fz * 1.5,
        ));
        this.events.emit('sword:hit', {
          step: this.sword.comboStep, enemiesHit, damage,
        });
      }
    }

    // Hit-stop: freeze world updates (camera shake still runs)
    if (this.state.hitStop > 0) {
      this.state.hitStop -= this._delta;
      this._delta = 0;
    }
  }

  _nearestSkeletonDist() {
    if (!this.skeletons) return Infinity;
    const p = this.state.player;
    let min = Infinity;
    for (const s of this.skeletons.skeletons) {
      if (s.skel.state === 'DEAD') continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < min) min = d;
    }
    return min;
  }

  _flashDamage() {
    if (this._damageFlashEl) {
      this._damageFlashEl.classList.remove('flash');
      void this._damageFlashEl.offsetWidth; // restart CSS animation
      this._damageFlashEl.classList.add('flash');
    }
    this._shakeTime = 0.25;
  }

  _updateRunTimer() {
    if (this._gameOverActive) return;
    this.state.levelTime += this._delta;
    this.state.runTime += this._delta;
    const remaining = Math.max(0, TIMED_RUN.LEVEL_TIME_LIMIT - this.state.levelTime);
    if (remaining <= 0) {
      this._gameOver();
      return;
    }
    if (this._timerEl) {
      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60).toString().padStart(2, '0');
      const totalMins = Math.floor(this.state.runTime / 60);
      const totalSecs = Math.floor(this.state.runTime % 60).toString().padStart(2, '0');
      const best = this.leaderboard.best();
      const bestTxt = best
        ? `best Lv${best.level} ${Math.floor(best.time / 60)}:${(best.time % 60).toString().padStart(2, '0')} ◈${best.orbs}`
        : 'best —';
      this._timerEl.textContent = `Lv ${this.state.level} · ${mins}:${secs} · total ${totalMins}:${totalSecs} · ${bestTxt}`;
      this._timerEl.classList.toggle('low', remaining < 30);
    }
  }

  _gameOver(reason = 'time') {
    this._gameOverActive = true;
    this._isRunning = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const rank = this.leaderboard.add(this.state.level, this.state.runTime, this.state.collectedOrbs);
    this._lastEntry = this.leaderboard.load()[0];
    if (this._goStats) {
      const t = this.state.runTime;
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60).toString().padStart(2, '0');
      this._goStats.textContent = `Level reached: ${this.state.level} · Total time: ${mm}:${ss} · Orbs: ${this.state.collectedOrbs}${rank > 0 ? ` · Rank #${rank}` : ''}`;
    }
    if (this._gameOverEl) {
      const title = this._gameOverEl.querySelector('h2');
      if (title) title.textContent = reason === 'dead' ? 'The dead claim you' : 'The darkness consumes you';
    }
    this._renderLeaderboard(this._goList);
    if (this._gameOverEl) this._gameOverEl.classList.remove('hidden');
    this._onGameOverClick = () => this._restartRun();
    document.addEventListener('click', this._onGameOverClick, { once: true });
  }

  _restartRun() {
    if (this._onGameOverClick) {
      document.removeEventListener('click', this._onGameOverClick);
      this._onGameOverClick = null;
    }
    this._gameOverActive = false;
    if (this._gameOverEl) this._gameOverEl.classList.add('hidden');
    this._regenerateDungeon({ newRun: true });
    this._isRunning = true;
    this._lastTime = performance.now();
    this._animate(); // RAF chain died on game over — restart it
    this._showMessage('A new descent begins', 'goal');
  }

  _renderLeaderboard(listEl) {
    if (!listEl) return;
    const entries = this.leaderboard.load();
    listEl.innerHTML = entries.length
      ? entries.map((e, i) => {
        const me = this._lastEntry && e.level === this._lastEntry.level
          && e.time === this._lastEntry.time && e.orbs === this._lastEntry.orbs;
        return `<li class="${me ? 'me' : ''}">#${i + 1} · Lv ${e.level} · ${Math.floor(e.time / 60)}:${(e.time % 60).toString().padStart(2, '0')} · ◈ ${e.orbs}</li>`;
      }).join('')
      : '<li>No runs yet — descend!</li>';
  }

  _checkMessages() {
    // Orb collected
    if (this.state.collectedOrbs > this._prevOrbCount) {
      this._showMessage('Orb collected! +1 ammo', 'success');
    }
    // Entered exit room
    if (this.state.inExitRoom && !this._prevInExit) {
      this._showMessage('The depths await — press E to descend', 'goal');
    }

    // Periodic directional hints (every 8 seconds after 3s initial delay)
    const now = this._lastTime * 0.001;
    if (now - this._lastHintTime > 8) {
      this._lastHintTime = now;
      this._showDirectionalHint();
    }

    this._prevOrbCount = this.state.collectedOrbs;
    this._prevInExit = this.state.inExitRoom;
  }

  _showDirectionalHint() {
    const p = this.state.player;
    const ex = this.dungeonData.exitCell.x * this.dungeonData.cellSize + this.dungeonData.cellSize / 2;
    const ez = this.dungeonData.exitCell.z * this.dungeonData.cellSize + this.dungeonData.cellSize / 2;

    const dx = ex - p.x, dz = ez - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz).toFixed(0);
    this._showMessage('Golden exit lies ' + this._compassDir(dx, dz) + ' (' + dist + 'm)', 'goal');
  }

  _compassDir(dx, dz) {
    const angle = Math.atan2(dx, dz) * 180 / Math.PI;
    if (angle > 157.5 || angle <= -157.5) return 'north';
    if (angle > 112.5) return 'northwest';
    if (angle > 67.5) return 'west';
    if (angle > 22.5) return 'southwest';
    if (angle > -22.5) return 'south';
    if (angle > -67.5) return 'southeast';
    if (angle > -112.5) return 'east';
    return 'northeast';
  }

  _regenerateDungeon({ newRun = false } = {}) {
    this._isRunning = false;
    this.orbs.dispose();
    this.runes.dispose();
    this.particles.dispose();
    this.lighting.dispose();
    if (this.props) this.props.dispose();
    this.smoke.dispose();
    if (this.skeletons) this.skeletons.dispose();
    if (this.shooter) this.shooter.dispose();
    for (const p of (this._waterPuddles || [])) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.scene.remove(p.mesh);
    }
    this._disposeScene();

    this.state = newRun
      ? new GameState()
      : new GameState({
        runTime: this.state.runTime,
        level: this.state.level + 1,
        collectedOrbs: this.state.collectedOrbs,
      });
    this._prevOrbCount = 0;
    this._prevInExit = false;
    this._noAmmoWarned = false;
    const biomeChanged = this.biomes.applyLevel(this.state.level, this.state);
    if (biomeChanged) {
      this.events.emit('biome:change', { biome: this.state.biome, biomeIndex: this.state.biomeIndex });
    }
    this._generateDungeon();
    this._buildWorld();
    this.lighting = new LightingSystem(this.scene, this.biomes.current.palette);
    this.lighting.init(this.dungeonData);
    this._initProps();
    this.smoke = new SmokeSystem(this.scene);
    this.smoke.init();
    this._rebindSmokeEmitters();
    this.particles = new ParticleSystem(this.scene);
    this.particles.init();
    this.runes = new RuneSystem(this.scene, this.dungeonData);
    this.runes.init();
    this.orbs = new OrbSystem(this.scene, this.dungeonData, this.state);
    this.orbs.init();
    this._initCombat();
    this._placeWaterPuddles();
    this._setupPlayerStart();
    this._showMessage('Slay them for orbs — shoot or swing', 'goal');
    if (this.state.level > 1) this._showMessage(`Level ${this.state.level} — descend!`, 'goal');
    this._emitLevelStart();
    this._isRunning = true;
    this._lastTime = performance.now();
  }

  _animateWater(t) {
    for (const puddle of this._waterPuddles) {
      const pos = puddle.mesh.geometry.attributes.position;
      const orig = puddle.vertices;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3 + 2] = orig[i * 3 + 2] + Math.sin(t * 2 + i) * 0.03;
      }
      pos.needsUpdate = true;
    }
  }

  _updateHUD() {
    if (this._orbCountEl) {
      const scale = this.sword ? this.sword.scale : 1;
      const suffix = scale > 1.01 ? ` · ×${scale.toFixed(1)}` : '';
      this._orbCountEl.textContent = `Orbs: ${this.state.collectedOrbs}${suffix}`;
    }
    if (this.sword) this.sword.setOrbCount(this.state.collectedOrbs);
    if (this._biomeLabelEl) {
      const pal = this.biomes.current?.palette;
      this._biomeLabelEl.textContent = pal?.label || 'STONE DUNGEON';
      this._biomeLabelEl.style.borderBottomColor = pal ? `#${pal.fog.toString(16).padStart(6, '0')}` : '#444';
    }
    if (this._comboPipsEl) {
      const step = this.sword ? this.sword.comboStep : 0;
      const pips = this._comboPipsEl.querySelectorAll('.pip');
      pips.forEach((el, i) => el.classList.toggle('lit', i < step));
      this._comboPipsEl.style.opacity = step > 0 ? '1' : '0.25';
    }
    if (this._heartsEl) {
      const h = Math.max(0, this.state.health);
      this._heartsEl.textContent = '♥'.repeat(h) + '♡'.repeat(Math.max(0, PLAYER.MAX_HEALTH - h));
    }
    if (this._exitEl) {
      this._exitEl.style.display = this.state.inExitRoom ? 'block' : 'none';
    }
    if (this._promptEl) {
      this._promptEl.style.display = this.input.isPointerLocked() ? 'none' : 'block';
    }
  }

  dispose() {
    this._isRunning = false;
    if (this._onGameOverClick) {
      document.removeEventListener('click', this._onGameOverClick);
      this._onGameOverClick = null;
    }
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.post.dispose();
    this.particles.dispose();
    this.smoke.dispose();
    this.runes.dispose();
    this.orbs.dispose();
    this.lighting.dispose();
    if (this.props) this.props.dispose();
    if (this.sword) this.sword.dispose();
    if (this.headlight) {
      this.camera.remove(this.headlight);
      this.headlight.dispose();
      this.headlight = null;
    }
    if (this.skeletons) this.skeletons.dispose();
    if (this.shooter) this.shooter.dispose();
    for (const p of this._waterPuddles) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.scene.remove(p.mesh);
    }
    this._disposeScene();
    if (this.biomes) this.biomes.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  _disposeScene() {
    // Detach the camera (and its children — the first-person sword) before
    // disposal so its resources survive, and re-add it after clear() so it
    // stays in the scene graph and keeps rendering.
    const cameraAttached = this.scene.getObjectById(this.camera.id) === this.camera;
    if (cameraAttached) this.scene.remove(this.camera);

    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => {
            if (m.map && !m.map.userData?.biomeCached) m.map.dispose();
            m.dispose();
          });
        } else {
          if (obj.material.map && !obj.material.map.userData?.biomeCached) obj.material.map.dispose();
          obj.material.dispose();
        }
      }
    });
    this.scene.clear();

    if (cameraAttached) this.scene.add(this.camera);
  }
}

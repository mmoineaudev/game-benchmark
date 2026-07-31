import * as THREE from 'three';
import { WORLD, PLAYER, CAMERA, RENDERER, TIMED_RUN } from './Constants.js';
import { GameState } from './GameState.js';
import { Leaderboard } from './Leaderboard.js';
import { DungeonGenerator } from '../world/DungeonGenerator.js';
import { WorldBuilder } from '../world/WorldBuilder.js';
import { LightingSystem } from '../systems/LightingSystem.js';
import { InputSystem } from '../systems/InputSystem.js';
import { PostProcessing } from '../systems/PostProcessing.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { RuneSystem } from '../systems/RuneSystem.js';
import { OrbSystem } from '../entities/OrbSystem.js';
import { SmokeSystem } from '../systems/SmokeSystem.js';

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
    this._interactEl = document.getElementById('interact-prompt');
    this._exitEl = document.getElementById('exit-prompt');
    this._messagesEl = document.getElementById('messages');
    this._prevOrbCount = 0;
    this._prevInExit = false;
    this._welcomeShown = false;
    this._lastHintTime = 0;
    this._nextOrbMsgTime = 0;
    this._sprinting = false;
    this.leaderboard = new Leaderboard();
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
  }

  init() {
    this._initRenderer();
    this._initCamera();
    this._initPostProcessing();
    this._initInput();
    this._generateDungeon();
    this._buildWorld();
    this._initLighting();
    this._initSmoke();
    this._initParticles();
    this._initRunes();
    this._initOrbs();
    this._placeWaterPuddles();
    this._setupPlayerStart();
    this._showMessage('Find the ' + this.state.totalOrbs + ' glowing blue orbs', 'goal');
    this._showMessage('Follow the torch-lit corridors', 'goal');
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
    const gen = new DungeonGenerator(this.state.dungeonSeed);
    this.dungeonData = gen.generate();
    this.state.entranceCell = this.dungeonData.entranceCell;
    this.state.exitCell = this.dungeonData.exitCell;
  }

  _buildWorld() {
    this.worldBuilder = new WorldBuilder(this.scene, this.dungeonData);
    const result = this.worldBuilder.build();
    this._collisionBoxes = result.collisionBoxes || [];
  }

  _initLighting() {
    this.lighting = new LightingSystem(this.scene);
    this.lighting.init(this.dungeonData);
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
    this.orbs.update(t, this.state.player,
      this.input.isPressed('KeyE'), this._eKeyWasDown);

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
    for (const box of this._collisionBoxes) {
      // Find closest point on box to player
      const cx = Math.max(box.minX, Math.min(p.x, box.maxX));
      const cz = Math.max(box.minZ, Math.min(p.z, box.maxZ));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < margin) {
        // Push player out
        const overlap = margin - dist;
        const nx = dist > 0.001 ? dx / dist : 0;
        const nz = dist > 0.001 ? dz / dist : 1;
        p.x += nx * overlap;
        p.z += nz * overlap;
      }
    }
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
        ? `best Lv${best.level} ${Math.floor(best.time / 60)}:${(best.time % 60).toString().padStart(2, '0')}`
        : 'best —';
      this._timerEl.textContent = `Lv ${this.state.level} · ${mins}:${secs} · total ${totalMins}:${totalSecs} · ${bestTxt}`;
      this._timerEl.classList.toggle('low', remaining < 30);
    }
  }

  _gameOver() {
    this._gameOverActive = true;
    this._isRunning = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const rank = this.leaderboard.add(this.state.level, this.state.runTime);
    this._lastEntry = this.leaderboard.load()[0];
    if (this._goStats) {
      const t = this.state.runTime;
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60).toString().padStart(2, '0');
      this._goStats.textContent = `Level reached: ${this.state.level} · Total time: ${mm}:${ss}${rank > 0 ? ` · Rank #${rank}` : ''}`;
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
        const me = this._lastEntry && e.level === this._lastEntry.level && e.time === this._lastEntry.time;
        return `<li class="${me ? 'me' : ''}">#${i + 1} · Lv ${e.level} · ${Math.floor(e.time / 60)}:${(e.time % 60).toString().padStart(2, '0')}</li>`;
      }).join('')
      : '<li>No runs yet — descend!</li>';
  }

  _checkMessages() {
    // Orb collected
    if (this.state.collectedOrbs > this._prevOrbCount) {
      const remaining = this.state.totalOrbs - this.state.collectedOrbs;
      if (remaining > 0) {
        this._showMessage('Orb collected! ' + remaining + ' remaining', 'success');
      }
    }
    // All orbs found
    if (this._prevOrbCount < this.state.totalOrbs && this.state.collectedOrbs >= this.state.totalOrbs) {
      this._showMessage('All orbs found! Head to the golden exit', 'success');
      this._nextOrbMsgTime = 0; // trigger immediate exit direction
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
    // If all orbs collected, point to exit
    if (this.state.collectedOrbs >= this.state.totalOrbs && this.state.totalOrbs > 0) {
      const ex = this.dungeonData.exitCell.x * this.dungeonData.cellSize + this.dungeonData.cellSize / 2;
      const ez = this.dungeonData.exitCell.z * this.dungeonData.cellSize + this.dungeonData.cellSize / 2;
      const dx = ex - p.x, dz = ez - p.z;
      const dist = Math.sqrt(dx * dx + dz * dz).toFixed(0);
      const dir = this._compassDir(dx, dz);
      this._showMessage('Golden exit lies ' + dir + ' (' + dist + 'm)', 'goal');
      return;
    }
    // Point to nearest orb
    if (!this.orbs) return;
    let nearest = null, nearestDist = Infinity;
    for (const orb of this.orbs.orbs) {
      if (orb.collected) continue;
      const dx = orb.x - p.x, dz = orb.z - p.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nearestDist) { nearestDist = d; nearest = orb; }
    }
    if (nearest) {
      const dx = nearest.x - p.x, dz = nearest.z - p.z;
      const dir = this._compassDir(dx, dz);
      this._showMessage('Nearest orb lies ' + dir, 'goal');
    }
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
    this.smoke.dispose();
    for (const p of (this._waterPuddles || [])) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.scene.remove(p.mesh);
    }
    this._disposeScene();

    this.state = newRun
      ? new GameState()
      : new GameState({ runTime: this.state.runTime, level: this.state.level + 1 });
    this._prevOrbCount = 0;
    this._prevInExit = false;
    this._generateDungeon();
    this._buildWorld();
    this.lighting = new LightingSystem(this.scene);
    this.lighting.init(this.dungeonData);
    this.smoke = new SmokeSystem(this.scene);
    this.smoke.init();
    this._rebindSmokeEmitters();
    this.particles = new ParticleSystem(this.scene);
    this.particles.init();
    this.runes = new RuneSystem(this.scene, this.dungeonData);
    this.runes.init();
    this.orbs = new OrbSystem(this.scene, this.dungeonData, this.state);
    this.orbs.init();
    this._placeWaterPuddles();
    this._setupPlayerStart();
    this._showMessage('Find the ' + this.state.totalOrbs + ' glowing blue orbs', 'goal');
    if (this.state.level > 1) this._showMessage(`Level ${this.state.level} — descend!`, 'goal');
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
      this._orbCountEl.textContent = `Orbs: ${this.state.collectedOrbs}/${this.state.totalOrbs}`;
    }
    if (this._interactEl) {
      const dist = this.orbs ? this.orbs.nearestOrbDist(this.state.player) : Infinity;
      this._interactEl.style.display = (dist < 1.5) ? 'block' : 'none';
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
    for (const p of this._waterPuddles) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.scene.remove(p.mesh);
    }
    this._disposeScene();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  _disposeScene() {
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
        } else {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      }
    });
    this.scene.clear();
  }
}

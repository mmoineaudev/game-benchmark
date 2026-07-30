import * as THREE from 'three';
import { WORLD, PLAYER, CAMERA, RENDERER } from './Constants.js';
import { GameState } from './GameState.js';
import { DungeonGenerator } from '../world/DungeonGenerator.js';
import { WorldBuilder } from '../world/WorldBuilder.js';
import { LightingSystem } from '../systems/LightingSystem.js';
import { InputSystem } from '../systems/InputSystem.js';
import { PostProcessing } from '../systems/PostProcessing.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { RuneSystem } from '../systems/RuneSystem.js';

export class Game {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = new GameState();
    this._isRunning = false;
    this._lastTime = 0;
    this._delta = 0;
    this._pKeyWasDown = false;
    this._promptEl = document.getElementById('prompt');
  }

  init() {
    this._initRenderer();
    this._initCamera();
    this._initPostProcessing();
    this._initInput();
    this._generateDungeon();
    this._buildWorld();
    this._initLighting();
    this._initParticles();
    this._initRunes();
    this._setupPlayerStart();
    this._updateHUD();
    this._isRunning = true;
    this._lastTime = performance.now();
    this._animate();
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
      CAMERA.FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR,
      CAMERA.FAR,
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
    this.worldBuilder.build();
  }

  _initLighting() {
    this.lighting = new LightingSystem(this.scene);
    this.lighting.init(this.dungeonData);
  }

  _initParticles() {
    this.particles = new ParticleSystem(this.scene);
    this.particles.init();
  }

  _initRunes() {
    this.runes = new RuneSystem(this.scene, this.dungeonData);
    this.runes.init();
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

    this._updateInput();
    this._updateCamera();
    this._handleToggles();
    this.lighting.update(now * 0.001, this.state.player);
    this.particles.update(this._delta, this.state.player, this.lighting.torches);
    this.runes.update(now * 0.001);
    this._updateHUD();
    this.post.render();
  }

  _updateInput() {
    const dt = this._delta;
    const p = this.state.player;
    const speed = PLAYER.SPEED * dt;

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

    const exit = this.dungeonData.exitCell;
    const cs = this.dungeonData.cellSize;
    const ex = exit.x * cs + cs / 2;
    const ez = exit.z * cs + cs / 2;
    const dx = p.x - ex;
    const dz = p.z - ez;
    this.state.inExitRoom = (dx * dx + dz * dz) < 4;
  }

  _updateCamera() {
    const p = this.state.player;
    this.camera.position.set(p.x, WORLD.PLAYER_EYE_HEIGHT, p.z);
    const dir = new THREE.Vector3(
      -Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      -Math.cos(p.yaw) * Math.cos(p.pitch),
    );
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }

  _handleToggles() {
    // P key toggle post-processing
    const pDown = this.input.isPressed('KeyP');
    if (pDown && !this._pKeyWasDown) {
      const on = this.post.toggle();
      this.state.effectsEnabled = on;
    }
    this._pKeyWasDown = pDown;
  }

  _updateHUD() {
    if (!this._promptEl) return;
    if (this.input.isPointerLocked()) {
      this._promptEl.style.display = 'none';
    } else {
      this._promptEl.style.display = 'block';
      this._promptEl.textContent = 'Click to explore';
    }
  }

  dispose() {
    this._isRunning = false;
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.post.dispose();
    this.particles.dispose();
    this.runes.dispose();
    this.lighting.dispose();
    this._disposeScene();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  _disposeScene() {
    this.scene.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      }
    });
    this.scene.clear();
  }
}

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
import { OrbSystem } from '../entities/OrbSystem.js';

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
    this._initOrbs();
    this._placeWaterPuddles();
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
    this.lighting.update(t, this.state.player);
    this.particles.update(this._delta, this.state.player, this.lighting.torches);
    this.runes.update(t);
    this.orbs.update(t, this.state.player,
      this.input.isPressed('KeyE'), this._eKeyWasDown);

    this._animateWater(t);
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
    const pDown = this.input.isPressed('KeyP');
    if (pDown && !this._pKeyWasDown) {
      this.state.effectsEnabled = this.post.toggle();
    }
    this._pKeyWasDown = pDown;
    this._eKeyWasDown = this.input.isPressed('KeyE');
  }

  _handleExitRegeneration() {
    if (!this.state.inExitRoom) return;
    const eDown = this.input.isPressed('KeyE');
    if (eDown && !this._eKeyWasDown) {
      this._regenerateDungeon();
    }
  }

  _regenerateDungeon() {
    this._isRunning = false;
    this.orbs.dispose();
    this.runes.dispose();
    this.particles.dispose();
    this.lighting.dispose();
    for (const p of (this._waterPuddles || [])) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.scene.remove(p.mesh);
    }
    this._disposeScene();

    this.state = new GameState();
    this._generateDungeon();
    this._buildWorld();
    this.lighting = new LightingSystem(this.scene);
    this.lighting.init(this.dungeonData);
    this.particles = new ParticleSystem(this.scene);
    this.particles.init();
    this.runes = new RuneSystem(this.scene, this.dungeonData);
    this.runes.init();
    this.orbs = new OrbSystem(this.scene, this.dungeonData, this.state);
    this.orbs.init();
    this._placeWaterPuddles();
    this._setupPlayerStart();
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
    // Orb counter
    if (this._orbCountEl) {
      this._orbCountEl.textContent = `Orbs: ${this.state.collectedOrbs}/${this.state.totalOrbs}`;
    }
    // Interaction prompt
    if (this._interactEl) {
      const dist = this.orbs ? this.orbs.nearestOrbDist(this.state.player) : Infinity;
      this._interactEl.style.display = (dist < 1.5) ? 'block' : 'none';
    }
    // Exit prompt
    if (this._exitEl) {
      this._exitEl.style.display = this.state.inExitRoom ? 'block' : 'none';
    }
    // Click prompt
    if (this._promptEl) {
      this._promptEl.style.display = this.input.isPointerLocked() ? 'none' : 'block';
    }
  }

  dispose() {
    this._isRunning = false;
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.post.dispose();
    this.particles.dispose();
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

// =============================================================================
// Game — orchestrator, state machine (HUB / DESCENT / DEATH), main loop.
// =============================================================================

import * as THREE from 'three';
import { COLORS, FOG, CAVE_ENTRANCE, TILE, WORLD_WIDTH, WORLD_DEPTH, RESOURCES } from '../core/Constants.js';
import { getEventBus, Events, resetEventBus } from '../core/EventBus.js';
import { getGameState, resetGameState } from '../core/GameState.js';
import { Logger } from '../core/Logger.js';

import { Input } from '../systems/Input.js';
import { Camera } from '../systems/Camera.js';
import { TerrainGenerator } from '../systems/TerrainGenerator.js';
import { DigSystem } from '../systems/DigSystem.js';
import { ResourceSystem } from '../systems/ResourceSystem.js';
import { OreManager } from '../systems/OreManager.js';
import { EnemyManager } from '../systems/EnemyManager.js';
import { MetaProgression } from '../systems/MetaProgression.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';

import { Vehicle } from '../entities/Vehicle.js';

import { ModelFactory } from '../visuals/ModelFactory.js';
import { TerrainRenderer } from '../visuals/TerrainRenderer.js';
import { HeadlightEffect } from '../visuals/HeadlightEffect.js';

import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { DeathScreen } from '../ui/DeathScreen.js';
import { WorkshopUI } from '../ui/WorkshopUI.js';

export class Game {
  constructor(container) {
    this._container = container;
    this._uiLayer = document.getElementById('ui-layer');

    // Three.js
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._clock = new THREE.Clock();

    // Systems (created once, reused across restarts)
    this._bus = null;
    this._state = null;
    this._input = null;
    this._cam = null;
    this._terrainGen = null;
    this._terrainRenderer = null;
    this._digSystem = null;
    this._resourceSystem = null;
    this._oreManager = null;
    this._enemyManager = null;
    this._metaProgression = null;
    this._particleSystem = null;
    this._headlight = null;

    // Entities
    this._vehicle = null;
    this._hubGroup = null;

    // UI
    this._hud = null;
    this._minimap = null;
    this._deathScreen = null;
    this._workshopUI = null;
  }

  init() {
    Logger.info('Game', '===== INIT =====');
    this._setupRenderer();
    this._setupScene();
    this._setupLighting();
    this._setupFog();

    // Core
    this._bus = getEventBus();
    this._state = getGameState();

    // Systems
    this._input = new Input(this._renderer.domElement);
    this._cam = new Camera(this._camera);
    this._terrainGen = new TerrainGenerator();
    this._resourceSystem = new ResourceSystem();
    this._oreManager = new OreManager();
    this._metaProgression = new MetaProgression();
    this._particleSystem = new ParticleSystem(this._scene);

    // UI
    this._hud = new HUD(this._uiLayer);
    this._minimap = new Minimap(this._uiLayer);
    this._deathScreen = new DeathScreen(this._uiLayer);
    this._workshopUI = new WorkshopUI(this._uiLayer, this._metaProgression);

    // Init all
    this._input.init();
    this._cam.init();
    this._hud.init();
    this._minimap.init();
    this._workshopUI.init();
    this._metaProgression.init();

    // Hub setup
    this._setupHub();

    // Listen for game flow events
    this._bus.on(Events.GAME_RESTART, () => this._restartToHub());
    this._bus.on(Events.PLAYER_DIED, (data) => this._onPlayerDied(data));

    // Main loop
    this._renderer.setAnimationLoop(() => this._loop());

    Logger.info('Game', '===== READY =====');
  }

  _setupRenderer() {
    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = false; // no shadows for MVP
    this._container.appendChild(this._renderer.domElement);

    window.addEventListener('resize', () => {
      this._camera.aspect = window.innerWidth / window.innerHeight;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _setupScene() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(COLORS.SKY_TOP);
    this._camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.5, 120,
    );
  }

  _setupLighting() {
    const hemi = new THREE.HemisphereLight(0x8899cc, 0x334455, 0.6);
    this._scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffeedd, 0.4);
    dir.position.set(10, 20, 5);
    this._scene.add(dir);
  }

  _setupFog() {
    // Distant fog for hub — underground tight fog is set in _startDescent
    this._scene.fog = new THREE.Fog(COLORS.SKY_TOP, 80, 180);
  }

  // ---- HUB Phase ----

  _setupHub() {
    Logger.info('Game', 'setting up hub');
    this._state.phase = 'hub';

    // Ground + hub building
    const ground = ModelFactory.createGround(30, 30);
    ground.position.set(WORLD_WIDTH / 2, -0.01, WORLD_DEPTH / 2);
    this._scene.add(ground);

    const hub = ModelFactory.createHub();
    hub.position.set(CAVE_ENTRANCE.x - 3, 0.02, CAVE_ENTRANCE.z + 1);
    hub.rotation.y = Math.PI / 4;
    this._scene.add(hub);
    this._hubGroup = new THREE.Group();
    this._hubGroup.add(ground);
    this._hubGroup.add(hub);

    // Starfield
    const stars = ModelFactory.createStarfield();
    this._scene.add(stars);
    this._hubGroup.add(stars);

    // Cave entrance marker (dark hole in ground)
    const holeGeom = new THREE.CylinderGeometry(0.6, 0.6, 0.1, 16);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    const hole = new THREE.Mesh(holeGeom, holeMat);
    hole.position.set(CAVE_ENTRANCE.x + 0.5, -0.01, CAVE_ENTRANCE.z + 0.5);
    this._scene.add(hole);
    this._hubGroup.add(hole);

    // Set camera to hub view
    this._cam.setAngle(Math.PI / 4);
    this._input.setCameraAngle(Math.PI / 4);

    // HUD and minimap hidden in hub
    this._hud.setVisible(false);
    this._minimap.setVisible(false);

    // Show workshop UI
    this._workshopUI.show();

    // Hub prompt: visible instruction to start
    this._hubPrompt = document.createElement('div');
    this._hubPrompt.id = 'hub-prompt';
    this._hubPrompt.innerHTML = `
      <style>
        #hub-prompt {
          position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
          font-family: 'Courier New', monospace; color: #aaa;
          font-size: 14px; letter-spacing: 2px;
          text-shadow: 0 0 8px rgba(0,0,0,0.9);
          pointer-events: none; z-index: 20;
          animation: hubPulse 2s ease-in-out infinite;
        }
        @keyframes hubPulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
      </style>
      Press ENTER to descend<br>
      <span style="color:#888;font-size:11px">ARROWS: Move | HOLD DOWN: Dig<br>
      MOUSE: Rotate | A/E: Orbit | ZQSD: Pan</span>
    `;
    this._uiLayer.appendChild(this._hubPrompt);

    // Keyboard: Enter to start descent
    this._onKeyHub = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        this._startDescent();
      }
    };
    window.addEventListener('keydown', this._onKeyHub);
  }

  _startDescent() {
    Logger.info('Game', '===== DESCENT BEGIN =====');
    window.removeEventListener('keydown', this._onKeyHub);

    // Remove hub prompt
    if (this._hubPrompt) {
      this._hubPrompt.remove();
      this._hubPrompt = null;
    }

    // Clear hub visuals
    this._clearHub();

    // Reset run state
    this._state.reset();
    this._state.applyUpgrades();
    this._state.phase = 'descent';
    this._state.isAlive = true;
    this._resourceSystem.onRestart();
    Logger.info('Game', 'state reset', {
      fuel: this._state.fuel,
      maxFuel: this._state.maxFuel,
      oxygen: this._state.oxygen,
      hull: this._state.hull,
    });

    // Generate terrain
    this._terrainGen.generate();

    // Create terrain renderer
    this._terrainRenderer = new TerrainRenderer(this._scene, this._terrainGen);
    this._terrainRenderer.init();

    // Create dig system
    this._digSystem = new DigSystem(this._terrainGen);

    // Create vehicle
    this._vehicle = new Vehicle(this._scene);
    this._vehicle.setGridPosition(CAVE_ENTRANCE.x, 0, CAVE_ENTRANCE.z);

    // Initial vehicle position — terrain is fully transparent, no cutaway needed

    // Headlight
    this._headlight = new HeadlightEffect(this._scene);
    this._headlight.init();
    this._headlight.attachTo(this._vehicle.group);

    // Enemies
    this._enemyManager = new EnemyManager(this._scene, this._terrainGen);

    // Camera follows vehicle
    this._cam.setAngle(Math.PI / 4);
    this._input.setCameraAngle(Math.PI / 4);

    // UI
    this._hud.setVisible(true);
    this._minimap.setVisible(true);
    this._workshopUI.hide();

    // Scene fog for underground
    this._scene.fog = new THREE.Fog(0x111122, 5, 16);

    // Emit events for initial HUD values
    const s = this._state;
    this._bus.emit(Events.FUEL_CHANGED, { fuel: s.fuel, maxFuel: s.maxFuel });
    this._bus.emit(Events.OXYGEN_CHANGED, { oxygen: s.oxygen, maxOxygen: s.maxOxygen });
    this._bus.emit(Events.HULL_CHANGED, { hull: s.hull, maxHull: s.maxHull });
    this._bus.emit(Events.DEPTH_CHANGED, { depth: 0 });

    Logger.info('Game', 'descent ready — arrows=move, hold down=dig, mouse=rotate, A/E=orbit, ZQSD=pan');
  }

  _clearHub() {
    if (this._hubGroup) {
      this._scene.remove(this._hubGroup);
      this._hubGroup.traverse((c) => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else c.material.dispose();
        }
      });
      this._hubGroup = null;
    }
  }

  // ---- DEATH ----

  _onPlayerDied(data) {
    Logger.info('Game', `player died: ${data.cause} at depth ${this._state.tileY}`);
    this._state.phase = 'death';
    this._state.isAlive = false;

    const totalOresMined = Object.values(this._state.oresMinedThisRun).reduce((a, b) => a + b, 0);

    this._deathScreen.show(
      data.cause === 'suffocation' ? 'SUFFOCATED' :
        data.cause === 'starvation' ? 'OUT OF FUEL' : 'DESTROYED',
      this._state.tileY,
      totalOresMined,
      0,
    );

    // Record run stats
    this._state.recordRun(this._state.tileY, totalOresMined, false);

    // Clean up descent entities
    this._cleanupDescent();
  }

  // ---- RESTART TO HUB ----

  _restartToHub() {
    Logger.info('Game', '===== RESTART TO HUB =====');

    this._cleanupDescent();
    this._deathScreen.hide();

    // Reset state singleton
    resetGameState();
    this._state = getGameState();
    this._resourceSystem = new ResourceSystem();

    // Re-setup hub
    this._scene.background = new THREE.Color(COLORS.SKY_TOP);
    this._scene.fog = new THREE.Fog(COLORS.SKY_TOP, 80, 180);
    this._setupHub();
  }

  _cleanupDescent() {
    if (this._enemyManager) { this._enemyManager.dispose(); this._enemyManager = null; }
    if (this._vehicle) { this._vehicle.dispose(); this._vehicle = null; }
    if (this._headlight) { this._headlight.dispose(); this._headlight = null; }
    if (this._terrainRenderer) { this._terrainRenderer.dispose(); this._terrainRenderer = null; }
    if (this._digSystem) { this._digSystem.dispose(); this._digSystem = null; }
    if (this._terrainGen) { this._terrainGen.dispose(); }

    // Recreate terrain gen
    this._terrainGen = new TerrainGenerator();
  }

  // ---- MAIN LOOP ----

  _loop() {
    const dt = Math.min(this._clock.getDelta(), 0.1); // cap to avoid spiral of death

    if (this._state.phase === 'hub') {
      // Camera orbit around hub
      this._cam.update(dt);
      this._particleSystem.update(dt);
    } else if (this._state.phase === 'descent' && this._state.isAlive) {
      this._updateDescent(dt);
    } else if (this._state.phase === 'death') {
      // No gameplay updates, just render what's left
      this._particleSystem.update(dt);
    }

    this._renderer.render(this._scene, this._camera);
  }

  _updateDescent(dt) {
    const s = this._state;

    // Input
    this._input.update();
    this._input.setCameraAngle(this._cam.getAngle());

    // Camera rotation via A/E + mouse drag
    if (this._input.rotate !== 0) {
      this._cam.rotateBy(this._input.rotate, dt);
      this._input.setCameraAngle(this._cam.getAngle());
    }

    // Camera pan via ZQSD
    if (this._input.pan.x !== 0 || this._input.pan.z !== 0) {
      this._cam.pan(this._input.pan.x, this._input.pan.z, dt);
    }

    // Player movement
    if (!this._vehicle.isMoving && !s.isDigging && !s.isClimbing) {
      const dir = this._input.direction;

      if (dir.x !== 0 || dir.z !== 0) {
        // Check climbing first
        if (this._digSystem.canClimb(dir.x, dir.z)) {
          this._digSystem.executeClimb(dir.x, dir.z);
          this._vehicle.climbUp(dir.x, dir.z);
          s.isClimbing = true;
        } else {
          // Horizontal movement — check target tile
          const tx = s.tileX + Math.round(dir.x);
          const tz = s.tileZ + Math.round(dir.z);
          const targetTile = this._terrainGen.get(tx, s.tileY, tz);
          if (targetTile === TILE.AIR) {
            this._vehicle.moveBy(dir.x, dir.z);
          }
        }
      }

      // Dig: hold Down/S to dig below
      if (this._input.isDown()) {
        const digResult = this._digSystem.digDown();
        if (digResult !== null) {
          // Spend fuel
          if (this._resourceSystem.spendFuel(RESOURCES.FUEL_DIG_COST)) {
            // If the dug tile was ore, add to inventory
            if (digResult === TILE.COAL_ORE || digResult === TILE.COPPER_ORE) {
              this._oreManager.mineOre(digResult);
            }

            // Particles
            const wp = this._vehicle.worldPos;
            this._particleSystem.burstDrill(wp.x, wp.y - 0.5, wp.z);

            // Move vehicle down into the dug space
            this._vehicle.moveDown();

            // Briefly set digging state for animation purposes
            s.isDigging = true;
            setTimeout(() => { s.isDigging = false; }, 300);
          }
        }
      }
    }

    // Systems
    this._vehicle.update(dt);
    this._resourceSystem.update(dt);
    if (this._enemyManager) this._enemyManager.update(dt);
    this._particleSystem.update(dt);

    // Camera follows vehicle
    if (this._vehicle) {
      this._cam.follow(this._vehicle.worldPos, dt);
    }
    this._cam.update(dt);

    // Terrain glow pulse
    if (this._terrainRenderer) this._terrainRenderer.updateGlow(dt);
  }

  dispose() {
    Logger.info('Game', '===== DISPOSE =====');
    this._renderer.setAnimationLoop(null);
    this._cleanupDescent();
    this._clearHub();
    if (this._input) this._input.dispose();
    if (this._cam) this._cam.dispose();
    if (this._hud) this._hud.dispose();
    if (this._minimap) this._minimap.dispose();
    if (this._deathScreen) this._deathScreen.dispose();
    if (this._workshopUI) this._workshopUI.dispose();
    if (this._particleSystem) this._particleSystem.dispose();
    if (this._renderer) this._renderer.dispose();
    if (this._onKeyHub) window.removeEventListener('keydown', this._onKeyHub);
    if (this._bus) this._bus.removeAll();
    this._scene.clear();
    resetEventBus();
    resetGameState();
  }
}

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { WORLD, TILE, TILE_COLORS, RESOURCE, EVENTS, ORE, VEHICLE } from './Constants.js';
import { bus } from './EventBus.js';
import { state } from './GameState.js';
import { input } from '../systems/Input.js';
import { CameraSystem } from '../systems/Camera.js';
import { generateTerrain, getTile, setTile } from '../systems/TerrainGenerator.js';
import { TerrainRenderer } from '../visuals/TerrainRenderer.js';
import { Vehicle } from '../entities/Vehicle.js';
import { EnemyManager } from '../systems/EnemyManager.js';
import { ParticleSystem } from '../systems/ParticleSystem.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { WorkshopUI } from '../ui/WorkshopUI.js';
import { DeathScreen } from '../ui/DeathScreen.js';

export class Game {
  constructor() {
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x050510);
    this._scene.fog = new THREE.Fog(0x0a0a1a, 8, 25);

    this._renderer = new THREE.WebGLRenderer({ antialias: true });
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;
    document.body.prepend(this._renderer.domElement);

    // Bloom
    this._composer = new EffectComposer(this._renderer);
    const renderPass = new RenderPass(this._scene, null);
    this._composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.4, 0.3, 0.1
    );
    this._composer.addPass(bloomPass);

    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this._renderer.setSize(w, h);
      this._composer.setSize(w, h);
    });

    // Lighting
    this._setupLighting();

    // Systems
    this.camera = new CameraSystem();
    this._particles = new ParticleSystem(this._scene);
    this._enemyManager = new EnemyManager(this._scene);
    this._terrainRenderer = new TerrainRenderer(this._scene);
    this._vehicle = new Vehicle();
    this._scene.add(this._vehicle.group);

    // UI
    this._hud = new HUD();
    this._minimap = new Minimap();
    this._workshop = new WorkshopUI(() => this._startRun());
    this._deathScreen = new DeathScreen(() => this._goToHub());

    // State machine
    this._state = null;
    this._terrainData = null;
    this._digTimer = 0;
    this._fuelTimer = 0;
    this._oxyTimer = 0;
    this._time = 0;
    this._lastTime = 0;

    // Scroll wheel for camera zoom
    window.addEventListener('wheel', (e) => {
      if (this._state === 'descending') {
        this.camera.setDistance(this.camera.distance + e.deltaY * 0.01);
      }
    });

    // Event bindings
    bus.on(EVENTS.PLAYER_HURT, (data) => {
      state.hull -= data.amount;
      state.tilesDiscovered.add(`${Math.floor(state.pos.x)},${Math.floor(state.pos.z)}`);
      if (state.hull <= 0) {
        state.hull = 0;
        this._die();
      }
      bus.emit(EVENTS.RESOURCE_CHANGED);
    });

    bus.on(EVENTS.ENEMY_KILLED, () => {
      state.enemiesKilled++;
    });

    // Start at hub
    this._goToHub();
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0x223355, 0.4);
    this._scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0x445577, 0x112233, 0.6);
    this._scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffeedd, 0.8);
    dir.position.set(10, 30, 10);
    this._scene.add(dir);
    this._scene.add(new THREE.DirectionalLight(0x8888ff, 0.3).position.set(-10, 20, -10));
  }

  _goToHub() {
    this._cleanRun();
    this._state = 'hub';
    state.reset();
    this._workshop.show();
    this._deathScreen.hide();

    // Place vehicle on surface for hub view
    this._vehicle.snapTo(10, 0, 10);
    this._vehicle.group.visible = true;
    this.camera.setDistance(18);

    // Minimal hub scene: flat ground
    if (this._hubGround) this._scene.remove(this._hubGround);
    const groundGeo = new THREE.PlaneGeometry(30, 30);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x334433 });
    this._hubGround = new THREE.Mesh(groundGeo, groundMat);
    this._hubGround.rotation.x = -Math.PI / 2;
    this._hubGround.position.y = -0.2;
    this._scene.add(this._hubGround);

    this._terrainRenderer.setVisible(false);
    this._cameraTarget = new THREE.Vector3(10, 0.2, 10);
    input.update();
  }

  _startRun() {
    this._workshop.hide();
    if (this._hubGround) {
      this._scene.remove(this._hubGround);
      this._hubGround = null;
    }

    this._state = 'descending';
    state.reset();
    state.atSurface = false;

    // Generate fresh terrain
    this._terrainData = generateTerrain();
    this._terrainRenderer.build(this._terrainData);
    this._terrainRenderer.setVisible(true);
    this._minimap.setTerrainData(this._terrainData);

    // Place vehicle at spawn
    this._vehicle.snapTo(10, 0, 10);
    this._vehicle.group.visible = true;

    // Spawn enemies
    this._enemyManager.spawnInitial(this._terrainData);

    // Update HUD
    bus.emit(EVENTS.RESOURCE_CHANGED);
    bus.emit(EVENTS.DEPTH_CHANGED);

    // Discover surroundings
    this._discoverSurroundings();
    input.update();
  }

  _die() {
    state.isDead = true;
    this._state = 'death';

    // Convert ore to meta-progression
    let totalOre = 0;
    for (const [key, count] of Object.entries(state.oreInventory)) {
      const def = ORE[key];
      if (def) totalOre += count * def.value;
    }
    if (totalOre > 0) {
      state.addMetaOre(totalOre);
    }
    state.incrementRuns();

    this._deathScreen.show();
  }

  _returnToSurface() {
    this._hud.showMessage('Surface reached! Ore secured.', 3);
    // Convert ore
    let totalOre = 0;
    for (const [key, count] of Object.entries(state.oreInventory)) {
      const def = ORE[key];
      if (def) totalOre += count * def.value;
    }
    if (totalOre > 0) {
      state.addMetaOre(totalOre);
      this._hud.showMessage(`+${totalOre} ore secured!`, 3);
    }
    state.incrementRuns();
    state.atSurface = true;

    // Flash "Press B to return" message
    document.getElementById('hub-return').style.display = 'block';
    setTimeout(() => {
      document.getElementById('hub-return').style.display = 'none';
    }, 4000);
  }

  _cleanRun() {
    this._enemyManager.clear();
    this._particles.clear();
    this._terrainRenderer.dispose();
    this._terrainData = null;
    state.reset();
    this._digTimer = 0;
    this._fuelTimer = 0;
    this._oxyTimer = 0;
  }

  update(dt) {
    this._time += dt;

    if (this._state === 'hub') {
      this._vehicle.update(dt);
      this.camera.update(this._cameraTarget, dt);
      this._composer.render();
      input.update();
      return;
    }

    if (this._state === 'death') {
      this._composer.render();
      input.update();
      return;
    }

    if (this._state !== 'descending') return;

    // --- Gameplay update ---

    const vp = this._vehicle.getTilePos();
    state.pos = { x: vp.x, y: vp.y, z: vp.z };
    state.depth = vp.y;

    // Handle input
    this._handleDigInput(dt);
    this._handleMovement(dt);
    this._handleResourceDrain(dt);

    // Return to hub key
    if (input.justPressed('KeyB') && state.atSurface) {
      this._goToHub();
      input.update();
      return;
    }

    // Ore collection (E key while looking at an exposed ore tile)
    if (input.justPressed('KeyE')) {
      this._tryCollectOre();
    }

    // Update systems
    this._vehicle.update(dt);
    this._enemyManager.update(dt, this._vehicle.getWorldPos(), this._terrainData);
    this._particles.update(dt);
    this.camera.update(this._vehicle.getWorldPos(), dt);

    // Add room for vehicle underground by lowering fog near player
    const playerY = vp.y;
    this._scene.fog.far = Math.min(25, 12 + playerY * 0.3);

    // Update minimap
    this._minimap.update(vp.x, vp.z);

    // Discover tiles around player
    this._discoverSurroundings();

    // Render
    this._composer.render();
    input.update();
  }

  _handleMovement(dt) {
    const vp = this._vehicle.getTilePos();
    const dir = input.getWASD();
    const climbing = input.isDown('Space') || input.isDown('KeyW');
    const data = this._terrainData.data;

    // Check if we should climb (player is pressing Space or W while standing in an open shaft)
    const below = getTile(data, vp.x, vp.y - 1, vp.z);
    const current = getTile(data, vp.x, vp.y, vp.z);
    const above = getTile(data, vp.x, vp.y + 1, vp.z);

    // Climbing: if there's air above and player is pressing Space (or W in a vertical shaft)
    if (climbing && above === TILE.AIR && current === TILE.AIR) {
      state.isClimbing = true;
      this._vehicle.setTilePosition(vp.x, vp.y + 1, vp.z);
      state.pos.y = vp.y + 1;
      state.depth = vp.y + 1;
      state.oxygen -= RESOURCE.OXYGEN_CLIMB_RATE * dt;
      bus.emit(EVENTS.RESOURCE_CHANGED);
      bus.emit(EVENTS.DEPTH_CHANGED);
      return;
    }
    state.isClimbing = false;

    // Horizontal movement: check if target tile is AIR
    if (dir.x !== 0 || dir.z !== 0) {
      const nx = Math.round(vp.x + dir.x);
      const nz = Math.round(vp.z + dir.z);

      if (nx >= 0 && nx < WORLD.WIDTH && nz >= 0 && nz < WORLD.DEPTH) {
        const targetTile = getTile(data, nx, vp.y, nz);
        const targetBelow = getTile(data, nx, vp.y - 1, nz);

        // Can walk on solid ground
        if (targetTile === TILE.AIR && targetBelow !== TILE.AIR && targetBelow !== undefined) {
          this._vehicle.setTilePosition(nx, vp.y, nz);
          state.oxygen -= RESOURCE.OXYGEN_MOVE_RATE * dt;
          bus.emit(EVENTS.RESOURCE_CHANGED);
          bus.emit(EVENTS.DEPTH_CHANGED);
        }
        // Can walk through air (hovering over air) — allow stepping into open space above ground
        else if (targetTile === TILE.AIR && targetBelow === TILE.AIR) {
          // Check if we'd fall
          let fallY = vp.y;
          while (fallY > 0 && getTile(data, nx, fallY - 1, nz) === TILE.AIR) {
            fallY--;
          }
          if (fallY !== vp.y) {
            this._vehicle.setTilePosition(nx, fallY, nz);
          } else {
            this._vehicle.setTilePosition(nx, vp.y, nz);
          }
          state.oxygen -= RESOURCE.OXYGEN_MOVE_RATE * dt;
          bus.emit(EVENTS.RESOURCE_CHANGED);
        }
      }
    }
  }

  _handleDigInput(dt) {
    const vp = this._vehicle.getTilePos();
    const data = this._terrainData.data;

    // Dig down (S + Shift) or dig forward
    const digDown = input.isDown('KeyS') && input.isDown('ShiftLeft') && !this._diggingComplete;

    // Check tile below
    const below = getTile(data, vp.x, vp.y - 1, vp.z);

    if (digDown && below !== TILE.AIR && below !== undefined && state.fuel >= RESOURCE.FUEL_DIG_COST) {
      this._digTimer += dt;
      this._vehicle.startDig();
      if (this._digTimer >= VEHICLE.DIG_TIME) {
        this._digTimer = 0;
        this._doDig(vp.x, vp.y - 1, vp.z);
      }
    } else {
      this._digTimer = 0;
      this._vehicle.stopDig();
    }
  }

  _doDig(x, y, z) {
    const data = this._terrainData.data;
    const tile = getTile(data, x, y, z);

    if (tile === TILE.BEDROCK) {
      this._hud.showMessage('Cannot dig through bedrock!', 1.5);
      return;
    }

    if (tile === TILE.AIR) return;

    // Consume fuel
    state.fuel -= RESOURCE.FUEL_DIG_COST;

    // Remove tile visually
    this._terrainRenderer.removeTile(x + 0.5, y + 0.5, z + 0.5);

    // Update data
    setTile(data, x, y, z, TILE.AIR);

    // Particle effect
    this._particles.emitDigDust(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));

    // Auto-collect ore if it was an ore tile
    if (tile === TILE.COAL_ORE || tile === TILE.COPPER_ORE) {
      this._collectOre(tile === TILE.COAL_ORE ? 'coal' : 'copper', x, y, z);
    }

    bus.emit(EVENTS.RESOURCE_CHANGED);

    // Move vehicle down if we dug below it
    const vp = this._vehicle.getTilePos();
    if (y === vp.y - 1) {
      this._vehicle.setTilePosition(vp.x, vp.y - 1, vp.z);
      state.pos.y = vp.y - 1;
      state.depth = vp.y - 1;
      bus.emit(EVENTS.DEPTH_CHANGED);
    }

    // Fall check after digging
    this._checkFall();
  }

  _checkFall() {
    const vp = this._vehicle.getTilePos();
    const data = this._terrainData.data;
    let y = vp.y;
    while (y > 0 && getTile(data, vp.x, y - 1, vp.z) === TILE.AIR) {
      y--;
    }
    if (y < vp.y) {
      const fallDist = vp.y - y;
      this._vehicle.snapTo(vp.x, y, vp.z);
      state.depth = y;
      bus.emit(EVENTS.DEPTH_CHANGED);
      if (fallDist > 3) {
        const dmg = (fallDist - 3) * 5;
        state.hull -= dmg;
        this._hud.showMessage(`Fall damage! -${dmg} hull`, 1.5);
        if (state.hull <= 0) this._die();
      }
    }
  }

  _tryCollectOre() {
    const vp = this._vehicle.getTilePos();
    const data = this._terrainData.data;

    // Check 4 adjacent tiles + below for exposed ore
    const checks = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 0, y: -1, z: 0 },
    ];

    for (const c of checks) {
      const tx = vp.x + c.x, ty = vp.y + c.y, tz = vp.z + c.z;
      const tile = getTile(data, tx, ty, tz);
      if (tile === TILE.COAL_ORE) {
        this._collectOre('coal', tx, ty, tz);
        setTile(data, tx, ty, tz, TILE.AIR);
        this._terrainRenderer.removeTile(tx + 0.5, ty + 0.5, tz + 0.5);
        break;
      } else if (tile === TILE.COPPER_ORE) {
        this._collectOre('copper', tx, ty, tz);
        setTile(data, tx, ty, tz, TILE.AIR);
        this._terrainRenderer.removeTile(tx + 0.5, ty + 0.5, tz + 0.5);
        break;
      }
    }
  }

  _collectOre(type, x, y, z) {
    const def = ORE[type];
    if (!def) return;

    // Check cargo
    let total = 0;
    for (const v of Object.values(state.oreInventory)) total += v;
    if (total >= state.cargoMax) {
      this._hud.showMessage('Cargo full!', 1.5);
      return;
    }

    if (!state.oreInventory[type]) state.oreInventory[type] = 0;
    state.oreInventory[type]++;

    // Spawn sparkle
    this._particles.emitOreSparkle(
      new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5),
      def.glowColor || undefined
    );

    this._hud.showMessage(`+1 ${def.name}`, 1);
    bus.emit(EVENTS.ORE_COLLECTED);
  }

  _handleResourceDrain(dt) {
    // Oxygen passive drain
    this._oxyTimer += dt;
    while (this._oxyTimer >= RESOURCE.OXYGEN_TICK) {
      this._oxyTimer -= RESOURCE.OXYGEN_TICK;
      if (!state.isClimbing) {
        state.oxygen -= RESOURCE.OXYGEN_IDLE_RATE;
      } else {
        state.oxygen -= RESOURCE.OXYGEN_CLIMB_RATE;
      }
      if (state.oxygen <= 0) {
        state.oxygen = 0;
        this._hud.showMessage('OXYGEN DEPLETED!', 2);
        state.hull -= 2; // suffocation damage
        if (state.hull <= 0) this._die();
      }
      bus.emit(EVENTS.RESOURCE_CHANGED);
    }

    // Check if fuel runs out
    if (state.fuel <= 0 && this._vehicle.getTilePos().y > 0) {
      state.fuel = 0;
      // Can't dig without fuel — show warning
      this._hud.showMessage('OUT OF FUEL! Find fuel caches or return.', 3);
    }

    // Check death
    if (state.hull <= 0) {
      state.hull = 0;
      this._die();
    }

    // Check if at surface
    if (state.pos.y <= 1 && !state.atSurface) {
      this._returnToSurface();
    }
  }

  _discoverSurroundings() {
    const vp = this._vehicle.getTilePos();
    const radius = 3;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const tx = vp.x + dx, tz = vp.z + dz;
        if (tx >= 0 && tx < WORLD.WIDTH && tz >= 0 && tz < WORLD.DEPTH) {
          state.tilesDiscovered.add(`${tx},${tz}`);
        }
      }
    }
  }

  start() {
    const loop = (time) => {
      const dt = Math.min(0.05, (time - this._lastTime) / 1000);
      this._lastTime = time;
      this.update(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame((time) => {
      this._lastTime = time;
      loop(time);
    });
  }
}

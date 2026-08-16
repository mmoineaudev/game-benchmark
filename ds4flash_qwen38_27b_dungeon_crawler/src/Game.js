/**
 * Game.js — the orchestrator (§4.2, §4.3, §8, §11, §12, §14, §19, §21, §22,
 * §23, §25, §26).
 *
 * Wires every module: renderer/camera/post init, the async phased level
 * loader, the rAF update loop, player movement/collision, combat callbacks,
 * HUD, meta-loop (level advance / boss defeat / death / NG+ / save / load).
 *
 * Headless guard (§27): no DOM is touched at import time; the constructor and
 * init() no-op when document/window/WebGL are unavailable.
 */

import * as THREE from 'three';

import {
  WORLD, PLAYER, CAMERA, BIOMES, BOSS, BUFF,
  DUNGEON, LIGHT_SOURCES,
  EVOLUTION, SWORD, HIT_STOP, ORB_WEAPON,
  biomeForLevel, weaponTier, damageMult,
} from './core/Constants.js';
import { GameState } from './core/GameState.js';
import { EventBus } from './core/EventBus.js';
import { Leaderboard } from './core/Leaderboard.js';
import { resolveCircleCollisions } from './core/Collision.js';

import { DungeonGenerator } from './world/DungeonGenerator.js';
import { BiomeSystem } from './world/BiomeSystem.js';

import { InputSystem } from './systems/InputSystem.js';
import { RuneSystem } from './systems/RuneSystem.js';
import { PostProcessing } from './systems/PostProcessing.js';

import { OrbSystem } from './entities/OrbSystem.js';
import { OrbShooter } from './entities/OrbShooter.js';
import { SkeletonSystem } from './entities/SkeletonSystem.js';
import { PlayerSword } from './entities/PlayerSword.js';
import { Hunter } from './entities/Hunter.js';

const SAVE_SERVER_URL = 'http://localhost:5174/save';
const PERF_WARNING = '⚠ DEGRADED MODE — decorations reduced for performance';

function raf(cb) {
  if (typeof requestAnimationFrame !== 'undefined') return requestAnimationFrame(cb);
  return setTimeout(cb, 16);
}
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function nowSec() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now() / 1000;
  return Date.now() / 1000;
}

export class Game {
  /**
   * @param {string|HTMLElement} target DOM id or element for the renderer.
   */
  constructor(target = 'app') {
    this.target = target;
    this.headless = typeof window === 'undefined' || typeof document === 'undefined';

    // --- always-available state (no DOM) ---
    this.eventBus = new EventBus();
    this.leaderboard = new Leaderboard();
    this.biomes = new BiomeSystem(this.eventBus);
    this.generator = new DungeonGenerator();

    /** @type {GameState} */
    this.state = new GameState();
    this._maxHealth = PLAYER.BASE_HEALTH;

    // Level-owned (recreated per level)
    this.dungeon = null;
    this.world = null;
    this.lighting = null;
    this.props = null;
    this.smoke = null;
    this.particles = null;
    this.runes = null;
    this.orbs = null;
    this.shooter = null;
    this.skeletons = null;
    this.hunter = null;

    // Persistent (survive level regens, §14)
    this.scene = null;
    this.camera = null;
    this.sword = null;
    this.renderer = null;
    this.input = null;
    this.post = null;
    this.fireballHeld = null;

    // Run / loop flags
    this._isRunning = false;
    this._inMenu = true;
    this._levelLoaded = false;
    this._animateId = null;
    this._lastTime = 0;
    this._now = 0;
    this._titleHeld = false;
    this._bossPortalOpen = false;
    this._degraded = false;
    this._inited = false;

    // Perf monitor (§22)
    this._fpsEma = 60;
    this._lowFpsMs = 0;
    this._titleFpsWindow = [];
    this._titleHoldStart = 0;

    // Misc runtime
    this._messages = [];        // {text, t}
    this._msgSig = -1;
    this._noAmmoShown = false;
    this._regenAcc = 0;
    this._flashT = 0;
    this._hitStop = 0;
    this._prevKeys = { e: false, m2: false, m0: false };
    this._leaderboardOpen = false;
    this._prevInExit = false;
    this._waterPuddles = [];
    this._arcBolts = [];
    this._firePatches = [];
    this._lastDeath = null;
    this._titleClock = 0;
    this._deathVisible = false;
    this._hudDirty = true;
    this._boxesCache = null;
    this._boxesCacheLevel = -1;
    this._fbCharge = 0;
    this._fbHeld = false;
    this._originV = null;
    this._forwardV = null;
  }

  // =========================================================================
  // §4.2 — init() in the exact binding order
  // =========================================================================
  init() {
    if (this.headless) return; // §27 guard: no DOM → no-op
    if (this._inited) return;
    this._inited = true;

    try {
      // 1. renderer
      this._initRenderer();
      if (!this.renderer) return; // WebGL unavailable
      // 2. camera (+ sword, headlight, held fireball)
      this._initCamera();
      // 3. post-processing (default ON)
      this._initPostProcessing();
      // 4. input
      this._initInput();
      // 5. event toasts + save bootstrap
      this._bindEventToasts();
      this._bootstrapSave();
      // 6. title showcase scene + start menu
      this._initTitleScene();
      this._showStartMenu();
      // 7. start the rAF loop (title showcase renders)
      this._lastTime = nowSec();
      this._animateId = raf(this._animate.bind(this));
    } catch (e) {
      console.error('[Game] init failed (headless fallback):', e);
      this.headless = true;
    }
  }

  /** 1. Renderer — §12.1 (antialias, PCFSoft shadows, ACES, sRGB). */
  _initRenderer() {
    const mount = typeof this.target === 'string' ? document.getElementById(this.target) : this.target;
    if (!mount) return;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (this.renderer.outputColorSpace !== undefined) {
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if (this.renderer.outputEncoding !== undefined) {
      this.renderer.outputEncoding = THREE.sRGBEncoding;
    }
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    mount.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    window.addEventListener('resize', this._onResize);
  }

  /** 2. Camera + camera-attached assets (§10.1, §19 held fireball, §20 sword). */
  _initCamera() {
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR,
    );
    this.camera.position.set(0, PLAYER.HEIGHT + CAMERA.EYE_HEIGHT, 0);

    // Headlight (§10.1)
    const head = new THREE.PointLight(0xffd9a0,
      LIGHT_SOURCES.PLAYER_HEADLIGHT.intensity, LIGHT_SOURCES.PLAYER_HEADLIGHT.distance, 2);
    head.position.set(0, -0.2, 0);
    this.camera.add(head);

    // Sword (camera-attached, §20)
    this.sword = new PlayerSword(this.camera, {
      onSwingHit: (enemies, step, dir, pos, arc) =>
        this._onSwordSwing(enemies, step, dir, pos, arc),
      onHitStop: (ms) => { this._hitStop = Math.max(this._hitStop, ms); },
      onElectricChain: (targets) => this._onElectricChain(targets),
      onEvolution: (tier, prev) => this._onEvolution(tier, prev),
      getArcBolts: () => this._arcBolts,
    });
    this.camera.add(this.sword.group);

    // Held fireball (§19)
    const fb = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff6622, transparent: true, opacity: 0.9 }),
    );
    fb.position.set(0.35, -0.42, -0.6);
    fb.visible = false;
    this.camera.add(fb);
    this.fireballHeld = fb;
  }

  /** 3. Post-processing — default ON, P toggles (§12.2). */
  _initPostProcessing() {
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
  }

  /** 4. Input system. */
  _initInput() {
    this.input = new InputSystem(this.renderer.domElement, {
      onPointerLock: (locked) => {
        if (locked) {
          if (this._inMenu) this._enterRun();
          else if (this._deathVisible) this._hideDeathScreen();
          this._hideLeaderboard();
        } else if (this._leaderboardOpen) {
          this._hideLeaderboard();
        }
      },
      onKey: (code, pressed) => {
        if (code === 'KeyN' && pressed) {
          if (this._inMenu) this.newGame();
          else if (this._deathVisible) this.newGame();
        }
        if (code === 'KeyL' && pressed && this._inMenu && this.leaderboard.hasSave()) this.loadGame();
        if (code === 'KeyY' && pressed && this._deathVisible) this.newGamePlus();
        if (code === 'KeyS' && pressed && this._deathVisible) this.saveGame();
        if (code === 'Tab' && pressed) this._toggleLeaderboard();
        if (code === 'KeyP' && pressed) this._togglePost();
        if (code === 'KeyE' && pressed) this._tryDescend();
      },
    });
  }

  /** 5. Event → HUD toasts + save bootstrap. */
  _bindEventToasts() {
    this.eventBus.on('level:loaded', (d) => this._onLevelLoadedEvent(d));
    this.eventBus.on('boss:killed', (d) => this._onBossKilledEvent(d));
    this.eventBus.on('weapon:evolved', (d) => this._onEvolution(d.tier, d.prevTier));
    this.eventBus.on('run:ended', (d) => this._onRunEndedEvent(d));
  }

  _bootstrapSave() {
    if (!this.leaderboard.hasSave()) return;
    const btn = document.getElementById('btn-load');
    if (btn) btn.classList.remove('hidden');
  }

  // =========================================================================
  // §23 — title showcase scene + start menu
  // =========================================================================
  _initTitleScene() {
    this._titleClock = 0;
    this._titleHeld = false;
    this._titleHoldStart = 0;
    // Title showcase dungeon (biome STONE).
    const seed = 7;
    const dungeon = this.generator.generate(seed, 'STONE');
    this.dungeon = dungeon;
    this._titleDungeon = dungeon;
    // Build a minimal world so the title orbit shows geometry.
    this._titleWorld = this.biomes.buildWorld(this.scene, dungeon, 'STONE');
    this.state.level = 1;
  }

  /** §23.1 — title state: camera orbit + pointerlock HOLD (5s). */
  _titleUpdate(dt) {
    this._titleClock += dt;
    if (this.camera) {
      const r = 14;
      const a = this._titleClock * 0.15;
      this.camera.position.set(
        Math.sin(a) * r,
        5 + Math.sin(this._titleClock * 0.3) * 0.8,
        Math.cos(a) * r,
      );
      this.camera.lookAt(0, 2, 0);
    }
    if (this._titleWorld) {
      // Rotate the title world slowly for parallax.
      this._titleWorld.group.rotation.y = this._titleClock * 0.05;
    }
    if (this.input && this.input.isLocked()) {
      if (!this._titleHeld) {
        this._titleHeld = true;
        this._titleHoldStart = this._now;
      }
      if (this._now - this._titleHoldStart >= 5) {
        this._titleHeld = false;
        this.input.setPointerLock(false);
        this._advanceFromTitle();
      }
    }
  }

  _advanceFromTitle() {
    // Camera stays; the run starts from the start menu.
  }

  _showStartMenu() {
    const el = document.getElementById('start-menu');
    if (el) el.classList.remove('hidden');
    this._inMenu = true;
  }

  _hideStartMenu() {
    const el = document.getElementById('start-menu');
    if (el) el.classList.add('hidden');
    this._inMenu = false;
  }

  _enterRun() {
    this._hideStartMenu();
    if (this._titleWorld) {
      this.scene.remove(this._titleWorld.group);
      this._titleWorld.dispose();
      this._titleWorld = null;
    }
    this._isRunning = true;
    this._regenerateDungeon();
  }

  // =========================================================================
  // §26 — start / restart / NG+ / save / load
  // =========================================================================
  newGame() {
    this._hideDeathScreen();
    this._hideStartMenu();
    this.state = new GameState();
    this._maxHealth = PLAYER.BASE_HEALTH;
    this.state.level = 1;
    this.state.weaponTier = 0;
    this.state.ngPlus = 0;
    this.state.bossKills = 0;
    this.state.maxHealth = PLAYER.BASE_HEALTH;
    if (this.sword) {
      this.sword.setTier(0);
      this.sword.souls = 0;
    }
    this._regenAcc = 0;
    this._bossPortalOpen = false;
    this._isRunning = true;
    this._regenerateDungeon();
  }

  newGamePlus() {
    if (!this._deathVisible) return;
    this._hideDeathScreen();
    const s = this.state;
    s.ngPlus += 1;
    this._maxHealth += PLAYER.MAX_HEALTH_BONUS_PER_NG_PLUS;
    s.maxHealth = this._maxHealth;
    s.level = 1;
    s.bossKills = 0;
    s.health = s.maxHealth;
    s.timeSurvived = 0;
    this._bossPortalOpen = false;
    this._regenAcc = 0;
    this._isRunning = true;
    this._regenerateDungeon();
  }

  saveGame() {
    if (!this._deathVisible) return;
    this.leaderboard.setSave(this.state.serialize());
    const btn = document.getElementById('btn-load');
    if (btn) btn.classList.remove('hidden');
    try {
      if (typeof fetch !== 'undefined') {
        fetch(SAVE_SERVER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.state.serialize()),
        }).catch(() => {});
      }
    } catch { /* ignore */ }
    this._toast('Run saved.');
  }

  loadGame() {
    if (!this.leaderboard.hasSave()) return;
    const saved = this.leaderboard.getSave();
    if (!saved) return;
    this._hideDeathScreen();
    this._hideStartMenu();
    this.state.deserialize(saved);
    this._maxHealth = this.state.maxHealth || this._maxHealth;
    if (this.sword) {
      this.sword.setTier(this.state.weaponTier);
      this.sword.souls = this.state.collectedOrbs;
    }
    this._bossPortalOpen = this.state.bossKills > 0;
    this._regenAcc = 0;
    this._isRunning = true;
    this._regenerateDungeon();
  }

  _onLevelLoadedEvent(d) {
    this._levelLoaded = true;
    this._hudDirty = true;
    this._noAmmoShown = false;
    if (d && d.showTitle) this._showLevelTitle(d.level, d.biomeId);
  }

  _onBossKilledEvent(d) {
    this.state.bossKills += 1;
    this._bossPortalOpen = true;
    this._regenAcc = 0;
    this._toast('The Spectral Lord has fallen. The exit opens.');
    this._hudDirty = true;
  }

  _onRunEndedEvent(d) {
    if (d && d.type === 'death') {
      this._showDeathScreen();
    }
  }

  // =========================================================================
  // §14 — async phased level regeneration (yielding between phases)
  // =========================================================================
  async _regenerateDungeon() {
    const s = this.state;
    const biomeId = biomeForLevel(s.level, s.ngPlus);
    this._isRunning = false; // freeze enemies while loading
    this._levelLoaded = false;

    this._teardownLevel();

    this._showLoadingOverlay(s.level, biomeId);

    const yieldFrame = () => new Promise((r) => raf(r));

    // Phase 1 — dungeon data
    await yieldFrame();
    const seed = (s.level * 7919 + (s.ngPlus + 1) * 104729) >>> 0;
    const dungeon = this.generator.generate(seed, biomeId);
    this.dungeon = dungeon;

    // Phase 2 — world geometry
    await yieldFrame();
    this.world = this.biomes.buildWorld(this.scene, dungeon, biomeId);
    const boxes = [...(this.world && this.world.collisionBoxes ? this.world.collisionBoxes : [])];
    this._boxesCache = null;

    // Phase 3 — props
    await yieldFrame();
    this.props = this.biomes.getPropsFor(biomeId);
    this.props.build(dungeon, biomeId);
    this.scene.add(this.props.group);
    this.props.configureCallbacks({
      bus: this.eventBus,
      state: s,
      spawnOrbs: (x, z, n) => { if (this.orbs) this.orbs.dropOrb(x, z, n); },
      spawnHealth: (x, z) => { if (this.orbs) this.orbs.dropHealth(x, z); },
      spawnBuff: (x, z, buffId) => { if (this.orbs) this.orbs.dropBuff(x, z, buffId); },
      onBuffCollected: (effect) => this._onBuffCollected(effect),
      onPropBroken: () => {},
    });
    for (const b of this.props.collidableBoxes()) boxes.push(b);
    this._waterPuddles = this._collectWaterPuddles();

    // Phase 4 — enemies
    await yieldFrame();
    this.skeletons = this._createSkeletonSystem(dungeon, biomeId, boxes);

    // Phase 5 — orbs
    await yieldFrame();
    this.orbs = new OrbSystem(this.scene, this.camera);
    this._wireOrbs();
    this.scene.add(this.orbs.group);

    // Phase 6 — shooter
    await yieldFrame();
    this.shooter = new OrbShooter(this.scene, {
      orbs: s.collectedOrbs,
      getOrbs: () => s.collectedOrbs,
      walls: () => this._collisionBoxes(),
      props: () => (this.props ? this.props.collidableBoxes() : []),
      spendOrb: () => this._spendOrb(),
      onOrbHit: (x, y, z, dir, damage) => this._onOrbHit(x, y, z, dir, damage),
      onOrbExplode: (x, y, z, damage) => this._onOrbExplode(x, y, z, damage),
      onBreakableHit: (x, y, z, normal) => {},
      onProjectile: () => {},
      onFireballProjectile: () => {},
    });
    this.shooter.setActiveBuff(s.activeBuff);
    this.scene.add(this.shooter.group);

    // Phase 7 — lighting
    await yieldFrame();
    this.lighting = this.biomes.getLightingFor(biomeId);
    this.lighting.build(this.scene, dungeon, biomeId);
    if (this._degraded) this.lighting.setDegraded(0);
    this.lighting.setBright(s.activeBuff === BUFF.EFFECTS.BRIGHT);

    // Phase 8 — particles
    await yieldFrame();
    this.particles = this.biomes.getParticlesFor(biomeId);
    this.particles.group.position.set(
      (dungeon.gridSize / 2) * DUNGEON.CELL_SIZE,
      0,
      (dungeon.gridSize / 2) * DUNGEON.CELL_SIZE,
    );
    this.scene.add(this.particles.group);

    // Phase 9 — smoke
    await yieldFrame();
    this.smoke = this.biomes.getSmokeFor(biomeId);
    this._setupSmokeSources(biomeId, dungeon);
    this.scene.add(this.smoke.group);

    // Phase 10 — runes
    await yieldFrame();
    this.runes = new RuneSystem();
    this.runes.build(dungeon, biomeId);
    this.scene.add(this.runes.group);

    // Player placement at the entrance.
    const cell = DUNGEON.CELL_SIZE;
    const ex = (dungeon.entranceCell.x + 0.5) * cell;
    const ez = (dungeon.entranceCell.z + 0.5) * cell;
    s.x = ex;
    s.z = ez;
    s.y = WORLD.FLOOR_Y;
    s.health = s.maxHealth;
    s.invulnTimer = 0;
    s.activeBuff = null;
    s.activeBuffTimer = 0;
    if (this.sword) {
      this.sword.buffAttackSpeedMult = 1;
      this.sword.buffDamageMult = 1;
      this.sword.souls = s.collectedOrbs;
    }
    this._placeCamera();

    // Fire the level-loaded event (§26: show title overlay).
    this.eventBus.emit('level:loaded', { level: s.level, biomeId, showTitle: true });

    // Phase 11 — done
    await yieldFrame();
    this._levelLoaded = true;
    this._isRunning = true;
    this._hudDirty = true;
    this._hideLoadingOverlay();
  }

  /** Tear down the previous level (keeps persistent §4.2 assets, §14). */
  _teardownLevel() {
    if (this._titleWorld) {
      this.scene.remove(this._titleWorld.group);
      this._titleWorld.dispose();
      this._titleWorld = null;
    }
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
      this.world = null;
    }
    if (this.lighting) { this.lighting.dispose(); this.lighting = null; }
    if (this.props) { this.props.dispose(); this.props = null; }
    if (this.skeletons) { this.skeletons.dispose(); this.skeletons = null; }
    if (this.orbs) { this.orbs.dispose(); this.orbs = null; }
    if (this.shooter) { this.shooter.dispose(); this.shooter = null; }
    if (this.particles) { this.particles.dispose(); this.particles = null; }
    if (this.smoke) { this.smoke.dispose(); this.smoke = null; }
    if (this.runes) { this.runes.dispose(); this.runes = null; }
    if (this.hunter) { this.hunter.dispose(); this.hunter = null; }
    for (const p of this._firePatches) {
      if (p.mesh) this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this._firePatches = [];
    for (const b of this._arcBolts) {
      if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
      if (b.mat) b.mat.dispose();
      if (b.geo) b.geo.dispose();
    }
    this._arcBolts = [];
    this._waterPuddles = [];
    this._boxesCache = null;
  }

  _createSkeletonSystem(dungeon, biomeId, boxes) {
    const sys = new SkeletonSystem(this.scene, dungeon, biomeId, this.state, {
      onKill: (enemy, info) => {
        // §26: onKill fires BEFORE the bus → spawn drops directly.
        this._spawnDrops(info);
        this.eventBus.emit('enemy:killed', info);
      },
      onBossKill: (boss) => {
        this.eventBus.emit('boss:killed', { level: this.state.level });
      },
      onPlayerDamaged: (dmg, src) => this._onPlayerDamaged(dmg, src),
      onBlinkHit: (x, z, r, d) => this._onBlinkHit(x, z, r, d),
      onToast: (msg) => this._toast(msg),
      onFirePatch: (x, z) => this._spawnFirePatch(x, z),
      collisionBoxes: boxes,
    });
    sys.isBossLevelFn = (lvl) => (lvl - 1) % BOSS.INTERVAL === BOSS.INTERVAL - 1;
    sys.ngPlus = this.state.ngPlus;
    sys.souls = this.state.collectedOrbs;
    sys.maxHealth = this.state.maxHealth;
    sys.bossKills = this.state.bossKills;
    sys.level = this.state.level;
    sys._speedMult = 1 + this.state.ngPlus * 0.05;
    sys._attackMult = 1 + this.state.ngPlus * 0.05;
    // Boss level: spawn the boss in the arena.
    if (sys.isBossLevelFn(this.state.level)) {
      sys._hasArena = true;
      sys._spawnBoss();
    }
    return sys;
  }

  /** Collect water-pool circles for movement slowdown (§26). */
  _collectWaterPuddles() {
    const out = [];
    if (!this.props) return out;
    // PropSystem tracks hazards; water pools are the non-damaging ones.
    if (this.props.hazards) {
      for (const h of this.props.hazards) {
        if (h.type === 'water' || h.damage === 0) {
          out.push({ x: h.x, z: h.z, r: h.radius || 1.5 });
        }
      }
    }
    return out;
  }

  _setupSmokeSources(biomeId, dungeon) {
    if (!this.smoke) return;
    if (biomeId === 'FUNGAL_CAVERN') {
      for (const room of dungeon.rooms) {
        if (room.type === 'CRYPT' || room.type === 'BOSS' || room.type === 'VAULT') {
          const cell = DUNGEON.CELL_SIZE;
          const cx = (room.cx + (room.w >> 1)) * cell;
          const cz = (room.cz + (room.h >> 1)) * cell;
          this.smoke.addEmitter([cx, 1.5, cz], {
            emitRate: 1.0, life: [2, 3.5], size: 1.8, spread: 0.4, scale: 1.5,
          });
        }
      }
    }
    // Boss smoke is driven by SkeletonSystem._tickBossSmoke.
  }

  // =========================================================================
  // §22 — perf monitor + degrade
  // =========================================================================
  _perfMonitor(dt) {
    if (!this._levelLoaded || this._inMenu || this._deathVisible) return;
    const fps = dt > 0 ? 1 / dt : 60;
    this._fpsEma += (fps - this._fpsEma) * 0.05;
    if (this._fpsEma < 30) {
      this._lowFpsMs += dt * 1000;
      if (this._lowFpsMs > 3000 && !this._degraded) {
        this._enterDegradedMode();
      }
    } else {
      this._lowFpsMs = Math.max(0, this._lowFpsMs - dt * 1000);
    }
  }

  _enterDegradedMode() {
    this._degraded = true;
    if (this.props) this.props.reduceDecorations(0.5);
    if (this.lighting) this.lighting.setDegraded(0);
    if (this.post && this.post.setDegraded) this.post.setDegraded();
    const w = document.getElementById('perf-warning');
    if (w) { w.textContent = PERF_WARNING; w.classList.remove('hidden'); }
  }

  // =========================================================================
  // §8 — main update loop
  // =========================================================================
  _animate() {
    if (this.headless) return;
    this._animateId = raf(this._animate);

    const t = nowSec();
    let dt = t - this._lastTime;
    this._lastTime = t;
    this._now = t;
    if (dt > 0.25) dt = 0.25; // clamp large hitches

    // Hit-stop (§8, §25.3)
    let scale = 1;
    if (this._hitStop > 0) {
      this._hitStop -= dt * 1000;
      scale = 0.05;
      if (this._hitStop <= 0) this._hitStop = 0;
    }
    const sdt = dt * scale;

    if (this._inMenu) {
      this._titleUpdate(dt);
    } else if (this._deathVisible) {
      // Frozen death screen.
    } else {
      this._updateGame(sdt, dt);
    }

    this._render();
  }

  _updateGame(sdt, dt) {
    this._perfMonitor(dt);

    // Timed-run timer
    if (this.state.timedRun) {
      this.state.timeLeft -= dt;
      if (this.state.timeLeft <= 0) {
        this.state.timeLeft = 0;
        this._onPlayerDamaged(this.state.maxHealth, { source: 'time' });
      }
    }

    // Weapon regen (per second)
    this._regenAcc += dt;
    if (this._regenAcc >= 1) {
      this._regenAcc -= 1;
      const cap = this.state.timedRun ? PLAYER.MAX_ORBS_TIMED : PLAYER.MAX_ORBS;
      this.state.collectedOrbs = Math.min(
        this.state.collectedOrbs + PLAYER.ORBS_REGEN_PER_SEC, cap,
      );
      this._checkEvolution();
      this._hudDirty = true;
    }

    // Player movement
    this._updatePlayer(sdt);

    // Fireball charge (buff #2)
    this._updateFireballCharge(dt);

    // Input edges
    this._updateInputEdges();

    // Systems
    if (this.skeletons) {
      const frozen = this.state.safeSpawnTimer > 0;
      const fleeing = this.state.activeBuff === BUFF.EFFECTS.BRIGHT;
      this.skeletons.update(sdt,
        { x: this.state.x, z: this.state.z, invulnTimer: this.state.invulnTimer },
        { frozen, fleeing });
    }
    if (this.orbs) {
      this.orbs.update(sdt, {
        x: this.state.x, z: this.state.z, y: this.state.y,
        invulnTimer: this.state.invulnTimer,
      });
    }
    if (this.shooter) {
      this.shooter.update(sdt, this._origin(), this._forward());
    }
    if (this.sword) {
      this.sword.update(sdt, 0, this._now);
    }
    if (this.hunter) {
      this.hunter.update(sdt, { x: this.state.x, z: this.state.z });
    }
    if (this.props) {
      this.props.update(sdt, this.state.x, this.state.z);
      this.props.stepCheck(this.state.x, this.state.z);
      const hazardDmg = this.props.tickHazard(sdt, this.state.x, this.state.z);
      if (hazardDmg > 0) this._onPlayerDamaged(hazardDmg, { source: 'hazard' });
    }
    if (this.runes) this.runes.update(this._now);
    if (this.particles) this.particles.update(sdt, this.camera.position);
    if (this.smoke) this.smoke.update(sdt, this.camera.position);

    // Safe-spawn timer
    if (this.state.safeSpawnTimer > 0) {
      this.state.safeSpawnTimer -= dt;
      if (this.state.safeSpawnTimer <= 0) this.state.safeSpawnTimer = 0;
    }

    // Buff timer
    if (this.state.activeBuffTimer > 0) {
      this.state.activeBuffTimer -= dt;
      if (this.state.activeBuffTimer <= 0) {
        this.state.activeBuffTimer = 0;
        this._onBuffExpired();
      }
    }

    // Invuln
    if (this.state.invulnTimer > 0) {
      this.state.invulnTimer = Math.max(0, this.state.invulnTimer - dt);
    }

    // Fire patches
    this._updateFirePatches(sdt);

    // Exit prompt
    this._updateExit();

    // Camera
    this._placeCamera();

    // HUD
    this._updateHud();
    this._hudDirty = false;
  }

  _origin() {
    const o = this._originV || (this._originV = new THREE.Vector3());
    o.set(this.camera.position.x, 0.6, this.camera.position.z);
    return o;
  }
  _forward() {
    const f = this._forwardV || (this._forwardV = new THREE.Vector3());
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    return f;
  }

  // =========================================================================
  // Player movement + collision (§8, §6)
  // =========================================================================
  _updatePlayer(sdt) {
    const s = this.state;
    const p = this.input.player;

    let speedMult = 1;
    if (s.activeBuff === BUFF.EFFECTS.GODSPEED) speedMult *= BUFF.GODSPEED.speedMult;
    if (s.activeBuff === BUFF.EFFECTS.EMPOWERED) speedMult *= BUFF.EMPOWERED.speedMult;
    const inWater = this._inWaterPool(s.x, s.z);
    if (inWater) speedMult *= 0.45;

    const base = (p.sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED) * speedMult;
    const dx = p.x;
    const dz = p.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.001) {
      s.x += (dx / len) * base * sdt;
      s.z += (dz / len) * base * sdt;
    }
    s.y = WORLD.FLOOR_Y;

    const boxes = this._collisionBoxes();
    resolveCircleCollisions(boxes, s, PLAYER.RADIUS);

    // Camera follows position.
    const k = Math.min(1, sdt * 12);
    this.camera.position.x += (s.x - this.camera.position.x) * k;
    this.camera.position.z += (s.z - this.camera.position.z) * k;
    this.camera.position.y = PLAYER.HEIGHT + CAMERA.EYE_HEIGHT;
  }

  _collisionBoxes() {
    if (this._boxesCache && this._boxesCacheLevel === this.state.level) {
      return this._boxesCache;
    }
    const boxes = [];
    if (this.world && this.world.collisionBoxes) boxes.push(...this.world.collisionBoxes);
    if (this.props) boxes.push(...this.props.collidableBoxes());
    this._boxesCache = boxes;
    this._boxesCacheLevel = this.state.level;
    return boxes;
  }

  _inWaterPool(x, z) {
    for (const w of this._waterPuddles) {
      const dx = x - w.x, dz = z - w.z;
      if (dx * dx + dz * dz <= w.r * w.r) return true;
    }
    return false;
  }

  // =========================================================================
  // Input edges (RMB attack, LMB orb, buff #2 fireball)
  // =========================================================================
  _updateInputEdges() {
    const m2 = this.input.mouse.right;
    const m0 = this.input.mouse.left;
    const canAct = !this._deathVisible && this._levelLoaded &&
      this.state.safeSpawnTimer <= 0 && !this._inMenu;

    if (m2 && !this._prevKeys.m2 && canAct) {
      this.sword.attack();
    }
    if (m0 && !this._prevKeys.m0 && canAct) {
      this._fireOrb();
    }
    this._prevKeys.m2 = m2;
    this._prevKeys.m0 = m0;
  }

  /** Per-frame: buff #2 charge + auto-fireball at full charge (§19). */
  _updateFireballCharge(dt) {
    const s = this.state;
    if (s.activeBuff !== BUFF.EFFECTS.FIREBALL) {
      this._fbCharge = 0;
      this._fbHeld = false;
      if (this.fireballHeld) this.fireballHeld.visible = false;
      return;
    }
    const m0 = this.input.mouse.left;
    if (m0 && this._levelLoaded && !this._deathVisible) {
      this._fbHeld = true;
      this._fbCharge = Math.min(this._fbCharge + dt, BUFF.FIREBALL.chargeTime);
      if (this.shooter) this.shooter._fbCharge = this._fbCharge;
      if (this.fireballHeld) this.fireballHeld.visible = true;
      if (this._fbCharge >= BUFF.FIREBALL.chargeTime) {
        this._fireFireball();
        this._fbCharge = 0;
        if (this.shooter) this.shooter._fbCharge = 0;
      }
    } else {
      this._fbCharge = 0;
      this._fbHeld = false;
      if (this.fireballHeld) this.fireballHeld.visible = false;
    }
  }

  _fireOrb() {
    if (!this.shooter) return;
    const step = (this.sword && this.sword.comboStep) || 1;
    this.shooter.fire(this._origin(), this._forward(), step);
  }

  _fireFireball() {
    if (!this.shooter) return;
    this.shooter.fireFireball(this._origin(), this._forward());
  }

  _spendOrb() {
    const s = this.state;
    if (s.collectedOrbs >= ORB_WEAPON.COST_PER_HIT) {
      s.collectedOrbs -= ORB_WEAPON.COST_PER_HIT;
      if (this.sword) this.sword.souls = s.collectedOrbs;
      this._checkEvolution();
      this._hudDirty = true;
      return true;
    }
    if (!this._noAmmoShown && this._levelLoaded) {
      this._toast('No orbs');
      this._noAmmoShown = true;
    }
    return false;
  }

  _checkEvolution() {
    const target = weaponTier(this.state.collectedOrbs);
    if (target > this.state.weaponTier) {
      if (this.sword) this.sword.setTier(target);
      else this.state.weaponTier = target;
    }
  }

  /** Wire OrbSystem callbacks to state + HUD. */
  _wireOrbs() {
    const s = this.state;
    this.orbs.rewireCallbacks({
      onOrbCollected: (x, z, value) => {
        const cap = s.timedRun ? PLAYER.MAX_ORBS_TIMED : PLAYER.MAX_ORBS;
        s.collectedOrbs += value;
        if (s.collectedOrbs > cap) s.collectedOrbs = cap;
        if (this.sword) this.sword.souls = s.collectedOrbs;
        this._checkEvolution();
        this._hudDirty = true;
      },
      onHealthCollected: (x, z, value) => {
        s.health = Math.min(s.maxHealth, s.health + value);
        this._hudDirty = true;
      },
      onBuffCollected: (x, z, buffId) => {
        this._onBuffCollected(buffId);
      },
    });
  }

  /** Snap the camera to the player position (after teleport / level load). */
  _placeCamera() {
    if (!this.camera) return;
    this.camera.position.set(
      this.state.x,
      PLAYER.HEIGHT + CAMERA.EYE_HEIGHT,
      this.state.z,
    );
  }

  // =========================================================================
  // Combat callbacks
  // =========================================================================
  _onSwordSwing(enemies, step, dir, pos, arc) {
    if (!this.skeletons) return;
    const s = this.state;
    const dmg = this.sword.damage(step, s.weaponTier, damageMult(s.collectedOrbs));
    for (const e of enemies) {
      if (!e || !e.alive) continue;
      this.skeletons.hitSkeleton(e, dmg, pos);
    }
    // Breakables in swing reach
    if (this.props) {
      const reach = this.sword._rangeForStep
        ? this.sword._rangeForStep(step)
        : SWORD.RANGE * this.sword.scale;
      for (const rec of this.props.breakables) {
        if (rec.broken) continue;
        const dx = rec.pos.x - pos.x, dz = rec.pos.z - pos.z;
        if (dx * dx + dz * dz <= reach * reach) {
          this.props.breakBreakable(rec);
        }
      }
    }
  }

  _onElectricChain(targets) {
    if (!this.skeletons) return;
    const dmg = 5 * damageMult(this.state.collectedOrbs);
    for (const t of targets) {
      if (t && t.alive) this.skeletons.hitSkeleton(t, dmg, null);
    }
  }

  _onEvolution(tier, prevTier) {
    const s = this.state;
    s.weaponTier = tier;
    this.eventBus.emit('weapon:evolved', { tier, prevTier, level: s.level });
    this._toast(`${EVOLUTION.tierName(tier)} evolved!`);
    this._hudDirty = true;
  }

  _onOrbHit(x, y, z, dir, damage) {
    if (!this.skeletons) return;
    const dmg = damage || 2;
    let hit = false;
    for (const e of this.skeletons.living) {
      if (!e.alive) continue;
      const dx = e.position.x - x, dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      const r = (e.radius || 0.4) + ORB_WEAPON.RADIUS;
      if (d <= r) {
        this.skeletons.hitSkeleton(e, dmg, { x, z });
        hit = true;
        break;
      }
    }
    if (hit && this.sword && this.sword.onHitStop) {
      this.sword.onHitStop(HIT_STOP.ORB_HIT);
    }
  }

  _onOrbExplode(x, y, z, damage) {
    if (!this.skeletons) return;
    const dmg = damage || 4;
    const R = ORB_WEAPON.EXPLOSION_RADIUS;
    for (const e of this.skeletons.living) {
      if (!e.alive) continue;
      const dx = e.position.x - x, dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d <= R + (e.radius || 0.4)) {
        this.skeletons.hitSkeleton(e, dmg, { x, z });
      }
    }
    if (this.props) {
      for (const rec of this.props.breakables) {
        if (rec.broken) continue;
        const dx = rec.pos.x - x, dz = rec.pos.z - z;
        if (dx * dx + dz * dz <= R * R) this.props.breakBreakable(rec);
      }
    }
  }

  _onBlinkHit(x, z, r, d) {
    const s = this.state;
    const dx = s.x - x, dz = s.z - z;
    if (dx * dx + dz * dz <= r * r) {
      this._onPlayerDamaged(d, { source: 'blink' });
    }
  }

  _onPlayerDamaged(dmg, src) {
    const s = this.state;
    if (s.invulnTimer > 0) return;
    s.health -= dmg;
    s.invulnTimer = PLAYER.I_FRAMES;
    this._damageFlash();
    if (s.health <= 0) {
      s.health = 0;
      this._die();
    }
  }

  _die() {
    const s = this.state;
    this._isRunning = false;
    this.eventBus.emit('run:ended', {
      type: 'death',
      level: s.level,
      timeSurvived: s.timeSurvived,
      ngPlus: s.ngPlus,
      bossKills: s.bossKills,
      orbs: s.collectedOrbs,
    });
  }

  // =========================================================================
  // Drops (§26, §11)
  // =========================================================================
  _spawnDrops(info) {
    if (!this.orbs) return;
    const { x, z, drops, healthChance } = info;
    if (drops > 0) this.orbs.dropOrb(x, z, drops);
    if (healthChance) this.orbs.dropHealth(x, z);
    if (Math.random() < 0.05) {
      const effects = BUFF.EFFECTS.filter((e) => e !== this.state.activeBuff);
      const pick = effects[Math.floor(Math.random() * effects.length)];
      this.orbs.dropBuff(x, z, pick);
    }
  }

  _onBuffCollected(effect) {
    const s = this.state;
    s.activeBuff = effect;
    s.activeBuffTimer = BUFF.DURATION;
    if (this.sword) {
      if (effect === BUFF.EFFECTS.EMPOWERED) {
        this.sword.buffAttackSpeedMult = BUFF.EMPOWERED.attackSpeedMult;
        this.sword.buffDamageMult = BUFF.EMPOWERED.damageMult;
      } else {
        this.sword.buffAttackSpeedMult = 1;
        this.sword.buffDamageMult = 1;
      }
    }
    if (this.shooter) this.shooter.setActiveBuff(effect);
    if (this.lighting) this.lighting.setBright(effect === BUFF.EFFECTS.BRIGHT);
    if (effect === BUFF.EFFECTS.HUNTER) {
      if (!this.hunter) {
        this.hunter = new Hunter(this.scene, {
          onKill: (e) => { if (this.skeletons) this.skeletons.hitSkeleton(e, 5, null); },
          onPlayerDamaged: () => {},
        });
      }
    } else if (this.hunter) {
      this.hunter.dispose();
      this.hunter = null;
    }
    this._hudDirty = true;
    this._toast(`Buff: ${effect}`);
  }

  _onBuffExpired() {
    const s = this.state;
    s.activeBuff = null;
    s.activeBuffTimer = 0;
    if (this.sword) {
      this.sword.buffAttackSpeedMult = 1;
      this.sword.buffDamageMult = 1;
    }
    if (this.shooter) this.shooter.setActiveBuff(null);
    if (this.lighting) this.lighting.setBright(false);
    if (this.hunter) {
      this.hunter.dispose();
      this.hunter = null;
    }
    this._hudDirty = true;
  }

  // =========================================================================
  // §17 — exit / descend
  // =========================================================================
  _updateExit() {
    const s = this.state;
    if (!this.dungeon) return;
    const cell = DUNGEON.CELL_SIZE;
    const ex = (this.dungeon.exitCell.x + 0.5) * cell;
    const ez = (this.dungeon.exitCell.z + 0.5) * cell;
    const dx = s.x - ex, dz = s.z - ez;
    const inExit = dx * dx + dz * dz <= 9;
    const isBossLevel = (s.level - 1) % BOSS.INTERVAL === BOSS.INTERVAL - 1;
    const prompt = document.getElementById('exit-prompt');
    if (prompt) {
      const show = inExit && (!isBossLevel || this._bossPortalOpen);
      if (show) {
        prompt.classList.remove('hidden');
        prompt.textContent = 'The depths beckon further... [E] to descend';
      } else {
        prompt.classList.add('hidden');
      }
    }
    this._prevInExit = inExit;
  }

  _tryDescend() {
    if (!this._levelLoaded || this._inMenu || this._deathVisible) return;
    const s = this.state;
    const isBossLevel = (s.level - 1) % BOSS.INTERVAL === BOSS.INTERVAL - 1;
    if (isBossLevel && !this._bossPortalOpen) return; // boss still alive
    const cell = DUNGEON.CELL_SIZE;
    const ex = (this.dungeon.exitCell.x + 0.5) * cell;
    const ez = (this.dungeon.exitCell.z + 0.5) * cell;
    const dx = s.x - ex, dz = s.z - ez;
    if (dx * dx + dz * dz > 9) return;
    s.level += 1;
    s.timeSurvived = 0;
    s.safeSpawnTimer = 5;
    this._regenerateDungeon();
  }

  // =========================================================================
  // HUD (§24, §25)
  // =========================================================================
  _updateHud() {
    if (this.headless) return;
    const s = this.state;
    const set = (id, text, width) => {
      const el = document.getElementById(id);
      if (el) {
        if (text !== undefined) el.textContent = String(text);
        if (width !== undefined) el.style.width = width;
      }
    };

    const hpFrac = s.maxHealth > 0 ? s.health / s.maxHealth : 0;
    set('hp-fill', null, `${Math.max(0, hpFrac * 100)}%`);
    set('hp-num', `${Math.ceil(s.health)} / ${s.maxHealth}`);

    const biomeId = biomeForLevel(s.level, s.ngPlus);
    const biome = BIOMES[biomeId];
    set('level-title', `LEVEL ${s.level}`);
    const bl = document.getElementById('biome-label');
    if (bl) bl.textContent = ` · ${biome.name}`;
    const timer = document.getElementById('timer');
    if (timer) {
      timer.textContent = s.timedRun ? fmtTime(s.timeLeft) : fmtTime(s.timeSurvived);
      timer.classList.toggle('low', s.timedRun && s.timeLeft < 30);
    }

    set('orb-count', s.collectedOrbs);
    set('weapon-name', EVOLUTION.tierName(s.weaponTier));
    set('weapon-tier', `TIER ${s.weaponTier} — ${EVOLUTION.tierDescr(s.weaponTier)}`);

    const pips = document.querySelectorAll('#combo-pips .pip');
    const step = this.sword ? this.sword.comboStep : 0;
    pips.forEach((p, i) => p.classList.toggle('on', i < step));

    const badge = document.getElementById('buff-badge');
    if (badge) {
      if (s.activeBuff) {
        badge.classList.remove('hidden');
        badge.textContent = `${s.activeBuff} — ${s.activeBuffTimer.toFixed(1)}s`;
      } else {
        badge.classList.add('hidden');
      }
    }

    const ss = document.getElementById('safe-spawn');
    if (ss) {
      if (s.safeSpawnTimer > 0) {
        ss.classList.remove('hidden');
        ss.textContent = String(Math.ceil(s.safeSpawnTimer));
      } else {
        ss.classList.add('hidden');
      }
    }

    const bbw = document.getElementById('boss-bar-wrap');
    const boss = this.skeletons && this.skeletons.boss;
    if (bbw) {
      if (boss && boss.alive) {
        bbw.classList.remove('hidden');
        const frac = boss.maxHp > 0 ? boss.hp / boss.maxHp : 0;
        const fill = document.getElementById('boss-bar-fill');
        if (fill) fill.style.width = `${Math.max(0, frac * 100)}%`;
        const label = document.getElementById('boss-bar-label');
        if (label) label.textContent = boss.label || 'SPECTRAL LORD';
      } else {
        bbw.classList.add('hidden');
      }
    }

    const stats = document.getElementById('stats-panel');
    if (stats) {
      const kills = this.skeletons ? this.skeletons.kills : 0;
      stats.textContent =
        `LEVEL ${s.level}  ${biome.name}\n` +
        `NG+${s.ngPlus}   SOULS ${s.collectedOrbs}\n` +
        `KILLS ${kills}   BOSS ${s.bossKills}\n` +
        `WALK ${PLAYER.WALK_SPEED}  SPRINT ${PLAYER.SPRINT_SPEED}\n` +
        `TIER ${s.weaponTier}  ${EVOLUTION.tierName(s.weaponTier)}`;
    }

    if (this.fireballHeld) {
      this.fireballHeld.visible =
        s.activeBuff === BUFF.EFFECTS.FIREBALL && this._fbCharge > 0;
    }

    this._updateMessages();
  }

  _updateMessages() {
    const box = document.getElementById('messages');
    if (!box) return;
    this._messages = this._messages.filter((m) => this._now - m.t < 3);
    if (this._messages.length !== this._msgSig) {
      this._msgSig = this._messages.length;
      box.innerHTML = '';
      for (const m of this._messages) {
        const div = document.createElement('div');
        div.className = 'toast';
        div.textContent = m.text;
        box.appendChild(div);
      }
    }
  }

  _toast(text) {
    this._messages.push({ text, t: this._now });
    if (this._messages.length > 4) this._messages.shift();
    this._msgSig = -1;
  }

  _damageFlash() {
    const el = document.getElementById('damage-flash');
    if (!el) return;
    el.style.opacity = '1';
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { if (el) el.style.opacity = '0'; }, 120);
  }

  // =========================================================================
  // §23 / §26 — overlays
  // =========================================================================
  _showLevelTitle(level, biomeId) {
    const t = document.getElementById('loading-title');
    const b = document.getElementById('loading-biome');
    const s = document.getElementById('loading-stats');
    const buff = document.getElementById('loading-buff');
    if (t) t.textContent = `LEVEL ${level}`;
    if (b) b.textContent = BIOMES[biomeId].name;
    if (buff) buff.textContent = this.state.activeBuff ? `${this.state.activeBuff}` : 'No active buff';
    if (s) {
      const biome = BIOMES[biomeId];
      s.textContent = `Fog ${biome.fogDensity} · Ambient ${biome.ambientIntensity}`;
    }
  }

  _showLoadingOverlay(level, biomeId) {
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.classList.remove('hidden');
    this._showLevelTitle(level, biomeId);
  }

  _hideLoadingOverlay() {
    const ov = document.getElementById('loading-overlay');
    if (ov) ov.classList.add('hidden');
  }

  _showDeathScreen() {
    this._deathVisible = true;
    if (this.input) this.input.setPointerLock(false);
    const s = this.state;
    const el = document.getElementById('death-screen');
    if (el) el.classList.remove('hidden');
    const title = document.getElementById('death-title');
    if (title) title.textContent = `The dead claim you — Level ${s.level}`;
    const stats = document.getElementById('death-stats');
    if (stats) {
      stats.textContent =
        `Reached Level ${s.level} · ${BIOMES[biomeForLevel(s.level, s.ngPlus)].name}\n` +
        `Survived ${fmtTime(s.timeSurvived)} · Souls ${s.collectedOrbs} · Bosses ${s.bossKills}`;
    }
    this._lastDeath = {
      level: s.level,
      time: s.timeSurvived,
      ngPlus: s.ngPlus,
      bossKills: s.bossKills,
      orbs: s.collectedOrbs,
    };
    this.leaderboard.recordDeath({
      level: s.level,
      time: Math.round(s.timeSurvived),
      ngPlus: s.ngPlus,
      bossKills: s.bossKills,
      orbs: s.collectedOrbs,
      date: Date.now(),
    });
    this._hudDirty = true;
  }

  _hideDeathScreen() {
    this._deathVisible = false;
    const el = document.getElementById('death-screen');
    if (el) el.classList.add('hidden');
  }

  _toggleLeaderboard() {
    if (!this.input || !this.input.isLocked()) return;
    if (this._leaderboardOpen) {
      this._hideLeaderboard();
    } else {
      this._showLeaderboard();
    }
  }

  _showLeaderboard() {
    this._leaderboardOpen = true;
    if (this.input) this.input.setPointerLock(false);
    const el = document.getElementById('leaderboard');
    if (el) el.classList.remove('hidden');
    const entries = this.leaderboard.getEntries();
    const box = document.querySelector('#leaderboard .entries');
    if (box) {
      if (!entries.length) {
        box.innerHTML = '<div class="empty">No runs yet — descend!</div>';
      } else {
        box.innerHTML = entries.map((e, i) =>
          `${i + 1}. Level ${e.level} · ${e.time}s · NG+${e.ngPlus} · Bosses ${e.bossKills}`
        ).join('<br>');
      }
    }
  }

  _hideLeaderboard() {
    this._leaderboardOpen = false;
    const el = document.getElementById('leaderboard');
    if (el) el.classList.add('hidden');
    if (this._levelLoaded && !this._deathVisible && !this._inMenu && this.input) {
      this.input.setPointerLock(true);
    }
  }

  _togglePost() {
    if (this.post) this.post.toggle();
  }

  // =========================================================================
  // Resizing
  // =========================================================================
  _onResize = () => {
    if (!this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.post && this.post.resize) this.post.resize();
  };

  // =========================================================================
  // Render
  // =========================================================================
  _render() {
    if (!this.renderer) return;
    if (this.post && this.post.available) {
      this.post.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // =========================================================================
  // Fire patches (§18)
  // =========================================================================
  _spawnFirePatch(x, z) {
    if (this._firePatches.length >= 8) {
      const old = this._firePatches.shift();
      if (old.mesh) {
        this.scene.remove(old.mesh);
        old.mesh.geometry.dispose();
        old.mesh.material.dispose();
      }
    }
    const geo = new THREE.CircleGeometry(1.2, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, WORLD.FLOOR_Y + 0.05, z);
    this.scene.add(mesh);
    this._firePatches.push({ mesh, t: 0 });
  }

  _updateFirePatches(sdt) {
    for (let i = this._firePatches.length - 1; i >= 0; i--) {
      const p = this._firePatches[i];
      p.t += sdt;
      if (p.t < 0.3) {
        const sc = 1 + (p.t / 0.3) * 0.5;
        p.mesh.scale.setScalar(sc);
      } else if (p.t < 10) {
        // hold
      } else if (p.t < 13) {
        const f = Math.max(0, 1 - (p.t - 10) / 3);
        p.mesh.material.opacity = 0.5 * f;
      } else {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this._firePatches.splice(i, 1);
      }
    }
  }
}

export default Game;

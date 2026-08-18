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
  DUNGEON, LIGHT_SOURCES, DROP, RENDERER,
  EVOLUTION, SWORD, HIT_STOP, ORB_WEAPON, ENEMY,
  biomeForLevel, weaponTier, damageMult,
} from './core/Constants.js';
import { GameState } from './core/GameState.js';
import { EventBus } from './core/EventBus.js';
import { Leaderboard } from './core/Leaderboard.js';
// DROP imported below with the other Constants.
import { resolveCircleCollisions } from './core/Collision.js';

import { DungeonGenerator } from './world/DungeonGenerator.js';
import { BiomeSystem } from './world/BiomeSystem.js';
import { WorldBuilder } from './world/WorldBuilder.js';
import { PropSystem } from './world/PropSystem.js';

import { InputSystem } from './systems/InputSystem.js';
import { RuneSystem } from './systems/RuneSystem.js';
import { PostProcessing } from './systems/PostProcessing.js';
import { LightingSystem } from './systems/LightingSystem.js';
import { ParticleSystem } from './systems/ParticleSystem.js';
import { SmokeSystem } from './systems/SmokeSystem.js';

import { OrbSystem } from './entities/OrbSystem.js';
import { OrbShooter } from './entities/OrbShooter.js';
import { SkeletonSystem } from './entities/SkeletonSystem.js';
import { Skeleton } from './entities/Skeleton.js';
import { PlayerSword, LAYER_SWORD } from './entities/PlayerSword.js';
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
    this._prevKeys = { m2: false, m0: false };
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
      // 5b. start-menu / death-screen buttons (keyboard paths already exist)
      this._bindMenuButtons();
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
    this.renderer.toneMappingExposure = RENDERER.EXPOSURE;
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
    // YXZ so yaw/pitch are independent euler angles (mouse look §4.2.2).
    this.camera.rotation.order = 'YXZ';
    // Sword (and its tier forms) live on LAYER_SWORD (2) — the camera must enable
    // that layer or the sword is never rendered (it is a camera child on layer 2).
    this.camera.layers.enable(LAYER_SWORD);
    // The camera must be in the scene graph, otherwise its children (sword,
    // headlight, held fireball, bolt/trail sprites) are never traversed by
    // renderer.render(scene, camera) and nothing camera-attached draws.
    this.scene.add(this.camera);

    // Headlight (§10.1) — camera-attached fill light
    const head = new THREE.PointLight(0xffd9a0, 2.4, 34, 1.2);
    head.position.set(0, -0.2, 0);
    this.camera.add(head);

    // Sword (camera-attached, §20)
    this.sword = new PlayerSword(this.camera, {
      onSwingHit: (step, cone) =>
        this._onSwordSwing(step, cone),
      onHitStop: (ms) => { this._hitStop = Math.max(this._hitStop, ms); },
      onElectricChain: (targets) => this._onElectricChain(targets),
      onEvolution: (tier, prev) => this._onEvolution(tier, prev),
      arcTargets: () => this.skeletons ? this.skeletons.allTargets() : [],
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
    this.input = new InputSystem(this.renderer.domElement);
    this._prevKeys = {};
    this._inputKeys = ['KeyN', 'KeyL', 'KeyY', 'KeyS', 'Tab', 'KeyP', 'KeyE'];
    for (const code of this._inputKeys) this._prevKeys[code] = false;
    // Pointer-lock edge (menu enter / death dismiss / leaderboard close).
    if (typeof document !== 'undefined') {
      this._plChange = () => {
        const locked = this.input.isPointerLocked();
        this.state.pointerLocked = locked;
        const prompt = document.getElementById('prompt');
        if (prompt) prompt.classList.toggle('hidden', locked);
        if (locked) {
          if (this._inMenu) this._enterRun();
          else if (this._deathVisible) this._hideDeathScreen();
          this._hideLeaderboard();
        } else if (this._leaderboardOpen) {
          this._hideLeaderboard();
        }
      };
      document.addEventListener('pointerlockchange', this._plChange);
    }
  }

  /** 5. Event → HUD toasts + save bootstrap. */
  _bindEventToasts() {
    this.eventBus.on('level:loaded', (d) => this._onLevelLoadedEvent(d));
    this.eventBus.on('boss:killed', (d) => this._onBossKilledEvent(d));
    this.eventBus.on('weapon:evolved', (d) => this._onEvolution(d.tier, d.prevTier));
    this.eventBus.on('run:ended', (d) => this._onRunEndedEvent(d));
  }

  /** Wire the start-menu and death-screen HTML buttons to the same methods
   *  the keyboard shortcuts (N/L/Y/S) use. Guarded so missing elements are a
   *  no-op rather than a throw. */
  _bindMenuButtons() {
    const bind = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn.bind(this));
    };
    bind('btn-new-game', this.newGame);
    bind('btn-load', this.loadGame);
    bind('btn-restart', this.newGame);
    bind('btn-ngplus', this.newGamePlus);
    bind('btn-save', this.saveGame);
  }

  _bootstrapSave() {
    if (!this.leaderboard.getSave) return;
    if (!this.leaderboard.getSave()) return;
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
    this._titleWorld = new WorldBuilder().build(dungeon, this.biomes.getTexturesFor('STONE'), 'STONE');
    this.scene.add(this._titleWorld.group);
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
    // (Pointer-lock hold-to-advance is a §23 showcase gesture; the menu
    //  button handles normal entry. Kept simple here.)
  }

  _advanceFromTitle() {
    // Camera stays; the run starts from the start menu.
  }

  _showStartMenu() {
    const el = document.getElementById('start-menu');
    if (el) el.classList.remove('hidden');
    this._hideLoadingOverlay();
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
    s.runTime = 0;
    s.levelTime = 0;
    this._bossPortalOpen = false;
    this._regenAcc = 0;
    this._isRunning = true;
    this._regenerateDungeon();
  }

  saveGame() {
    if (!this._deathVisible) return;
    if (!this.leaderboard.setSave) return; // Leaderboard is rankings-only in this build
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
    if (!this.leaderboard.getSave) return;
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
    const s = this.state;
    s.bossKills += 1;
    this._bossPortalOpen = true;
    this._regenAcc = 0;

    // §17 boss defeat rewards
    // (a) 5-minute uncapped buff (BUFF.BOSS_DURATION, NOT the 90 s breakable cap)
    const effects = BUFF.EFFECTS;
    const rewardBuff = effects[Math.floor(Math.random() * effects.length)];
    this._onBuffCollected(rewardBuff); // side effects (BRIGHT/FIREBALL/speeds/HUNTER)
    s.activeBuffTimer = BUFF.BOSS_DURATION; // uncapped: override the 60 s DURATION

    // (b) +1 permanent max heart and heal +1
    s.maxHealth += 1;
    this._maxHealth = s.maxHealth;
    s.health = Math.min(s.health + 1, s.maxHealth);

    // (c) soul reward = level × max(1, ngPlus)
    const rewardSouls = s.level * Math.max(1, s.ngPlus);
    s.collectedOrbs += rewardSouls;
    if (this.sword) this.sword.souls = s.collectedOrbs;

    // §25 binding string
    this._toast(`The Spectral Lord falls - ${rewardSouls} souls, a heart and a blessing are yours. The portal opens!`);
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
    this.world = new WorldBuilder().build(
      dungeon, this.biomes.getTexturesFor(biomeId), biomeId,
    );
    this.scene.add(this.world.group);
    const boxes = [...(this.world && this.world.collisionBoxes ? this.world.collisionBoxes : [])];
    this._boxesCache = null;

    // Phase 3 — props
    await yieldFrame();
    this.props = new PropSystem(this.scene, this.eventBus, {
      spawnOrbs: (x, z, n) => { if (this.orbs) this.orbs.dropOrb(x, WORLD.FLOOR_Y, z, n); },
      onBuffCollected: (effect) => this._onBuffCollected(effect),
      onPropBroken: () => this._onPropBroken(),
      onPropOpened: () => {},
      onSpawnWraith: (x, z) => { if (this.skeletons) this.skeletons._spawnMob('WRAITH', x, z, false); },
    });
    this.props.build(dungeon, biomeId);
    for (const b of this.props.collidableBoxes()) boxes.push(b);
    this._waterPuddles = this._collectWaterPuddles();

    // Phase 4 — enemies
    await yieldFrame();
    this.skeletons = this._createSkeletonSystem(dungeon, biomeId, boxes);

    // Phase 5 — orbs
    await yieldFrame();
    this.orbs = new OrbSystem(this.scene);
    this._wireOrbs();

    // Phase 6 — shooter
    await yieldFrame();
    this.shooter = new OrbShooter(this.scene, {
      orbs: s.collectedOrbs,
      getOrbs: () => s.collectedOrbs,
      enemies: () => this.skeletons ? this.skeletons.allTargets() : [],
      walls: () => this._collisionBoxes(),
      props: () => (this.props ? this.props.collidableBoxes() : []),
      spendOrb: () => this._spendOrb(),
      onOrbHit: (x, y, z, dir, damage) => this._onOrbHit(x, y, z, dir, damage),
      onOrbExplode: (x, y, z, damage) => this._onOrbExplode(x, y, z, damage),
      onBreakableHit: (x, y, z, normal) => {},
      onProjectile: () => {},
      onFireballProjectile: () => {},
    });
    this.shooter.setActiveBuff(this._buffIndex(s.activeBuff));

    // Phase 7 — lighting
    await yieldFrame();
    this.lighting = new LightingSystem();
    this.lighting.build(this.scene, dungeon, biomeId);
    if (this._degraded) this.lighting.setDegraded(0);

    // Phase 8 — particles
    await yieldFrame();
    const pc = (dungeon.gridSize / 2) * DUNGEON.CELL_SIZE;
    this.particles = new ParticleSystem(this.scene, {
      radius: Math.max(20, dungeon.gridSize * DUNGEON.CELL_SIZE * 0.5),
      yMin: 0, yMax: 6,
      x: pc, z: pc,
    });

    // Phase 9 — smoke
    await yieldFrame();
    this.smoke = new SmokeSystem(this.scene);
    this._setupSmokeSources(biomeId, dungeon);

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
      this.sword.souls = s.collectedOrbs;
    }
    // Reset look so the run never inherits the title-screen orbit aim.
    if (this.camera) {
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = 0;
      this.camera.rotation.x = -0.1;
    }
    this._placeCamera();

    // Fire the level-loaded event (§26: show title overlay).
    this.eventBus.emit('level:loaded', { level: s.level, biomeId, showTitle: true });

    // Phase 11 — done
    await yieldFrame();
    // Pre-compile enemy shader programs while the loading overlay is still
    // up. The title/loading screens never render enemies, so the enemy
    // materials (bone/metal/cloth MeshStandardMaterial + emissive glow) have
    // no compiled GLSL program until the first enemy is drawn. That first
    // draw compiles the shader synchronously on the GPU/main thread → a hard
    // hitch the moment the player meets the first enemy.
    //
    // The real enemies are still in the spawn queue at this point (revealed
    // one-per-0.5 s during play), so the scene holds no enemy meshes. We
    // build one throwaway enemy of every registered type, add them to the
    // scene, force ONE real render frame (the identical code path gameplay
    // uses, so the exact shader programs are compiled), then remove them.
    // renderer.compile() alone is not sufficient: it builds programs against
    // a traverseVisible light state that doesn't always match the real draw,
    // so the first gameplay enemy would still compile. A forced real render
    // is the reliable path. The loading overlay hides the canvas, so the
    // throwaway frame is invisible. (Skipped if the renderer is unavailable,
    // e.g. headless.)
    if (this.renderer) {
      const prewarm = [];
      const types = ['SKELETON', 'MAGICIAN', 'ARMORED', 'ARCHER',
                     'RAT', 'BRUTE', 'WRAITH', 'BURN'];
      const prewarmDebug = { built: 0, failed: [], progsBefore: 0, progsAfter: 0, renderRan: false };
      try { prewarmDebug.progsBefore = this.renderer.info.programs.length; } catch {}
      // Place them 8u in front of the camera (it faces -Z after the
      // _placeCamera reset), NOT at the camera position — at distance ~0 the
      // rig's child meshes fall inside the near clip plane and get clipped,
      // so no programs compile. 8u is well inside NEAR/FAR (0.1/160) and the
      // 90° FOV, so every descendant is guaranteed to be rasterized.
      const ppx = this.camera.position.x;
      const ppz = this.camera.position.z - 8;
      for (const t of types) {
        try {
          const e = Skeleton.forType(t, this.scene, {
            position: { x: ppx, z: ppz },
          });
          if (e && e.mesh) {
            e.mesh.visible = true;
            // Culling is per-Mesh in three.js — the Group flag is ignored by
            // child meshes, so force every descendant to be drawn regardless
            // of the camera frustum (the enemies sit at the entrance, which
            // may be behind the camera's view direction).
            e.mesh.traverse((o) => { o.frustumCulled = false; });
            prewarm.push(e);
            prewarmDebug.built++;
          }
        } catch (err) { prewarmDebug.failed.push(t + ':' + String(err)); }
      }
      if (prewarm.length) {
        // Force one render through the game's OWN render path (post-processing
        // composer or plain, exactly as gameplay does) so every enemy type's
        // exact program — including the shadow-pass variants — is compiled
        // now, behind the loading overlay. A plain renderer.render misses the
        // composer/shadow variants, so use _render() to match gameplay.
        this._render();
        prewarmDebug.renderRan = true;
        // The composer renders into render targets; in some contexts the
        // target-bound pass can no-op. A direct draw to the canvas is the
        // guaranteed-compile fallback for the same materials.
        this.renderer.render(this.scene, this.camera);
        prewarmDebug.plainRan = true;
      }
      for (const e of prewarm) {
        try {
          if (e.mesh) this.scene.remove(e.mesh);
          e.dispose();
        } catch { /* already gone */ }
      }
      try { prewarmDebug.progsAfter = this.renderer.info.programs.length; } catch {}
      window.__prewarmDebug = prewarmDebug;
    }
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
    if (this.particles) {
      this.scene.remove(this.particles.group);
      this.particles.dispose();
      this.particles = null;
    }
    if (this.smoke) {
      this.scene.remove(this.smoke.group);
      this.smoke.dispose();
      this.smoke = null;
    }
    if (this.runes) {
      this.scene.remove(this.runes.group);
      this.runes.dispose();
      this.runes = null;
    }
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
        this.state.kills = (this.state.kills || 0) + 1;
        this._spawnDrops(info);
        this.eventBus.emit('enemy:killed', info);
      },
      onBossKill: (boss) => {
        this.eventBus.emit('boss:killed', { level: this.state.level });
      },
      onPlayerDamaged: (dmg, src) => this._onPlayerDamaged(dmg, src),
      onBlinkHit: (x, z, r, d) => this._onBlinkHit(x, z, r, d),
      onChargeHit: (boss) => this._onChargeHit(boss),
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
    // Enemy scaling: base = level + boss-kill bonus (ENEMY.speedMult/attackMult),
    // with the NG+ multiplier stacked on top.
    const ngPlusMult = 1 + this.state.ngPlus * 0.05;
    sys._speedMult = ENEMY.speedMult(this.state.level, this.state.bossKills) * ngPlusMult;
    sys._attackMult = ENEMY.attackMult(this.state.level, this.state.bossKills) * ngPlusMult;
    // Boss level: spawn the boss in the arena.
    if (sys.isBossLevelFn(this.state.level)) {
      sys._hasArena = true;
      sys._spawnBoss();
    }
    return sys;
  }

  /** Collect water-pool circles for movement slowdown (§26). */
  _collectWaterPuddles() {
    // PropSystem registers water pools (non-damaging slow zones) in `waterPuddles`.
    if (!this.props || !this.props.waterPuddles) return [];
    return this.props.waterPuddles;
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
    this._animateId = raf(this._animate.bind(this));

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

    // Keyboard edges (E / P / Tab / N / L / Y / S) — must run in every state so
    // the start menu (N/L) and death screen (N/Y/S) respond, not just in-run.
    this._updateKeys();

    this._render();
  }

  _updateGame(sdt, dt) {
    this._perfMonitor(dt);
    // Accumulate run + level timers
    this.state.runTime += dt;
    this.state.levelTime += dt;

    // Timed-run timer (not used in this build; kept as a no-op for parity)
    // if (this.state.timedRun) { ... }

    // Health regen (§1: REGEN_DELAY 0, +1 heart per REGEN_INTERVAL s, capped at max)
    this._regenAcc += dt;
    if (this._regenAcc >= PLAYER.REGEN_INTERVAL) {
      this._regenAcc %= PLAYER.REGEN_INTERVAL;
      if (this.state.health < this.state.maxHealth) {
        this.state.health = Math.min(this.state.maxHealth, this.state.health + 1);
        this._hudDirty = true;
      }
    }

    // Mouse look (§4.2.2): consume accumulated mouse deltas, rotate camera.
    if (this.input && this.camera) {
      const m = this.input.consumeMouse();
      if (m.x !== 0 || m.y !== 0) {
        this.camera.rotation.y -= m.x * CAMERA.SENSITIVITY;
        this.camera.rotation.x -= m.y * CAMERA.SENSITIVITY;
        const lim = CAMERA.PITCH_CLAMP;
        if (this.camera.rotation.x > lim) this.camera.rotation.x = lim;
        else if (this.camera.rotation.x < -lim) this.camera.rotation.x = -lim;
      }
      // Keep pointer-lock state fresh every frame (cheap).
      this.state.pointerLocked = this.input.isPointerLocked();
    }

    // Player movement
    this._updatePlayer(sdt);

    // Fireball charge (buff #2)
    this._updateFireballCharge(dt);

    // Input edges
    this._updateInputEdges();

    // Systems
    if (this.skeletons) {
      const frozen = this.state.safeSpawn > 0;
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
      this.hunter.update(sdt,
        { x: this.state.x, z: this.state.z },
        this.skeletons ? this.skeletons.living : [],
        this._collisionBoxes(),
        this.skeletons ? this.skeletons.boxGrid : null);
    }
    if (this.props) {
      this.props.update(sdt, this.state.x, this.state.z);
      this.props.stepCheck(this.state.x, this.state.z);
      const hazardDmg = this.props.tickHazard(sdt, this.state.x, this.state.z);
      if (hazardDmg > 0) this._onPlayerDamaged(hazardDmg, { source: 'hazard' });
    }
    if (this.runes) this.runes.update(this._now);
    if (this.particles) this.particles.update(sdt, this.camera.position, this._torchPositions());
    if (this.smoke) this.smoke.update(sdt, this.camera.position);
    if (this.hunter) this.hunter.setCollectedOrbs(this.state.collectedOrbs);

    // Safe-spawn timer
    if (this.state.safeSpawn > 0) {
      this.state.safeSpawn -= dt;
      if (this.state.safeSpawn <= 0) this.state.safeSpawn = 0;
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

  _torchPositions() {
    if (!this.lighting) return null;
    return this.lighting.torches.map((t) => ({
      x: t.position.x, y: t.position.y, z: t.position.z,
    }));
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
    const i = this.input;
    if (!i) return;

    let speedMult = 1;
    if (s.activeBuff === BUFF.EFFECTS.GODSPEED) speedMult *= BUFF.GODSPEED.moveMult;
    if (s.activeBuff === BUFF.EFFECTS.EMPOWERED) speedMult *= BUFF.EMPOWERED.moveMult;
    const inWater = this._inWaterPool(s.x, s.z);
    if (inWater) speedMult *= 0.45;

    const sprint = i.isPressed('ShiftLeft') || i.isPressed('ShiftRight');
    const base = (sprint ? PLAYER.SPRINT_SPEED : PLAYER.WALK_SPEED) * speedMult;
    // Camera-relative WASD: rotate input direction by the camera yaw so
    // KeyW always moves where the camera faces (not a fixed world axis).
    const yaw = this.camera.rotation.y;
    const dx = (i.isPressed('KeyD') ? 1 : 0) - (i.isPressed('KeyA') ? 1 : 0);
    const dz = (i.isPressed('KeyW') ? 1 : 0) - (i.isPressed('KeyS') ? 1 : 0);
    const len = Math.hypot(dx, dz);
    if (len > 0.001) {
      const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) }; // camera forward on XZ
      const rgt = { x: Math.cos(yaw), z: -Math.sin(yaw) };  // camera right on XZ
      const wx = (rgt.x * dx + fwd.x * dz) / len;
      const wz = (rgt.z * dx + fwd.z * dz) / len;
      s.x += wx * base * sdt;
      s.z += wz * base * sdt;
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

  /**
   * A breakable prop was destroyed: its AABB must stop colliding. Rebuild the
   * cached box list and the enemy BoxGrid from the (now shrunk) live prop
   * boxes. Walls are immutable, so only the prop boxes changed.
   */
  _onPropBroken() {
    this._boxesCache = null;
    if (this.skeletons) {
      const boxes = this._collisionBoxes();
      this.skeletons.setCollisionBoxes(boxes);
    }
  }

  _inWaterPool(x, z) {
    for (const w of this._waterPuddles) {
      const dx = x - w.x, dz = z - w.z;
      if (dx * dx + dz * dz <= w.r * w.r) return true;
    }
    return false;
  }

  // =========================================================================
  // Keyboard edges (§2: E descend, P post, Tab ledger, N/L/Y/S menus)
  // =========================================================================
  _updateKeys() {
    if (!this.input) return;
    const prev = this._prevKeys;
    for (const code of this._inputKeys) {
      const down = this.input.isPressed(code);
      const edge = down && !prev[code];
      prev[code] = down;
      if (!edge) continue;
      switch (code) {
        case 'KeyE':
          this._tryDescend();
          break;
        case 'KeyP':
          this._togglePost();
          break;
        case 'Tab':
          this._toggleLeaderboard();
          break;
        case 'KeyN':
          if (this._deathVisible) this.newGame();
          else if (this._inMenu) this.newGame();
          break;
        case 'KeyL':
          if (this._inMenu) this.loadGame();
          break;
        case 'KeyY':
          if (this._deathVisible) this.newGamePlus();
          break;
        case 'KeyS':
          if (this._deathVisible) this.saveGame();
          break;
      }
    }
  }

  // Input edges (RMB attack, LMB orb, buff #2 fireball)
  // =========================================================================
  _updateInputEdges() {
    const m2 = this.input.isMouseDown(2);
    const m0 = this.input.isMouseDown(0);
    const canAct = !this._deathVisible && this._levelLoaded &&
      this.state.safeSpawn <= 0 && !this._inMenu;

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
    const m0 = this.input.isMouseDown(0);
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
    this.shooter.fire(this._forward(), this._origin(), this._now);
  }

  _fireFireball() {
    if (!this.shooter) return;
    this.shooter.fireFireball(this._forward(), this._origin(), this._now);
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

  /** Map a buff effect to its shooter index (0 none, 1 BRIGHT, 2 FIREBALL, …). */
  _buffIndex(effect) {
    return effect ? BUFF.EFFECTS.indexOf(effect) + 1 : 0;
  }

  /** Wire OrbSystem callbacks to state + HUD. */
  _wireOrbs() {
    const s = this.state;
    this.orbs.onOrbCollected = (x, z, value) => {
      s.collectedOrbs += value;
      if (this.sword) this.sword.souls = s.collectedOrbs;
      this._checkEvolution();
      this._hudDirty = true;
    };
    this.orbs.onHealthCollected = (x, z) => {
      s.health = Math.min(s.maxHealth, s.health + DROP.HEALTH_RESTORE);
      this._hudDirty = true;
    };
    this.orbs.onBuffCollected = (x, z, buffId) => {
      this._onBuffCollected(buffId);
    };
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
  /**
   * Sword swing cone (§9.1). The sword supplies cone geometry in local
   * camera space (origin 0,0,0; direction (0,0,-1) = camera forward;
   * range, halfAngle); Game resolves which enemies/props/bolts are hit.
   * Cone origin = player feet; direction = the player's actual forward
   * vector (camera world direction on the XZ plane — the same convention
   * as _forward(), which _updatePlayer's camera follows).
   */
  _onSwordSwing(step, cone) {
    if (!this.skeletons) return;
    const s = this.state;
    // Binding composition rule: (1 + (scale−1)×0.5) × 1.1^tier × 1.1^⌊level/5⌋.
    // All three inputs are required — passing fewer yields NaN damage.
    const dmg = this.sword.damage(step, s.weaponTier,
      damageMult(this.sword.scale, s.weaponTier, s.level));

    // World-space cone: origin at the player (feet + ~1.5u chest height).
    const ox = s.x, oy = s.y + 1.5, oz = s.z;
    // Forward = camera world direction flattened to XZ (matches _forward()).
    const fwd = this._forward();
    const fx = fwd.x, fz = fwd.z;

    // --- enemies: within range AND within the swing cone ---
    const range = cone.range;
    const halfAngle = cone.halfAngle;
    const cosHalf = Math.cos(halfAngle);
    for (const e of this.skeletons.allTargets()) {
      if (!e || !e.alive) continue;
      const dx = e.position.x - ox, dz = e.position.z - oz;
      const d2 = dx * dx + dz * dz;
      if (d2 > range * range) continue;
      const d = Math.sqrt(d2);
      let dot;
      if (d < 0.05) dot = 1; // enemy at origin — always inside
      else dot = (dx / d) * fx + (dz / d) * fz;
      if (dot < cosHalf) continue; // outside the XZ cone
      // small vertical tolerance (cone origin is chest height)
      const dy = (e.position.y + 0.8) - oy;
      if (Math.abs(dy) > 1.5 + halfAngle * range * 0.5) continue;
      this.skeletons.hitSkeleton(e, dmg, { x: ox, z: oz });
    }

    // --- breakables: same range, looser cone (§ BREAKABLE_CONE_LOOSE) ---
    if (this.props) {
      const looseCos = Math.cos(halfAngle + SWORD.BREAKABLE_CONE_LOOSE);
      for (const rec of this.props.breakables) {
        if (rec.broken) continue;
        const dx = rec.pos.x - ox, dz = rec.pos.z - oz;
        const d2 = dx * dx + dz * dz;
        if (d2 > range * range) continue;
        const d = Math.sqrt(d2);
        const dot = d < 0.05 ? 1 : (dx / d) * fx + (dz / d) * fz;
        if (dot < looseCos) continue;
        this.props.breakBreakable(rec);
      }
    }

    // --- break enemy projectiles in the swing cone (arrows/orbs) ---
    if (this.skeletons.breakProjectiles) {
      const facing = Math.atan2(fx, fz); // breakProjectiles uses atan2(x, z) convention
      this.skeletons.breakProjectiles(halfAngle, ox, oz, facing);
    }
  }

  /**
   * Electric proc (§9.3). The sword fires onElectricChain({ damage, range })
   * without targets, so Game resolves the targets: every living enemy
   * within SWORD.ELECTRIC_RANGE (20u) of the player.
   */
  _onElectricChain(info) {
    if (!this.skeletons) return;
    const s = this.state;
    const range = (info && info.range) || SWORD.ELECTRIC_RANGE;
    const mult = (info && info.damage) !== undefined
      ? info.damage
      : 5 * damageMult(this.sword.scale, s.weaponTier, s.level);
    const r2 = range * range;
    for (const e of this.skeletons.allTargets()) {
      if (!e || !e.alive) continue;
      const dx = e.position.x - s.x, dz = e.position.z - s.z;
      if (dx * dx + dz * dz <= r2) {
        this.skeletons.hitSkeleton(e, mult, null);
      }
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
    for (const e of this.skeletons.allTargets()) {
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
    for (const e of this.skeletons.allTargets()) {
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

  // Boss CHARGE contact (GhostBoss already gated distance + once-per-charge).
  _onChargeHit(boss) {
    this._onPlayerDamaged(BOSS.CHARGE_DMG, { source: 'bossCharge' });
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
      runTime: s.runTime,
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
    // OrbSystem drop signatures are (x, y, z, ...) — pass the floor Y.
    if (drops > 0) this.orbs.dropOrb(x, WORLD.FLOOR_Y, z, drops);
    if (healthChance) this.orbs.dropHealth(x, WORLD.FLOOR_Y, z);
    if (Math.random() < 0.05) {
      const effects = BUFF.EFFECTS.filter((e) => e !== this.state.activeBuff);
      const pick = effects[Math.floor(Math.random() * effects.length)];
      this.orbs.dropBuff(x, WORLD.FLOOR_Y, z, pick);
    }
  }

  _onBuffCollected(effect) {
    const s = this.state;
    s.activeBuff = effect;
    s.activeBuffTimer = BUFF.DURATION;
    if (this.sword) {
      // EMPOWERED 1.2 / GODSPEED 1.5 / otherwise 1.0 (consumed by sword.attackSpeed)
      if (effect === BUFF.EFFECTS.EMPOWERED) {
        this.sword.buffAttackSpeedMult = BUFF.EMPOWERED.attackSpeedMult;
      } else if (effect === BUFF.EFFECTS.GODSPEED) {
        this.sword.buffAttackSpeedMult = BUFF.GODSPEED.attackSpeedMult;
      } else {
        this.sword.buffAttackSpeedMult = 1;
      }
    }
    if (this.shooter) this.shooter.setActiveBuff(this._buffIndex(effect));
    if (this.lighting) {
      this.lighting.setBright(effect === BUFF.EFFECTS.BRIGHT);
      if (this._degraded) this.lighting.setDegraded(0);
    }
    if (this.sword && effect === BUFF.EFFECTS.EMPOWERED) {
      this.sword.lengthMult = BUFF.EMPOWERED.swordLengthMult;
    } else if (this.sword) {
      this.sword.lengthMult = 1;
    }
    if (effect === BUFF.EFFECTS.HUNTER) {
      if (!this.hunter) {
        this.hunter = new Hunter(this.scene, {
          collectedOrbs: this.state.collectedOrbs,
          playerPos: { x: this.state.x, z: this.state.z },
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
    }
    if (this.shooter) this.shooter.setActiveBuff(null);
    if (this.lighting) {
      this.lighting.setBright(false);
      if (this._degraded) this.lighting.setDegraded(0);
    }
    if (this.sword) this.sword.lengthMult = 1;
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
    s.levelTime = 0;
    s.safeSpawn = 5;
    this._regenerateDungeon();
  }

  // =========================================================================
  // HUD (§24, §25)
  // =========================================================================
  _updateHud() {
    if (this.headless) return;
    const s = this.state;
    const el = this._hudEls();

    const set = (id, text, width) => {
      const e = el[id];
      if (e) {
        if (text != null) e.textContent = String(text); // null = bar fill, no text
        if (width !== undefined) e.style.width = width;
      }
    };

    const hpFrac = s.maxHealth > 0 ? s.health / s.maxHealth : 0;
    set('hp-fill', null, `${Math.max(0, hpFrac * 100)}%`);
    set('hp-num', `${Math.ceil(s.health)} / ${s.maxHealth}`);

    const biomeId = biomeForLevel(s.level, s.ngPlus);
    const biome = BIOMES[biomeId];
    // #level-title contains the nested #biome-label span, so updating
    // #level-title via textContent would destroy the span. Update only the
    // level-number text node, then the span separately.
    const lt = el['level-title'];
    if (lt) {
      const bl = el['biome-label'];
      if (bl) {
        // Keep the span's preceding text node holding the level number.
        let tn = bl.previousSibling;
        if (!(tn && tn.nodeType === Node.TEXT_NODE)) {
          tn = document.createTextNode('');
          lt.insertBefore(tn, bl);
        }
        tn.nodeValue = `LEVEL ${s.level}`;
      } else {
        lt.textContent = `LEVEL ${s.level}`;
      }
    }
    const bl = el['biome-label'];
    if (bl) bl.textContent = ` · ${biome.label}`;
    const timer = el['timer'];
    if (timer) {
      timer.textContent = fmtTime(s.runTime);
      timer.classList.remove('low');
    }

    set('orb-count', s.collectedOrbs);
    set('weapon-name', EVOLUTION.tierName(s.weaponTier));
    set('weapon-tier', `TIER ${s.weaponTier} — ${EVOLUTION.tierDescr(s.weaponTier)}`);

    const pips = el.pips;
    const step = this.sword ? this.sword.comboStep : 0;
    pips.forEach((p, i) => p.classList.toggle('on', i < step));

    const badge = el['buff-badge'];
    if (badge) {
      if (s.activeBuff) {
        badge.classList.remove('hidden');
        badge.textContent = `${s.activeBuff} — ${s.activeBuffTimer.toFixed(1)}s`;
      } else {
        badge.classList.add('hidden');
      }
    }

    const ss = el['safe-spawn'];
    if (ss) {
      if (s.safeSpawn > 0) {
        ss.classList.remove('hidden');
        ss.textContent = String(Math.ceil(s.safeSpawn));
      } else {
        ss.classList.add('hidden');
      }
    }

    const bbw = el['boss-bar-wrap'];
    const boss = this.skeletons && this.skeletons.boss;
    if (bbw) {
      if (boss && boss.alive) {
        bbw.classList.remove('hidden');
        const frac = boss.maxHp > 0 ? boss.hp / boss.maxHp : 0;
        const fill = el['boss-bar-fill'];
        if (fill) fill.style.width = `${Math.max(0, frac * 100)}%`;
        const label = el['boss-bar-label'];
        if (label) label.textContent = boss.label || 'SPECTRAL LORD';
      } else {
        bbw.classList.add('hidden');
      }
    }

    const stats = el['stats-panel'];
    if (stats) {
      const kills = s.kills || 0;
      stats.textContent =
        `LEVEL ${s.level}  ${biome.label}\n` +
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

  /** Cache HUD element handles once — the HUD DOM is static for the whole run,
   *  so per-frame `getElementById` / `querySelectorAll` lookups (the real
   *  per-frame cost) collapse to a one-time capture. */
  _hudEls() {
    if (this._hudCache) return this._hudCache;
    const ids = ['hp-fill', 'hp-num', 'orb-count', 'weapon-name', 'weapon-tier',
      'level-title', 'biome-label', 'timer', 'buff-badge', 'safe-spawn',
      'boss-bar-wrap', 'boss-bar-fill', 'boss-bar-label', 'stats-panel',
      'messages'];
    const map = { pips: document.querySelectorAll('#combo-pips .pip') };
    for (const id of ids) map[id] = document.getElementById(id);
    this._hudCache = map;
    return map;
  }

  _updateMessages() {
    const box = this._hudEls().messages;
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
        `Survived ${fmtTime(s.runTime)} · Souls ${s.collectedOrbs} · Bosses ${s.bossKills}`;
    }
    this._lastDeath = {
      level: s.level,
      time: s.runTime,
      ngPlus: s.ngPlus,
      bossKills: s.bossKills,
      orbs: s.collectedOrbs,
    };
    this.leaderboard.submit({
      level: s.level,
      time: Math.round(s.runTime),
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
    if (!this.input || !this.input.isPointerLocked()) return;
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
    // Mark layer-1 glow targets (enemy meshes, incl. boss) then render.
    // `now` is ms — uPulse = sin(now · 0.003) expects a ms clock.
    if (this.post && this.post.available) {
      if (this.post.setEnemyTargets && this.skeletons) {
        this.post.setEnemyTargets(this.skeletons.allTargets().map((e) => e.mesh));
      }
      this.post.render(this._now * 1000);
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

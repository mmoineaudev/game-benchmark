import * as THREE from 'three';
import { WORLD, PLAYER, CAMERA, RENDERER, TIMED_RUN, ORB_WEAPON, SWORD, PROPS, HIT_STOP, LIGHTING, DROP, BUFF, EVOLUTION, weaponTier, excessOrbs, orbDamageMultiplier, enemyHpMultiplier } from './Constants.js';
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
import { Hunter } from '../entities/Hunter.js';
import { generateGlowTexture } from '../world/Textures.js';
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
    this._orbScaleEl = document.getElementById('orb-scale');
    this._perfWarningEl = document.getElementById('perf-warning');
    // Perf safeguard (degraded mode): spike-aware tiers — bad frames
    // (dt > 50 ms) in a rolling ~3 s window escalate; a clean 10 s window
    // de-escalates. Tier 1 hides 50% decoratives, tier 2 kills torch shadows,
    // tier 3 turns post-processing off. (See _updatePerfMonitor.)
    this._degradedTier = 0;
    this._perfBad = 0;
    this._perfWindow = [];
    this._perfSum = 0;
    this._recoverTimer = 0;
    this._biomeLabelEl = document.getElementById('biome-label');
    this._comboPipsEl = document.getElementById('combo-pips');
    this._pipEls = this._comboPipsEl
      ? Array.from(this._comboPipsEl.querySelectorAll('.pip'))
      : [];
    this._slotNameEl = document.getElementById('slot-name');
    this._slotEffectEl = document.getElementById('slot-effect');
    this._slotIconEl = document.querySelector('#weapon-slot .slot');
    this._slotTier = -1; // weapon-slot cache (icon + text, updates on tier change)
    this._lastBiomePal = null; // cache biome border color (HUD writes once per level)
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
    this._timerEl = document.getElementById('timer');
    this._loadingEl = document.getElementById('loading');
    this._loadingBiomeEl = document.getElementById('loading-biome');
    this._loadingLevelEl = document.getElementById('loading-level');
    this._loadingBuffEl = document.getElementById('loading-buff');
    this._loadingStatsEl = document.getElementById('loading-stats');
    this._titleActive = false;   // title screen holds the scene while fps stabilizes
    this._titleMinFps = 30;
    this._titleDts = [];         // rolling window of recent frame deltas (for avg-fps)
    this._titleSumDt = 0;        // sum of deltas in the window
    this._titleSamples = 0;      // frames in the window
    this._titleStartedAt = 0;    // timestamp when the current title appeared
    this._titleWindow = 3.0;     // average fps measured over this many seconds
    this._titleMaxHold = 8;      // safety: force-lift after this many seconds, never trap the player
    this._sprintBonusEl = document.getElementById('sprint-bonus');
    this._buffBadgeEl = document.getElementById('buff-badge');
    this._safeSpawnEl = document.getElementById('safe-spawn');
    this._lbPanel = document.getElementById('leaderboard-panel');
    this._lbList = document.getElementById('leaderboard-list');
    this._gameOverEl = document.getElementById('game-over');
    this._goStats = document.getElementById('go-stats');
    this._goList = document.getElementById('go-leaderboard-list');
    this._goRestartBtn = document.getElementById('go-restart');
    this._goNgPlusBtn = document.getElementById('go-ngplus');
    this._goSaveBtn = document.getElementById('go-save');
    this._goKeyHandler = null; // Y/N/S keyboard choice on the death screen
    // Startup "Load last save?" menu (only appears when a save exists)
    this._startMenuEl = document.getElementById('start-menu');
    this._startLoadBtn = document.getElementById('start-load');
    this._startNewBtn = document.getElementById('start-new');
    this._menuKeyHandler = null; // L/N keyboard choice on the start menu
    this._saveKey = 'dungeonCrawlerSave'; // localStorage key for death-saves
    this._saveUrl = 'http://127.0.0.1:5174/save'; // file-backed mirror (launch.sh)
    this._heartsEl = document.getElementById('hp-fill');
    this._hpTextEl = document.getElementById('hp-text');
    this._staminaFillEl = document.getElementById('stamina-fill');
    this._bossBarEl = document.getElementById('boss-bar');
    this._statsEl = document.getElementById('stats-panel');
    this._statsCache = ''; // stats panel innerHTML cache — only rewrites on change
    this._damageFlashEl = document.getElementById('damage-flash');
    this.skeletons = null;
    this.shooter = null;
    this.sword = null;
    this.props = null;
    this._noAmmoWarned = false;
    this._shakeTime = 0;
    this._stepCooldown = 0;
    this._swordHitApplied = false;
    this._rmbWasDown = false;
    this._lmbWasDown = false;
    this._fireballCd = 0;   // FIREBALL buff: RMB fireball cooldown
    this._moveSpeedMult = 1; // EMPOWERED buff: +20% move speed
    this._heldFireball = null; // FIREBALL buff: hand visual replacing the dagger
    this._hlTargets = [];    // scratch array: alive enemy groups for the highlight pass
    this._hlAliveCount = -1; // alive-roster cache (rebuild highlight only on change)
    this._maxHealth = PLAYER.MAX_HEALTH; // grows by 1 per boss kill
    if (this.state) this.state.maxHealth = this._maxHealth;
    this._bossPortalOpen = true; // boss arenas gate the exit portal
    this._bossBarEl = null;
    this._firePatches = [];    // pooled blue magic-fire patches (orb impacts)
    this.hunter = null;        // HUNTER buff: spectral boss companion
  }

  async init() {
    this._initRenderer();
    this._initCamera();
    this._initPostProcessing();
    this._initInput();
    this._bindEventToasts();
    // Startup: a "Load last save?" menu appears when a death-save exists;
    // otherwise the descent begins immediately. A corrupt local save is
    // dropped and the file-backed server copy (if any) pulled instead — the
    // save persists across browser storage wipes / origin switches between
    // server runs.
    if (this._hasSave() && !this._readSave()) this._clearSave();
    if (!this._hasSave()) await this._pullRemoteSave();
    if (this._hasSave() && this._readSave()) {
      this._showStartMenu();
      return;
    }
    this._beginRun(null);
  }

  // -------------------------------------------------------------------------
  // Save / load (localStorage): save at death [S], load at startup [L].
  // Loading restarts the CURRENT level from the beginning with all run-meta
  // kept (orbs, souls, weapon tier, permanent hearts, NG+ cycle, boss kills —
  // no orb penalty, no NG+ change).
  _hasSave() {
    try { return !!localStorage.getItem(this._saveKey); } catch { return false; }
  }

  _readSave() {
    try {
      const raw = localStorage.getItem(this._saveKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  _saveRun() {
    let data;
    try {
      data = JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        deathEntry: this._lastEntry || null,
        state: this.state.toJSON(),
      });
      localStorage.setItem(this._saveKey, data);
    } catch { return false; }
    this._pushRemoteSave(data);
    return true;
  }

  // Mirror the save to the file-backed companion server (launch.sh). Optional:
  // when the save-server isn't running (plain `npx vite`), localStorage alone
  // is used and this silently no-ops.
  _pushRemoteSave(data) {
    if (!this._saveUrl) return;
    fetch(this._saveUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    }).catch(() => {});
  }

  // Pull the file-backed copy into localStorage (startup, when nothing is
  // stored locally). Never throws — remote absence or failure means
  // localStorage-only mode.
  _pullRemoteSave() {
    if (!this._saveUrl) return Promise.resolve();
    return fetch(this._saveUrl, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.state) return;
        try { localStorage.setItem(this._saveKey, JSON.stringify(data)); } catch { /* blocked */ }
      })
      .catch(() => {});
  }

  _clearSave() {
    try { localStorage.removeItem(this._saveKey); } catch { /* blocked */ }
  }

  _showStartMenu() {
    if (!this._startMenuEl) return;
    const save = this._readSave();
    if (this._startLoadBtn) {
      if (save) {
        this._startLoadBtn.classList.remove('hidden');
        this._startLoadBtn.textContent =
          `Load last save — Level ${save.state.level} · ${save.state.collectedOrbs} Souls [L]`;
        this._startLoadBtn.onclick = () => this._startFromMenu('load');
      } else {
        this._startLoadBtn.classList.add('hidden');
      }
    }
    if (this._startNewBtn) this._startNewBtn.onclick = () => this._startFromMenu('new');
    this._startMenuEl.classList.remove('hidden');
    if (!this._menuKeyHandler) {
      this._menuKeyHandler = (e) => {
        if (!this._startMenuEl.classList.contains('hidden') && !e.repeat) {
          if (e.code === 'KeyL') this._startFromMenu('load');
          else if (e.code === 'KeyN') this._startFromMenu('new');
        }
      };
      window.addEventListener('keydown', this._menuKeyHandler);
    }
  }

  _startFromMenu(choice) {
    if (this._startMenuEl) this._startMenuEl.classList.add('hidden');
    if (this._menuKeyHandler) {
      window.removeEventListener('keydown', this._menuKeyHandler);
      this._menuKeyHandler = null;
    }
    if (choice === 'load') {
      const save = this._readSave();
      if (save) {
        // The save is NOT consumed by loading: it stays on offer until a new
        // death-save overwrites it, so "Load last save?" never disappears.
        if (save.deathEntry) this.leaderboard.remove(save.deathEntry);
        this._beginRun(GameState.fromJSON(save.state));
        return;
      }
    }
    // Fresh run chosen — the old save remains available (the menu offers it
    // again next startup); it is only replaced by saving again at death.
    this._beginRun(null);
  }

  // First run of the session: a fresh descent, or a loaded save (restarts the
  // saved level with all meta-progression intact).
  _beginRun(savedState = null) {
    this._regenClock = 0;
    this._regenTickAcc = 0;
    if (savedState) {
      this.state = savedState;
      this._maxHealth = savedState.maxHealth;
      this._regenerateDungeon({
        nextState: savedState,
        startMessage: `The descent continues — Level ${savedState.level}`,
      });
    } else {
      this._regenerateDungeon({ newRun: true, startMessage: 'A new descent begins' });
    }
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was ~3x the point-light cost
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
    // Render layer 2 as well: the first-person dagger lives there so the
    // ×10 headlight (layer 0) never reflects off it.
    this.camera.layers.enable(2);
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

    // Held fireball (FIREBALL buff): replaces the dagger in hand. Camera
    // child, so it survives level regens like the sword. Hidden by default.
    this._heldFireball = new THREE.Group();
    const fbMat = new THREE.MeshStandardMaterial({
      color: 0xff8830, emissive: 0xff5522, emissiveIntensity: 3,
      roughness: 0.2, metalness: 0.1,
    });
    const fbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), fbMat);
    const fbGlowMat = new THREE.SpriteMaterial({
      map: this.sword._glowTex, color: 0xff8844,
      blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.9,
    });
    this._heldFbGlow = new THREE.Sprite(fbGlowMat);
    this._heldFbGlow.scale.setScalar(0.8);
    this._heldFireball.add(fbMesh, this._heldFbGlow);
    this._heldFireball.position.set(0.25, -0.2, -0.6);
    this._heldFireball.visible = false;
    this.camera.add(this._heldFireball);
  }

  _initPostProcessing() {
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
    this.post.init();
    // Post-processing is ON by default (reduced to ~5% intensity). The key
    // handler can still toggle it off.
    this.state.effectsEnabled = this.post.enabled; // true initially
  }

  _initInput() {
    this.input = new InputSystem(this.renderer.domElement);
    this.input.init();
  }

  _generateDungeon() {
    // window.__perfSeed is set by the headless perf probe (addScriptToEvaluate
    // on new document) so A/B runs build the identical dungeon.
    this.state.dungeonSeed = window.__perfSeed ?? Date.now();
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
    // Degraded tier 2 persists across level regens (shadows stay off).
    if (this._degradedTier >= 2) this.lighting.setShadowBudget(0);
  }

  _initProps() {
    this.props = new PropSystem(this.scene, this.dungeonData, this.state.biome, this.events);
    const result = this.props.place();
    // Merge prop AABBs into the collision list BEFORE enemies spawn
    this._collisionBoxes.push(...(result.collisionBoxes || []));
    this.props.lavaHazard = ({ x, z }) => this._lavaDamage(x, z);
    // Breakables: 20% soul-orb drop (1-5 orbs), plus buff drop chance = base +
    // orbs-above-100 bonus.
    this.props.onBreak = (x, z) => {
      if (Math.random() < BUFF.ORB_DROP_CHANCE) {
        const n = BUFF.ORB_DROP_MIN + Math.floor(Math.random() * (BUFF.ORB_DROP_MAX - BUFF.ORB_DROP_MIN + 1));
        this.orbs.spawnDrop(x, z, n);
      }
      const chance = BUFF.CHANCE + excessOrbs(this.state.collectedOrbs) * BUFF.ORB_BUFF_CHANCE;
      if (Math.random() < chance) this.orbs.spawnBuff(x, z);
    };
    // Degraded mode (perf safeguard): once triggered, every NEW level builds
    // with the active tier's cuts so the run stays fluid.
    if (this._degradedTier >= 1) this.props.reduceDecorations(0.5);
    if (this._degradedTier >= 3) this.props.reduceDecorations(0.5);
  }

  // Stepping on a breakable shatters it (same drop roll as a weapon break).
  _stepOnBreakables() {
    if (!this.props) return;
    const p = this.state.player;
    for (let i = this.props.breakables.length - 1; i >= 0; i--) {
      const b = this.props.breakables[i];
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      if (dx * dx + dz * dz < 0.45 * 0.45) {
        this.props._breakProp(b);
      }
    }
  }

  _lavaDamage(x, z) {
    if (this._gameOverActive) return;
    if (this.state.invulnTimer > 0 || this.state.health <= 0) return;
    // Pool hazard config from PROPS.POOLS (BIOME_EXPANSION_PLAN §6.2) — LAVA
    // and ACID share identical damage/interval numbers, so the callback needs
    // no pool-type payload (signature unchanged).
    const pool = PROPS.POOLS.LAVA;
    if (!this._lastLavaHit || performance.now() - this._lastLavaHit > pool.interval * 1000) {
      this._lastLavaHit = performance.now();
      this.state.health -= pool.damage;
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
    // Buff pickup collected -> roll a random 15s effect
    this.orbs.onBuffCollected = () => this._applyBuff();
  }

  _initCombat() {
    this.shooter = new OrbShooter(this.scene);
    this.shooter.init();

    this.skeletons = new SkeletonSystem(this.scene, this.state);
    this.skeletons.init(this.dungeonData, this.state);
    this.skeletons.onKill = (x, z, orbs = 1, skel) => {
      if (orbs > 0) this.orbs.spawnDrop(x, z, orbs);
      // 15% chance the kill also drops a health pickup (+3 hearts)
      if (Math.random() < DROP.HEALTH_CHANCE) this.orbs.spawnHealth(x, z);
      this.smoke.addTransient(x, 0.6, z, 10, 0.4);
      // Purple death: tint the fading corpse purple and pop into particles
      if (skel && skel.group) {
        skel.group.traverse((o) => {
          if (o.material && o.material.color) o.material.color.set(0xb44fff);
        });
      }
      this.orbs.spawnPurpleBurst(x, z, performance.now() * 0.001);
    };
    // Boss kill: 5-minute buff + a permanent extra heart, then the exit portal opens
    this.skeletons.onBossKill = () => this._onBossDefeated();
    // Burning enemy sets the ground alight where it walks
    this.skeletons.onBurn = (x, z) => this._spawnFirePatch(x, z);
    this.skeletons.onPlayerDamaged = () => this._flashDamage();
    this.skeletons.onPlayerDeath = () => this._gameOver('dead');
    // Orb damage scales with total orbs held: +2% per orb.
    const orbDmg = () => Math.round(ORB_WEAPON.DAMAGE * orbDamageMultiplier(this.state.collectedOrbs));
    const orbExplodeDmg = () => Math.round(ORB_WEAPON.EXPLODE_DAMAGE * orbDamageMultiplier(this.state.collectedOrbs));
    this.shooter.hitSkeleton = (skel) => this.skeletons.hitSkeleton(skel, orbDmg());
    // Explosive orb (last of the volley): AOE damage around the blast point.
    // Only counts when the blast is low enough to reach ground-level enemies.
    this.shooter.onExplode = (x, y, z) => {
      if (!this.skeletons || y > 2.6) return;
      const range = ORB_WEAPON.EXPLODE_RADIUS;
      const dmg = orbExplodeDmg();
      for (const s of this.skeletons.skeletons) {
        if (s.skel.state === 'DEAD') continue;
        const dx = s.x - x;
        const dz = s.z - z;
        if (dx * dx + dz * dz < range * range) {
          this.skeletons.hitSkeleton(s.skel, dmg);
        }
      }
    };
    this.shooter.onHitProp = (x, z) => {
      if (!this.props) return false;
      return this.props.hitBreakables(x, z);
    };

    // Boss arena: exit portal stays closed until the boss is dead
    this._bossPortalOpen = !this.skeletons.boss;
    this._setupExitPortal();
    this._setupFirePatchPool();
  }

  // Pooled blue magic-fire patches: an orb impact lights ~6m for ~5s, then
  // fades into a short smoke puff drifting toward the exit portal.
  _setupFirePatchPool() {
    this._disposeFirePatches();
    const tex = generateGlowTexture();
    this._fireGlowTex = tex;
    this._firePatches = [];
    for (let i = 0; i < 6; i++) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: 0x44ccff, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0,
      }));
      glow.scale.setScalar(3);
      const light = new THREE.PointLight(0x44aaff, 0, 12, 2);
      light.position.y = 1.2;
      const group = new THREE.Group();
      group.add(glow, light);
      // The group (and its light) stays VISIBLE for the whole level: hiding it
      // changes the scene's point-light count, and three's program cache key
      // includes numPointLights — every light-count change force-recompiles
      // all shaders (the original "lag on first orb kill"). The FX is carried
      // by the glow sprite + light intensity instead.
      glow.visible = false;
      this.scene.add(group);
      this._firePatches.push({
        group, glow, light, active: false, start: 0, ttl: 5, x: 0, z: 0,
      });
    }
  }

  _disposeFirePatches() {
    for (const p of this._firePatches || []) {
      this.scene.remove(p.group);
      if (p.glow.material) p.glow.material.dispose();
    }
    this._firePatches = [];
    if (this._fireGlowTex) { this._fireGlowTex.dispose(); this._fireGlowTex = null; }
  }

  _spawnFirePatch(x, z) {
    if (!this._firePatches.length) return;
    let p = this._firePatches.find((q) => !q.active);
    if (!p) { p = this._firePatches.reduce((a, b) => (a.start <= b.start ? a : b)); }
    p.active = true;
    p.start = performance.now() * 0.001;
    p.ttl = 10; // magic fire lingers 10s
    p.x = x; p.z = z;
    p.glow.visible = true;
    p.group.position.set(x, 0.4, z);
    p.glow.scale.setScalar(0.5);
    p.glow.material.opacity = 0.6;
    p.light.intensity = 2.5;
  }

  _updateFirePatches() {
    if (!this._firePatches.length) return;
    const now = performance.now() * 0.001;
    for (const p of this._firePatches) {
      if (!p.active) continue;
      const elapsed = now - p.start;
      if (elapsed >= p.ttl) {
        this._spawnPatchSmoke(p.x, p.z);
        p.active = false;
        p.glow.visible = false;
        p.light.intensity = 0;
        continue;
      }
      const t = elapsed / p.ttl;
      const grow = Math.min(1, elapsed / 0.3); // quick grow-in
      const fade = t > 0.88 ? (1 - (t - 0.88) / 0.12) : 1; // fade at the very end
      p.glow.scale.setScalar(6 * grow); // ~twice the illumination footprint
      p.glow.material.opacity = 0.6 * fade;
      p.light.intensity = 2.5 * fade * (0.85 + 0.15 * Math.sin(now * 9 + p.x));
    }
  }

  _spawnPatchSmoke(x, z) {
    // Short smoke puff drifting toward the next-level portal
    const exit = this.dungeonData.exitCell;
    const cs = this.dungeonData.cellSize;
    const ex = exit.x * cs + cs / 2;
    const ez = exit.z * cs + cs / 2;
    for (let i = 0; i < 3; i++) this.smoke.addTransient(x, 0.3, z, 6, 0.6);
    // (adding direction would need a smoke velocity param; the puff is enough)
  }

  // The golden exit portal. Hidden in boss arenas until the boss falls.
  _setupExitPortal() {
    if (this._exitPortal) {
      this.scene.remove(this._exitPortal);
      this._exitPortal.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      if (this._exitPortalMat) this._exitPortalMat.dispose();
      this._exitPortal = null;
    }
    const exit = this.dungeonData.exitCell;
    const cs = this.dungeonData.cellSize;
    const ex = exit.x * cs + cs / 2;
    const ez = exit.z * cs + cs / 2;
    const portal = new THREE.Group();
    this._exitPortalMat = new THREE.MeshStandardMaterial({
      color: 0xffcc44, emissive: 0xffaa22, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.7,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 10, 24), this._exitPortalMat);
    ring.position.y = 1.3;
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    disc.position.y = 1.3;
    portal.add(ring, disc);
    portal.position.set(ex, 0, ez);
    portal.visible = this._bossPortalOpen;
    this.scene.add(portal);
    this._exitPortal = portal;
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
    // Re-sync the sword's evolution form (idempotent; tier carried in state).
    if (this.sword) this.sword.setTier(this.state.weaponTier || 0);
    this.events.emit('level:start', {
      level: this.state.level,
      biome: this.state.biome,
    });
  }

  // Weapon evolution: tier derives from the souls counter (collectedOrbs —
  // orbs ARE souls, one notion). The tier LOCKS at the max reached: spending
  // ammo never downgrades the blade (only-upgrade guard). On a tier increase:
  // rebuild the sword form, toast, blade flash, brief hit-stop.
  // (WEAPON_EVOLUTION_PLAN §3, §7)
  _checkWeaponEvolution() {
    if (!this.sword) return;
    const t = weaponTier(this.state.collectedOrbs || 0);
    if (t <= (this.state.weaponTier || 0)) return; // never downgrade
    this.state.weaponTier = t;
    this.sword.setTier(t);
    if (t >= 1) {
      const isMax = t >= EVOLUTION.MAX_TIER;
      this._showMessage(
        isMax ? 'Your blade is whole — the lightsaber sings' : `Your blade awakens — Tier ${t}`,
        'success',
      );
      this.sword.flashBlade();
      this.state.hitStop = 0.1; // non-blocking evolution beat (vs 0.06 combat)
    }
    this._updateHUD();
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
    const rawDt = (now - this._lastTime) / 1000; // uncapped — the perf monitor
    this._delta = Math.min(rawDt, 0.1);          // sees real hitches
    this._lastTime = now;
    const t = now * 0.001;

    // Frame stats for headless perf probes (3 adds + 1 shift per frame).
    // Raw dt — the capped sim delta would mask real frame times.
    const fs = (this._frameStats = this._frameStats || { n: 0, sum: 0, max: 0, buf: [] });
    fs.n++; fs.sum += rawDt;
    if (rawDt > fs.max) fs.max = rawDt;
    fs.buf.push(rawDt);
    if (fs.buf.length > 300) fs.buf.shift();

    // Perf safeguard: spike-aware degraded tiers (see _updatePerfMonitor)
    this._updatePerfMonitor(rawDt);

    // Title screen holds the scene until ==30fps sustained for ~3s.
    this._updateTitleFps(this._delta);

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
    this._updateFirePatches();
    if (this.props) this.props.update(this._delta, t, this.state.player);
    this._stepOnBreakables();
    // No combat while the title screen holds the scene (input is locked away)
    // or during the safe-spawn countdown (the player is rooted).
    if (!this._titleActive && this.state.safeSpawn <= 0) {
      this._handleShooting();
      this._handleSwordAttack();
    }
    // Buff timers don't tick during safe spawn — the buff effectively starts
    // when the player can actually play.
    if (this.state.safeSpawn <= 0) this._updateBuff(this._delta);
    if (this.skeletons) this.skeletons.update(this._delta, t, this.state.player, this._collisionBoxes);
    this._updateHunter();
    if (this.shooter) this.shooter.update(this._delta, this._collisionBoxes, this.skeletons.skeletons || []);
    if (this.state.invulnTimer > 0) this.state.invulnTimer -= this._delta;
    if (this.state.safeSpawn > 0) this.state.safeSpawn -= this._delta;
    this._updateRegen(this._delta);
    if (this._shakeTime > 0) this._shakeTime -= this._delta;

    this._animateWater(t);
    this._checkMessages();
    this._updateHUD();
    this._checkWeaponEvolution();
    this._updateArcBolts(this._delta);
    this._eKeyWasDown = this.input.isPressed('KeyE');
    if (this.sword) this.sword.updateSmoke(this._delta);

    // Enemy highlight: feed the living enemy groups + nearest distance.
    // Roster is cached — setEnemyTargets only re-traverses when it changes.
    if (this.post && this.skeletons) {
      this._refreshEnemyRoster();
      this.post.setEnemyTargets(this._hlTargets);
      this.post.setEnemyDist(this._nearestSkeletonDist());
    }

    this.post.render();
  }

  // Perf safeguard: spike-aware degraded tiers. A rolling ~3 s window of
  // frame deltas feeds a bad-frame counter (dt > 50 ms counts 1, dt > 250 ms
  // counts 3 — the worst hitches now count the most, instead of being
  // excluded). 6 bad frames escalate one tier; 10 clean seconds de-escalate
  // one tier. Tiers: 1 = hide 50% decoratives, 2 = torch shadows off,
  // 3 = post-processing off. De-escalation restores shadows/post (hidden
  // decoratives stay hidden).
  _updatePerfMonitor(dt) {
    if (this._titleActive) return;
    if (dt <= 0) return;
    this._perfWindow.push(dt);
    this._perfSum += dt;
    while (this._perfSum > 3) this._perfSum -= this._perfWindow.shift();
    const bad = dt > 0.05 ? (dt > 0.25 ? 3 : 1) : 0;
    this._perfBad += bad;
    if (this._perfBad >= 6) {
      this._setDegradedTier(this._degradedTier + 1);
      this._perfBad = 0;
    }
    if (bad === 0) {
      this._recoverTimer += dt;
      if (this._recoverTimer > 10 && this._degradedTier > 0) {
        this._setDegradedTier(this._degradedTier - 1);
        this._recoverTimer = 0;
      }
    } else {
      this._recoverTimer = 0;
    }
  }

  // Apply/undo one degraded tier. Cumulative: higher tiers include the cuts
  // of lower ones. reduceDecorations is idempotent per prop (visibility flag).
  _setDegradedTier(t) {
    const next = Math.max(0, Math.min(3, t));
    if (next === this._degradedTier) return;
    const prev = this._degradedTier;
    this._degradedTier = next;
    if (next >= 1 && prev < 1 && this.props) this.props.reduceDecorations(0.5);
    if (next >= 2 && prev < 2 && this.lighting) this.lighting.setShadowBudget(0);
    if (next >= 3 && prev < 3) {
      if (this.post) this.post.enabled = false;
      if (this.props) this.props.reduceDecorations(0.5);
    }
    if (next < 2 && prev >= 2 && this.lighting) {
      this.lighting.setShadowBudget(LIGHTING.TORCH_SHADOW_COUNT);
    }
    if (next < 3 && prev >= 3 && this.post) this.post.enabled = true;
    if (this._perfWarningEl) {
      this._perfWarningEl.textContent = next > 0
        ? `⚠ DEGRADED MODE (tier ${next}) — effects reduced for performance`
        : '⚠ DEGRADED MODE — decorations reduced for performance';
      this._perfWarningEl.classList.toggle('hidden', next === 0);
    }
  }

  // Cache the alive-enemy roster: only rebuilds _hlTargets when the number of
  // living mobs changes, so PostProcessing.setEnemyTargets re-traverses
  // rarely instead of every frame.
  _refreshEnemyRoster() {
    const sks = this.skeletons ? this.skeletons.skeletons : [];
    let alive = 0;
    for (const s of sks) if (s.skel.state !== 'DEAD') alive++;
    if (alive === this._hlAliveCount) return;
    this._hlAliveCount = alive;
    this._hlTargets.length = 0;
    for (const s of sks) if (s.skel.state !== 'DEAD') this._hlTargets.push(s.skel.group);
  }

  _updateInput() {
    const dt = this._delta;
    const p = this.state.player;
    const safe = this.state.safeSpawn > 0;
    this._sprinting = this.input.isPressed('ShiftLeft') || this.input.isPressed('ShiftRight');

    // Sprint acceleration: holding Shift + moving for 5s grants +5% sprint
    // speed per tier, cumulative; resets the moment sprinting stops.
    // (Paused during the safe-spawn countdown — the player can't move.)
    const moving = !safe && (this.input.isPressed('KeyW') || this.input.isPressed('KeyS')
      || this.input.isPressed('KeyA') || this.input.isPressed('KeyD'));
    this.state.updateSprint(dt, this._sprinting && !safe, moving);
    const sprintMult = this._sprinting
      ? PLAYER.SPRINT_MULTIPLIER * this.state.sprintSpeedMult
      : 1;
    const speed = PLAYER.SPEED * sprintMult * this._moveSpeedMult * dt;

    const mouse = this.input.consumeMouse();
    p.yaw -= mouse.x * PLAYER.MOUSE_SENSITIVITY;
    p.pitch -= mouse.y * PLAYER.MOUSE_SENSITIVITY;
    p.pitch = Math.max(-PLAYER.PITCH_CLAMP, Math.min(PLAYER.PITCH_CLAMP, p.pitch));

    const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));

    // Accumulate the requested movement direction for this frame.
    let mx = 0, mz = 0;
    // Safe spawn: the player is rooted in place (camera look still works).
    if (!safe) {
      if (this.input.isPressed('KeyW')) { mx += forward.x; mz += forward.z; }
      if (this.input.isPressed('KeyS')) { mx -= forward.x; mz -= forward.z; }
      if (this.input.isPressed('KeyA')) { mx -= right.x; mz -= right.z; }
      if (this.input.isPressed('KeyD')) { mx += right.x; mz += right.z; }
    }
    const mlen = Math.hypot(mx, mz);
    if (mlen > 0.0001) {
      // Sub-step the movement so a large dt (e.g. level-loading hitch) can
      // never tunnel the player through a wall: each partial step is kept
      // smaller than the wall thickness and collisions are resolved after every
      // sliver, so a circle can't end up pushed fully past an AABB.
      const dist = speed * mlen;
      const ux = mx / mlen, uz = mz / mlen;
      const maxStep = 0.08; // well under corridor/wall thickness
      let remaining = dist;
      while (remaining > 1e-6) {
        const step = Math.min(maxStep, remaining);
        p.x += ux * step;
        p.z += uz * step;
        this._resolveCollisions(p);
        remaining -= step;
      }
    }

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

    // Smooth FOV kick while sprinting — scales up with the sprint bonus
    const targetFov = CAMERA.FOV
      + (this._sprinting ? CAMERA.SPRINT_FOV_BOOST * this.state.sprintSpeedMult : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, this._delta * 8);
      this.camera.updateProjectionMatrix();
    }

    // Held fireball pulse (FIREBALL buff)
    if (this._heldFireball && this._heldFireball.visible) {
      const t = performance.now() * 0.01;
      this._heldFireball.rotation.z = Math.sin(t) * 0.15;
      this._heldFbGlow.scale.setScalar(0.7 + Math.sin(t * 2) * 0.15);
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
    // Boss arenas: the portal only works once the boss is dead
    if (!this._bossPortalOpen) return;
    if (!this.state.inExitRoom) return;
    const eDown = this.input.isPressed('KeyE');
    if (eDown && !this._eKeyWasDown) {
      this._regenerateDungeon();
    }
  }

  _handleShooting() {
    if (this._gameOverActive) return;
    const lmbDown = this.input.isMouseDown(0) && this.input.isPointerLocked();
    if (!lmbDown) {
      this._lmbWasDown = false;
      return;
    }

    // One click = ONE STEP of the orb sequence. A fresh press fires a step
    // immediately; holding the button keeps stepping at STEP_INTERVAL.
    const fresh = !this._lmbWasDown;
    this._lmbWasDown = true;
    if (!fresh) {
      if (this._stepCooldown > 0) {
        this._stepCooldown -= this._delta;
        return;
      }
    }
    this._stepCooldown = ORB_WEAPON.STEP_INTERVAL;

    // Only the FIRST step of a NEW sequence costs an orb — steps 2 and 3 of
    // an open sequence are free (the sequence was paid for up front).
    const startingNew = this.shooter.step === 0 || this.shooter.window <= 0;
    if (startingNew) {
      if (this.state.collectedOrbs <= 0) {
        if (!this._noAmmoWarned) {
          this._showMessage('No orbs! Slay skeletons to gather orbs', 'goal');
          this._noAmmoWarned = true;
        }
        return;
      }
      this._noAmmoWarned = false;
      this.state.collectedOrbs--;
    }
    const p = this.state.player;
    this.shooter.fire(
      p.x,
      WORLD.PLAYER_EYE_HEIGHT - 0.1,
      p.z,
      p.yaw,
      p.pitch,
    );
  }

  // Boss defeated: 5-minute buff + a permanent extra heart, and the exit
  // portal (closed during the fight) opens. Every boss kill also permanently
  // buffs all mobs: +10% movement AND attack speed.
  _onBossDefeated() {
    this.state.bossKills = (this.state.bossKills || 0) + 1;
    this._applyBuff(BUFF.BOSS_DURATION, { cap: false }); // 5-minute buff
    this._maxHealth += 1;
    this.state.maxHealth = this._maxHealth;
    this.state.health = Math.min(this._maxHealth, this.state.health + 1);
    this._bossPortalOpen = true;
    if (this._exitPortal) this._exitPortal.visible = true;
    this._showMessage('The Spectral Lord falls — a heart and a blessing are yours. The portal opens!', 'success');
    this._updateHUD();
  }

  // Arc bolt pool (WEAPON_EVOLUTION_PLAN §5): pooled homing projectiles thrown
  // by the evolved blade. 8 in the pool — fits 2 bolts × 3 combo steps.
  _buildArcBolts() {
    this._arcBolts = [];
    const geo = new THREE.CylinderGeometry(0.01, 0.01, 0.5, 6);
    const mat = new THREE.MeshBasicMaterial({
      color: EVOLUTION.BOLT_COLOR, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (let i = 0; i < EVOLUTION.ARC_POOL; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this._arcBolts.push({ mesh, active: false, x: 0, y: 1.2, z: 0, target: null, life: 0 });
    }
  }

  _nearestAlive(fromX, fromZ) {
    if (!this.skeletons) return null;
    let best = null;
    let bd = EVOLUTION.ARC_RANGE * EVOLUTION.ARC_RANGE;
    for (const s of this.skeletons.skeletons) {
      if (s.skel.state === 'DEAD') continue;
      const dx = s.x - fromX;
      const dz = s.z - fromZ;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // Throw `count` arc bolts at the nearest alive enemies (re-target mid-flight).
  _spawnArcBolts(count) {
    if (!this._arcBolts) this._buildArcBolts();
    const p = this.state.player;
    for (let k = 0; k < count; k++) {
      const bolt = this._arcBolts.find((b) => !b.active);
      if (!bolt) break;
      const target = this._nearestAlive(p.x, p.z);
      if (!target) break;
      bolt.active = true;
      bolt.x = p.x;
      bolt.z = p.z;
      bolt.target = target;
      bolt.life = EVOLUTION.ARC_LIFE;
      bolt.mesh.visible = true;
      bolt.mesh.position.set(bolt.x, bolt.y, bolt.z);
      bolt.mesh.lookAt(target.x, 1.0, target.z);
    }
  }

  _updateArcBolts(dt) {
    if (!this._arcBolts) return;
    for (const b of this._arcBolts) {
      if (!b.active) continue;
      b.life -= dt;
      if (!b.target || b.target.skel.state === 'DEAD') {
        b.target = this._nearestAlive(b.x, b.z);
      }
      if (b.life <= 0 || !b.target) {
        b.active = false;
        b.mesh.visible = false;
        continue;
      }
      const dx = b.target.x - b.x;
      const dz = b.target.z - b.z;
      const dist = Math.hypot(dx, dz);
      const step = EVOLUTION.ARC_SPEED * dt;
      if (dist <= step + 0.4) {
        // Impact: arc damage + sparks at the target
        this.skeletons.hitSkeleton(b.target.skel, EVOLUTION.ARC_DAMAGE);
        b.active = false;
        b.mesh.visible = false;
        this.sword?.burstSparks(new THREE.Vector3(b.target.x, 1.2, b.target.z));
        continue;
      }
      b.x += (dx / dist) * step;
      b.z += (dz / dist) * step;
      b.mesh.position.set(b.x, b.y + Math.sin(b.life * 20) * 0.1, b.z);
      b.mesh.lookAt(b.target.x, 1.0, b.target.z);
    }
  }

  // Rare (1%) electric chain on a landing strike: a blue blast that kills
  // every enemy within ELECTRIC_RANGE of the player.
  _electricChain(x, z) {
    if (!this.skeletons) return;
    const r2 = SWORD.ELECTRIC_RANGE * SWORD.ELECTRIC_RANGE;
    let killed = 0;
    for (const s of this.skeletons.skeletons) {
      if (s.skel.state === 'DEAD') continue;
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz <= r2) {
        if (this.skeletons.hitSkeleton(s.skel, 99999)) killed++;
      }
    }
    // blue explosion flash + screen shake + arrival message
    this._spawnFirePatch(x, z);
    this.state.hitStop = HIT_STOP * 2;
    this._shakeTime = Math.max(this._shakeTime, 0.4);
    if (killed > 0) this._showMessage(`ELECTRIC CHAIN — ${killed} foes vaporized!`, 'success');
    this._updateHUD();
  }

  _handleSwordAttack() {
    if (this._gameOverActive) return;
    if (!this.sword) return;

    // FIREBALL buff: right click hurls free explosive fireballs instead of
    // the dagger combo (held to spam at FIREBALL_COOLDOWN).
    if (this.state.buffEffect === 2) {
      if (this._fireballCd > 0) this._fireballCd -= this._delta;
      if (this.input.isMouseDown(2) && this.input.isPointerLocked() && this._fireballCd <= 0) {
        this._fireballCd = BUFF.FIREBALL_COOLDOWN;
        const p = this.state.player;
        this.shooter.fireFireball(
          p.x, WORLD.PLAYER_EYE_HEIGHT - 0.1, p.z, p.yaw, p.pitch,
        );
      }
      return;
    }

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

      // Breakable props in the arc — swept over the FULL swing reach, not one
      // at a time, so one swing can shatter everything the blade sweeps past.
      if (this.props) {
        for (const b of this.props.breakables) {
          const dx = b.x - p.x;
          const dz = b.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > range + 0.9) continue;
          // Slightly looser cone for props so the swing's wide motion connects
          const dot = dist > 0.001 ? (dx / dist) * fx + (dz / dist) * fz : 1;
          if (dot < maxDot - 0.12) continue;
          this.props.hitBreakables(b.x, b.z);
        }
      }

      // Mobs' projectiles (magician orbs + archer arrows) are breakable: a
      // swing in range clips them out of the air before they can hit.
      if (this.skeletons) this.skeletons.breakProjectiles(p, fx, fz, range, Math.cos(this.sword.currentArc));

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
        // 1% chance the landing strike chains an electric blast that kills
        // every enemy within ~20m (proc fix — B0 hoisted the constants)
        if (Math.random() < SWORD.ELECTRIC_CHANCE) {
          this._electricChain(p.x, p.z);
        }
        // Evolution arc bolts: per-tier chance × bolt count (T5 = 100% × 2)
        if (this.sword.tier >= 3 && Math.random() < EVOLUTION.ARC_CHANCE[this.sword.tier]) {
          this._spawnArcBolts(EVOLUTION.ARC_BOLTS[this.sword.tier]);
        }
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

  // Roll a random buff (1..4) and apply its side effects.
  // Never rolls the SAME effect twice in a row: if a buff is already active,
  // the new roll excludes that effect so every pickup gives a visibly
  // different (and labeled) buff instead of silently re-applying the same one.
  // Breakable buffs are capped at BUFF.MAX_DURATION (1:30); opts.cap=false
  // (boss-kill) keeps the full BUFF.BOSS_DURATION (5 min).
  _applyBuff(duration = BUFF.DURATION, opts = {}) {
    opts = opts || {};
    this._clearBuffEffects(); // replacing any active buff
    const active = this.state.buffEffect || 0;
    let effect;
    if (active >= 1 && active <= 5) {
      // pick from the 4 effects OTHER than the active one
      const candidates = [1, 2, 3, 4, 5].filter((e) => e !== active);
      effect = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      effect = 1 + Math.floor(Math.random() * 5);
    }
    this.state.applyBuff(effect, duration, { cap: opts.cap !== false });
    this._applyBuffEffects(effect);
    this._updateHUD();
  }

  // Apply the side effects of a buff EFFECT (the visual/gameplay switch).
  // Separated from the roll+duration so a carried-over buff can be re-applied
  // verbatim after a level change.
  _applyBuffEffects(effect) {
    switch (effect) {
      case 1: // BRIGHT: level lights up, mobs flee
        this.lighting.brightness = BUFF.BRIGHT_AMBIENT;
        this.skeletons.fleeing = true;
        break;
      case 2: // FIREBALL: dagger swapped for a free explosive fireball
        this.sword.group.visible = false;
        this._heldFireball.visible = true;
        this._fireballCd = 0;
        this.sword.state = 'idle'; // abort any in-flight combo
        this.sword.comboStep = 0;
        this._swordHitApplied = false;
        break;
      case 3: // EMPOWERED: longer dagger, +20% move & attack speed
        this.sword.lengthMult = BUFF.EMPOWER_LENGTH;
        this.sword.attackSpeedMult = BUFF.EMPOWER_ATTACK;
        this._moveSpeedMult = BUFF.EMPOWER_SPEED;
        break;
      case 4: // GODSPEED: +50% attack speed AND +50% move speed
        this.sword.attackSpeedMult = BUFF.GODSPEED_ATTACK;
        this._moveSpeedMult = BUFF.GODSPEED_SPEED;
        break;
      case 5: // HUNTER: a spectral boss companion follows and attacks mobs
        this._spawnHunter();
        break;
    }
  }

  // Remove every buff side effect (called on expiry or replacement).
  _clearBuffEffects() {
    this.lighting.brightness = 1;
    this.skeletons.fleeing = false;
    this.sword.group.visible = true;
    if (this._heldFireball) this._heldFireball.visible = false;
    this.sword.lengthMult = 1;
    this.sword.attackSpeedMult = 1;
    this._moveSpeedMult = 1;
    if (this.hunter) this._removeHunter();
  }

  _updateBuff(dt) {
    if (this.state.updateBuff(dt)) {
      this._clearBuffEffects();
      this._updateHUD();
    }
  }

  // HUNTER buff: summon the spectral boss companion near the player.
  _spawnHunter() {
    this._removeHunter(); // never two
    this.hunter = new Hunter(this.scene);
    const p = this.state.player;
    this.hunter.group.position.set(p.x + 1.5, 0.6, p.z + 1.5);
  }

  _removeHunter() {
    if (this.hunter) {
      this.hunter.dispose();
      this.hunter = null;
    }
  }

  // HUNTER buff: each frame, the companion follows the player, targets mobs
  // on sight, and throws energy beams at them.
  _updateHunter() {
    if (!this.hunter || !this.skeletons) return;
    const p = this.state.player;
    this.hunter.update(this._delta, performance.now() * 0.001, p, this.skeletons.skeletons, (skel, dmg) => {
      this.skeletons.hitSkeleton(skel, dmg);
    }, this._collisionBoxes, this.state.collectedOrbs);
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
    // Any hit resets the passive-regen countdown.
    this._regenClock = 0;
    this._regenTickAcc = 0;
  }

  // Passive health regen: after PLAYER.REGEN_DELAY seconds without a hit,
  // restore PLAYER.REGEN_AMOUNT heart(s) every PLAYER.REGEN_INTERVAL seconds
  // (never above max, never once the game is over).
  _updateRegen(dt) {
    if (this._gameOverActive || this.state.health <= 0) return;
    if (this.state.health >= this._maxHealth) {
      this._regenClock = 0;
      this._regenTickAcc = 0;
      return;
    }
    this._regenClock += dt;
    if (this._regenClock < PLAYER.REGEN_DELAY) return;
    this._regenTickAcc += dt;
    if (this._regenTickAcc >= PLAYER.REGEN_INTERVAL) {
      this._regenTickAcc = 0;
      this.state.health = Math.min(this._maxHealth, this.state.health + PLAYER.REGEN_AMOUNT);
    }
  }

  _updateRunTimer() {
    if (this._gameOverActive || this._titleActive) return; // no timer while title holds the scene
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
      const ng = this.state.ngPlus ? ` · NG+${this.state.ngPlus}` : '';
      // Central countdown: big, at-a-glance. Level name is shown above it.
      this._timerEl.textContent = `${mins}:${secs}${ng}`;
      this._timerEl.classList.toggle('low', remaining < 30);
    }
  }

  _gameOver(reason = 'time') {
    this._gameOverActive = true;
    this._isRunning = false;
    if (document.pointerLockElement) document.exitPointerLock();
    const rank = this.leaderboard.add(this.state.level, this.state.runTime, this.state.collectedOrbs, this.state.ngPlus);
    // Mark THIS run (not the top entry) so the red highlight tracks our score.
    this._lastEntry = {
      level: this.state.level,
      time: Math.round(this.state.runTime),
      orbs: this.state.collectedOrbs,
      ngPlus: this.state.ngPlus || 0,
    };
    if (this._goStats) {
      const t = this.state.runTime;
      const mm = Math.floor(t / 60);
      const ss = Math.floor(t % 60).toString().padStart(2, '0');
      const ng = this.state.ngPlus || 0;
      this._goStats.textContent = `Level reached: ${this.state.level}${ng ? ` (NG+${ng})` : ''} · Total time: ${mm}:${ss} · Souls: ${this.state.collectedOrbs}${rank > 0 ? ` · Rank #${rank}` : ''}`;
    }
    if (this._gameOverEl) {
      const title = this._gameOverEl.querySelector('h2');
      if (title) title.textContent = reason === 'dead' ? 'The dead claim you' : 'The darkness consumes you';
    }
    this._renderLeaderboard(this._goList);
    if (this._gameOverEl) this._gameOverEl.classList.remove('hidden');
    // Two ways forward: a fresh run from level 1, or New Game+ at half the
    // level — keeping the sword buff (orbs) — with tougher mobs.
    const ngLevel = Math.max(1, Math.floor(this.state.level / 2));
    if (this._goNgPlusBtn) {
      const ng = (this.state.ngPlus || 0) + 1;
      // NG+ effects are doubled: +200% enemy HP per cycle (real multiplier).
      this._goNgPlusBtn.textContent = `New Game+ [Y] — Level ${ngLevel} (keep ${this.state.collectedOrbs} Souls · mobs +${200 * ng}% HP)`;
    }
    if (this._goRestartBtn) this._goRestartBtn.onclick = () => this._startNewRun(false);
    if (this._goNgPlusBtn) this._goNgPlusBtn.onclick = () => this._startNewRun(true);
    if (this._goSaveBtn) {
      this._goSaveBtn.disabled = false;
      this._goSaveBtn.textContent = 'Save for later [S]';
      this._goSaveBtn.onclick = () => this._saveAtDeath();
    }
    // Y/N/S keyboard choice — reliable regardless of button focus/click issues
    if (!this._goKeyHandler) {
      this._goKeyHandler = (e) => {
        if (this._gameOverActive && !e.repeat) {
          if (e.code === 'KeyY') this._startNewRun(true);
          else if (e.code === 'KeyN') this._startNewRun(false);
          else if (e.code === 'KeyS') this._saveAtDeath();
        }
      };
      window.addEventListener('keydown', this._goKeyHandler);
    }
  }

  // Write the current run to localStorage so the startup menu can offer
  // "Load last save". One save per death screen.
  _saveAtDeath() {
    if (!this._goSaveBtn || this._goSaveBtn.disabled) return;
    const ok = this._saveRun();
    this._goSaveBtn.textContent = ok ? 'Saved ✓ — loadable at startup' : 'Save failed (storage blocked)';
    this._goSaveBtn.disabled = true;
  }

  // Start a new run after death: fresh (level 1, no carry, ngPlus 0) or
  // New Game+ (half level, orbs kept, ngPlus +1). Orb loss on death is a
  // flat 10% in NG+ — you keep 90% of your banked orbs. The death-save (if
  // any) stays untouched — it is only replaced by saving again at death.
  _startNewRun(newGamePlus = false) {
    if (this._goKeyHandler) {
      window.removeEventListener('keydown', this._goKeyHandler);
      this._goKeyHandler = null;
    }
    this._gameOverActive = false;
    if (this._gameOverEl) this._gameOverEl.classList.add('hidden');
    this._clearBuffEffects(); // no lingering buff side effects across runs
    const nextState = new GameState({
      level: newGamePlus ? Math.max(1, Math.floor(this.state.level / 2)) : 1,
      collectedOrbs: newGamePlus ? Math.floor(this.state.collectedOrbs * 0.9) : 0,
      ngPlus: newGamePlus ? (this.state.ngPlus || 0) + 1 : 0,
      bossKills: newGamePlus ? (this.state.bossKills || 0) : 0,
      // NG+ takes a flat 10% toll on souls but NEVER resets the ladder: the
      // weapon tier is kept (no downgrade to Dagger on NG+).
      weaponTier: newGamePlus ? (this.state.weaponTier || 0) : 0,
    });
    const msg = newGamePlus
      ? `New Game+ ${nextState.ngPlus} — the depths grow stronger`
      : 'A new descent begins';
    // The async loader tears down memory, rebuilds the level phase by phase,
    // and restarts the RAF chain + timer itself.
    this._regenerateDungeon({ nextState, startMessage: msg });
  }

  _renderLeaderboard(listEl) {
    if (!listEl) return;
    const entries = this.leaderboard.load();
    listEl.innerHTML = entries.length
      ? entries.map((e, i) => {
        const me = this._lastEntry && e.level === this._lastEntry.level
          && e.time === this._lastEntry.time && e.orbs === this._lastEntry.orbs
          && (e.ngPlus || 0) === (this._lastEntry.ngPlus || 0);
        const ng = e.ngPlus ? ` · NG+${e.ngPlus}` : '';
        return `<li class="${me ? 'me' : ''}">#${i + 1} · Lv ${e.level}${ng} · ${Math.floor(e.time / 60)}:${(e.time % 60).toString().padStart(2, '0')} · Souls ${e.orbs}</li>`;
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

  // Yield to the browser for one animation frame so the loading overlay can
  // paint and the GC can reclaim memory between level-build phases.
  _nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  // Show the title screen (level name + active buff + stats) over the scene.
  // The scene and mob spawns keep running underneath; the title only fades once
  // the level's mobs are fully spawned AND ~30fps has held (see _updateTitleFps).
  _showTitle(level = this.state ? this.state.level : 1) {
    if (!this._loadingEl) return;
    // Level name (explicit level so it's never the stale previous value)
    if (this._loadingLevelEl) {
      const ng = (this.state && this.state.ngPlus) ? ` · NG+${this.state.ngPlus}` : '';
      this._loadingLevelEl.textContent = `LEVEL ${level}${ng}`;
    }
    if (this._loadingBiomeEl) {
      const pal = this.biomes.current?.palette;
      this._loadingBiomeEl.textContent = pal?.label || 'STONE DUNGEON';
    }
    // Active buff + description
    if (this._loadingBuffEl) {
      const e = this.state ? this.state.buffEffect : 0;
      const DESCRIPTIONS = [
        'No active buff',
        'BRIGHT — the level lights up, enemies flee from you',
        'FIREBALL — right-click hurls an explosive fireball',
        'EMPOWERED — longer reach, faster movement & attacks',
        'GODSPEED — +50% attack speed and +50% move speed',
        'HUNTER — a spectral boss companion follows and attacks mobs',
      ];
      this._loadingBuffEl.textContent = DESCRIPTIONS[e] || DESCRIPTIONS[0];
      this._loadingBuffEl.classList.toggle('none', !e);
      if (this._loadingBuffEl.querySelector?.('.strong')) this._loadingBuffEl.innerHTML = '';
      if (e) {
        this._loadingBuffEl.innerHTML = `<span class="strong">${['', 'BRIGHT', 'FIREBALL', 'EMPOWERED', 'GODSPEED', 'HUNTER'][e]}</span> — ${DESCRIPTIONS[e].split(' — ')[1]}`;
      }
    }
    // Statistics — single source of truth shared with the HUD stats panel
    // (_liveStats): the loading screen and the in-game panel show the SAME
    // computed values, no duplicated formulas.
    if (this._loadingStatsEl) {
      const s = this.state;
      if (s) {
        const st = this._liveStats();
        const rows = [
          [`Souls`, `${s.collectedOrbs}`],
          [`DMG ×`, `${st.dmgMult.toFixed(2)}`],
          [`Orb DMG`, `${Math.round(ORB_WEAPON.DAMAGE * st.orbMult)}`],
          [`Reach`, `${st.reach.toFixed(1)}u`],
          [`Enemy HP`, `×${st.enemyHpMult.toFixed(1)}`],
          [`Mob speed`, `×${st.mobSpeedMult.toFixed(1)}`],
          [`Spawns`, `×${st.spawnMult.toFixed(1)}`],
          [`Regen`, st.regen],
        ];
        this._loadingStatsEl.innerHTML = rows
          .map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join('');
      } else {
        this._loadingStatsEl.innerHTML = '';
      }
    }
    this._loadingEl.classList.remove('hidden');
    this._titleActive = true;
    this._titleDts.length = 0;
    this._titleSumDt = 0;
    this._titleSamples = 0;
    this._titleStartedAt = performance.now();
    // Mobs spawn (queue drains) but stay frozen until the title lifts.
    if (this.skeletons) this.skeletons.frozen = true;
  }

  _hideLoading() {
    this._titleActive = false;
    if (this.skeletons) this.skeletons.frozen = false;
    if (this._loadingEl) this._loadingEl.classList.add('hidden');
    // Restart the clock cleanly the moment the title lifts so the level timer
    // doesn't count the (laggy) title-screen frames.
    this._lastTime = performance.now();
    // Level-start protection: the player is briefly immobile and invincible
    // (with a countdown) so mobs can't hit them during the first frames after
    // the title lifts — this absorbs any residual level-start latency.
    this.state.safeSpawn = PLAYER.SAFE_SPAWN;
    this.state.invulnTimer = PLAYER.SAFE_SPAWN;
  }

  // While the title is up, reveal it once the AVERAGE fps over a rolling
  // ~3s window is >=30fps (tolerant of the odd dropped frame), or as a safety
  // net after _titleMaxHold seconds so the player is never trapped behind it.
  // Called from _animate each frame.
  _updateTitleFps(dt) {
    if (!this._titleActive) return;

    // Rolling window of the last ~_titleWindow seconds of frame deltas.
    this._titleDts.push(dt);
    this._titleSumDt += dt;
    this._titleSamples++;
    while (this._titleSumDt > this._titleWindow && this._titleDts.length > 1) {
      this._titleSumDt -= this._titleDts.shift();
      this._titleSamples--;
    }

    const avgDt = this._titleSumDt / this._titleSamples;
    const avgFps = 1000 / (avgDt * 1000); // = 1 / avgDt
    const stable = avgFps >= this._titleMinFps;
    // Don't lift while mobs are still spawning (their reveal hitches are the
    // source of the post-title lag). Wait until the spawn queue drains.
    const spawnsDone = !this.skeletons || !this.skeletons._spawnQueue || this.skeletons._spawnQueue.length === 0;
    const ready = stable && spawnsDone;
    // Max-hold is a hard safety net: never trap the player behind the title.
    const held = performance.now() - this._titleStartedAt >= (this._titleMaxHold * 1000);
    if (ready || held) this._hideLoading();
  }

  // Clean every level-owned system and the scene graph so memory from the
  // previous dungeon is fully released before the new one is built.
  _teardownLevel() {
    this._removeHunter(); // HUNTER buff companion is a scene child
    this.orbs?.dispose();
    this.runes?.dispose();
    this.particles?.dispose();
    this.lighting?.dispose();
    if (this.props) this.props.dispose();
    this.smoke?.dispose();
    if (this.skeletons) this.skeletons.dispose();
    if (this.shooter) this.shooter.dispose();
    this._arcBolts = null; // bolt meshes disposed by the scene teardown
    for (const p of (this._waterPuddles || [])) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      this.scene.remove(p.mesh);
    }
    this._disposeScene();
  }

  // Sequential level loader: (1) free memory, (2) build the level phase by
  // phase (yielding a frame between each so the browser stays responsive and
  // garbage collection can run), (3) display the finished level, and only
  // then (4) start the run timer and game loop.
  async _regenerateDungeon({ newRun = false, nextState = null, startMessage = null } = {}) {
    this._isRunning = false; // stop the timer + update loop during the load
    const target = nextState ? nextState.level : (newRun ? 1 : this.state.level + 1);
    // Cover the scene with the CORRECT new level name right away (never stale).
    this._showTitle(target);

    // ---- STEP 1: clean memory first ----
    this._teardownLevel();
    await this._nextFrame();

    // HIDDEN RULE: an active buff carries across a level advance (not a fresh
    // run) with x5 of its remaining time. Capture it BEFORE the state is
    // replaced (the new GameState would otherwise wipe it to 0).
    const isLevelAdvance = !newRun && !nextState;
    const carriedBuff = isLevelAdvance && this.state.buffActive
      ? { effect: this.state.buffEffect, time: this.state.buffTime }
      : null;

    this.state = nextState
      || (newRun
        ? new GameState()
        : new GameState({
          runTime: this.state.runTime,
          level: this.state.level + 1,
          collectedOrbs: this.state.collectedOrbs,
          ngPlus: this.state.ngPlus || 0,
          bossKills: this.state.bossKills || 0,
          weaponTier: this.state.weaponTier || 0,
        }));

    // Carry the buff over (x5 remaining) so the HUD and level systems see it.
    // The buff's SIDE EFFECTS are applied AFTER _initCombat() below rebuilds
    // the skeletons/lighting (setting them here would touch the disposed
    // systems). With no carried buff we likewise clear any stuck visuals at
    // that point — this is what fixes the gone-fireball bug.
    if (carriedBuff) {
      this.state.buffEffect = carriedBuff.effect;
      this.state.buffTime = Math.min(carriedBuff.time * 5, BUFF.MAX_DURATION);
    }
    this._carriedBuff = carriedBuff;

    // A new run starts with the base max heart count; a loaded save carries
    // its own permanent hearts; a level advance keeps whatever was earned.
    // Either way the player ALWAYS begins the level at full health.
    if (newRun) {
      this._maxHealth = PLAYER.MAX_HEALTH;
    } else if (nextState) {
      this._maxHealth = nextState.maxHealth || PLAYER.MAX_HEALTH;
    }
    this.state.health = this._maxHealth;

    this._prevOrbCount = 0;
    this._prevInExit = false;
    this._noAmmoWarned = false;
    const biomeChanged = this.biomes.applyLevel(this.state.level, this.state);
    if (biomeChanged) {
      this.events.emit('biome:change', { biome: this.state.biome, biomeIndex: this.state.biomeIndex });
    }

    // ---- STEP 2: build the level phase by phase ----
    this._generateDungeon();
    await this._nextFrame();

    this._buildWorld();
    await this._nextFrame();

    this.lighting = new LightingSystem(this.scene, this.biomes.current.palette);
    this.lighting.init(this.dungeonData);
    // Degraded tier 2 persists across level regens (shadows stay off).
    if (this._degradedTier >= 2) this.lighting.setShadowBudget(0);
    await this._nextFrame();

    this._initProps();
    await this._nextFrame();

    this.smoke = new SmokeSystem(this.scene);
    this.smoke.init();
    this._rebindSmokeEmitters();
    await this._nextFrame();

    this.particles = new ParticleSystem(this.scene);
    this.particles.init();
    await this._nextFrame();

    this.runes = new RuneSystem(this.scene, this.dungeonData);
    this.runes.init();
    await this._nextFrame();

    this.orbs = new OrbSystem(this.scene, this.dungeonData, this.state);
    this.orbs.init();
    // Re-wire the buff-collected hook: _initOrbs() only runs at startup, and
    // this fresh OrbSystem has no hook by default — without this, buff pickups
    // would be collectible but trigger nothing after the first level.
    this.orbs.onBuffCollected = () => this._applyBuff();
    await this._nextFrame();

    this._initCombat();
    this._placeWaterPuddles();
    this._setupPlayerStart();
    // Prewarm both shadow variants — a mid-level tier-2 toggle is then ~free.
    this.lighting.prewarmShadowVariants(this.renderer, this.camera);
    await this._nextFrame();

    // ---- STEP 3: display the finished level (title screen holds it) ----
    this._showTitle();
    this._showMessage('Slay them for orbs — shoot or swing', 'goal');
    if (this.state.level > 1) this._showMessage(`Level ${this.state.level} — descend!`, 'goal');
    if (startMessage) this._showMessage(startMessage, 'goal');
    this._emitLevelStart();

    // Apply the carried buff's side effects now that skeletons/lighting are
    // rebuilt; with no carried buff, clear any stuck visuals (fixes the
    // gone-fireball bug where a fireball stayed on screen + sword stayed hidden
    // while state.buffEffect was 0).
    if (this._carriedBuff) {
      this._applyBuffEffects(this._carriedBuff.effect);
      this._updateHUD();
    } else {
      this._clearBuffEffects();
    }
    this._carriedBuff = null;

    // ---- STEP 4: start the run timer + game loop ----
    this._isRunning = true;
    this._lastTime = performance.now();
    this._animate();
  }

  _animateWater(t) {
    for (const puddle of this._waterPuddles) {
      // Freeze puddles >20u from the player — no per-frame VBO upload offscreen
      const dx = puddle.mesh.position.x - this.state.player.x;
      const dz = puddle.mesh.position.z - this.state.player.z;
      if (dx * dx + dz * dz > 400) continue;
      const pos = puddle.mesh.geometry.attributes.position;
      const orig = puddle.vertices;
      for (let i = 0; i < pos.count; i++) {
        pos.array[i * 3 + 2] = orig[i * 3 + 2] + Math.sin(t * 2 + i) * 0.03;
      }
      pos.needsUpdate = true;
    }
  }

  _updateHUD() {
    // Weapon slot: current tier's icon, name and effect (cached — only writes
    // when the tier actually changes, so icon + label stay in sync).
    const wtier = this.state.weaponTier || 0;
    if (wtier !== this._slotTier) {
      this._slotTier = wtier;
      const icon = EVOLUTION.TIER_ICONS[wtier] || 'icon-dagger';
      if (this._slotIconEl) this._slotIconEl.className = `slot ${icon}`;
      if (this._slotNameEl) this._slotNameEl.textContent = EVOLUTION.TIER_NAMES[wtier] || 'Dagger';
      if (this._slotEffectEl) this._slotEffectEl.textContent = `TIER ${wtier} — ${EVOLUTION.TIER_EFFECTS[wtier] || ''}`;
    }
    if (this._orbCountEl) {
      // Ammo counter (banked orbs) — labeled ORBS in the HUD.
      this._orbCountEl.textContent = String(this.state.collectedOrbs);
      if (this._orbScaleEl) {
        const scale = this.sword ? this.sword.scale : 1;
        const pct = Math.round((scale - 1) * 100);
        this._orbScaleEl.textContent = scale > 1.01 ? `+${pct}% power` : '';
      }
    }
    // Single souls counter — the ORBS/SOULS readout is the one notion, no
    // separate lifetime line (user ruling: souls = orbs).
    if (this.sword) this.sword.setOrbCount(this.state.collectedOrbs);
    if (this._biomeLabelEl) {
      const pal = this.biomes.current?.palette;
      const ng = this.state.ngPlus ? ` · NG+${this.state.ngPlus}` : '';
      // Level title includes the level number.
      this._biomeLabelEl.textContent = `LEVEL ${this.state.level}${ng} — ${pal?.label || 'STONE DUNGEON'}`;
      // Border color only changes per level — skip the style write every frame
      if (pal !== this._lastBiomePal) {
        this._lastBiomePal = pal;
        this._biomeLabelEl.style.borderBottomColor = pal
          ? `#${pal.fog.toString(16).padStart(6, '0')}` : '#444';
      }
    }
    if (this._comboPipsEl) {
      const step = this.sword ? this.sword.comboStep : 0;
      const pips = this._pipEls; // cached at construction — no per-frame query
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('lit', i < step);
      this._comboPipsEl.style.opacity = step > 0 ? '1' : '0.25';
    }
    if (this._sprintBonusEl) {
      const mult = this.state.sprintSpeedMult;
      this._sprintBonusEl.textContent = mult > 1.001
        ? `SPRINT ×${mult.toFixed(2)}`
        : '';
    }
    if (this._buffBadgeEl) {
      const labels = ['', 'BRIGHT', 'FIREBALL', 'EMPOWERED', 'GODSPEED', 'HUNTER'];
      const colors = ['', '#ffe066', '#ff8844', '#66ff88', '#88ddff', '#66ccff'];
      const e = this.state.buffEffect;
      const t = this.state.buffTime;
      const m = t >= 60 ? Math.floor(t / 60) : 0;
      const ss = t >= 60 ? Math.floor(t % 60).toString().padStart(2, '0') : '';
      this._buffBadgeEl.textContent = e
        ? `${labels[e]} ${t >= 60 ? `${m}:${ss}` : `${Math.ceil(t)}s`}`
        : '';
      this._buffBadgeEl.style.color = e ? colors[e] : '';
      // Hide the badge entirely when no buff is active (an empty box peeked
      // out between the level title and the timer).
      this._buffBadgeEl.style.display = e ? 'block' : 'none';
    }
    // Safe-spawn countdown: big number while active, hidden otherwise.
    if (this._safeSpawnEl) {
      const t = this.state.safeSpawn;
      if (t > 0) {
        this._safeSpawnEl.textContent = Math.ceil(t);
        this._safeSpawnEl.classList.remove('hidden');
      } else {
        this._safeSpawnEl.classList.add('hidden');
      }
    }
    // Dark Souls HP bar (red fill) + HP number; stamina bar stays full
    if (this._heartsEl) {
      const h = Math.max(0, this.state.health);
      const pct = Math.max(0, this._maxHealth > 0 ? h / this._maxHealth : 0);
      this._heartsEl.style.width = `${(pct * 100).toFixed(1)}%`;
      if (this._hpTextEl) this._hpTextEl.textContent = `${h} / ${this._maxHealth}`;
    }
    if (this._staminaFillEl) this._staminaFillEl.style.width = '100%'; // removed stamina bar; kept for safety
    if (this._exitEl) {
      // Boss arenas hide the "press E" prompt until the portal opens
      this._exitEl.style.display = (this.state.inExitRoom && this._bossPortalOpen) ? 'block' : 'none';
    }
    // Boss health bar: visible while a boss is alive
    if (this._bossBarEl && this.skeletons && this.skeletons.boss) {
      const b = this.skeletons.boss;
      const pct = Math.max(0, b.hp / b.maxHp);
      this._bossBarEl.style.display = 'block';
      const fill = this._bossBarEl.querySelector('.boss-bar-fill');
      if (fill) {
        fill.style.width = `${(pct * 100).toFixed(1)}%`;
        fill.style.backgroundColor = pct > 0.5 ? '#66cc66' : pct > 0.25 ? '#ffcc44' : '#ff5544';
      }
      const label = this._bossBarEl.querySelector('.boss-bar-label');
      if (label) label.textContent = b.variantLabel || 'SPECTRAL LORD';
    } else if (this._bossBarEl) {
      this._bossBarEl.style.display = 'none';
    }
    if (this._promptEl) {
      this._promptEl.style.display = this.input.isPointerLocked() ? 'none' : 'block';
    }
    this._updateStatsPanel();
  }

  // SINGLE source of truth for every live tuning coefficient displayed in the
  // HUD stats panel and the loading/title stats (one formula set, two views).
  _liveStats() {
    const s = this.state;
    const sw = this.sword;
    const orbMult = orbDamageMultiplier(s.collectedOrbs);
    // Spawn multiplier (SkeletonSystem's real formula): ×(1 + (level+souls)/10)
    const spawnMult = 1 + (s.level + s.collectedOrbs) / 10;
    const mobSpeedMult = (1 + 0.05 * (s.level - 1)) * (1 + 0.1 * (s.bossKills || 0));
    return {
      orbMult,
      spawnMult,
      mobSpeedMult,
      enemyHpMult: enemyHpMultiplier(s.ngPlus, s.level),
      dmgMult: sw ? sw.damageMult : 1,
      reach: sw ? sw.range : SWORD.RANGE,
      swordScale: sw ? sw.scale : 1,
      atkSpeed: sw && sw.attackSpeedMult !== 1
        ? `×${sw.attackSpeedMult.toFixed(2)}`
        : '×1.00',
      moveSpeed: s.sprintSpeedMult > 1.001 ? `×${s.sprintSpeedMult.toFixed(2)}` : '×1.00',
      regen: `+${PLAYER.REGEN_AMOUNT}/${PLAYER.REGEN_INTERVAL}s${PLAYER.REGEN_DELAY > 0 ? ` @${PLAYER.REGEN_DELAY}s` : ''}`,
    };
  }

  // Surface every live tuning coefficient in the HUD stats panel.
  _updateStatsPanel() {
    if (!this._statsEl) return;
    const st = this._liveStats();
    const rows = [
      ['DMG ×', `×${st.dmgMult.toFixed(2)}`],
      ['Orb DMG', `${Math.round(ORB_WEAPON.DAMAGE * st.orbMult)}`],
      ['Orb AOE', `${Math.round(ORB_WEAPON.EXPLODE_DAMAGE * st.orbMult)}`],
      ['Reach', `${st.reach.toFixed(2)}u`],
      ['Sword size', `×${st.swordScale.toFixed(2)}`],
      ['Atk speed', st.atkSpeed],
      ['Move speed', st.moveSpeed],
      ['Enemy HP', `×${st.enemyHpMult.toFixed(2)}`],
      ['Mob speed', `×${st.mobSpeedMult.toFixed(2)}`],
      ['Spawns', `×${st.spawnMult.toFixed(2)}`],
      ['Regen', st.regen],
    ];
    const html = rows
      .map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`)
      .join('');
    if (html !== this._statsCache) {
      this._statsEl.innerHTML = html;
      this._statsCache = html;
    }
  }

  dispose() {
    this._isRunning = false;
    if (this._goKeyHandler) {
      window.removeEventListener('keydown', this._goKeyHandler);
      this._goKeyHandler = null;
    }
    window.removeEventListener('resize', this._onResize);
    this.input.dispose();
    this.post.dispose();
    this._removeHunter();
    this.particles.dispose();
    this.smoke.dispose();
    this.runes.dispose();
    this.orbs.dispose();
    this.lighting.dispose();
    this._disposeFirePatches();
    if (this.props) this.props.dispose();
    if (this.sword) this.sword.dispose();
    if (this.headlight) {
      this.camera.remove(this.headlight);
      this.headlight.dispose();
      this.headlight = null;
    }
    if (this._heldFireball) {
      this.camera.remove(this._heldFireball);
      this._heldFireball.traverse((o) => {
        if (o.isMesh && o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      });
      this._heldFireball = null;
    }
    if (this.skeletons) this.skeletons.dispose();
    if (this.shooter) this.shooter.dispose();
    this._arcBolts = null; // bolt meshes disposed by the scene teardown
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

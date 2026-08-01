import * as THREE from 'three';
import { WORLD, PLAYER, CAMERA, RENDERER, TIMED_RUN, ORB_WEAPON, SWORD, PROPS, HIT_STOP, LIGHTING, DROP, BUFF, excessOrbs } from './Constants.js';
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
    this._timerEl = document.getElementById('timer');
    this._sprintBonusEl = document.getElementById('sprint-bonus');
    this._buffBadgeEl = document.getElementById('buff-badge');
    this._lbPanel = document.getElementById('leaderboard-panel');
    this._lbList = document.getElementById('leaderboard-list');
    this._gameOverEl = document.getElementById('game-over');
    this._goStats = document.getElementById('go-stats');
    this._goList = document.getElementById('go-leaderboard-list');
    this._goRestartBtn = document.getElementById('go-restart');
    this._goNgPlusBtn = document.getElementById('go-ngplus');
    this._goKeyHandler = null; // Y/N keyboard choice on the death screen
    this._heartsEl = document.getElementById('hearts');
    this._bossBarEl = document.getElementById('boss-bar');
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
    this._maxHealth = PLAYER.MAX_HEALTH; // grows by 1 per boss kill
    this._bossPortalOpen = true; // boss arenas gate the exit portal
    this._bossBarEl = null;
    this._firePatches = [];    // pooled blue magic-fire patches (orb impacts)
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
    // Breakables: buff drop chance = base + orbs-above-100 bonus
    this.props.onBreak = (x, z) => {
      const chance = BUFF.CHANCE + excessOrbs(this.state.collectedOrbs) * BUFF.ORB_BUFF_CHANCE;
      if (Math.random() < chance) this.orbs.spawnBuff(x, z);
    };
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
      // 15% chance the kill also drops a full health reset
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
    // Orb impacts on walls/ground light a brief blue magic fire
    this.shooter.onImpact = (x, z) => this._spawnFirePatch(x, z);

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
      group.visible = false;
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
    p.group.visible = true;
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
        p.group.visible = false;
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
    this._updateFirePatches();
    if (this.props) this.props.update(this._delta, t, this.state.player);
    this._stepOnBreakables();
    this._handleShooting();
    this._handleSwordAttack();
    this._updateBuff(this._delta);
    if (this.skeletons) this.skeletons.update(this._delta, t, this.state.player, this._collisionBoxes);
    if (this.shooter) this.shooter.update(this._delta, this._collisionBoxes, this.skeletons.skeletons || []);
    if (this.state.invulnTimer > 0) this.state.invulnTimer -= this._delta;
    if (this._shakeTime > 0) this._shakeTime -= this._delta;

    this._animateWater(t);
    this._checkMessages();
    this._updateHUD();
    this._eKeyWasDown = this.input.isPressed('KeyE');

    // Enemy highlight: feed the living enemy groups to the glow pass
    if (this.post && this.skeletons) {
      this._hlTargets.length = 0;
      for (const s of this.skeletons.skeletons) {
        if (s.skel.state !== 'DEAD') this._hlTargets.push(s.skel.group);
      }
      this.post.setEnemyTargets(this._hlTargets);
    }

    this.post.render();
  }

  _updateInput() {
    const dt = this._delta;
    const p = this.state.player;
    this._sprinting = this.input.isPressed('ShiftLeft') || this.input.isPressed('ShiftRight');

    // Sprint acceleration: holding Shift + moving for 5s grants +5% sprint
    // speed per tier, cumulative; resets the moment sprinting stops.
    const moving = this.input.isPressed('KeyW') || this.input.isPressed('KeyS')
      || this.input.isPressed('KeyA') || this.input.isPressed('KeyD');
    this.state.updateSprint(dt, this._sprinting, moving);
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
  // portal (closed during the fight) opens.
  _onBossDefeated() {
    this._applyBuff(BUFF.BOSS_DURATION); // 5-minute buff
    this._maxHealth += 1;
    this.state.health = Math.min(this._maxHealth, this.state.health + 1);
    this._bossPortalOpen = true;
    if (this._exitPortal) this._exitPortal.visible = true;
    this._showMessage('The Spectral Lord falls — a heart and a blessing are yours. The portal opens!', 'success');
    this._updateHUD();
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
        // 1% chance the landing strike chains an electric blast that kills
        // every enemy within ~20m
        if (Math.random() < SWORD.ELECTRIC_CHANCE) {
          this._electricChain(p.x, p.z);
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

  // Roll a random buff (1..4) and apply its side effects for 15 seconds.
  _applyBuff(duration = BUFF.DURATION) {
    this._clearBuffEffects(); // replacing any active buff
    const effect = 1 + Math.floor(Math.random() * 4);
    this.state.applyBuff(effect, duration);
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
      case 4: // VISION: enemies glow through walls
        this.post.xray = true;
        break;
    }
    this._updateHUD();
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
    if (this.post) this.post.xray = false;
  }

  _updateBuff(dt) {
    if (this.state.updateBuff(dt)) {
      this._clearBuffEffects();
      this._updateHUD();
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
      this._timerEl.textContent = `Lv ${this.state.level}${this.state.ngPlus ? ` · NG+${this.state.ngPlus}` : ''} · ${mins}:${secs} · total ${totalMins}:${totalSecs} · ${bestTxt}`;
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
      const ng = this.state.ngPlus || 0;
      this._goStats.textContent = `Level reached: ${this.state.level}${ng ? ` (NG+${ng})` : ''} · Total time: ${mm}:${ss} · Orbs: ${this.state.collectedOrbs}${rank > 0 ? ` · Rank #${rank}` : ''}`;
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
      this._goNgPlusBtn.textContent = `New Game+ [Y] — Level ${ngLevel} (keep ${this.state.collectedOrbs} orbs · mobs +${10 * ng}% HP)`;
    }
    if (this._goRestartBtn) this._goRestartBtn.onclick = () => this._startNewRun(false);
    if (this._goNgPlusBtn) this._goNgPlusBtn.onclick = () => this._startNewRun(true);
    // Y/N keyboard choice — reliable regardless of button focus/click issues
    if (!this._goKeyHandler) {
      this._goKeyHandler = (e) => {
        if (this._gameOverActive && !e.repeat) {
          if (e.code === 'KeyY') this._startNewRun(true);
          else if (e.code === 'KeyN') this._startNewRun(false);
        }
      };
      window.addEventListener('keydown', this._goKeyHandler);
    }
  }

  // Start a new run after death: fresh (level 1, no carry, ngPlus 0) or
  // New Game+ (half level, orbs kept, ngPlus +1).
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
      collectedOrbs: newGamePlus ? Math.floor(this.state.collectedOrbs * 0.5) : 0,
      ngPlus: newGamePlus ? (this.state.ngPlus || 0) + 1 : 0,
    });
    this._regenerateDungeon({ nextState });
    this._isRunning = true;
    this._lastTime = performance.now();
    this._animate(); // RAF chain died on game over — restart it
    this._showMessage(
      newGamePlus ? `New Game+ ${nextState.ngPlus} — the depths grow stronger` : 'A new descent begins',
      'goal',
    );
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

  _regenerateDungeon({ newRun = false, nextState = null } = {}) {
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

    this.state = nextState
      || (newRun
        ? new GameState()
        : new GameState({
          runTime: this.state.runTime,
          level: this.state.level + 1,
          collectedOrbs: this.state.collectedOrbs,
          ngPlus: this.state.ngPlus || 0,
        }));
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
    if (this._sprintBonusEl) {
      const mult = this.state.sprintSpeedMult;
      this._sprintBonusEl.textContent = mult > 1.001
        ? `SPRINT ×${mult.toFixed(2)}`
        : '';
    }
    if (this._buffBadgeEl) {
      const labels = ['', 'BRIGHT', 'FIREBALL', 'EMPOWERED', 'VISION'];
      const colors = ['', '#ffe066', '#ff8844', '#66ff88', '#88ddff'];
      const e = this.state.buffEffect;
      const t = this.state.buffTime;
      const m = t >= 60 ? Math.floor(t / 60) : 0;
      const ss = t >= 60 ? Math.floor(t % 60).toString().padStart(2, '0') : '';
      this._buffBadgeEl.textContent = e
        ? `${labels[e]} ${t >= 60 ? `${m}:${ss}` : `${Math.ceil(t)}s`}`
        : '';
      this._buffBadgeEl.style.color = e ? colors[e] : '';
    }
    if (this._heartsEl) {
      const h = Math.max(0, this.state.health);
      this._heartsEl.textContent = '♥'.repeat(h) + '♡'.repeat(Math.max(0, this._maxHealth - h));
    }
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

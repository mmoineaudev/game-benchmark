import * as THREE from 'three';
import { Skeleton } from './Skeleton.js';
import { ArmoredSkeleton } from './enemies/ArmoredSkeleton.js';
import { ArcherSkeleton } from './enemies/ArcherSkeleton.js';
import { Brute } from './enemies/Brute.js';
import { Rat } from './enemies/Rat.js';
import { Wraith } from './enemies/Wraith.js';
import { GhostBoss } from './enemies/GhostBoss.js';
import { Burning } from './enemies/Burning.js';
import {
  SKELETON, PLAYER, MAGICIAN, ENEMY, ENEMY_SPAWN_WEIGHTS, ENEMY_TYPES,
  ROOM_ENEMY_MODIFIERS, ARCHER, BRUTE, BOSS, WRAITH, BURN,
  enemyHpMultiplier,
} from '../core/Constants.js';
import { resolveCircleCollisions, circleHitsBox } from '../core/Collision.js';
import { generateGlowTexture } from '../world/Textures.js';

// Unified enemy system: spawns the full roster via biome-weighted registry,
// drives per-type AI (melee chase, ranged kiting, rat packs, phasing wraiths),
// manages projectile pools (magician orbs, archer arrows), and reports kills.
export class SkeletonSystem {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.skeletons = []; // { skel, x, z, cellX, cellZ, nextThink, type, elite, magician }
    this.enemyOrbs = []; // pooled red orbs fired by magicians
    this.arrows = [];    // pooled bone arrows fired by archers
    this._nextOrb = 0;
    this._nextArrow = 0;
    this.onKill = null;
    this.onPlayerDamaged = null;
    this.onPlayerDeath = null;
    this.speedMult = 1;
    this.fleeing = false; // BRIGHT buff: mobs run away instead of attacking
    this.boss = null;      // GhostBoss on boss levels
    this.onBossKill = null; // Game hook: boss died -> buff + heart + portal
    this.onBurn = null;    // Game hook: burning enemy set the ground alight
    this._spawnQueue = []; // deferred spawn jobs: one mob revealed per tick
    this._spawnTimer = 0;  // accumulator for the SPAWN_INTERVAL reveal cadence
    this.frozen = false;   // title-screen gate: spawn drains, mobs stay put
    this._burnPending = false; // BURN awaits: appears once ALL enemies are dead
    this._burnSpawned = false;
    this.data = null;      // dungeon data (set in init) for burn spawn placement
    this.spectralOrbs = []; // wraith + boss soul orbs
    this._nextSpec = 0;
  }

  _initProjectilePools() {
    // Magician red orbs (existing) — HIGH VISIBILITY: bright emissive + big glow
    const orbGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0xff3322, emissive: 0xff3322, emissiveIntensity: 3.5,
      roughness: 0.15, metalness: 0.4,
    });
    const glowTex = generateGlowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xff4433,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95,
    });
    this._orbTex = glowTex;
    this._orbMeshMat = orbMat;
    this._orbGlowMat = glowMat;
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(1.9);
      mesh.visible = false;
      glow.visible = false;
      this.scene.add(mesh);
      this.scene.add(glow);
      this.enemyOrbs.push({ mesh, glow, dirX: 0, dirZ: 0, life: 0, active: false });
    }

    // Archer bone arrows (pool of 10) — each carries a bright additive glow
    // sprite so the thin shaft reads at a glance against dark halls.
    const arrowGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xe8e0d0, emissive: 0x664422, emissiveIntensity: 0.6, roughness: 0.6, metalness: 0.1,
    });
    const arrowGlowMat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xffd8a0,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9,
    });
    this._arrowGeo = arrowGeo;
    this._arrowMat = arrowMat;
    this._arrowGlowMat = arrowGlowMat;
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(arrowGeo, arrowMat);
      const glow = new THREE.Sprite(arrowGlowMat);
      glow.scale.setScalar(0.75);
      mesh.visible = false;
      glow.visible = false;
      this.scene.add(mesh);
      this.scene.add(glow);
      this.arrows.push({ mesh, glow, dirX: 0, dirZ: 0, life: 0, active: false });
    }

    // Spectral orbs (Wraith + boss ranged cast): small blue-white souls.
    // Per-orb speed/damage are set at fire time (Wraith vs boss differ).
    // HIGH VISIBILITY: bright emissive, big pulsing glow.
    const specGeo = new THREE.SphereGeometry(0.17, 10, 8);
    const specMat = new THREE.MeshStandardMaterial({
      color: 0xaaddff, emissive: 0xaaddff, emissiveIntensity: 4,
      roughness: 0.15, metalness: 0.4,
    });
    const specGlowMat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xccf2ff,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95,
    });
    this._specOrbMat = specMat;
    this._specGlowMat = specGlowMat;
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(specGeo, specMat);
      const glow = new THREE.Sprite(specGlowMat);
      glow.scale.setScalar(1.8);
      mesh.visible = false;
      glow.visible = false;
      this.scene.add(mesh);
      this.scene.add(glow);
      this.spectralOrbs.push({ mesh, glow, dirX: 0, dirZ: 0, life: 0, speed: 7.5, dmg: 1, active: false });
    }
  }

  init(dungeonData, state) {
    this.data = dungeonData;
    this.state = state;
    this._initProjectilePools();
    const gs = dungeonData.gridSize;

    // BFS from entrance for spawn distance
    const dist = Array.from({ length: gs }, () => new Array(gs).fill(-1));
    const queue = [[state.entranceCell.x, state.entranceCell.z]];
    dist[state.entranceCell.z][state.entranceCell.x] = 0;
    while (queue.length) {
      const [x, z] = queue.shift();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= gs || nz >= gs) continue;
        if (dungeonData.grid[nz][nx] === 'empty' || dist[nz][nx] !== -1) continue;
        dist[nz][nx] = dist[z][x] + 1;
        queue.push([nx, nz]);
      }
    }

    // Candidate cells: far from entrance, not the exit room
    const exitRoom = new Set();
    const exit = state.exitCell;
    let rx = exit.x, rz = exit.z;
    while (rz > 0 && dungeonData.metadata[rz - 1][exit.x].type === 'room') rz--;
    while (rx > 0 && dungeonData.metadata[exit.z][rx - 1].type === 'room') rx--;
    for (let z = rz; z < gs && dungeonData.metadata[z][rx].type === 'room'; z++) {
      for (let x = rx; x < gs && dungeonData.metadata[z][x].type === 'room'; x++) {
        exitRoom.add(`${x},${z}`);
      }
    }

    const candidates = [];
    for (let z = 0; z < gs; z++) {
      for (let x = 0; x < gs; x++) {
        if (dungeonData.grid[z][x] === 'empty') continue;
        if (exitRoom.has(`${x},${z}`)) continue;
        if (dist[z][x] < ENEMY.SPAWN_MIN_DIST) continue;
        candidates.push({ x, z });
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // --- Boss level: spawn ONLY the ghost boss (plus its summons later) ---
    if (this._isBossLevel(state)) {
      this._spawnBoss(dungeonData, state, candidates);
      return;
    }

    // Level scaling: +5% move speed PER LEVEL; attack speed still +5% per
    // 3 levels (attackMult — swing cadence, not movement).
    // Every boss kill adds +10% to BOTH movement and attack speed (permanent).
    const bossMult = 1 + 0.1 * (state.bossKills || 0);
    this.speedMult = (1 + 0.05 * (state.level - 1)) * bossMult;
    const attackMult = (1 + 0.05 * Math.floor((state.level - 1) / 3)) * bossMult;

    // New Game+: +300% enemy HP per NG+ cycle, +100% per 10 levels, and spawn
    // pressure above the ×100 spawn cap converts to HP (the overflow rule).
    const hpMult = enemyHpMultiplier(state.ngPlus, state.level, state.collectedOrbs);

    // Spawn rate: ACCELERATED — ×(1 + (level + souls)/10), CAPPED at ×100
    // (ENEMY.SPAWN_CAP). Past the cap, pressure feeds enemy HP instead
    // (enemyHpMultiplier's overflow rule). Slots are hard-capped at MAX_ALIVE.
    const spawnMult = Math.min(
      1 + (state.level + state.collectedOrbs) / 10,
      ENEMY.SPAWN_CAP,
    );
    let slots = Math.min(
      Math.round((ENEMY.BASE_SLOTS + (state.level - 1) * ENEMY.SLOTS_PER_LEVEL) * spawnMult),
      ENEMY.MAX_ALIVE,
    );
    const inArena = dungeonData.rooms.some((r) => r.type === 'ARENA');
    if (inArena) slots += ENEMY.ARENA_EXTRA_SLOTS;

    const cs = dungeonData.cellSize;
    const ex = state.entranceCell.x * cs + cs / 2;
    const ez = state.entranceCell.z * cs + cs / 2;

    // Build a spawn PLAN (cheap data) instead of constructing every enemy
    // synchronously. update() reveals one mob per SPAWN_INTERVAL, spreading
    // the heavy mesh construction across the first seconds of the level so
    // level start no longer blocks on one big synchronous build.
    const spawnPlan = [];

    let ratCount = 0;
    for (let i = 0; i < Math.min(slots, candidates.length); i++) {
      const { x, z } = candidates[i];
      const cellMeta = dungeonData.metadata[z][x];
      const roomType = cellMeta?.type === 'room' ? cellMeta.roomType : null;
      const type = this._pickType(roomType, state.biome);
      const sx = x * cs + cs / 2;
      const sz = z * cs + cs / 2;

      if (type === 'RAT') {
        if (ratCount >= ENEMY.RAT_CAP) continue;
        const packSize = Math.min(
          ENEMY.RAT_PACK_MIN + Math.floor(Math.random() * (ENEMY.RAT_PACK_MAX - ENEMY.RAT_PACK_MIN + 1)),
          ENEMY.RAT_CAP - ratCount,
          ENEMY.MAX_ALIVE - this.skeletons.length,
        );
        for (let r = 0; r < packSize; r++) {
          const ox = (Math.random() - 0.5) * 2;
          const oz = (Math.random() - 0.5) * 2;
          spawnPlan.push({ kind: 'RAT', x: sx + ox, z: sz + oz, cellX: x, cellZ: z, attackMult, hpMult });
          ratCount++;
        }
        continue;
      }

      // Elite roll: 1-in-10 for elite-eligible types (Armored, Archer, Brute, Wraith)
      const elite = ['ARMORED', 'ARCHER', 'BRUTE', 'WRAITH'].includes(type)
        && Math.random() < ENEMY.ELITE_CHANCE;
      // ARENA guarantees an elite on its first spawn roll
      const arenaElite = inArena && spawnPlan.length === 0
        && ['ARMORED', 'ARCHER', 'BRUTE', 'WRAITH'].includes(type);
      spawnPlan.push({
        kind: type, x: sx, z: sz, cellX: x, cellZ: z,
        elite: elite || arenaElite, magician: type === 'MAGICIAN',
        attackMult, hpMult, ex, ez,
      });
    }

    this._spawnQueue = spawnPlan;
    // The BURN enemy no longer spawns at level start: it awaits until ALL
    // other enemies are dead (see update() -> _maybeSpawnBurn). Reset the
    // flag here so a fresh level can summon it again.
    this._burnPending = !this._isBossLevel(state) && !inArena && spawnPlan.length > 0;
    // Reveal the first mob immediately so the level isn't empty on frame 1.
    if (this._spawnQueue.length) this._revealNextSpawn();
  }

  // Construct ONE planned mob now and add it to the live roster. Called from
  // update() at SPAWN_INTERVAL cadence to spread out level-start construction.
  _revealNextSpawn() {
    const job = this._spawnQueue.shift();
    if (!job) return;
    // Spawns only occur more than SPAWN_PLAYER_DIST (30 m) from the player: a
    // queued mob whose spot is currently too close rotates to the back of the
    // queue and waits until the player moves away — nothing materializes
    // right next to you.
    const p = this.state.player;
    const ddx = job.x - p.x;
    const ddz = job.z - p.z;
    if (ddx * ddx + ddz * ddz < ENEMY.SPAWN_PLAYER_DIST * ENEMY.SPAWN_PLAYER_DIST) {
      this._spawnQueue.push(job);
      return;
    }
    const { attackMult, hpMult } = job;
    const scaleHp = (skel) => {
      skel.hp = Math.ceil(skel.hp * hpMult);
      skel.maxHp = skel.hp;
    };

    if (job.kind === 'RAT') {
      const rat = new Rat(this.scene, { attackMult });
      rat.group.position.set(job.x, 0, job.z);
      this._ground(rat.group);
      rat.onKill = () => this._onKill(rat);
      rat.onDeathComplete = () => this._removeSkeleton(rat);
      scaleHp(rat); // NG+ HP
      this.skeletons.push({
        skel: rat, x: job.x, z: job.z,
        cellX: job.cellX, cellZ: job.cellZ, nextThink: 0, type: 'RAT', elite: false, magician: false,
      });
      return;
    }

    if (job.kind === 'BURN') {
      const burn = new Burning(this.scene);
      burn.group.position.set(job.x, 0, job.z);
      this._ground(burn.group);
      burn.onKill = () => this._onKill(burn);
      burn.onDeathComplete = () => this._removeSkeleton(burn);
      scaleHp(burn); // NG+ HP
      this.skeletons.push({
        skel: burn, x: job.x, z: job.z,
        cellX: job.cellX, cellZ: job.cellZ, nextThink: 0, type: 'BURN', elite: false, magician: false,
      });
      return;
    }

    const type = job.kind;
    let skel;
    switch (type) {
      case 'ARMORED': skel = new ArmoredSkeleton(this.scene, { attackMult, elite: job.elite }); break;
      case 'ARCHER': skel = new ArcherSkeleton(this.scene, { attackMult, elite: job.elite }); break;
      case 'BRUTE': skel = new Brute(this.scene, { attackMult, elite: job.elite }); break;
      case 'WRAITH': skel = new Wraith(this.scene, { attackMult, elite: job.elite }); break;
      default: {
        const magician = type === 'MAGICIAN';
        skel = new Skeleton(this.scene, { isMagician: magician, active: true, attackMult });
        skel.magician = magician;
      }
    }
    skel.group.position.set(job.x, 0, job.z);
    this._ground(skel.group);
    skel.onAttackHit = () => this._onAttackHit(skel, type);
    skel.onDeathComplete = () => this._removeSkeleton(skel);
    skel.onKill = () => this._onKill(skel);
    skel.facingYaw = Math.atan2(job.ex - job.x, job.ez - job.z);
    skel.group.rotation.y = skel.facingYaw;
    scaleHp(skel); // NG+ HP
    this.skeletons.push({
      skel, x: job.x, z: job.z,
      cellX: job.cellX, cellZ: job.cellZ, nextThink: 0, type, elite: job.elite, magician: type === 'MAGICIAN',
    });
  }

  _revealQueue(dt) {
    if (!this._spawnQueue || !this._spawnQueue.length) return;
    this._spawnTimer += dt;
    while (this._spawnTimer >= ENEMY.SPAWN_INTERVAL && this._spawnQueue.length) {
      this._spawnTimer -= ENEMY.SPAWN_INTERVAL;
      this._revealNextSpawn();
    }
  }

  _isBossLevel(state) {
    return BOSS.INTERVAL > 0 && state.level % BOSS.INTERVAL === 0;
  }

  // Plant an enemy model on the ground: set the group's Y so its lowest
  // vertex rests exactly on the floor (y=0). Fixes models whose feet were
  // built below the origin (they appeared to hover with legs sunk in).
  _ground(group) {
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    if (Number.isFinite(box.min.y)) group.position.y = -box.min.y;
  }

  // Spawn ONE ghost boss (random enemy-type variant) at the exit cell.
  _spawnBoss(dungeonData, state, candidates) {
    const cs = dungeonData.cellSize;
    const exit = dungeonData.exitCell;
    const bx = exit.x * cs + cs / 2;
    const bz = exit.z * cs + cs / 2;
    const variants = ['SKELETON', 'ARMORED', 'ARCHER', 'BRUTE', 'WRAITH', 'RAT', 'MAGICIAN'];
    const variant = variants[Math.floor(Math.random() * variants.length)];
    const baseHp = 4; // base enemy HP; boss = 22.5x this (15x +50%)
    // The boss scales with the player's wealth: +25% HP per 50 souls held.
    // NG+ hits the boss like every mob: base HP x (1 + HP_PER_NG x ngPlus).
    const boss = new GhostBoss(
      this.scene, baseHp * (1 + ENEMY.HP_PER_NG * (state.ngPlus || 0)), variant, state.collectedOrbs,
    );
    boss.group.position.set(bx, 0, bz);
    this._ground(boss.group);
    boss.onSummon = () => this._summonMinions(boss, candidates, dungeonData, state);
    boss.onChargeHit = () => this._damagePlayer(BOSS.CHARGE_DMG);
    boss.onFireOrb = () => this._fireSpectralOrb(boss, BOSS.ORB_SPEED, BOSS.ORB_DAMAGE);
    boss.onKill = () => this._onBossKill();
    boss.onDeathComplete = () => this._removeSkeleton(boss);
    this.boss = boss;
    this.skeletons.push({
      skel: boss, x: bx, z: bz, cellX: exit.x, cellZ: exit.z,
      nextThink: 0, type: 'BOSS', elite: false, magician: false,
    });
  }

  // Boss summons a pack of small wraiths that shoot projectiles.
  _summonMinions(boss, candidates, dungeonData, state) {
    const liveMinions = this.skeletons.filter((s) => s.type === 'WRAITH' && s.skel.state !== 'DEAD').length;
    const room = Math.max(0, Math.min(BOSS.SUMMON_COUNT, BOSS.MAX_MINIONS - liveMinions));
    if (room <= 0) return;
    const cs = dungeonData.cellSize;
    for (let i = 0; i < room; i++) {
      const c = candidates.length
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : { x: Math.floor(boss.group.position.x / cs), z: Math.floor(boss.group.position.z / cs) };
      const w = new Wraith(this.scene, { attackMult: 1 });
      const sx = c.x * cs + cs / 2;
      const sz = c.z * cs + cs / 2;
      w.group.position.set(sx, 0, sz);
      this._ground(w.group);
      w.magician = true; // these wraiths SHOOT projectiles
      w.onKill = () => this._onKill(w);
      w.onDeathComplete = () => this._removeSkeleton(w);
      this.skeletons.push({
        skel: w, x: sx, z: sz, cellX: c.x, cellZ: c.z,
        nextThink: 0, type: 'WRAITH', elite: false, magician: true,
      });
    }
  }

  _onBossKill() {
    this.boss = null;
    this.onBossKill?.();
  }

  // Biome weights + room-type multipliers -> enemy type
  _pickType(roomType, biome) {
    const weights = ENEMY_SPAWN_WEIGHTS[biome] || ENEMY_SPAWN_WEIGHTS.STONE;
    const mods = roomType ? ROOM_ENEMY_MODIFIERS[roomType] : null;
    const scaled = weights.map((w, i) => {
      const type = ENEMY_TYPES[i];
      const m = mods ? (mods[type] ?? 1) : 1;
      return w * m;
    });
    const sum = scaled.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < scaled.length; i++) {
      r -= scaled[i];
      if (r <= 0) return ENEMY_TYPES[i];
    }
    return ENEMY_TYPES[scaled.length - 1];
  }

  _onAttackHit(skel, type) {
    if (type === 'MAGICIAN') this._fireEnemyOrb(skel);
    else if (type === 'ARCHER') this._fireArrow(skel);
    else if (type === 'BRUTE') this._bruteSlam(skel);
    else if (type === 'WRAITH') this._fireSpectralOrb(skel, WRAITH.ORB_SPEED, WRAITH.ORB_DAMAGE);
    else this._damagePlayer(SKELETON.ATTACK_DAMAGE);
  }

  _bruteSlam(skel) {
    const p = this.state.player;
    const dx = p.x - skel.group.position.x;
    const dz = p.z - skel.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > BRUTE.RANGE || dist < 0.001) return;
    const dot = (dx / dist) * Math.sin(skel.facingYaw) + (dz / dist) * Math.cos(skel.facingYaw);
    if (dot < Math.cos(BRUTE.ARC)) return; // outside ±50° cone
    this._damagePlayer(BRUTE.DMG);
    this._spawnShockwave(skel.group.position.x, skel.group.position.z);
  }

  _spawnShockwave(x, z) {
    // Visual only: expanding torus ring
    if (!this._shockGeo) {
      this._shockGeo = new THREE.TorusGeometry(0.6, 0.05, 6, 20);
      this._shockMat = new THREE.MeshBasicMaterial({
        color: 0xff8830, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this._shocks = [];
      for (let i = 0; i < 4; i++) {
        const mesh = new THREE.Mesh(this._shockGeo, this._shockMat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.visible = false;
        this.scene.add(mesh);
        this._shocks.push({ mesh, life: 0, active: false });
      }
    }
    const s = this._shocks.find((s) => !s.active) || this._shocks[0];
    s.active = true;
    s.life = 0.25;
    s.mesh.visible = true;
    s.mesh.position.set(x, 0.1, z);
    s.mesh.scale.setScalar(0.6);
  }

  update(dt, time, player, collisionBoxes) {
    this._revealQueue(dt);
    // Frozen (title screen up): drain spawns so they exist, but keep all mobs
    // immobile until the title lifts (level-start stability trick).
    if (this.frozen) return;
    // Safe spawn: mobs stay put and idle (no tracking/attacking) until the
    // player's spawn protection countdown reaches 0.
    const tracking = !(this.state && this.state.safeSpawn > 0);
    for (const s of this.skeletons) {
      const skel = s.skel;
      if (skel.state === 'DEAD') {
        skel.update(dt, time);
        continue;
      }
      // Safe spawn: mobs idle in place (no tracking/attacking). Bosses also
      // wait — their charge/summon AI is gated the same way.
      if (!tracking) {
        skel.update(dt, time);
        continue;
      }
      const dx = player.x - s.x;
      const dz = player.z - s.z;
      const dist = Math.hypot(dx, dz);
      // Far-frozen bodies: mobs > FROZEN_DIST (40 m) from the player are
      // IMMOBILE — idle in place, no AI, no tracking, no attacks. This is
      // what makes the 100-body cap affordable (distant mobs cost almost
      // nothing per frame).
      if (s.type !== 'BOSS' && dist > ENEMY.FROZEN_DIST) {
        skel.update(dt, time);
        continue;
      }
      if (s.type === 'BOSS') {
        s.skel.update(dt, time, player, collisionBoxes, resolveCircleCollisions);
        s.x = s.skel.group.position.x;
        s.z = s.skel.group.position.z;
        continue;
      }

      // --- Burning enemy: chases and sets the ground alight where it walks ---
      if (s.type === 'BURN') {
        const b = s.skel;
        const bdx = player.x - s.x;
        const bdz = player.z - s.z;
        const bd = Math.hypot(bdx, bdz);
        const bspd = b.speed * this.speedMult * dt;
        if (bd > 1e-3) {
          // Sub-step so the burn can't tunnel through walls at high speed.
          const ux = bdx / bd, uz = bdz / bd;
          const maxStep = 0.08;
          let remaining = bspd;
          while (remaining > 1e-6) {
            const step = Math.min(maxStep, remaining);
            s.x += ux * step;
            s.z += uz * step;
            resolveCircleCollisions(collisionBoxes, s, 0.35);
            remaining -= step;
          }
        }
        b.group.position.x = s.x;
        b.group.position.z = s.z;
        b.setFacing(Math.atan2(bdx, bdz));
        b.group.rotation.y = b.facingYaw;
        // ground fire where it walks
        b.burnAcc -= dt;
        if (b.burnAcc <= 0) {
          b.burnAcc = BURN.FIRE_INTERVAL;
          if (bd > 0.15) this.onBurn?.(s.x, s.z);
        }
        // melee attack
        if (bd < b.attackRange && b.attack()) this._damagePlayer(b.damage);
        b.update(dt, time);
        continue;
      }

      // --- Flee (BRIGHT buff): every enemy runs away, no attacks ---
      if (this.fleeing) {
        const speed = (skel.speed ?? SKELETON.CHASE_SPEED) * this.speedMult * dt;
        if (dist > 0.01) {
          const ux = -dx / dist, uz = -dz / dist;
          // Sub-step so a high flee speed (BRIGHT + level + boss-kill speed)
          // can never tunnel a mob through a wall: each sliver is smaller than
          // the wall thickness, and collisions resolve after every sliver.
          const maxStep = 0.08;
          let remaining = speed;
          while (remaining > 1e-6) {
            const step = Math.min(maxStep, remaining);
            s.x += ux * step;
            s.z += uz * step;
            resolveCircleCollisions(collisionBoxes, s, 0.35);
            remaining -= step;
          }
          skel.group.position.x = s.x;
          skel.group.position.z = s.z;
          skel.setFacing(Math.atan2(-dx, -dz));
          skel.group.rotation.y = THREE.MathUtils.damp(
            skel.group.rotation.y, skel.facingYaw, 8, dt,
          );
        }
        skel.update(dt, time);
        continue;
      }

      // --- Ranged attackers: Archer (kite) & Magician (cast) ---
      if (s.type === 'ARCHER') {
        const atkRange = ARCHER.RANGE;
        if (skel.state === 'CHASE' && dist <= atkRange
          && skel.attackCooldown <= 0 && this._hasLOS(skel, player, collisionBoxes)) {
          skel.state = 'ATTACK';
          skel.animTime = 0;
          skel.attackHitDone = false;
          skel.setFacing(Math.atan2(dx, dz));
        }
        if (skel.state === 'ATTACK') { skel.update(dt, time); continue; }
        // Kite: stop at pref dist, retreat if too close
        let moveX = 0, moveZ = 0;
        if (dist < ARCHER.RETREAT_DIST) {
          moveX = -dx / dist; moveZ = -dz / dist;
          const speed = ARCHER.RETREAT_SPEED * this.speedMult * dt;
          this._substepMove(s, moveX, moveZ, speed, collisionBoxes);
        } else if (dist > ARCHER.PREF_DIST && this._hasLOS(skel, player, collisionBoxes)) {
          moveX = dx / dist; moveZ = dz / dist;
          const speed = ARCHER.SPEED * this.speedMult * dt;
          this._substepMove(s, moveX, moveZ, speed, collisionBoxes);
        } else if (!this._hasLOS(skel, player, collisionBoxes)) {
          const dir = this._greedyStep(s, player, collisionBoxes);
          if (dir) {
            moveX = dir.x; moveZ = dir.z;
            const speed = ARCHER.SPEED * this.speedMult * dt;
            this._substepMove(s, moveX, moveZ, speed, collisionBoxes);
          }
        }
        if (moveX !== 0 || moveZ !== 0) {
          resolveCircleCollisions(collisionBoxes, s, 0.35);
          skel.group.position.x = s.x;
          skel.group.position.z = s.z;
          skel.setFacing(Math.atan2(moveX, moveZ));
          skel.group.rotation.y = THREE.MathUtils.damp(skel.group.rotation.y, skel.facingYaw, 8, dt);
        }
        skel.update(dt, time);
        continue;
      }

      // --- Phasing Wraith: straight-line flight through walls ---
      if (s.type === 'WRAITH') {
        if (dist > 0.5) {
          const speed = skel.speed * this.speedMult * dt;
          // Sub-step so high chase speed (level + boss-kill scaling) can't
          // tunnel a mob through a wall; collisions resolve per sliver.
          const ux = dx / dist, uz = dz / dist;
          const maxStep = 0.08;
          let remaining = speed;
          while (remaining > 1e-6) {
            const step = Math.min(maxStep, remaining);
            s.x += ux * step;
            s.z += uz * step;
            resolveCircleCollisions(collisionBoxes, s, 0.35);
            remaining -= step;
          }
          skel.group.position.x = s.x;
          skel.group.position.z = s.z;
          skel.setFacing(Math.atan2(dx, dz));
        }
        if (dist <= skel.attackRange && skel.attack() && this.state.invulnTimer <= 0) {
          this._damagePlayer(skel.damage);
        }
        skel.update(dt, time);
        continue;
      }

      // --- Rats: fast straight-line chase (with greedy step if LOS blocked) ---
      if (s.type === 'RAT') {
        let moveX = 0, moveZ = 0;
        if (this._hasLOS(skel, player, collisionBoxes)) {
          moveX = dx / dist; moveZ = dz / dist;
        } else {
          const dir = this._greedyStep(s, player, collisionBoxes);
          if (dir) { moveX = dir.x; moveZ = dir.z; }
        }
        if (moveX !== 0 || moveZ !== 0) {
          const speed = skel.speed * this.speedMult * dt;
          // Sub-step so fast rats (level + boss-kill scaling) can't tunnel
          // through walls; collisions resolve per sliver.
          const maxStep = 0.08;
          let remaining = speed;
          while (remaining > 1e-6) {
            const step = Math.min(maxStep, remaining);
            s.x += moveX * step;
            s.z += moveZ * step;
            resolveCircleCollisions(collisionBoxes, s, 0.35);
            remaining -= step;
          }
          skel.group.position.x = s.x;
          skel.group.position.z = s.z;
          skel.setFacing(Math.atan2(moveX, moveZ));
        }
        if (dist <= skel.attackRange && skel.attack() && this.state.invulnTimer <= 0) {
          this._damagePlayer(skel.damage);
        }
        skel.update(dt);
        continue;
      }

      // --- Melee skeleton-family (Skeleton, Magician?, Armored, Brute) ---
      const atkRange = skel.attackRange ?? SKELETON.ATTACK_RANGE;
      // No LOS gate on the swing: at point-blank near a wall the 2D LOS ray
      // grazes the wall and blocks the attack, so skeletons couldn't hurt the
      // player right next to them. In range + cooldown ready = attack.
      if (skel.state === 'CHASE' && dist <= atkRange && skel.attackCooldown <= 0) {
        skel.state = 'ATTACK';
        skel.animTime = 0;
        skel.attackHitDone = false;
        skel.setFacing(Math.atan2(dx, dz));
      }

      if (skel.state === 'ATTACK') {
        skel.update(dt, time);
        continue;
      }

      if (skel.state === 'CHASE') {
        let moveX = 0, moveZ = 0;
        const los = this._hasLOS(skel, player, collisionBoxes);
        const stopRange = s.magician
          ? Math.max(MAGICIAN.CAST_RANGE * 0.6, SKELETON.ATTACK_RANGE)
          : atkRange;
        if (los && dist > stopRange) {
          moveX = dx / dist;
          moveZ = dz / dist;
        } else if (!los) {
          const dir = this._greedyStep(s, player, collisionBoxes);
          if (dir) { moveX = dir.x; moveZ = dir.z; }
        }

        if (moveX !== 0 || moveZ !== 0) {
          const speed = skel.speed * this.speedMult * dt;
          // Sub-step so high chase speed (level + boss-kill scaling) can't
          // tunnel a mob through a wall; collisions resolve per sliver.
          const maxStep = 0.08;
          let remaining = speed;
          while (remaining > 1e-6) {
            const step = Math.min(maxStep, remaining);
            s.x += moveX * step;
            s.z += moveZ * step;
            resolveCircleCollisions(collisionBoxes, s, 0.35);
            remaining -= step;
          }
          skel.group.position.x = s.x;
          skel.group.position.z = s.z;
          skel.setFacing(Math.atan2(moveX, moveZ));
          skel.group.rotation.y = THREE.MathUtils.damp(
            skel.group.rotation.y, skel.facingYaw, 8, dt,
          );
        }
      }

      skel.update(dt, time);
    }

    // The BURN enemy rises once every other mob is dead (boss-tier final foe)
    this._maybeSpawnBurn(player);

    // Magician red orbs + archer arrows
    this._updateProjectiles(dt, collisionBoxes, player);

    // Shockwave rings
    if (this._shocks) {
      for (const s of this._shocks) {
        if (!s.active) continue;
        s.life -= dt;
        const t = 1 - Math.max(0, s.life / 0.25);
        s.mesh.scale.setScalar(0.6 + t * 2.0);
        s.mesh.material.opacity = 0.6 * (1 - t);
        if (s.life <= 0) { s.active = false; s.mesh.visible = false; }
      }
    }
  }

  _updateProjectiles(dt, collisionBoxes, player) {
    // Magician orbs
    for (const orb of this.enemyOrbs) {
      if (!orb.active) continue;
      orb.mesh.position.x += orb.dirX * MAGICIAN.ORB_SPEED * dt;
      orb.mesh.position.z += orb.dirZ * MAGICIAN.ORB_SPEED * dt;
      orb.glow.position.copy(orb.mesh.position);
      orb.life -= dt;
      if (circleHitsBox(collisionBoxes, orb.mesh.position.x, orb.mesh.position.z, MAGICIAN.ORB_RADIUS)) {
        this._deactivateOrb(orb);
        continue;
      }
      const dx = player.x - orb.mesh.position.x;
      const dz = player.z - orb.mesh.position.z;
      if (dx * dx + dz * dz < 0.8) {
        this._damagePlayer(MAGICIAN.ORB_DAMAGE);
        this._deactivateOrb(orb);
        continue;
      }
      if (orb.life <= 0) this._deactivateOrb(orb);
    }

    // Spectral orbs (Wraith + boss cast)
    for (const orb of this.spectralOrbs) {
      if (!orb.active) continue;
      orb.mesh.position.x += orb.dirX * orb.speed * dt;
      orb.mesh.position.z += orb.dirZ * orb.speed * dt;
      orb.glow.position.copy(orb.mesh.position);
      // Pulsing glow so the orb reads as alive (and is easy to spot mid-flight)
      orb.glow.scale.setScalar(1.8 + Math.sin(orb.life * 18) * 0.3);
      orb.life -= dt;
      if (circleHitsBox(collisionBoxes, orb.mesh.position.x, orb.mesh.position.z, 0.25)) {
        this._deactivateOrb(orb);
        continue;
      }
      const dx = player.x - orb.mesh.position.x;
      const dz = player.z - orb.mesh.position.z;
      if (dx * dx + dz * dz < 0.7) {
        this._damagePlayer(orb.dmg);
        this._deactivateOrb(orb);
        continue;
      }
      if (orb.life <= 0) this._deactivateOrb(orb);
    }

    // Archer arrows
    for (const a of this.arrows) {
      if (!a.active) continue;
      a.mesh.position.x += a.dirX * ARCHER.ARROW_SPEED * dt;
      a.mesh.position.z += a.dirZ * ARCHER.ARROW_SPEED * dt;
      a.mesh.rotation.x = Math.atan2(0.02, ARCHER.ARROW_SPEED * dt) + Math.PI / 2;
      if (a.glow) a.glow.position.copy(a.mesh.position);
      a.life -= dt;
      if (circleHitsBox(collisionBoxes, a.mesh.position.x, a.mesh.position.z, ARCHER.ARROW_RADIUS)) {
        this._deactivateArrow(a);
        continue;
      }
      const dx = player.x - a.mesh.position.x;
      const dz = player.z - a.mesh.position.z;
      if (dx * dx + dz * dz < 0.7) {
        this._damagePlayer(ARCHER.DMG);
        this._deactivateArrow(a);
        continue;
      }
      if (a.life <= 0) this._deactivateArrow(a);
    }
  }

  _fireEnemyOrb(skel) {
    const orb = this.enemyOrbs[this._nextOrb];
    this._nextOrb = (this._nextOrb + 1) % this.enemyOrbs.length;
    const p = this.state.player;
    const sx = skel.group.position.x;
    const sz = skel.group.position.z;
    orb.active = true;
    orb.mesh.visible = true;
    orb.glow.visible = true;
    orb.mesh.position.set(sx, 1.6, sz);
    orb.glow.position.copy(orb.mesh.position);
    const dx = p.x - sx;
    const dz = p.z - sz;
    const len = Math.hypot(dx, dz) || 1;
    orb.dirX = dx / len;
    orb.dirZ = dz / len;
    orb.life = MAGICIAN.ORB_LIFETIME;
  }

  _fireSpectralOrb(skel, speed = WRAITH.ORB_SPEED, dmg = WRAITH.ORB_DAMAGE) {
    const orb = this.spectralOrbs[this._nextSpec];
    this._nextSpec = (this._nextSpec + 1) % this.spectralOrbs.length;
    const p = this.state.player;
    const sx = skel.group.position.x;
    const sz = skel.group.position.z;
    orb.active = true;
    orb.mesh.visible = true;
    orb.glow.visible = true;
    orb.mesh.position.set(sx, 1.6, sz);
    orb.glow.position.copy(orb.mesh.position);
    const dx = p.x - sx;
    const dz = p.z - sz;
    const len = Math.hypot(dx, dz) || 1;
    orb.dirX = dx / len;
    orb.dirZ = dz / len;
    orb.life = 2.5;
    orb.speed = speed;
    orb.dmg = dmg;
  }

  _fireArrow(skel) {
    const p = this.state.player;
    const sx = skel.group.position.x;
    const sz = skel.group.position.z;
    const arrows = skel.elite ? 2 : 1; // Sharpshooter fires a 2-arrow fan
    for (let k = 0; k < arrows; k++) {
      const a = this.arrows[this._nextArrow];
      this._nextArrow = (this._nextArrow + 1) % this.arrows.length;
      a.active = true;
      a.mesh.visible = true;
      a.glow.visible = true;
      a.mesh.position.set(sx, 1.5, sz);
      a.glow.position.copy(a.mesh.position);
      const dx = p.x - sx;
      const dz = p.z - sz;
      const len = Math.hypot(dx, dz) || 1;
      const spread = k === 0 ? 0 : (k === 1 ? -0.14 : 0.14); // ±8°
      const ang = Math.atan2(dx, dz) + spread;
      a.dirX = Math.sin(ang);
      a.dirZ = Math.cos(ang);
      a.life = ARCHER.ARROW_LIFE;
    }
  }

  _deactivateOrb(orb) {
    orb.active = false;
    orb.mesh.visible = false;
    orb.glow.visible = false;
  }

  _deactivateArrow(a) {
    a.active = false;
    a.mesh.visible = false;
    if (a.glow) a.glow.visible = false;
  }

  // Sword swing clips mob projectiles out of the air. Any active magician
  // orb or archer arrow within the reach cone of the player's blade is broken
  // (deactivated). px/pz = player pos, fx/fz = forward direction,
  // range = blade reach, coneCos = cos of the swing's half-angle.
  breakProjectiles(px, pz, fx, fz, range, coneCos) {
    const hit = (arr, cx, cz) => {
      const dx = cx - px;
      const dz = cz - pz;
      const dist = Math.hypot(dx, dz);
      if (dist > range + 0.4) return false;
      const dot = dist > 0.001 ? (dx / dist) * fx + (dz / dist) * fz : 1;
      return dot >= coneCos - 0.1;
    };
    for (const orb of this.enemyOrbs) {
      if (!orb.active) continue;
      if (hit(orb.mesh.position.x, orb.mesh.position.z)) {
        this._deactivateOrb(orb);
      }
    }
    for (const orb of this.spectralOrbs) {
      if (!orb.active) continue;
      if (hit(orb.mesh.position.x, orb.mesh.position.z)) {
        this._deactivateOrb(orb);
      }
    }
    for (const a of this.arrows) {
      if (!a.active) continue;
      if (hit(a.mesh.position.x, a.mesh.position.z)) {
        this._deactivateArrow(a);
      }
    }
  }

  _damagePlayer(amount = 1) {
    if (this.state.invulnTimer > 0 || this.state.health <= 0) return;
    this.state.health -= amount;
    this.state.invulnTimer = PLAYER.INVULN_TIME;
    this.onPlayerDamaged?.();
    if (this.state.health <= 0) {
      this.onPlayerDeath?.();
    }
  }

  _onKill(skel) {
    this.onKill?.(skel.group.position.x, skel.group.position.z, skel.dropOrbs || 1, skel);
  }

  // The BURN enemy waits until the ENTIRE level is cleared, then rises as a
  // final challenge with boss-tier HP. Called from update() every frame.
  _maybeSpawnBurn(player) {
    if (!this._burnPending || this._burnSpawned) return;
    if (this._spawnQueue.length) return; // mobs still draining in
    // Any OTHER living enemy (not the burn itself, not the boss) blocks it.
    for (const s of this.skeletons) {
      if (s.type === 'BURN' || s.type === 'BOSS') continue;
      if (s.skel.state !== 'DEAD') return;
    }
    if (!this.data) return;
    this._burnPending = false;
    this._burnSpawned = true;

    // Pick a spawn cell: far from the player, on a walkable room cell.
    const cs = this.data.cellSize;
    const gs = this.data.gridSize;
    const grid = this.data.grid;
    const pcx = Math.floor(player.x / cs);
    const pcz = Math.floor(player.z / cs);
    let best = null, bestD = -1;
    for (let z = 0; z < gs; z++) {
      for (let x = 0; x < gs; x++) {
        if (grid[z][x] === 'empty') continue;
        const d2 = (x - pcx) ** 2 + (z - pcz) ** 2;
        if (d2 > bestD) { bestD = d2; best = { x, z }; }
      }
    }
    if (!best) return;
    const wx = best.x * cs + cs / 2;
    const wz = best.z * cs + cs / 2;

    const burn = new Burning(this.scene);
    burn.group.position.set(wx, 0, wz);
    this._ground(burn.group);
    burn.onKill = () => this._onKill(burn);
    burn.onDeathComplete = () => this._removeSkeleton(burn);
    // Boss-tier HP: BURN.BOSS_HP_MULT x base, then NG+ scaling on top.
    burn.hp = Math.ceil(BURN.HP * BURN.BOSS_HP_MULT * enemyHpMultiplier(this.state.ngPlus));
    burn.maxHp = burn.hp;
    this.skeletons.push({
      skel: burn, x: wx, z: wz,
      cellX: best.x, cellZ: best.z, nextThink: 0, type: 'BURN', elite: false, magician: false,
    });
    this.onBurnSpawned?.();
  }

  // Line-of-sight raycast with a 3-unit cell cache. Called up to 3× per frame
  // per mob — the cell key (player + mob position quantized) only changes as
  // they move across cells, so most frames hit the cache instead of re-walking
  // the collision boxes (perf plan §6).
  _hasLOS(skel, player, collisionBoxes) {
    const pcx = Math.floor(player.x / 3);
    const pcz = Math.floor(player.z / 3);
    const scx = Math.floor(skel.group.position.x / 3);
    const scz = Math.floor(skel.group.position.z / 3);
    if (skel._losCellX === pcx && skel._losCellZ === pcz
      && skel._losScx === scx && skel._losScz === scz
      && skel._losVal !== undefined) {
      return skel._losVal;
    }
    skel._losCellX = pcx;
    skel._losCellZ = pcz;
    skel._losScx = scx;
    skel._losScz = scz;
    const val = this._losRaycast(skel, player, collisionBoxes);
    skel._losVal = val;
    return val;
  }

  _losRaycast(skel, player, collisionBoxes) {
    const x0 = skel.group.position.x;
    const z0 = skel.group.position.z;
    const x1 = player.x;
    const z1 = player.z;
    const d = Math.hypot(x1 - x0, z1 - z0);
    const step = 0.4;
    const steps = Math.max(1, Math.floor(d / step));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      if (circleHitsBox(collisionBoxes, px, pz, 0.25)) return false;
    }
    return true;
  }

  // Move a mob in a direction in sub-steps, resolving collisions after each
  // sliver so a high speed (level + boss-kill scaling, BRIGHT flee) can never
  // tunnel it through a wall.
  _substepMove(s, moveX, moveZ, speed, collisionBoxes) {
    const maxStep = 0.08; // well under corridor/wall thickness
    let remaining = speed;
    while (remaining > 1e-6) {
      const step = Math.min(maxStep, remaining);
      s.x += moveX * step;
      s.z += moveZ * step;
      resolveCircleCollisions(collisionBoxes, s, 0.35);
      remaining -= step;
    }
  }

  _greedyStep(s, player, collisionBoxes) {
    if (performance.now() < s.nextThink) return null;
    s.nextThink = performance.now() + 300;
    const cs = this.data.cellSize;
    const gs = this.data.gridSize;
    const grid = this.data.grid;
    const cx = Math.floor(s.x / cs);
    const cz = Math.floor(s.z / cs);
    const pcx = Math.floor(player.x / cs);
    const pcz = Math.floor(player.z / cs);

    let best = null;
    let bestD = Infinity;
    const cellCenter = (x, z) => ({ x: x * cs + cs / 2, z: z * cs + cs / 2 });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= gs || nz >= gs) continue;
      if (grid[nz][nx] === 'empty') continue;
      const d = (nx - pcx) ** 2 + (nz - pcz) ** 2;
      if (d < bestD) {
        const c = cellCenter(nx, nz);
        if (!circleHitsBox(collisionBoxes, c.x, c.z, 0.35)) {
          bestD = d;
          best = c;
        }
      }
    }
    if (!best) return null;
    const dx = best.x - s.x;
    const dz = best.z - s.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return null;
    return { x: dx / len, z: dz / len };
  }

  // Unified damage entry — kept for Game/OrbShooter compatibility
  hitSkeleton(skel, damage) {
    const record = this.skeletons.find((s) => s.skel === skel);
    const died = skel.hit(damage);
    if (died && record) {
      // hit() already fired onKill -> onKill -> drop
    }
    return died;
  }

  _removeSkeleton(skel) {
    const idx = this.skeletons.findIndex((s) => s.skel === skel);
    if (idx !== -1) this.skeletons.splice(idx, 1);
    skel.dispose();
  }

  dispose() {
    this._spawnQueue = [];
    this._spawnTimer = 0;
    for (const s of [...this.skeletons]) {
      s.skel.dispose();
    }
    this.skeletons = [];
    for (const orb of this.enemyOrbs) {
      orb.mesh.geometry.dispose();
      this.scene.remove(orb.mesh);
      this.scene.remove(orb.glow);
    }
    for (const a of this.arrows) {
      a.mesh.geometry.dispose();
      this.scene.remove(a.mesh);
      if (a.glow) this.scene.remove(a.glow);
    }
    for (const orb of this.spectralOrbs) {
      orb.mesh.geometry.dispose();
      this.scene.remove(orb.mesh);
      this.scene.remove(orb.glow);
    }
    if (this._orbMeshMat) this._orbMeshMat.dispose();
    if (this._orbGlowMat) this._orbGlowMat.dispose();
    if (this._orbTex) this._orbTex.dispose();
    if (this._arrowGeo) this._arrowGeo.dispose();
    if (this._arrowMat) this._arrowMat.dispose();
    if (this._arrowGlowMat) this._arrowGlowMat.dispose();
    if (this._specOrbMat) this._specOrbMat.dispose();
    if (this._specGlowMat) this._specGlowMat.dispose();
    if (this._shockGeo) {
      this._shockGeo.dispose();
      this._shockMat.dispose();
      for (const s of this._shocks) this.scene.remove(s.mesh);
    }
    this.enemyOrbs = [];
    this.arrows = [];
    this._shocks = [];
  }
}

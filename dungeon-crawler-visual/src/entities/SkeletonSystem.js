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
  ROOM_ENEMY_MODIFIERS, ARCHER, BRUTE, BOSS, WRAITH, BUFF, BURN,
  orbPowerMultiplier, enemyHpMultiplier, excessOrbs,
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
  }

  _initProjectilePools() {
    // Magician red orbs (existing)
    const orbGeo = new THREE.SphereGeometry(0.16, 10, 8);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0xff3322, emissive: 0xff3322, emissiveIntensity: 2.5,
      roughness: 0.15, metalness: 0.4,
    });
    const glowTex = generateGlowTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, color: 0xff4433,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8,
    });
    this._orbTex = glowTex;
    this._orbMeshMat = orbMat;
    this._orbGlowMat = glowMat;
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(orbGeo, orbMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(1.4);
      mesh.visible = false;
      glow.visible = false;
      this.scene.add(mesh);
      this.scene.add(glow);
      this.enemyOrbs.push({ mesh, glow, dirX: 0, dirZ: 0, life: 0, active: false });
    }

    // Archer bone arrows (pool of 10)
    const arrowGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6);
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xd8d0c0, roughness: 0.6, metalness: 0.1,
    });
    this._arrowGeo = arrowGeo;
    this._arrowMat = arrowMat;
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(arrowGeo, arrowMat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.arrows.push({ mesh, dirX: 0, dirZ: 0, life: 0, active: false });
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
    this.speedMult = 1 + 0.05 * (state.level - 1);
    const attackMult = 1 + 0.05 * Math.floor((state.level - 1) / 3);

    // New Game+: +10% enemy HP per NG+ cycle
    const hpMult = enemyHpMultiplier(state.ngPlus);
    const scaleHp = (skel) => {
      skel.hp = Math.ceil(skel.hp * hpMult);
      skel.maxHp = skel.hp;
    };

    // Spawn rate scales with the SAME multiplier as the sword size bonus:
    // +20% per 10 orbs held (capped at 3x). Banked ammo = more enemies =
    // more drops. Hard-capped at MAX_ALIVE so the live-bodies budget holds.
    const spawnMult = orbPowerMultiplier(state.collectedOrbs)
      + excessOrbs(state.collectedOrbs) / BUFF.SPAWN_EXCESS_PER;
    let slots = Math.min(
      Math.round((ENEMY.BASE_SLOTS + (state.level - 1) * ENEMY.SLOTS_PER_LEVEL) * spawnMult),
      ENEMY.MAX_ALIVE,
    );
    const inArena = dungeonData.rooms.some((r) => r.type === 'ARENA');
    if (inArena) slots += ENEMY.ARENA_EXTRA_SLOTS;

    const cs = dungeonData.cellSize;
    const ex = state.entranceCell.x * cs + cs / 2;
    const ez = state.entranceCell.z * cs + cs / 2;

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
          const rat = new Rat(this.scene, { attackMult });
          const ox = (Math.random() - 0.5) * 2;
          const oz = (Math.random() - 0.5) * 2;
          rat.group.position.set(sx + ox, 0, sz + oz);
          this._ground(rat.group);
          rat.onKill = () => this._onKill(rat);
          rat.onDeathComplete = () => this._removeSkeleton(rat);
          scaleHp(rat); // NG+ HP
          this.skeletons.push({
            skel: rat, x: sx + ox, z: sz + oz,
            cellX: x, cellZ: z, nextThink: 0, type: 'RAT', elite: false, magician: false,
          });
          ratCount++;
        }
        continue;
      }

      // Elite roll: 1-in-10 for elite-eligible types (Armored, Archer, Brute, Wraith)
      const elite = ['ARMORED', 'ARCHER', 'BRUTE', 'WRAITH'].includes(type)
        && Math.random() < ENEMY.ELITE_CHANCE;
      // ARENA guarantees an elite on its first spawn roll
      const arenaElite = inArena && this.skeletons.length === 0
        && ['ARMORED', 'ARCHER', 'BRUTE', 'WRAITH'].includes(type);
      const isElite = elite || arenaElite;

      let skel;
      switch (type) {
        case 'ARMORED': skel = new ArmoredSkeleton(this.scene, { attackMult, elite: isElite }); break;
        case 'ARCHER': skel = new ArcherSkeleton(this.scene, { attackMult, elite: isElite }); break;
        case 'BRUTE': skel = new Brute(this.scene, { attackMult, elite: isElite }); break;
        case 'WRAITH': skel = new Wraith(this.scene, { attackMult, elite: isElite }); break;
        default: {
          const magician = type === 'MAGICIAN';
          skel = new Skeleton(this.scene, { isMagician: magician, active: true, attackMult });
          skel.magician = magician;
        }
      }
      skel.group.position.set(sx, 0, sz);
      this._ground(skel.group);
      skel.onAttackHit = () => this._onAttackHit(skel, type);
      skel.onDeathComplete = () => this._removeSkeleton(skel);
      skel.onKill = () => this._onKill(skel);
      skel.facingYaw = Math.atan2(ex - sx, ez - sz);
      skel.group.rotation.y = skel.facingYaw;
      scaleHp(skel); // NG+ HP
      this.skeletons.push({
        skel, x: sx, z: sz,
        cellX: x, cellZ: z, nextThink: 0, type, elite: isElite, magician: type === 'MAGICIAN',
      });
    }

    // Random mysterious burning enemy, at most one per level
    if (candidates.length && Math.random() < BURN.CHANCE) {
      const c = candidates[Math.floor(Math.random() * candidates.length)];
      const burn = new Burning(this.scene);
      const sx = c.x * cs + cs / 2;
      const sz = c.z * cs + cs / 2;
      burn.group.position.set(sx, 0, sz);
      this._ground(burn.group);
      burn.onKill = () => this._onKill(burn);
      burn.onDeathComplete = () => this._removeSkeleton(burn);
      scaleHp(burn); // NG+ HP
      this.skeletons.push({
        skel: burn, x: sx, z: sz, cellX: c.x, cellZ: c.z,
        nextThink: 0, type: 'BURN', elite: false, magician: false,
      });
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
    const baseHp = 4; // base enemy HP; boss = 15x this
    const boss = new GhostBoss(this.scene, baseHp, variant);
    boss.group.position.set(bx, 0, bz);
    this._ground(boss.group);
    boss.onSummon = () => this._summonMinions(boss, candidates, dungeonData, state);
    boss.onChargeHit = () => this._damagePlayer(BOSS.CHARGE_DMG);
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
    else this._tryDamagePlayer(skel);
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
    for (const s of this.skeletons) {
      const skel = s.skel;
      if (skel.state === 'DEAD') {
        skel.update(dt, time);
        continue;
      }
      const dx = player.x - s.x;
      const dz = player.z - s.z;
      const dist = Math.hypot(dx, dz);

      // --- Ghost boss: self-contained AI (charge + summon) ---
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
          s.x += (bdx / bd) * bspd;
          s.z += (bdz / bd) * bspd;
          resolveCircleCollisions(collisionBoxes, s, 0.35);
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
          s.x -= (dx / dist) * speed;
          s.z -= (dz / dist) * speed;
          resolveCircleCollisions(collisionBoxes, s, 0.35);
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
          s.x += moveX * speed;
          s.z += moveZ * speed;
        } else if (dist > ARCHER.PREF_DIST && this._hasLOS(skel, player, collisionBoxes)) {
          moveX = dx / dist; moveZ = dz / dist;
          const speed = ARCHER.SPEED * this.speedMult * dt;
          s.x += moveX * speed;
          s.z += moveZ * speed;
        } else if (!this._hasLOS(skel, player, collisionBoxes)) {
          const dir = this._greedyStep(s, player, collisionBoxes);
          if (dir) {
            moveX = dir.x; moveZ = dir.z;
            const speed = ARCHER.SPEED * this.speedMult * dt;
            s.x += moveX * speed;
            s.z += moveZ * speed;
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
          s.x += (dx / dist) * speed;
          s.z += (dz / dist) * speed;
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
          s.x += moveX * speed;
          s.z += moveZ * speed;
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
          s.x += moveX * speed;
          s.z += moveZ * speed;
          resolveCircleCollisions(collisionBoxes, s, 0.35);
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

    // Archer arrows
    for (const a of this.arrows) {
      if (!a.active) continue;
      a.mesh.position.x += a.dirX * ARCHER.ARROW_SPEED * dt;
      a.mesh.position.z += a.dirZ * ARCHER.ARROW_SPEED * dt;
      a.mesh.rotation.x = Math.atan2(0.02, ARCHER.ARROW_SPEED * dt) + Math.PI / 2;
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
      a.mesh.position.set(sx, 1.5, sz);
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

  _hasLOS(skel, player, collisionBoxes) {
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
    }
    if (this._orbMeshMat) this._orbMeshMat.dispose();
    if (this._orbGlowMat) this._orbGlowMat.dispose();
    if (this._orbTex) this._orbTex.dispose();
    if (this._arrowGeo) this._arrowGeo.dispose();
    if (this._arrowMat) this._arrowMat.dispose();
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

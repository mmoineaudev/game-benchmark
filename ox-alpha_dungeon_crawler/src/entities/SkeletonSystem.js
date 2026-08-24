// SkeletonSystem.js — enemy spawner + AI driver (§16): spawn plan/queue, reveal pacing,
// per-type behaviors, LOS/pathing, projectiles, brute shockwave, boss hookup, BURN, dispose
import * as THREE from 'three';
import Skeleton from './Skeleton.js';
import GhostBoss from './enemies/GhostBoss.js';
import {
  ENEMY_TYPES, ENEMY_SPAWN_WEIGHTS, ENEMY_SPAWN, ELITE_CHANCE,
  ROOM_ENEMY_MODIFIERS, RAT, BOSS, burnHp, bossHp, enemyHpMultiplier,
  SPEED_PER_LEVEL, ATTACK_PER_3_LEVELS, BOSS_KILL_BUFF
} from '../core/Constants.js';
import { circleHitsBox, resolveCircleCollisions } from '../core/Collision.js';

export default class SkeletonSystem {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];        // live mobs (Skeleton instances)
    this.boss = null;
    this.minions = [];        // summoned wraiths
    this.queue = [];          // spawn plan entries {cell, typeKey, elite}
    this.revealTimer = 0;
    this.projectiles = { arrows: [], orbs: [] }; // pooled
    this.shockwaves = [];
    this.smokeClouds = [];    // boss smoke
    this.firePatches = [];    // visual-only pool of 6
    this.onKill = null; this.onPlayerDamaged = null; this.onBurn = null;
    this.blinkTelegraphFx = [];
    // pools
    for (let i = 0; i < 10; i++) this.projectiles.arrows.push(this._makeProjectile(0x9a7a3a, 0.15));
    for (let i = 0; i < 12; i++) this.projectiles.orbs.push(this._makeProjectile(0xff4444, 0.3));
    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 6, 24),
        new THREE.MeshBasicMaterial({ color: 0xccaa66, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      this.shockwaves.push({ mesh: ring, t: -1 });
    }
    for (let i = 0; i < 12; i++) {
      const spark = new THREE.Mesh(new THREE.SphereGeometry(0.08),
        new THREE.MeshBasicMaterial({ color: 0xaa88ff }));
      spark.visible = false;
      scene.add(spark);
      this.blinkTelegraphFx.push(spark);
    }
    for (let i = 0; i < 6; i++) {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.5 + Math.random() * 0.3, 10),
        new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.y = 0.04;
      patch.visible = false;
      scene.add(patch);
      this.firePatches.push({ mesh: patch, t: -1 });
    }
    this._patchIdx = 0;
  }

  _makeProjectile(color, radius) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6),
      new THREE.MeshBasicMaterial({ color }));
    // additive glow halo so projectiles are visible at distance / in dark corridors
    if (!SkeletonSystem._glowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      SkeletonSystem._glowTex = new THREE.CanvasTexture(c);
    }
    const glowMat = new THREE.SpriteMaterial({
      map: SkeletonSystem._glowTex, color,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(radius * 8, radius * 8, 1);
    m.add(glow);
    m.visible = false;
    this.scene.add(m);
    return { mesh: m, vel: new THREE.Vector3(), life: -1, dmg: 1 };
  }

  // ---- spawn plan (§16.1) ----
  buildSpawnPlan(level, souls, dungeon, biomeId, playerStart, hasArena) {
    const spawnMult = Math.min(1 + (level + souls) / 10, ENEMY_SPAWN.SPAWN_CAP);
    let slots = Math.min(Math.round((2 + (level - 1)) * spawnMult), ENEMY_SPAWN.MAX_ALIVE);
    if (hasArena) slots += 2;
    // candidate cells: BFS distance ≥ 6 from entrance, excluding exit room
    const cells = this._candidateCells(dungeon);
    if (!cells.length) return;
    const shuffled = cells.slice().sort(() => Math.random() - 0.5);
    let arenaUsed = false;
    for (let i = 0; i < slots; i++) {
      const cell = shuffled[i % shuffled.length];
      const roomMeta = dungeon.metadata[cell.z][cell.x];
      let typeKey = this._pickType(biomeId, roomMeta.roomType);
      if (!typeKey) continue;
      const elite = typeKey !== 'RAT' && Math.random() < ELITE_CHANCE &&
        ENEMY_TYPES[typeKey].eliteEligible;
      this.queue.push({ cell, typeKey, elite, firstOfArena: hasArena && !arenaUsed && i === 0 });
      if (hasArena && i === 0) arenaUsed = true;
    }
    this.revealTimer = 0;
  }

  _candidateCells(dungeon) {
    // BFS from entrance over non-empty cells
    const { grid, gridSize } = dungeon;
    const dist = Array.from({ length: gridSize }, () => new Array(gridSize).fill(-1));
    const q = [dungeon.entranceCell];
    dist[dungeon.entranceCell.z][dungeon.entranceCell.x] = 0;
    while (q.length) {
      const c = q.shift();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx, nz = c.z + dz;
        if (nx < 0 || nz < 0 || nx >= gridSize || nz >= gridSize) continue;
        if (grid[nz][nx] === 'empty' || dist[nz][nx] >= 0) continue;
        dist[nz][nx] = dist[c.z][c.x] + 1;
        q.push({ x: nx, z: nz });
      }
    }
    // exclude the exit room's cells
    const exitRoom = dungeon.exitRoom;
    const out = [];
    for (let z = 0; z < gridSize; z++) for (let x = 0; x < gridSize; x++) {
      if (dist[z][x] < ENEMY_SPAWN.BFS_MIN_FROM_ENTRANCE) continue;
      if (exitRoom && x >= exitRoom.cx && x < exitRoom.cx + exitRoom.w && z >= exitRoom.cz && z < exitRoom.cz + exitRoom.h) continue;
      out.push({ x, z });
    }
    return out;
  }

  _pickType(biomeId, roomType) {
    const weights = { ...ENEMY_SPAWN_WEIGHTS[biomeId] };
    const mods = ROOM_ENEMY_MODIFIERS[roomType];
    if (mods) for (const k in mods) weights[k] = (weights[k] ?? 0) * mods[k];
    let total = 0;
    for (const k in weights) total += Math.max(0, weights[k]);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const k in weights) { r -= Math.max(0, weights[k]); if (r <= 0 && weights[k] > 0) return k; }
    return 'SKELETON';
  }

  drainQueue(dt, playerPos, level, ngPlus, souls, bossKills, isTitleOrSafe) {
    // reveal one mob every SPAWN_INTERVAL; queued spawns within 30 m rotate to back
    this.revealTimer -= dt;
    while (this.revealTimer <= 0 && this.queue.length) {
      const entry = this.queue.shift();
      const cellPos = { x: entry.cell.x * 6, z: entry.cell.z * 6 };
      const dpx = cellPos.x - playerPos.x, dpz = cellPos.z - playerPos.z;
      if (dpx * dpx + dpz * dpz < ENEMY_SPAWN.DEFER_PLAYER_DIST ** 2) {
        this.queue.push(entry); // rotate to back
        if (this.queue.every(e => e === entry)) break; // all too close
        continue;
      }
      this.revealTimer += ENEMY_SPAWN.SPAWN_INTERVAL;
      if (entry.typeKey === 'RAT') {
        // pack of 2–3 at one cell, clamped to rat cap 6 and live-body cap
        const n = RAT.PACK_MIN + Math.floor(Math.random() * (RAT.PACK_MAX - RAT.PACK_MIN + 1));
        const ratsAlive = this.enemies.filter(e => e.type === 'RAT' && e.state !== 'DEAD').length;
        const allowed = Math.max(0, Math.min(RAT.CAP - ratsAlive, ENEMY_SPAWN.MAX_ALIVE - this._liveCount()));
        for (let k = 0; k < Math.min(n, allowed); k++) this._spawnOne(entry, level, ngPlus, souls, bossKills, k * 0.8);
      } else {
        this._spawnOne(entry, level, ngPlus, souls, bossKills, 0);
      }
    }
  }

  _liveCount() { return this.enemies.filter(e => e.state !== 'DEAD').length + this.minions.length; }

  _spawnOne(entry, level, ngPlus, souls, bossKills, jitter) {
    const def = ENEMY_TYPES[entry.typeKey];
    const hpMult = enemyHpMultiplier(ngPlus, level, souls);
    let hp = Math.ceil(def.hp * hpMult);
    let drops = def.drops;
    let elite = null;
    let speedOverride = null;
    if ((entry.elite || entry.firstOfArena && def.eliteEligible)) {
      elite = def.elite;
      if (elite) { hp = Math.ceil(elite.hp * hpMult); drops = elite.drops; speedOverride = def.speed * elite.speedMult; }
    }
    const speedMult = (1 + SPEED_PER_LEVEL * (level - 1)) * (1 + BOSS_KILL_BUFF * bossKills);
    const sk = new Skeleton(def, entry.typeKey, { hp, drops, elite, speedMult, speedOverride });
    const jx = (Math.random() - .5) * 3, jz = (Math.random() - .5) * 3;
    sk.pos.set(entry.cell.x * 6 + jx, 0, entry.cell.z * 6 + jz);
    sk.group.position.copy(sk.pos);
    sk.ground();
    this.scene.add(sk.group);
    this.enemies.push(sk);
  }

  // ---- boss hookup ----
  spawnBoss(dungeon, level, ngPlus, souls, maxHealth, onSummon, onBlinkHit, onSmokeTick) {
    const variant = ['Skeleton', 'Armored', 'Archer', 'Brute', 'Wraith', 'Rat', 'Magician'][
      (level / BOSS.INTERVAL - 1) % 7];
    const hp = bossHp(level, ngPlus, souls, maxHealth);
    this.boss = new GhostBoss({ hp, variant });
    const c = dungeon.exitCell;
    this.boss.pos.set(c.x * 6, 0, c.z * 6);
    this.boss.group.position.copy(this.boss.pos);
    this.scene.add(this.boss.group);
    this.onSummon = onSummon;
    this.onBlinkHit = onBlinkHit;
    this.onSmokeTick = onSmokeTick;
    this.boss.chargeFirstDone = false;
  }

  summonMinion(cell, level, ngPlus, souls, bossKills) {
    if (this.minions.length >= BOSS.MAX_MINIONS) return;
    const def = ENEMY_TYPES.WRAITH;
    const hpMult = enemyHpMultiplier(ngPlus, Math.max(1, level), souls);
    const sk = new Skeleton(def, 'WRAITH', { hp: Math.ceil(def.hp * hpMult), drops: 0, rangedOverride: true });
    sk.rangedFiring = true; // projectile-firing wraiths
    sk.pos.set(cell.x * 6 + (Math.random() - .5) * 3, 0, cell.z * 6 + (Math.random() - .5) * 3);
    sk.group.position.copy(sk.pos);
    this.scene.add(sk.group);
    this.enemies.push(sk);
    this.minions.push(sk);
  }

  spawnBURN(dungeon, playerPos, ngPlus) {
    // walkable cell farthest from the player
    let best = null, bestD = -1;
    for (let z = 0; z < dungeon.gridSize; z++) for (let x = 0; x < dungeon.gridSize; x++) {
      if (dungeon.grid[z][x] === 'empty') continue;
      const d = (x * 6 - playerPos.x) ** 2 + (z * 6 - playerPos.z) ** 2;
      if (d > bestD) { bestD = d; best = { x, z }; }
    }
    if (!best) return;
    const def = {
      ...ENEMY_TYPES.WRAITH,
      phases: false, instantAttack: false, drops: 2,
      // melee cycle (spec §18: cooldown 1.4s) — without this _tickAttack throws
      cycle: { windup: 0.4, swing: 0.25, recover: 0.35, cooldown: 1.4 },
      eliteEligible: false, elite: undefined
    };
    const hp = burnHp(ngPlus);
    const sk = new Skeleton(def, 'BURN', { hp, drops: 2, speedMult: 1, speedOverride: 2.6 });
    sk.isBURN = true;
    sk.range = 1.3; sk.speed = 2.6; sk.dmg = 1;
    sk.pos.set(best.x * 6, 0, best.z * 6);
    sk.group.position.copy(sk.pos);
    sk.ground();
    this.scene.add(sk.group);
    this.enemies.push(sk);
    this.onBurn?.();
  }

  firePatch(x, z) {
    const p = this.firePatches[this._patchIdx];
    this._patchIdx = (this._patchIdx + 1) % this.firePatches.length;
    p.t = 0;
    p.mesh.visible = true;
    p.mesh.position.set(x, 0.04, z);
  }

  updateFirePatches(dt) {
    for (const p of this.firePatches) {
      if (p.t < 0) continue;
      p.t += dt;
      const grow = Math.min(1, p.t / 0.3);
      p.mesh.scale.setScalar(grow);
      if (p.t > 9) p.mesh.material.opacity = Math.max(0, (10 - p.t));
      else p.mesh.material.opacity = 0.5;
      if (p.t >= 10) { p.t = -1; p.mesh.visible = false; }
    }
  }

  // ---- AI update ----
  update(dt, ctx) {
    // ctx: {playerPos, collisionBoxes, losFn, pathStepFn, invuln, safeSpawn, brightActive, damageMult...}
    const P = ctx.playerPos;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.state === 'DEAD') {
        if (e.updateDeath(dt)) {
          e.dispose(this.scene);
          this.enemies.splice(i, 1);
          const mi = this.minions.indexOf(e);
          if (mi >= 0) this.minions.splice(mi, 1);
        }
        continue;
      }
      // far-frozen bodies are immobile
      const distP = Math.hypot(P.x - e.pos.x, P.z - e.pos.z);
      e.frozen = distP > ENEMY_SPAWN.FROZEN_DIST || ctx.frozenAll;
      if (e.wakeTimer > 0) { e.wakeTimer -= dt; e.updatePose(dt, false); continue; }
      if (e.frozen) { e.updatePose(dt, false); continue; }

      if (e.cooldown > 0) e.cooldown -= dt;

      const seesLOS = e.def.phases ? true : ctx.losFn(e.pos.x, e.pos.z, P.x, P.z);
      const inRange = distP < e.def.range;

      // flee under BRIGHT
      if (ctx.brightActive) {
        this._moveToward(e, e.pos.x + (e.pos.x - P.x), e.pos.z + (e.pos.z - P.z), ctx, 1);
        e.updatePose(dt, true);
        continue;
      }

      if (e.def.instantAttack) {
        // rat / wraith style: straight chase, touch-range attack with cooldown
        this._chaseMove(e, P, ctx, seesLOS);
        if (inRange && e.cooldown <= 0 && !ctx.safeSpawn) {
          this._damagePlayer(e.dmg, e);
          e.cooldown = e.def.attackCooldown;
        }
      } else if (e.def.ranged) {
        // archer kite / magician cast positioning
        const stopAt = e.def.stopFrac ? e.def.range * e.def.stopFrac : e.def.kiteStop ?? 8;
        if (distP > stopAt || !seesLOS) this._chaseMove(e, P, ctx, seesLOS);
        else if (e.def.kiteStop && distP < e.def.retreatUnder) {
          this._moveToward(e, e.pos.x + (e.pos.x - P.x), e.pos.z + (e.pos.z - P.z), ctx, e.def.retreatSpeed / e.speed);
        }
        if (distP <= e.def.range && seesLOS && e.cooldown <= 0 && e.state !== 'ATTACK' && !ctx.safeSpawn) {
          e.startAttack();
        }
        if (e.state === 'ATTACK') this._tickAttack(e, dt, ctx, () => this._fireRanged(e, P, ctx));
      } else {
        // melee cycle
        if (inRange && e.cooldown <= 0 && e.state !== 'ATTACK' && !ctx.safeSpawn) e.startAttack();
        else if (!inRange) this._chaseMove(e, P, ctx, seesLOS);
        if (e.state === 'ATTACK') this._tickAttack(e, dt, ctx, () => {
          // melee hit lands at swing progress ≥ 0.35 via cone check
          const dx = P.x - e.pos.x, dz = P.z - e.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < e.def.range + 0.6) {
            if (e.def.coneRad) {
              const ang = Math.atan2(dx, dz);
              const face = e.group.rotation.y;
              let diff = Math.abs(ang - face); if (diff > Math.PI) diff = Math.PI * 2 - diff;
              if (diff < e.def.coneRad) this._damagePlayer(e.dmg, e);
            } else this._damagePlayer(e.dmg, e);
          }
        });
      }

      // BURN ground fire
      if (e.isBURN) {
        e.fireAcc = (e.fireAcc ?? 0) + dt;
        if (e.fireAcc >= 0.6) { e.fireAcc = 0; this.firePatch(e.pos.x, e.pos.z); }
      }

      e.updatePose(dt, distP > e.def.range);
    }

    // boss AI
    if (this.boss && this.boss.state !== 'DEAD') this._updateBoss(dt, ctx);

    // projectiles
    this._updateProjectiles(dt, ctx);

    // shockwaves
    for (const s of this.shockwaves) {
      if (s.t < 0) continue;
      s.t += dt;
      s.mesh.scale.setScalar(1 + s.t / 0.25 * 4);
      s.mesh.material.opacity = Math.max(0, 0.7 * (1 - s.t / 0.25));
      if (s.t >= 0.25) { s.t = -1; s.mesh.visible = false; }
    }

    this.updateFirePatches(dt);
  }

  _chaseMove(e, P, ctx, seesLOS) {
    if (seesLOS || e.def.phases) {
      this._moveToward(e, P.x, P.z, ctx, 1);
      e.pathTimer = 0;
    } else {
      // greedy 4-neighbor step toward the player's CELL, re-eval every 300 ms
      e.pathTimer -= ctx.dt;
      if (e.pathTimer <= 0 || !e.pathStep) {
        e.pathTimer = ENEMY_SPAWN.PATH_REEVAL;
        e.pathStep = ctx.pathStepFn(e.pos.x, e.pos.z, P.x, P.z);
      }
      if (e.pathStep) this._moveToward(e, e.pathStep.x, e.pathStep.z, ctx, 1);
    }
    e.faceTo(P.x, P.z);
  }

  // sub-stepped movement (≤0.08 u slivers) + circle collision
  _moveToward(e, tx, tz, ctx, frac) {
    const dx = tx - e.pos.x, dz = tz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    let remaining = Math.min(e.speed * frac * ctx.dt, d);
    const step = ENEMY_SPAWN.SUBSTEP;
    while (remaining > 0) {
      const s = Math.min(step, remaining);
      remaining -= s;
      e.pos.x += (dx / d) * s;
      e.pos.z += (dz / d) * s;
      if (!e.def.phases) resolveCircleCollisions(ctx.collisionBoxes(), e.pos, 0.35);
      else resolveCircleCollisions(ctx.collisionBoxes(), e.pos, 0.35); // wraith phases walls but stays in bounds visually? spec: cannot be blocked → skip
    }
    e.group.position.set(e.pos.x, e.floats ? 0.2 : 0, e.pos.z);
  }

  _tickAttack(e, dt, ctx, landFn) {
    const cycle = e.def.cycle;
    if (!cycle) { // defensive: types without a cycle use instant attacks
      e.state = 'CHASE'; e.attackPhase = null; e.cooldown = 1.0;
      return;
    }
    e.attackT += dt * (ctx.attackSpeedMult ?? 1);
    if (e.attackPhase === 'windup' && e.attackT >= cycle.windup) { e.attackPhase = 'swing'; e.attackT = 0; e._hitApplied = false; }
    else if (e.attackPhase === 'swing') {
      if (!e._hitApplied && e.attackT >= cycle.swing * 0.35) { landFn(); e._hitApplied = true; }
      if (e.def.shockwave && e._hitApplied && !e._waveDone) { this._shockwave(e); e._waveDone = true; }
      if (e.attackT >= cycle.swing) { e.attackPhase = 'recover'; e.attackT = 0; }
    } else if (e.attackPhase === 'recover' && e.attackT >= cycle.recover) {
      e.state = 'CHASE'; e.attackPhase = null; e.cooldown = cycle.cooldown; e._waveDone = false;
    }
  }

  _fireRanged(e, P, ctx) {
    const pool = e.def.ranged === 'arrow' ? this.projectiles.arrows : this.projectiles.orbs;
    const life = e.def.ranged === 'arrow' ? 3 : 4;
    const speed = e.def.ranged === 'arrow' ? 8 : 6.2;
    const fan = e.elite && e.elite.fanDeg ? [-e.elite.fanDeg, e.elite.fanDeg] : [0];
    for (const deg of fan) {
      let slot = pool.find(p => p.life < 0);
      if (!slot) return;
      const rad = Math.atan2(P.x - e.pos.x, P.z - e.pos.z) + deg * Math.PI / 180;
      slot.vel.set(Math.sin(rad) * speed, 0, Math.cos(rad) * speed);
      slot.mesh.position.set(e.pos.x, 1.3, e.pos.z);
      slot.life = life;
      slot.dmg = e.dmg;
      slot.mesh.visible = true;
    }
  }

  _updateProjectiles(dt, ctx) {
    for (const set of [this.projectiles.arrows, this.projectiles.orbs]) {
      for (const p of set) {
        if (p.life < 0) continue;
        p.life -= dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        const P = ctx.playerPos;
        const dx = P.x - p.mesh.position.x, dz = P.z - p.mesh.position.z;
        if (dx * dx + dz * dz < 0.35 ** 2) {
          this._damagePlayer(p.dmg, null);
          p.life = -1; p.mesh.visible = false;
          continue;
        }
        if (ctx.swordBreakCheck?.(p.mesh.position)) { p.life = -1; p.mesh.visible = false; continue; }
        if (p.life <= 0) { p.life = -1; p.mesh.visible = false; }
      }
    }
  }

  _shockwave(e) {
    const s = this.shockwaves.find(w => w.t < 0);
    if (!s) return;
    s.t = 0;
    s.mesh.visible = true;
    s.mesh.position.set(e.pos.x, 0.15, e.pos.z);
  }

  _damagePlayer(dmg, source) {
    this.onPlayerDamaged?.(dmg, source);
  }

  hitEnemy(e, damage, sourceKind) {
    if (!e.alive !== undefined || true) {
      e.hp -= damage;
      e.hitFlash = 0.08;
      if (e.hp <= 0 && e.state !== 'DEAD') {
        e.beginDeath();
        this.onKill?.(e, sourceKind);
      }
    }
  }

  breakProjectilesInCone(checkFn) {
    for (const set of [this.projectiles.arrows, this.projectiles.orbs])
      for (const p of set)
        if (p.life >= 0 && checkFn(p.mesh.position)) { p.life = -1; p.mesh.visible = false; }
  }

  // ---- boss AI (§17) ----
  _updateBoss(dt, ctx) {
    const b = this.boss;
    const P = ctx.playerPos;
    if (b.state === 'DEAD') return;
    if (ctx.frozenAll) { return; }

    b.chargeCooldown -= dt;
    b.blinkCooldown -= dt;
    b.smokeCooldown -= dt;
    b.summonTimer -= dt;

    const distP = Math.hypot(P.x - b.pos.x, P.z - b.pos.z);

    // drift toward the player beyond 2.5 u (pathing when wall blocks; only charges on wall-free paths)
    if (b.state === 'CHASE') {
      if (distP > BOSS.DRIFT_KEEP) {
        const seesLOS = ctx.losFn(b.pos.x, b.pos.z, P.x, P.z);
        if (seesLOS) this._moveBoss(b, P.x, P.z, ctx, BOSS.DRIFT_SPEED);
        else {
          b.pathTimer = (b.pathTimer ?? 0) - ctx.dt;
          if (b.pathTimer <= 0 || !b.pathStep) {
            b.pathTimer = ENEMY_SPAWN.PATH_REEVAL;
            b.pathStep = ctx.pathStepFn(b.pos.x, b.pos.z, P.x, P.z);
          }
          if (b.pathStep) this._moveBoss(b, b.pathStep.x, b.pathStep.z, ctx, BOSS.DRIFT_SPEED);
        }
        b.faceTo(P.x, P.z);
      }
      // charge: off cooldown, within 14 u, wall-free path
      if (b.chargeCooldown <= 0 && distP < BOSS.CHARGE_RANGE && ctx.losFn(b.pos.x, b.pos.z, P.x, P.z)) {
        b.state = 'CHARGING';
        b.chargeT = 0;
        b.chargeHitDone = false;
        b.chargeDir.set(P.x - b.pos.x, 0, P.z - b.pos.z).normalize();
        b.faceTo(P.x, P.z);
      }
    } else if (b.state === 'CHARGING') {
      b.chargeT += dt;
      // dash at 14 u/s along locked direction
      const move = Math.min(BOSS.CHARGE_SPEED * dt, 1.5);
      const steps = Math.ceil(move / ENEMY_SPAWN.SUBSTEP);
      for (let s = 0; s < steps; s++) {
        const sl = move / steps;
        b.pos.x += b.chargeDir.x * sl;
        b.pos.z += b.chargeDir.z * sl;
        resolveCircleCollisions(ctx.collisionBoxes(), b.pos, BOSS.RADIUS);
      }
      b.group.position.set(b.pos.x, 0, b.pos.z);
      if (!b.chargeHitDone && distP < BOSS.CONTACT_RADIUS) {
        this._damagePlayer(BOSS.CHARGE_DMG, b);
        b.chargeHitDone = true; // once per charge
      }
      if (b.chargeT >= BOSS.CHARGE_TIME) {
        b.state = 'CHASE';
        b.chargeCooldown = BOSS.CHARGE_COOLDOWN;
      }
    }

    // BLINK (teleport-nova)
    if (b.blinkCooldown <= 0 && b.state === 'CHASE') {
      b.blinkCooldown = BOSS.BLINK_COOLDOWN;
      // teleport ONTO the player through walls
      b.pos.set(P.x, 0, P.z);
      b.group.position.set(b.pos.x, 0, b.pos.z);
      b.state = 'BLINKING'; // frozen while charging the spell
      b.blinkT = 0;
      this._blinkSparks(b);
    } else if (b.state === 'BLINKING') {
      b.blinkT += dt;
      this._animateBlinkSparks(b, b.blinkT);
      if (b.blinkT >= BOSS.BLINK_TELEGRAPH) {
        this._hideBlinkSparks();
        this.onBlinkHit?.(b.pos.x, b.pos.z, BOSS.BLINK_RADIUS, BOSS.BLINK_DMG);
        b.state = 'CHASE';
      }
    }

    // SMOKE: fires alongside any other attack (doesn't change state)
    if (b.smokeCooldown <= 0 && b.state !== 'DEAD') {
      b.smokeCooldown = BOSS.SMOKE_COOLDOWN;
      this._launchSmoke(b, P);
    }

    // summon every 6 s: ⌊3 × 1.5^heartsExtra⌋ projectile-firing wraiths at random candidate cells
    if (b.summonTimer <= 0 && b.state !== 'DEAD') {
      b.summonTimer = BOSS.SUMMON_INTERVAL;
      const heartsExtra = Math.max(0, (ctx.playerMaxHealth ?? 3) - 3);
      const n = Math.floor(3 * Math.pow(BOSS.SUMMON_HEARTS_MULT, heartsExtra));
      for (let i = 0; i < n; i++) {
        const cell = this._candidateCellsCache?.[(Math.random() * (this._candidateCellsCache?.length || 1)) | 0]
          || { x: Math.round(b.pos.x / 6), z: Math.round(b.pos.z / 6) };
        this.summonMinion(cell, ctx.level, ctx.ngPlus, ctx.souls, ctx.bossKills);
      }
    }

    this._tickBossSmoke(dt, ctx);
  }

  _moveBoss(b, tx, tz, ctx, speed) {
    const dx = tx - b.pos.x, dz = tz - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    let remaining = Math.min(speed * ctx.dt, d);
    while (remaining > 0) {
      const s = Math.min(ENEMY_SPAWN.SUBSTEP, remaining);
      remaining -= s;
      b.pos.x += (dx / d) * s;
      b.pos.z += (dz / d) * s;
      resolveCircleCollisions(ctx.collisionBoxes(), b.pos, BOSS.RADIUS);
    }
    b.group.position.set(b.pos.x, 0, b.pos.z);
  }

  _blinkSparks(b) {
    for (let i = 0; i < 12; i++) {
      const s = this.blinkTelegraphFx[i];
      s.visible = true;
      const ang = i / 12 * Math.PI * 2;
      s.userData.ang = ang;
      s.position.set(b.pos.x + Math.cos(ang) * 0.5, 0.5, b.pos.z + Math.sin(ang) * 0.5);
    }
  }

  _animateBlinkSparks(b, t) {
    const r = 0.5 + (t / BOSS.BLINK_TELEGRAPH) * BOSS.BLINK_RADIUS;
    for (const s of this.blinkTelegraphFx) {
      if (!s.visible) continue;
      s.position.set(b.pos.x + Math.cos(s.userData.ang) * r, 0.5, b.pos.z + Math.sin(s.userData.ang) * r);
    }
  }

  _hideBlinkSparks() { for (const s of this.blinkTelegraphFx) s.visible = false; }

  _launchSmoke(b, P) {
    const cloud = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(BOSS.SMOKE_RADIUS * 0.55, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x333344, transparent: true, opacity: 0.75 }));
      puff.position.set((Math.random() - .5) * 1.5, (Math.random() - .5), (Math.random() - .5) * 1.5);
      cloud.add(puff);
    }
    cloud.position.set(b.pos.x, 1.2, b.pos.z);
    this.scene.add(cloud);
    this.smokeClouds.push({
      group: cloud, target: new THREE.Vector2(P.x, P.z), flight: BOSS.SMOKE_FLIGHT,
      linger: BOSS.SMOKE_DURATION, pos: new THREE.Vector2(b.pos.x, b.pos.z),
      start: new THREE.Vector2(b.pos.x, b.pos.z), tickAcc: 0
    });
  }

  _tickBossSmoke(dt, ctx) {
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      const c = this.smokeClouds[i];
      const P = ctx.playerPos;
      if (c.flight > 0) {
        c.flight -= dt;
        const k = 1 - Math.max(0, c.flight) / BOSS.SMOKE_FLIGHT;
        c.pos.lerpVectors(c.start, c.target, k);
        c.group.position.set(c.pos.x, 1.2, c.pos.y);
      } else if (c.linger > 0) {
        c.linger -= dt;
        c.tickAcc += dt;
        const inside = (P.x - c.pos.x) ** 2 + (P.z - c.pos.y) ** 2 < BOSS.SMOKE_RADIUS ** 2;
        if (inside && c.tickAcc >= 1) { c.tickAcc = 0; this.onSmokeTick?.(BOSS.SMOKE_DMG); }
        if (c.linger <= 0) {
          this.scene.remove(c.group);
          c.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
          this.smokeClouds.splice(i, 1);
        }
      }
    }
  }

  clearMinions() {
    for (const m of this.minions.slice()) {
      m.beginDeath();
    }
    this.minions = [];
  }

  dispose(scene) {
    for (const e of this.enemies) e.dispose(scene);
    if (this.boss) { this.boss.dispose(scene); this.boss = null; }
    this.enemies = []; this.minions = []; this.queue = [];
    for (const set of [this.projectiles.arrows, this.projectiles.orbs])
      for (const p of set) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    for (const s of this.shockwaves) { scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    for (const s of this.blinkTelegraphFx) scene.remove(s);
    for (const p of this.firePatches) { scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    for (const c of this.smokeClouds) { scene.remove(c.group); }
    this.smokeClouds = [];
    this.projectiles = { arrows: [], orbs: [] };
  }
}

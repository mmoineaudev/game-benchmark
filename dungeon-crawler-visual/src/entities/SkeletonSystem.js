import * as THREE from 'three';
import { Skeleton } from './Skeleton.js';
import { SKELETON, PLAYER } from '../core/Constants.js';
import { resolveCircleCollisions, circleHitsBox } from '../core/Collision.js';

export class SkeletonSystem {
  constructor(scene, state) {
    this.scene = scene;
    this.state = state;
    this.skeletons = []; // { skel, x, z, cellX, cellZ, nextThink, active }
    this.onWake = null;
    this.onKill = null;
    this.onPlayerDamaged = null;
    this.onPlayerDeath = null;
  }

  init(dungeonData, state) {
    this.data = dungeonData;
    this.state = state;
    const gs = dungeonData.gridSize;

    // BFS from entrance to find cells far enough away for spawns
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
        if (dist[z][x] < SKELETON.MIN_SPAWN_DIST) continue;
        candidates.push({ x, z });
      }
    }

    // Shuffle
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const count = Math.min(
      SKELETON.BASE_COUNT + (state.level - 1) * SKELETON.COUNT_PER_LEVEL,
      SKELETON.MAX_COUNT,
    );

    const cs = dungeonData.cellSize;
    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      const { x, z } = candidates[i];
      const skel = new Skeleton(this.scene);
      skel.group.position.set(x * cs + cs / 2, 0, z * cs + cs / 2);
      skel.onAttackHit = () => this._tryDamagePlayer(skel);
      skel.onDeathComplete = () => this._removeSkeleton(skel);
      this.skeletons.push({
        skel, x: skel.group.position.x, z: skel.group.position.z,
        cellX: x, cellZ: z, nextThink: 0, active: false,
      });
    }
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

      // Wake when player gets close
      if (skel.state === 'DORMANT') {
        if (dist < SKELETON.WAKE_RADIUS) {
          skel.state = 'WAKING';
          skel.animTime = 0;
          this.onWake?.(s.x, s.z);
        } else {
          skel.update(dt, time);
          continue;
        }
      }

      // Attack cycle (from CHASE or WAKING)
      if (skel.state === 'CHASE' && dist <= SKELETON.ATTACK_RANGE
        && skel.attackCooldown <= 0 && this._hasLOS(skel, player, collisionBoxes)) {
        skel.state = 'ATTACK';
        skel.animTime = 0;
        skel.attackHitDone = false;
      }

      if (skel.state === 'ATTACK') {
        skel.update(dt, time);
        continue;
      }

      // Movement: chase or greedy grid pathing (only while fully awake)
      if (skel.state === 'CHASE') {
        let moveX = 0, moveZ = 0;
        const los = this._hasLOS(skel, player, collisionBoxes);
        if (los && dist > SKELETON.ATTACK_RANGE) {
          moveX = dx / dist;
          moveZ = dz / dist;
        } else if (!los) {
          const dir = this._greedyStep(s, player, collisionBoxes);
          if (dir) { moveX = dir.x; moveZ = dir.z; }
        }

        if (moveX !== 0 || moveZ !== 0) {
          const speed = SKELETON.CHASE_SPEED * dt;
          s.x += moveX * speed;
          s.z += moveZ * speed;
          // Wall collision (same push-out as player)
          resolveCircleCollisions(collisionBoxes, s, 0.35);
          skel.group.position.set(s.x, 0, s.z);
          skel.setFacing(Math.atan2(moveX, moveZ));
          skel.group.rotation.y = THREE.MathUtils.damp(
            skel.group.rotation.y, skel.facingYaw, 8, dt,
          );
        }
      }

      skel.update(dt, time);
    }
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
    // Re-evaluate every 0.3s; pick the walkable 4-neighbor cell closest to the player
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

  _tryDamagePlayer(skel) {
    const p = this.state.player;
    const dx = p.x - skel.group.position.x;
    const dz = p.z - skel.group.position.z;
    if (Math.hypot(dx, dz) > SKELETON.ATTACK_RANGE + 0.4) return;
    if (this.state.invulnTimer > 0 || this.state.health <= 0) return;

    this.state.health -= SKELETON.ATTACK_DAMAGE;
    this.state.invulnTimer = PLAYER.INVULN_TIME;
    this.onPlayerDamaged?.();
    if (this.state.health <= 0) {
      this.onPlayerDeath?.();
    }
  }

  hitSkeleton(skel, damage) {
    if (skel.state === 'DEAD') return;
    skel.hp -= damage;
    if (skel.hp <= 0) {
      skel.state = 'DEAD';
      skel.animTime = 0;
      skel.attackHitDone = true;
      this.onKill?.(skel.group.position.x, skel.group.position.z);
    }
  }

  _removeSkeleton(skel) {
    const idx = this.skeletons.findIndex(s => s.skel === skel);
    if (idx !== -1) this.skeletons.splice(idx, 1);
    skel.dispose();
  }

  dispose() {
    for (const s of [...this.skeletons]) {
      s.skel.dispose();
    }
    this.skeletons = [];
  }
}

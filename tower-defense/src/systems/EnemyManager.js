import * as THREE from 'three';
import { ENEMY_DEFS, COLORS, GRID_COLS, GRID_ROWS, BUDGET, HP_WAVE_SCALE, START_TILE, END_TILE } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';
import ModelFactory from './ModelFactory.js';

export default class EnemyManager {
  constructor(scene, audio, stateObj) {
    this.scene = scene; this.audio = audio;
    this._gs = stateObj;
    this.state = stateObj.state;
    this.enemies = [];
    this._dying = [];    // death-dissolve queue
    this._spawnFX = [];  // spawn burst rings
    this._nextId = 0; this._wait = 0;
    this._fallbackPath = [];
    this._time = 0;
  }

  reset() {
    this.enemies.forEach(e => { this.scene.remove(e.mesh); this._disposeGroup(e.mesh); });
    this._dying.forEach(d => { this.scene.remove(d.mesh); this._disposeGroup(d.mesh); });
    this._spawnFX.forEach(s => { this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); });
    this.enemies = []; this._dying = []; this._spawnFX = [];
    this._nextId = 0; this._wait = 0; this._fallbackPath = [];
  }

  _disposeGroup(group) {
    group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }

  _spawnBurst(worldPos, color) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.04, 8, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(worldPos);
    ring.position.y = 0.05;
    this.scene.add(ring);
    this._spawnFX.push({ mesh: ring, life: 0.4, color });
  }

  spawnWave(queue, pathSystem) {
    const ordered = this.state.enemyPathTiles;
    if (!ordered || ordered.length === 0) {
      const sx = START_TILE.qx, sy = START_TILE.qy, ex = END_TILE.qx, ey = END_TILE.qy;
      const steps = Math.max(Math.abs(ex - sx), Math.abs(ey - sy)) * 8 + 10;
      this._fallbackPath = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        this._fallbackPath.push({ qx: Math.round(sx + (ex - sx) * t), qy: Math.round(sy + (ey - sy) * t) });
      }
    } else {
      this._fallbackPath = ordered;
    }
    queue.forEach(item => {
      const def = ENEMY_DEFS[item.defIdx];
      const waveScale = 1 + (this.state.wave - 1) * HP_WAVE_SCALE;
      const scaledHp = Math.floor(def.hp * waveScale);
      const id = this._nextId++;
      const group = ModelFactory.buildEnemy(item.defIdx, def.scale, def.color);
      const start = this._fallbackPath[0] || { qx: START_TILE.qx, qy: START_TILE.qy };
      const wPos = new THREE.Vector3(start.qx + 0.5, def.scale * 0.5, start.qy + 0.5);
      group.position.copy(wPos);
      group.scale.set(0.01, 0.01, 0.01);
      this.scene.add(group);
      this._spawnBurst(wPos, def.color);
      const enemy = {
        id, defIdx: item.defIdx,
        hp: scaledHp, maxHp: scaledHp,
        speed: def.speed, reward: def.reward,
        mesh: group,
        pathIndex: 0, slowUntil: 0,
        shieldPercent: def.shieldPercent || 0,
        dead: false,
        tags: { ...def },
        state: this.state,
        spawnAnim: 0.3,
      };
      this.enemies.push(enemy);
      EventBus.emit('enemy:spawned', { id });
    });
  }

  update(dt, state, pathSystem, towers) {
    this._time += dt;
    const path = this._fallbackPath;
    if (!path || path.length < 2) return;

    // ── Animate spawn bursts ──────────────────────────────────────────
    for (let i = this._spawnFX.length - 1; i >= 0; i--) {
      const s = this._spawnFX[i];
      s.life -= dt;
      const t = Math.max(0, s.life / 0.4);
      s.mesh.scale.setScalar(1 + (1 - t) * 2.5);
      s.mesh.material.opacity = t * 0.8;
      if (s.life <= 0) {
        this.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
        this._spawnFX.splice(i, 1);
      }
    }

    // ── Animate dying enemies (dissolve) ──────────────────────────────
    for (let i = this._dying.length - 1; i >= 0; i--) {
      const d = this._dying[i];
      d.life -= dt;
      const t = Math.max(0, d.life / 0.35);
      d.mesh.scale.setScalar(t);
      d.mesh.traverse(child => {
        if (child.material && child.material.opacity !== undefined) {
          child.material.opacity = t * (child.material._origOpacity || 1);
        }
      });
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this._disposeGroup(d.mesh);
        this._dying.splice(i, 1);
      }
    }

    // ── Animate & move living enemies ─────────────────────────────────
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (enemy.dead) continue;

      // Spawn scale-up animation
      if (enemy.spawnAnim > 0) {
        enemy.spawnAnim -= dt;
        const st = Math.min(1, 1 - enemy.spawnAnim / 0.3);
        const eased = st < 1 ? 1 - Math.pow(1 - st, 3) : 1; // ease-out cubic
        enemy.mesh.scale.setScalar(Math.max(0.01, eased));
      }

      ModelFactory.animateEnemy(enemy.mesh, enemy.defIdx, this._time, enemy.speed);

      if (enemy.tags.stationary) continue;
      let idx = enemy.pathIndex;
      const pace = enemy.slowUntil > performance.now() ? enemy.speed * 0.45 : enemy.speed;
      let remaining = pace * dt;
      let steps = 0;
      while (remaining > 0 && idx < path.length && steps < 20) {
        steps++;
        const step = path[idx];
        if (!step) break;
        const tx = step.qx + 0.5, tz = step.qy + 0.5;
        const dx = tx - enemy.mesh.position.x, dz = tz - enemy.mesh.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= remaining) {
          enemy.mesh.position.x = tx;
          enemy.mesh.position.z = tz;
          remaining -= dist;
          idx++;
          if (idx >= path.length) {
            this.leak(enemy, state);
            break;
          }
        } else {
          const frac = remaining / (dist || 0.0001);
          enemy.mesh.position.x += dx * frac;
          enemy.mesh.position.z += dz * frac;
          remaining = 0;
        }
      }
      if (!enemy.dead) enemy.pathIndex = idx;
    }
  }

  leak(enemy, state) {
    enemy.dead = true;
    state.lives -= 1;
    EventBus.emit('enemy:leaked', { id: enemy.id });
    if (state.lives <= 0) EventBus.emit('game:over');
    this._beginDeathDissolve(enemy);
  }

  kill(enemy, state) {
    enemy.dead = true;
    state.stats.enemiesKilled += 1;
    const def = ENEMY_DEFS[enemy.defIdx];
    const reward = Math.floor(enemy.reward * (1 + (state.wave - 1) * BUDGET.killWaveScale) * 3 / 10);
    state.money += reward;
    state.stats.moneyEarned += reward;
    EventBus.emit('enemy:despawned', { id: enemy.id });

    if (enemy.tags.split && def.split) {
      for (let j = 0; j < 2; j++) {
        const childDef = ENEMY_DEFS[Math.min(enemy.defIdx, 6)];
        const childGroup = ModelFactory.buildEnemy(Math.min(enemy.defIdx, 6), childDef.scale, childDef.color);
        childGroup.position.copy(enemy.mesh.position);
        childGroup.scale.set(0.01, 0.01, 0.01);
        this.scene.add(childGroup);
        const child = {
          id: this._nextId++, defIdx: Math.min(enemy.defIdx, 6),
          hp: def.hp * 0.6, maxHp: def.hp * 0.6,
          speed: enemy.speed * 1.1, reward: 0,
          mesh: childGroup,
          pathIndex: Math.max(0, enemy.pathIndex - 1),
          slowUntil: 0, dead: false,
          tags: { ...childDef, split: false },  // children don't split again
          state: this.state,
          spawnAnim: 0.3,
        };
        this.enemies.push(child);
      }
    }
    this._beginDeathDissolve(enemy);
  }

  _beginDeathDissolve(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) this.enemies.splice(i, 1);
    // Store original opacity for dissolve
    enemy.mesh.traverse(child => {
      if (child.material && child.material.opacity !== undefined) {
        child.material._origOpacity = child.material.opacity;
        child.material.transparent = true;
        child.material.depthWrite = false;
      }
    });
    this._dying.push({ mesh: enemy.mesh, life: 0.35 });
  }

  _remove(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i >= 0) {
      this.enemies.splice(i, 1);
      this.scene.remove(enemy.mesh);
      this._disposeGroup(enemy.mesh);
    }
  }

  range(enemies, pos, radius) {
    const out = [];
    enemies.forEach(e => { if (!e.dead && e.mesh.position.distanceTo(pos) <= radius) out.push(e); });
    return out;
  }
}
import * as THREE from 'three';
import { COLORS, TOWER_DEFS, UPGRADE_COST, UPGRADE_STATS, BUDGET } from '../core/Constants.js';
import EventBus from '../core/EventBus.js';
import ModelFactory from './ModelFactory.js';

export default class TowerManager {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.towers = [];
    this._time = 0;
  }
  reset() {
    this.towers.forEach(t => {
      this.scene.remove(t.mesh);
      if (t._rangeRing) { this.scene.remove(t._rangeRing); t._rangeRing.geometry.dispose(); t._rangeRing.material.dispose(); }
    });
    this.towers = [];
  }
  place(state, tileIdx, qx, qy, defIdx, pathSet) {
    if (!pathSet || pathSet.has(tileIdx)) return false;
    const existing = state.grid[tileIdx];
    if (existing !== 'empty' && !existing.startsWith('tower:')) return false;
    const def = TOWER_DEFS[defIdx];

    // Build over an existing tower: sell it first (refund at sell ratio)
    if (existing.startsWith('tower:')) {
      const i = this.towers.findIndex(t => t.idx === tileIdx);
      if (i < 0) return false;
      this.sell(state, tileIdx);
    }
    if (state.money < def.cost) return false;
    state.money -= def.cost;
    state.stats.towersBuilt += 1;

    const pos = new THREE.Vector3(qx * 1 + 0.5, 0, qy * 1 + 0.5);
    const group = ModelFactory.buildTower(defIdx)(def.color);
    group.position.copy(pos);
    this.scene.add(group);

    const tower = {
      defIdx, level: 0, totalInvested: def.cost,
      mesh: group, pos: pos.clone(),
      range: def.range, damage: def.damage, rate: def.rate,
      qx, qy, idx: tileIdx, cooldown: 0,
      turret: group.getObjectByName('_turret') || group,
      _recoilY: 0,            // current recoil offset
      _targetAngle: 0,        // desired Y-rotation toward target
      _currentAngle: 0,       // smoothed Y-rotation
    };
    this.towers.push(tower);
    state.grid[tileIdx] = `tower:${defIdx}`;
    this.audio.playPlace();
    EventBus.emit('tower:placed', { idx: tileIdx });
    EventBus.emit('economy:changed', { money: state.money });
    return true;
  }
  upgrade(state, idx) {
    const t = this.towers.find(x => x.idx === idx);
    if (!t || t.level >= 3) return;
    const def = TOWER_DEFS[t.defIdx];
    const cost = UPGRADE_COST(t.defIdx, t.level);
    if (state.money < cost) return;
    state.money -= cost;
    t.level += 1;
    t.totalInvested += cost;
    const s = UPGRADE_STATS(def, t.level);
    t.damage = s.damage; t.range = s.range; t.rate = s.rate;
    t.mesh.scale.setScalar(1 + t.level * 0.1);
    t.mesh.traverse(child => {
      if (child.material && child.material.emissiveIntensity !== undefined) {
        child.material.emissiveIntensity = 1.2 + t.level * 0.8;
      }
    });
    this.audio.playUpgrade();
    EventBus.emit('economy:changed', { money: state.money });
  }
  sell(state, idx) {
    const i = this.towers.findIndex(x => x.idx === idx);
    if (i < 0) return;
    const t = this.towers[i];
    const refund = Math.floor(t.totalInvested * BUDGET.sellBackRatio);
    state.money += refund;
    if (t._rangeRing) { this.scene.remove(t._rangeRing); t._rangeRing.geometry.dispose(); t._rangeRing.material.dispose(); }
    this._disposeGroup(t.mesh);
    this.scene.remove(t.mesh);
    this.towers.splice(i, 1);
    state.grid[idx] = 'empty';
    EventBus.emit('economy:changed', { money: state.money });
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
  /** Point tower toward a world position. */
  aimAt(t, worldTarget) {
    const dx = worldTarget.x - t.pos.x;
    const dz = worldTarget.z - t.pos.z;
    t._targetAngle = Math.atan2(dx, dz);
  }
  /** Trigger a firing recoil. */
  recoil(t) {
    t._recoilY = -0.12;
  }
  /** Flash the tower emissive (called on fire). */
  flashTower(t, intensity) {
    t.mesh.traverse(child => {
      if (child.material && child.material.emissiveIntensity !== undefined) {
        child.material.emissiveIntensity = intensity;
      }
    });
  }
  update(dt, state) {
    this._time += dt;
    if (state.buildCooldown > 0) state.buildCooldown -= dt;

    for (const t of this.towers) {
      ModelFactory.animateTower(t.mesh, t.defIdx, this._time);

      // Rotation toward target (smooth) — only for single-target towers.
      // Area-effect towers (splash / aura / gravity) stay orientation-free.
      const def = TOWER_DEFS[t.defIdx];
      const isAoe = !!(def.splash || def.auraSlow || def.gravity);
      if (!isAoe) {
        const turret = t.turret || t.mesh;
        let diff = t._targetAngle - t._currentAngle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        t._currentAngle += diff * Math.min(1, 8 * dt);
        turret.rotation.y = t._currentAngle;
      }

      // Recoil spring-back
      t._recoilY += (0 - t._recoilY) * 6 * dt;
      t.mesh.position.y = t._recoilY;

      // Emissive lerp-back after flash
      t.mesh.traverse(child => {
        if (child.material && child.material.emissiveIntensity !== undefined) {
          const base = 1.2 + t.level * 0.8;
          child.material.emissiveIntensity += (base - child.material.emissiveIntensity) * 5 * dt;
        }
      });
    }
  }
}
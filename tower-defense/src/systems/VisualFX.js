import * as THREE from 'three';

const EL = document.getElementById('visualFX');
const W = () => window.innerWidth;
const H = () => window.innerHeight;

function project(pos, camera) {
  const v = pos.clone().project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * W(),
    y: (-v.y * 0.5 + 0.5) * H(),
    visible: v.z < 1,
  };
}

export default class VisualFX {
  constructor(camera) {
    this.camera = camera;
    this._healthBars = new Map();
  }

  setHealthBars(enemies) {
    const seen = new Set();
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      seen.add(enemy.id);
      const screen = project(enemy.mesh.position, this.camera);
      if (!screen.visible) continue;

      let entry = this._healthBars.get(enemy.id);
      if (!entry) {
        const outer = document.createElement('div');
        outer.style.cssText = 'position:absolute;width:36px;height:4px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);border-radius:2px;transform:translate(-50%,0);';
        const bar = document.createElement('div');
        bar.style.cssText = 'height:100%;background:#22ff88;border-radius:2px;';
        outer.appendChild(bar);
        EL.appendChild(outer);
        entry = { el: outer, bar, enemy };
        this._healthBars.set(enemy.id, entry);
      }

      const pct = Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100));
      entry.bar.style.width = pct + '%';
      if (pct > 50) entry.bar.style.background = '#22ff88';
      else if (pct > 25) entry.bar.style.background = '#ffcc00';
      else entry.bar.style.background = '#ff4444';

      entry.el.style.left = screen.x + 'px';
      entry.el.style.top = (screen.y - 14) + 'px';
      entry.el.style.display = '';
    }
    for (const [id, entry] of this._healthBars) {
      if (!seen.has(id)) { entry.el.remove(); this._healthBars.delete(id); }
    }
  }

  clearHealthBars() {
    for (const [, entry] of this._healthBars) entry.el.remove();
    this._healthBars.clear();
  }

  spawnDamage() {}  // disabled for performance

  update() {}

  reset() { this.clearHealthBars(); }
}
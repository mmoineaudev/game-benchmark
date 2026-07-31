import { Constants } from '../core/Constants.js';

// LightManager (spec v2.0 §6.3): priority-culled dynamic light budget.
// Lights register by NAME convention:
//   'ship:<id>'   → always on (ship lights)
//   'sig:<key>'   → signature lights, priority by key (see priorities)
//   'land:<key>'  → landmark lights (dead star, nebula, station)
// Every 6th frame the manager scans the scene, sorts budget lights by
// (priority, distance to camera) and toggles `.visible` to stay under the cap.
export class LightManager {
  constructor(scene) {
    this.scene = scene;
    this.profile = 'auto';
    this._frame = 0;
    this._budget = []; // { light, name, key }
  }

  setProfile(profile) {
    this.profile = profile;
  }

  /** Called each frame by Game; culls at 10 Hz. */
  update(cameraPos) {
    this._frame++;
    if (this._frame % Constants.LIGHT_MANAGER.reevalEvery !== 0) return;
    this._budget.length = 0;

    const priorities = Constants.LIGHT_MANAGER.priorities;
    this.scene.traverse((o) => {
      if (!o.isLight || !o.name) return;
      let key = null;
      let cls = null;
      if (o.name.startsWith('ship:')) { cls = 'ship'; key = o.name.slice(5); }
      else if (o.name.startsWith('sig:')) { cls = 'sig'; key = o.name.slice(4); }
      else if (o.name.startsWith('land:')) { cls = 'land'; key = o.name.slice(5); }
      if (!cls) return;
      this._budget.push({ light: o, cls, key, prio: priorities[key] ?? 99, dist: cameraPos ? o.position.distanceToSquared(cameraPos) : 0 });
    });

    const cap = this.profile === 'eco' ? Constants.LIGHT_MANAGER.capEco : Constants.LIGHT_MANAGER.capAuto;
    const sigBudget = this.profile === 'eco' ? 0 : Constants.LIGHT_MANAGER.signatureBudget;
    const landBudget = this.profile === 'eco' ? 0 : Constants.LIGHT_MANAGER.landmarkBudget;

    let shipOn = 0;
    for (const b of this._budget) {
      if (b.cls === 'ship') { b.light.visible = true; shipOn++; }
      else b.light.visible = false;
    }

    if (shipOn + sigBudget + landBudget > cap) {
      // shrink signature budget to fit (landmark keeps priority by distance)
      const overflow = shipOn + sigBudget + landBudget - cap;
      const sigFinal = Math.max(0, sigBudget - overflow);
      this._applyBudget('sig', sigFinal);
      this._applyBudget('land', landBudget);
    } else {
      this._applyBudget('sig', sigBudget);
      this._applyBudget('land', landBudget);
    }
  }

  _applyBudget(cls, n) {
    if (n <= 0) return;
    const items = this._budget.filter((b) => b.cls === cls).sort((a, b) => a.prio - b.prio || a.dist - b.dist);
    for (let i = 0; i < Math.min(n, items.length); i++) items[i].light.visible = true;
  }

  /** Count of visible dynamic lights (perf probe). */
  countVisible() {
    let n = 0;
    this.scene.traverse((o) => { if (o.isLight && o.visible) n++; });
    return n;
  }
}

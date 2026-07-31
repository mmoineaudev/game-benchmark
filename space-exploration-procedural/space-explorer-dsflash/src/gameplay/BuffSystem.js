// Time-based stat modifiers (spec structure §3). Generic buff registry —
// currently no gameplay buffs exist, but the API is stable for future use.
export class BuffSystem {
  constructor() {
    this.buffs = [];
  }

  add(name, duration, modifiers = {}) {
    this.buffs.push({ name, duration, remaining: duration, modifiers });
  }

  update(dt) {
    for (const b of this.buffs) {
      b.remaining -= dt;
    }
    this.buffs = this.buffs.filter((b) => b.remaining > 0);
  }

  /** Product of all active modifier values for a key (default 1 = neutral). */
  getModifier(key) {
    let value = 1;
    for (const b of this.buffs) {
      if (b.modifiers[key] !== undefined) value *= b.modifiers[key];
    }
    return value;
  }

  reset() {
    this.buffs = [];
  }
}

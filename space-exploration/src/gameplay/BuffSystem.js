// ============================================================
// BuffSystem — Time-based stat modifiers
// ============================================================
import EventBus from '../core/EventBus.js';

class BuffSystem {
  constructor() {
    this._activeBuffs = new Map();
  }

  init() {
    // Listen for buff events
    EventBus.on('buff:add', (data) => {
      this.addBuff(data);
    });

    EventBus.on('game:reset', () => {
      this.clearAll();
    });
  }

  /**
   * Add a time-based buff
   */
  addBuff(data) {
    const buff = {
      id: data.id || `buff_${Date.now()}`,
      type: data.type,
      duration: data.duration || 5,
      remaining: data.duration || 5,
      params: data.params || {},
    };

    // Apply immediate effect
    if (data.onApply) data.onApply(buff.params);
    
    this._activeBuffs.set(buff.id, buff);
    EventBus.emit('buff:applied', buff);
  }

  /**
   * Remove a buff by ID
   */
  removeBuff(id) {
    const buff = this._activeBuffs.get(id);
    if (buff && buff.onExpire) {
      buff.onExpire(buff.params);
    }
    this._activeBuffs.delete(id);
  }

  /**
   * Update all active buffs
   */
  update(dt) {
    for (const [id, buff] of this._activeBuffs) {
      buff.remaining -= dt;
      if (buff.remaining <= 0) {
        this.removeBuff(id);
      }
    }
  }

  /**
   * Get all active buffs
   */
  getActiveBuffs() {
    return Array.from(this._activeBuffs.values());
  }

  /**
   * Get a specific buff type
   */
  getBuff(type) {
    for (const buff of this._activeBuffs.values()) {
      if (buff.type === type) return buff;
    }
    return null;
  }

  /**
   * Clear all buffs
   */
  clearAll() {
    for (const [id] of this._activeBuffs) {
      this.removeBuff(id);
    }
  }
}

export default BuffSystem;

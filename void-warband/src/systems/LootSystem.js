/**
 * LootSystem.js — drop tables, pickup spawning, magnetism, cargo (SPEC §6).
 *
 *   - rollDrops(sourceType, position, sectorIndex) → [{itemDef, count}] using
 *     per-source weighted tables in Constants (drone common-heavy, frigate
 *     uncommon+ rare chance, crate anything, boss guaranteed rare+);
 *   - spawnPickup / spawnCluster(position, sectorIndex): 3–6 scattered;
 *   - update(dt, time, playerPos, gameState): bob/rotate, magnet pull within
 *     magnetRadius, pickup within pickupRadius → run.cargo (scrap stacks,
 *     items 1 slot each) + 'loot:pickedUp' {itemDef, position}; first pickup
 *     of a type → meta.discovered + 'loot:firstDiscovery' {itemDef};
 *   - clear() for restart (SPEC §11).
 */
import * as THREE from 'three';
import { ITEMS, ITEM_EFFECTS, TRADE } from '../core/Constants.js';
import { Pickup } from '../entities/Pickup.js';
import { EventBus } from '../core/EventBus.js';
import { GameState } from '../core/GameState.js';

/** Base pickup radius, u (SPEC §6). */
const PICKUP_RADIUS = 8;

/** Tier rank for "rare+" gating (rare=2, exotic=3). */
const _TIER_RANK = { common: 0, uncommon: 1, rare: 2, exotic: 3 };

/**
 * Per-source drop tables: explicit weighted arrays of item ids (SPEC §6 —
 * "Drop tables per source … are explicit arrays in Constants with weights";
 * weights come from the ITEMS catalog `weight` field, source multipliers
 * here). `guaranteedRare` sources always yield at least one rare+ item.
 * @type {Record<string, {ids: string[], mult: Record<string, number>, count: [number, number], guaranteedRare?: boolean}>}
 */
const _DROP_TABLES = {
  // Drone: common-heavy, usually 1–2 scrap.
  drone: { ids: ['scrap', 'salvage_plate', 'coolant'], mult: {}, count: [1, 2], guaranteedRare: false },
  // Interceptor: common, slightly better, rare chance.
  interceptor: { ids: ['scrap', 'salvage_plate', 'ammo_cell', 'data_fragment'], mult: { uncommon: 1.5 }, count: [1, 2], guaranteedRare: false },
  // Rammer: common, small scrap burst.
  rammer: { ids: ['scrap', 'salvage_plate', 'hull_patch'], mult: {}, count: [1, 2], guaranteedRare: false },
  // Frigate: uncommon+, rare chance (loot piñata, SPEC §4).
  frigate: { ids: ['scrap', 'salvage_plate', 'shield_cell', 'mod_fire_rate', 'mod_damage', 'mystery_crate', 'mod_split_beam', 'core_aegis'], mult: { common: 0.5, uncommon: 2, rare: 2 }, count: [2, 4], guaranteedRare: false },
  // Crate (mystery/derelict): anything, full weight.
  crate: { ids: ITEMS.map((i) => i.id), mult: {}, count: [1, 3], guaranteedRare: false },
  // Breakable props (user feedback: loot bias per prop model).
  // Container — raw resources.
  container: { ids: ['scrap', 'scrap', 'salvage_plate', 'coolant', 'fuel_skip'], mult: {}, count: [1, 3], guaranteedRare: false },
  // Pod cluster — consumables.
  podcluster: { ids: ['ammo_cell', 'hull_patch', 'shield_cell', 'coolant'], mult: {}, count: [1, 2], guaranteedRare: false },
  // Satellite wreck — tech.
  satellite: { ids: ['data_fragment', 'data_fragment', 'mod_fire_rate', 'mod_damage', 'mod_engine', 'mod_homing'], mult: { rare: 1.5 }, count: [1, 2], guaranteedRare: false },
  // Defense buoy — weapons.
  buoy: { ids: ['ammo_cell', 'ammo_cell', 'mod_fire_rate', 'mod_damage', 'mod_split_beam', 'core_overclock'], mult: { rare: 1.5 }, count: [1, 2], guaranteedRare: false },
  // Chrome Sentinel (THE ABYSS): mirrored tech — rare-leaning.
  chrome: { ids: ['salvage_plate', 'data_fragment', 'mod_homing', 'mod_split_beam', 'void_relic'], mult: { rare: 2, exotic: 0.5 }, count: [2, 3], guaranteedRare: false },
  // Boss: guaranteed rare+ (SPEC §4 sentinel / §6).
  boss: { ids: ITEMS.map((i) => i.id), mult: { common: 0, uncommon: 0, rare: 3, exotic: 1 }, count: [2, 4], guaranteedRare: true },
  // Dummy test target: pure scrap (P2/P4 fixture).
  dummy: { ids: ['scrap'], mult: {}, count: [1, 3], guaranteedRare: false },
};

class _LootSystem {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    /** @type {THREE.Scene} */
    this._scene = scene;
    /** @type {Pickup[]} */
    this.pickups = [];
  }

  /**
   /** Effective pickup radius: base × ship pickup mult + item buffs. */
   _pickupRadius() {
     return (PICKUP_RADIUS + GameState.pickupRadiusBonus())
       * GameState.currentShip().pickupMult;
   }

   /** Effective magnet radius (base × ship mult + same buffs). @returns {number} */
   _magnetRadius() {
     return (ITEM_EFFECTS.magnetRadius + GameState.pickupRadiusBonus())
       * GameState.currentShip().pickupMult;
   }

  /**
   * Roll drops for a source.
   * @param {string} sourceType key in _DROP_TABLES.
   * @param {THREE.Vector3} position
   * @param {number} sectorIndex 1-based.
   * @returns {Array<{itemDef: object, count: number}>}
   */
  rollDrops(sourceType, position, sectorIndex) {
    const table = _DROP_TABLES[sourceType] ?? _DROP_TABLES.drone;
    const drops = [];
    const n = table.count[0] + Math.floor(Math.random() * (table.count[1] - table.count[0] + 1));
    for (let i = 0; i < n; i++) {
      const itemDef = this._rollItem(table, sourceType);
      if (itemDef) drops.push({ itemDef, count: 1 });
    }
    // Guaranteed rare+: force at least one rare+ for boss sources.
    if (table.guaranteedRare && !drops.some((d) => _TIER_RANK[d.itemDef.tier] >= 2)) {
      const rares = ITEMS.filter((i) => _TIER_RANK[i.tier] >= 2);
      const rare = rares[Math.floor(Math.random() * rares.length)];
      drops.push({ itemDef: rare, count: 1 });
    }
    void sectorIndex;
    void position;
    return drops;
  }

  /**
   * Spawn a single pickup at `position`.
   * @param {object} itemDef
   * @param {THREE.Vector3} position
   * @returns {Pickup}
   */
  spawnPickup(itemDef, position) {
    const p = new Pickup(this._scene, itemDef, position);
    this.pickups.push(p);
    return p;
  }

  /**
   * Spawn a loot cluster: 3–6 pickups scattered around `position`.
   * @param {THREE.Vector3} position
   * @param {number} sectorIndex
   * @returns {Pickup[]}
   */
  spawnCluster(position, sectorIndex) {
    const table = _DROP_TABLES.crate;
    const n =
      ITEM_EFFECTS.clusterMin +
      Math.floor(Math.random() * (ITEM_EFFECTS.clusterMax - ITEM_EFFECTS.clusterMin + 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const itemDef = this._rollItem(table, 'crate');
      if (!itemDef) continue;
      const pos = position.clone().add(_scatter(ITEM_EFFECTS.clusterRadius));
      out.push(this.spawnPickup(itemDef, pos));
    }
    void sectorIndex;
    return out;
  }

  /**
   * Per-frame: bob/rotate, magnet pull, pickup-on-touch.
   * @param {number} dt delta, s.
   * @param {number} time absolute time, s.
   * @param {THREE.Vector3} playerPos player world position.
   * @param {object} gameState
   */
  update(dt, time, playerPos, gameState) {
    const run = gameState.run;
    if (!run) return;

    const pickupR = this._pickupRadius();
    const magnetR = this._magnetRadius();
    const magnetSpeed = ITEM_EFFECTS.magnetSpeed;

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      if (p.taken) {
        this.pickups.splice(i, 1);
        continue;
      }

      const dist = p.position.distanceTo(playerPos);

      // Magnet: within magnetRadius → fly toward player.
      if (dist <= magnetR) {
        const dir = _scratch.copy(playerPos).sub(p.position).normalize();
        const step = magnetSpeed * dt;
        p.position.addScaledVector(dir, step);
        p.group.position.copy(p.position);
      }

      // Pickup: within pickupRadius → collect (only if cargo has room).
      if (p.position.distanceTo(playerPos) <= pickupR && this._tryCollect(p, gameState)) {
        p.taken = true;
        p.dispose();
        this.pickups.splice(i, 1);
        continue;
      }

      p.update(dt, time);
    }
  }

  /**
   * Try to collect a pickup into cargo + emit events.
   * @param {Pickup} p
   * @param {object} gameState
   * @returns {boolean} true if collected (caller removes the pickup);
   *   false if cargo is full (pickup stays on the floor).
   */
  _tryCollect(p, gameState) {
    const run = gameState.run;
    const itemDef = p.itemDef;

    // AUTO-SELL (user feedback: money automated + persistent). Every pickup
    // converts straight into the persistent WALLET (meta.scrap) — no cargo
    // juggling, nothing to lose on death. Scrap items are worth 1 each;
    // collectibles auto-sell at their tier value (× sell-bonus buffs).
    if (itemDef.id === 'scrap') {
      gameState.meta.scrap += 1;
    } else {
      const base = TRADE.sellValue[itemDef.tier] ?? 5;
      gameState.meta.scrap += Math.round(
        base * (1 + gameState.sellBonusPct() / 100));
    }

    EventBus.emit('loot:pickedUp', { itemDef, position: p.position });

    // Discovery: first pickup of this type → meta.discovered + popup.
    if (!gameState.meta.discovered.includes(itemDef.id)) {
      gameState.meta.discovered.push(itemDef.id);
      EventBus.emit('loot:firstDiscovery', { itemDef });
    }
    return true;
  }

  /**
   * Cargo slots used: scrap stacks as 1, each other item count as its count.
   * @param {object} run
   * @returns {number}
   */
  _slotsUsed(run) {
    let used = 0;
    for (const [id, count] of Object.entries(run.cargo)) {
      if (id === 'scrap') used += 1;
      else used += count;
    }
    return used;
  }

  /**
   * Weighted item roll from a source table (source multipliers on tier).
   * @param {object} table
   * @param {string} sourceType
   * @returns {object|null} itemDef (null if table empty).
   */
  _rollItem(table, sourceType) {
    void sourceType;
    const entries = [];
    let total = 0;
    for (const id of table.ids) {
      const itemDef = ITEMS.find((i) => i.id === id);
      if (!itemDef) continue;
      const tierMult = table.mult[itemDef.tier] ?? 1;
      if (tierMult <= 0) continue;
      const w = itemDef.weight * tierMult;
      if (w <= 0) continue;
      entries.push({ itemDef, w });
      total += w;
    }
    if (entries.length === 0 || total <= 0) return null;
    let r = Math.random() * total;
    for (const e of entries) {
      r -= e.w;
      if (r <= 0) return e.itemDef;
    }
    return entries[entries.length - 1].itemDef;
  }

  /**
   * Remove every pickup (restart cleanup, SPEC §11).
   */
  clear() {
    for (const p of this.pickups) p.dispose();
    this.pickups.length = 0;
  }
}

/** Scratch vector (no per-frame allocation). */
const _scratch = new THREE.Vector3();

/**
 * Random scatter offset within `radius` (uniform ball, biased outward).
 * @param {number} radius
 * @returns {THREE.Vector3}
 */
function _scatter(radius) {
  const v = new THREE.Vector3();
  v.randomDirection();
  v.multiplyScalar(radius * (0.3 + 0.7 * Math.random()));
  return v;
}

export { _LootSystem as LootSystem };
export default _LootSystem;

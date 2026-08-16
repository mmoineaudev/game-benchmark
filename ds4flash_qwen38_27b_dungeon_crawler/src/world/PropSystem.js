/**
 * PropSystem.js — populates a generated dungeon level with props, decorations,
 * breakables, interactives, hazards and biome light sources
 * (§7.3, §11, §13, §19, §22, §26).
 *
 * Contract:
 *   const props = new PropSystem(scene, eventBus, callbacks);
 *   props.build(dungeon, biomeId, opts);      // dungeon = DungeonGenerator output
 *   props.update(dt, playerX, playerZ);       // per frame (Game)
 *   props.tickHazard(dt, playerX, playerZ);   // Game hazard tick driver
 *   props.breakBreakable(meshOrPos);          // sword / orb / step-on entry point
 *   props.checkHazard(x, z);                 // returns {dmg} for the 0.8 s tick
 *   props.collidableBoxes();                 // AABBs to append to collision (§5.4/§26)
 *   props.reduceDecorations(0.5);            // degraded mode (§22)
 *   props.dispose();
 *
 * callbacks: { onBuffCollected(effect), onPropBroken(pos), onPropOpened(pos),
 *              onSpawnWraith(x, z), lavaHazard?, spawnOrbs?(x, z, count),
 *              collectedOrbs, activeBuff }
 */

import * as THREE from 'three';
import { DUNGEON, BUFF, PROPS, LIGHT_SOURCES, HAZARD, POOLS } from '../core/Constants.js';

const CELL = DUNGEON.CELL_SIZE;
const CEIL_Y = DUNGEON.WALL_HEIGHT;
const HAZARD_HAZARD_BIOMES_LAVA = ['VOLCANIC_DEPTHS', 'EMBER_FORGE'];
const HAZARD_ACID_BIOMES = ['POISON_SWAMP'];
const STEP_ON_RADIUS = PROPS.STEP_ON_BREAK_RADIUS;

export class PropSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../core/EventBus.js').EventBus} eventBus
   * @param {object} callbacks
   */
  constructor(scene, eventBus, callbacks) {
    this.scene = scene;
    this.bus = eventBus;
    this.cb = callbacks || {};

    this.group = new THREE.Group();
    this.lightList = [];
    this.geometries = [];
    this.materials = [];
    this.meshes = [];          // everything removed/disposed on dispose()
    this.instanced = [];       // { mesh, full: number } for degraded tail-shed
    this.breakables = [];      // { mesh, pos, box, broken }
    this.interactives = [];    // { root, box, opened, opening, lid, t }
    this.hazards = [];         // { x, z, kind }
    this.wisps = [];           // { group, light, cx, cz, ox, oz, ang, vx, vz, bounds }
    this.cosmetic = [];        // groups hidden by reduceDecorations (lights included)
    this._cosmeticLights = [];
    this._debris = [];
    this._smoke = [];
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this.disposed = false;
    this.degraded = false;
    this.biomeId = null;

    scene.add(this.group);
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  _cellCenter(c) { return c * CELL + CELL / 2; }

  _roomCenter(r) {
    return { x: this._cellCenter(r.cx + (r.w >> 1)), z: this._cellCenter(r.cz + (r.h >> 1)) };
  }

  /** Random point inside a room, margin m u from room edges (world space). */
  _randInRoom(r, m, rng) {
    const m2 = m || 0.6;
    return {
      x: (r.cx + (m2 / CELL)) * CELL + rng() * Math.max(0.01, r.w * CELL - 2 * m2),
      z: (r.cz + (m2 / CELL)) * CELL + rng() * Math.max(0.01, r.h * CELL - 2 * m2),
    };
  }

  _track(geo) { this.geometries.push(geo); return geo; }
  _trackMat(mat) { this.materials.push(mat); return mat; }

  _mat(color, opts = {}) {
    return this._trackMat(new THREE.MeshStandardMaterial({
      color,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    }));
  }

  _addPointLight(color, x, y, z, src, owner, { cosmetic = false } = {}) {
    const light = new THREE.PointLight(color, src.intensity, src.distance, src.decay);
    light.position.set(x, y, z);
    light.castShadow = false;
    this.group.add(light);
    this.lightList.push(light);
    if (cosmetic) {
      light.userData.cosmeticLight = true;
      if (owner) light.userData.owner = owner;
      this._cosmeticLights.push(light);
    }
    return light;
  }

  _pickWeighted(pool, rng) {
    const entries = pool.filter(e => (e.weight ?? 1) > 0);
    let total = 0;
    for (const e of entries) total += e.weight;
    let roll = rng() * total;
    for (const e of entries) {
      roll -= e.weight;
      if (roll <= 0) return e;
    }
    return entries[entries.length - 1];
  }

  // ---------------------------------------------------------------------
  // BUILD
  // ---------------------------------------------------------------------
  /**
   * @param {object} dungeon — DungeonGenerator.generate() output
   * @param {string} biomeId
   * @param {object} opts — { rng? }
   */
  build(dungeon, biomeId, opts = {}) {
    this.biomeId = biomeId;
    this.rng = opts.rng || Math.random;
    const { rooms, exitCell, cellSize = CELL } = dungeon;
    const exitX = this._cellCenter(exitCell.x);
    const exitZ = this._cellCenter(exitCell.z);

    const stalactiteCount = POOLS.STALACTITES;
    const waterCount = POOLS.WATER_POOLS;
    const stalactites = [];
    const waters = [];
    const skullPileSpots = [];
    const bookSpots = [];

    const isFungal = biomeId === 'FUNGAL_CAVERN';
    const isSwamp = biomeId === 'POISON_SWAMP';
    const isLavaHazard = HAZARD_HAZARD_BIOMES_LAVA.includes(biomeId);
    const isAcidHazard = HAZARD_ACID_BIOMES.includes(biomeId);

    // ------------------------------------------------------------------
    // per-room placement
    // ------------------------------------------------------------------
    for (const room of rooms) {
      const c = this._roomCenter(room);
      const spec = PROPS.PROPS_PER_ROOM[room.type] || { decorative: 2, breakable: 1, interactive: 0 };
      const pool = (PROPS.POOLS[room.type] || []).filter(e => !e.breakable && !e.interactive);

      // --- breakables (barrels/crates) — individual meshes, ≤ 3/room
      const nBreak = Math.min(spec.breakable, PROPS.MAX_BREAKABLES_PER_ROOM);
      for (let i = 0; i < nBreak; i++) {
        const p = this._randInRoom(room, 1.2, this.rng);
        const kind = this.rng() < 0.5 ? 'barrel' : 'crate';
        this._buildBreakable(p.x, p.z, kind);
      }

      // --- decoratives from the weighted pool (cosmetic)
      for (let i = 0; i < spec.decorative; i++) {
        const entry = pool.length ? this._pickWeighted(pool, this.rng) : null;
        const p = this._randInRoom(room, 0.8, this.rng);
        const name = entry ? entry.name : 'rubble';
        this._buildDecor(name, p.x, p.z, room, biomeId);
      }

      // --- interactives
      if (room.type === 'CRYPT') {
        const n = Math.max(1, spec.interactive);
        for (let i = 0; i < n; i++) {
          const p = this._randInRoom(room, 1.0, this.rng);
          this._buildSarcophagus(p.x, p.z);
        }
      }

      // --- hazards (§7.3) — 1–2 per room, never within 3 u of the exit marker
      if ((isLavaHazard || isAcidHazard) && room.type !== 'ARENA') {
        const count = HAZARD.POOLS_PER_ROOM_MIN +
          (this.rng() < 0.5 ? 1 : 0); // 1–2
        for (let i = 0; i < count; i++) {
          let p = null;
          for (let a = 0; a < 24; a++) {
            p = this._randInRoom(room, 1.5, this.rng);
            const dx = p.x - exitX, dz = p.z - exitZ;
            if (dx * dx + dz * dz >= HAZARD.MIN_EXIT_DIST * HAZARD.MIN_EXIT_DIST) break;
            p = null;
          }
          if (p) this._buildHazard(p.x, p.z, isAcidHazard ? 'acid' : 'lava');
        }
      }

      // --- wisps (§7.3)
      if (biomeId === 'HAUNTED_CRYPT' && room.type === 'CRYPT') {
        const n = 1 + (this.rng() < 0.5 ? 1 : 0); // 1–2
        for (let i = 0; i < n; i++) this._buildWisp(c.x, c.z, room, 0xaaffee);
      }
      if (biomeId === 'FLOODED_RUINS') {
        this._buildWisp(c.x, c.z, room, 0x66e0ff); // exactly 1 (aqua)
      }

      // --- mushrooms (§7.3)
      if (room.type === 'MUSHROOM_GROVE') {
        const n = 6;
        for (let i = 0; i < n; i++) {
          const p = this._randInRoom(room, 0.6, this.rng);
          this._buildMushroomCluster(p.x, p.z, isSwamp, c);
        }
      } else if (isFungal) {
        // ~2 per other room in FUNGAL_CAVERN (weight-5 pool)
        if (this.rng() < 0.85) {
          const p = this._randInRoom(room, 0.6, this.rng);
          this._buildMushroomCluster(p.x, p.z, false, c);
        }
      }

      // --- crystal lamps (§7.3) — biome light props, never degraded
      if (biomeId === 'CRYSTAL_DEPTHS') {
        const p = this._randInRoom(room, 0.8, this.rng);
        this._buildCrystalCluster(p.x, p.z, 1);
      }
      if (biomeId === 'FROZEN_HALLS') {
        for (let i = 0; i < 2; i++) {
          const p = this._randInRoom(room, 0.8, this.rng);
          this._buildCrystalCluster(p.x, p.z, 1);
        }
      }

      // --- instanced candidates
      // stalactites hang from the ceiling over every room cell
      for (let dx = 0; dx < room.w; dx++) {
        for (let dz = 0; dz < room.h; dz++) {
          if (this.rng() < 0.35) {
            const x = (room.cx + dx + this.rng()) * CELL;
            const z = (room.cz + dz + this.rng()) * CELL;
            stalactites.push({ x, z, s: 0.6 + this.rng() * 0.9 });
          }
        }
      }
      // water pools — VAULT rooms only, flat plane at y 0.02
      if (room.type === 'VAULT') {
        const n = 1 + (this.rng() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const p = this._randInRoom(room, 1.0, this.rng);
          waters.push({ x: p.x, z: p.z, r: 0.8 + this.rng() * 1.2 });
        }
      }
      // skull piles / books — instanced decoratives
      if (room.type === 'VAULT' || room.type === 'ARMORY' || room.type === 'ARENA') {
        if (this.rng() < 0.6) {
          const p = this._randInRoom(room, 0.8, this.rng);
          skullPileSpots.push({ x: p.x, z: p.z, ry: this.rng() * Math.PI * 2 });
        }
      }
      if (room.type === 'LIBRARY') {
        const n = 3 + Math.floor(this.rng() * 3);
        for (let i = 0; i < n; i++) {
          const p = this._randInRoom(room, 0.6, this.rng);
          bookSpots.push({ x: p.x, z: p.z, ry: this.rng() * Math.PI * 2 });
        }
      }
    }

    // ------------------------------------------------------------------
    // INSTANCED MESHES — one per type per level (§13)
    // ------------------------------------------------------------------
    this._buildInstancedStalactites(stalactites, stalactiteCount);
    this._buildInstancedWater(waters, waterCount);
    this._buildInstancedSkulls(skullPileSpots);
    this._buildInstancedBooks(bookSpots);

    // cosmetic bookkeeping (reduceDecorations hides random 50%)
    this._cosmeticLights = this._cosmeticLights || [];
  }

  // ---------------------------------------------------------------------
  // BREAKABLES
  // ---------------------------------------------------------------------
  _buildBreakable(x, z, kind) {
    const g = new THREE.Group();
    let box;
    if (kind === 'barrel') {
      const geo = this._track(new THREE.CylinderGeometry(0.35, 0.4, 0.9, 10));
      const mat = this._mat(0x7a4a20);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 0.45;
      m.castShadow = true;
      g.add(m);
      box = { minX: x - 0.45, minZ: z - 0.45, maxX: x + 0.45, maxZ: z + 0.45 };
    } else {
      const geo = this._track(new THREE.BoxGeometry(0.8, 0.8, 0.8));
      const mat = this._mat(0x8a6a30);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 0.4;
      m.castShadow = true;
      g.add(m);
      box = { minX: x - 0.5, minZ: z - 0.5, maxX: x + 0.5, maxZ: z + 0.5 };
    }
    g.position.set(x, 0, z);
    this.group.add(g);
    this.meshes.push(g);
    const rec = { mesh: g, pos: { x, z }, box, broken: false, kind };
    // mark mesh → record lookup for breakBreakable(mesh)
    g.userData.breakable = rec;
    this.breakables.push(rec);
  }

  /**
   * Break a breakable. Accepts a mesh/Group with userData.breakable, a
   * breakable record, or a {x, z} position (nearest, within step radius).
   * Returns the dropped orbs array or null.
   */
  breakBreakable(target) {
    if (this.disposed) return null;
    let rec = null;
    if (target && target.userData && target.userData.breakable) {
      rec = target.userData.breakable;
    } else if (target && target.broken === undefined && target.x !== undefined) {
      // position: nearest unbroken within step radius
      let best = null, bestD = STEP_ON_RADIUS;
      for (const b of this.breakables) {
        if (b.broken) continue;
        const dx = b.pos.x - target.x, dz = b.pos.z - target.z;
        const d = Math.hypot(dx, dz);
        if (d <= bestD) { bestD = d; best = b; }
      }
      rec = best;
    } else if (target && target.broken !== undefined) {
      rec = target;
    }
    if (!rec || rec.broken) return null;
    rec.broken = true;

    // debris + smoke flash (visual-only; no pooling needed at this scale)
    this._debrisBurst(rec.pos.x, rec.pos.z);
    this.group.remove(rec.mesh);
    this._disposeObject(rec.mesh);
    this.meshes.splice(this.meshes.indexOf(rec.mesh), 1);
    const i = this.breakables.indexOf(rec);
    if (i >= 0) this.breakables.splice(i, 1);

    // rolls (§11 / §19)
    const orbs = this.cb.collectedOrbs || 0;
    const orbBonus = Math.max(0, orbs - BUFF.EXCESS_ORB_THRESHOLD) * BUFF.EXCESS_ORB_BONUS;
    let drops = null;
    if (this.cb.onBuffCollected && this.rng() < BUFF.CHANCE + orbBonus) {
      const effects = BUFF.EFFECTS.filter(e => e !== this.cb.activeBuff);
      const effect = effects[Math.floor(this.rng() * effects.length)];
      this.cb.onBuffCollected(effect);
    }
    if (this.rng() < BUFF.ORB_DROP_CHANCE) {
      drops = 1 + Math.floor(this.rng() * (BUFF.ORB_DROP_MAX - BUFF.ORB_DROP_MIN + 1));
      if (this.cb.spawnOrbs) this.cb.spawnOrbs(rec.pos.x, rec.pos.z, drops);
    }
    if (this.cb.onPropBroken) this.cb.onPropBroken({ x: rec.pos.x, z: rec.pos.z });
    if (this.bus && this.bus.emit) this.bus.emit('prop:broken', { x: rec.pos.x, z: rec.pos.z });
    return drops;
  }

  /** Step-on check: break any breakable within STEP_ON_RADIUS of (x, z). */
  stepCheck(x, z) {
    for (const rec of this.breakables) {
      if (rec.broken) continue;
      const dx = rec.pos.x - x, dz = rec.pos.z - z;
      if (dx * dx + dz * dz <= STEP_ON_RADIUS * STEP_ON_RADIUS) {
        this.breakBreakable(rec);
      }
    }
  }

  _debrisBurst(x, z) {
    const n = 5;
    const geo = this._track(new THREE.BoxGeometry(0.08, 0.08, 0.08));
    const mat = this._mat(0x333333);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0.5, z);
      m.userData.debris = {
        vx: (this.rng() - 0.5) * 3,
        vy: 1 + this.rng() * 2,
        vz: (this.rng() - 0.5) * 3,
        life: 0.7,
      };
      this.group.add(m);
      this.meshes.push(m);
      this._debris.push(m);
    }
    // smoke puff
    const sGeo = this._track(new THREE.SphereGeometry(0.25, 8, 6));
    const sMat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0x888888, transparent: true, opacity: 0.5,
    }));
    const s = new THREE.Mesh(sGeo, sMat);
    s.position.set(x, 0.6, z);
    s.userData.smoke = { life: 0.6 };
    this.group.add(s);
    this.meshes.push(s);
    this._smoke.push(s);
    if (!this._debris) this._debris = [];
  }

  // ---------------------------------------------------------------------
  // INTERACTIVES — sarcophagi (CRYPT, §19/§26)
  // ---------------------------------------------------------------------
  _buildSarcophagus(x, z) {
    const g = new THREE.Group();
    const bodyGeo = this._track(new THREE.BoxGeometry(1.1, 0.9, 2.4));
    const bodyMat = this._mat(0x6a6f78, { roughness: 0.7 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.45;
    body.castShadow = true;
    g.add(body);

    const lidGeo = this._track(new THREE.BoxGeometry(1.2, 0.15, 2.5));
    const lidMat = this._mat(0x7d8391, { roughness: 0.7 });
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.set(0, 0.98, -0.3);
    g.add(lid);

    g.position.set(x, 0, z);
    this.group.add(g);
    this.meshes.push(g);
    this.interactives.push({
      root: g, lid,
      x, z,
      box: { minX: x - 0.7, minZ: z - 1.3, maxX: x + 0.7, maxZ: z + 1.3 },
      opened: false, opening: false, t: 0,
      triggered: false,
    });
  }

  /** Per-frame interactive check. Returns true if a wraith spawn was requested. */
  _updateInteractives(playerX, playerZ, dt) {
    for (const it of this.interactives) {
      if (!it.triggered) {
        const dx = it.x - playerX, dz = it.z - playerZ;
        if (dx * dx + dz * dz < PROPS.SARCOPHAGUS_TRIGGER_DIST * PROPS.SARCOPHAGUS_TRIGGER_DIST) {
          it.triggered = true;
          it.opening = true;
          this._openSarcophagus(it);
        }
      }
      if (it.opening) {
        it.t += dt / PROPS.SARCOPHAGUS_LID_TIME;
        const k = Math.min(1, it.t);
        // slide lid back + lift
        it.lid.position.z = -0.3 - k * 1.0;
        it.lid.position.y = 0.98 + k * 0.5;
        it.lid.rotation.x = -k * 0.5;
        if (k >= 1) it.opening = false;
      }
    }
  }

  _openSarcophagus(it) {
    // guaranteed 1 orb drop inside
    if (this.cb.spawnOrbs) this.cb.spawnOrbs(it.x, it.z, PROPS.SARCOPHAGUS_ORB_DROP);
    // 30% wraith
    if (this.cb.onSpawnWraith && this.rng() < PROPS.SARCOPHAGUS_WRAITH_CHANCE) {
      this.cb.onSpawnWraith(it.x, it.z);
    }
    if (this.cb.onPropOpened) this.cb.onPropOpened({ x: it.x, z: it.z });
    if (this.bus && this.bus.emit) this.bus.emit('prop:opened', { x: it.x, z: it.z });
  }

  // ---------------------------------------------------------------------
  // HAZARDS (§7.3/§26) — visual-only emissive discs
  // ---------------------------------------------------------------------
  _buildHazard(x, z, kind) {
    const color = kind === 'acid' ? 0x88ff22 : 0xff5510;
    const geo = this._track(new THREE.CircleGeometry(1.1, 20));
    const mat = this._trackMat(new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    }));
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    this.group.add(m);
    this.meshes.push(m);
    this.hazards.push({ x, z, kind, tick: 0 });
    if (kind === 'lava' && this.cb.lavaHazard) this.cb.lavaHazard(x, z);
  }

  /**
   * Hazard tick driver — call from Game every frame.
   * Within HAZARD.DAMAGE_RADIUS of a pool center: HAZARD.TICK_DAMAGE damage
   * every HAZARD.TICK_INTERVAL (i-frames handled by the caller).
   * Returns accumulated tick damage this frame (0 or 1).
   */
  checkHazard(x, z) {
    for (const h of this.hazards) {
      const dx = h.x - x, dz = h.z - z;
      if (dx * dx + dz * dz <= HAZARD.DAMAGE_RADIUS * HAZARD.DAMAGE_RADIUS) {
        return { dmg: true, kind: h.kind, x: h.x, z: h.z };
      }
    }
    return { dmg: false };
  }

  /** Advance per-hazard tick timers; returns total damage ticks due this frame. */
  tickHazard(dt, x, z) {
    let due = 0;
    for (const h of this.hazards) {
      const dx = h.x - x, dz = h.z - z;
      const inside = dx * dx + dz * dz <= HAZARD.DAMAGE_RADIUS * HAZARD.DAMAGE_RADIUS;
      if (inside) {
        h.tick += dt;
        if (h.tick >= HAZARD.TICK_INTERVAL) {
          h.tick -= HAZARD.TICK_INTERVAL;
          due += HAZARD.TICK_DAMAGE;
        }
      } else {
        h.tick = 0;
      }
    }
    return due;
  }

  // ---------------------------------------------------------------------
  // WISPS (§7.3)
  // ---------------------------------------------------------------------
  _buildWisp(cx, cz, room, color) {
    const g = new THREE.Group();
    const geo = this._track(new THREE.SphereGeometry(0.18, 10, 8));
    const mat = this._trackMat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    const m = new THREE.Mesh(geo, mat);
    g.add(m);
    const src = LIGHT_SOURCES.WISP;
    const light = new THREE.PointLight(color, src.intensity, src.distance, src.decay);
    light.position.y = 0;
    light.castShadow = false;
    g.add(light);
    this.lightList.push(light);
    g.position.set(cx + (this.rng() - 0.5) * 2, 1.2, cz + (this.rng() - 0.5) * 2);
    this.group.add(g);
    this.meshes.push(g);
    const margin = 0.5;
    this.wisps.push({
      group: g, light,
      cx, cz,
      ang: this.rng() * Math.PI * 2,
      speed: 0.6 + this.rng() * 0.5,
      bounds: {
        minX: (room.cx + margin / CELL) * CELL,
        maxX: (room.cx + room.w - margin / CELL) * CELL,
        minZ: (room.cz + margin / CELL) * CELL,
        maxZ: (room.cz + room.h - margin / CELL) * CELL,
      },
    });
  }

  /** Wisps patrol a 2 u radius at y 1.2 around the room center, bouncing at room bounds. */
  _updateWisps(dt, now) {
    for (const w of this.wisps) {
      const p = w.group.position;
      w.ang += dt * w.speed;
      let nx = w.cx + Math.cos(w.ang) * 2;
      let nz = w.cz + Math.sin(w.ang) * 2;
      // bounce at room bounds
      if (nx < w.bounds.minX) { nx = w.bounds.minX; w.ang = Math.PI - w.ang; }
      else if (nx > w.bounds.maxX) { nx = w.bounds.maxX; w.ang = Math.PI - w.ang; }
      if (nz < w.bounds.minZ) { nz = w.bounds.minZ; w.ang = -w.ang; }
      else if (nz > w.bounds.maxZ) { nz = w.bounds.maxZ; w.ang = -w.ang; }
      p.x = nx;
      p.z = nz;
      p.y = 1.2 + Math.sin(now * 2 + w.cx) * 0.15;
    }
  }

  // ---------------------------------------------------------------------
  // MUSHROOMS / CRYSTALS (light-emitting clusters)
  // ---------------------------------------------------------------------
  _buildMushroomCluster(x, z, toxic, roomCenter) {
    const g = new THREE.Group();
    const stemGeo = this._track(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 6));
    const capGeo = this._track(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const stemMat = this._mat(0xccccbb);
    const capMat = this._mat(toxic ? 0x99ff33 : 0x44ff88, {
      emissive: toxic ? 0x558811 : 0x11aa55, emissiveIntensity: 0.8,
    });
    for (let i = 0; i < 4; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = this.rng() * 0.3;
      const sx = Math.cos(a) * r, sz = Math.sin(a) * r;
      const h = 0.2 + this.rng() * 0.25;
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(sx, h / 2, sz);
      stem.scale.y = h / 0.35;
      g.add(stem);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(sx, h, sz);
      g.add(cap);
    }
    g.position.set(x, 0, z);
    this.group.add(g);
    this.meshes.push(g);
    const src = LIGHT_SOURCES.MUSHROOM; // 3.2, dist 12, decay 1.2, no shadow
    this._addPointLight(toxic ? 0xaaff44 : 0x66ff99, x, 0.6, z, src, g, { cosmetic: true });
    // mushroom clusters are cosmetic for degrade purposes (spec §22)
    this.cosmetic.push(g);
  }

  _buildCrystalCluster(x, z, n) { // biome light prop — never degraded
    const g = new THREE.Group();
    const geo = this._track(new THREE.ConeGeometry(0.15, 0.9, 5));
    const mat = this._mat(0xcc88ff, { emissive: 0xaa55ff, emissiveIntensity: 0.9, roughness: 0.3 });
    for (let i = 0; i < n * 3; i++) {
      const m = new THREE.Mesh(geo, mat);
      const a = this.rng() * Math.PI * 2;
      const r = this.rng() * 0.35;
      m.position.set(Math.cos(a) * r, 0.45, Math.sin(a) * r);
      m.rotation.set((this.rng() - 0.5) * 0.5, this.rng() * Math.PI, (this.rng() - 0.5) * 0.5);
      m.castShadow = false;
      g.add(m);
    }
    g.position.set(x, 0, z);
    this.group.add(g);
    this.meshes.push(g);
    const src = LIGHT_SOURCES.CRYSTAL;
    this._addPointLight(0xcc88ff, x, 0.8, z, src); // biome light prop — never degraded
  }

  _buildDecor(name, x, z, room, biomeId) {
    // decorative / structural flavor; purely cosmetic unless noted
    let g = new THREE.Group();
    const add = (mesh, y = 0.1) => { mesh.position.y = y; mesh.castShadow = true; g.add(mesh); };
    switch (name) {
      case 'rubble': {
        const geo = this._track(new THREE.DodecahedronGeometry(0.3, 0));
        const mat = this._mat(0x55504a);
        add(new THREE.Mesh(geo, mat), 0.15);
        break;
      }
      case 'skullPile': {
        const geo = this._track(new THREE.SphereGeometry(0.18, 8, 6));
        const mat = this._mat(0xd8d4c8);
        for (let i = 0; i < 3; i++) {
          const m = new THREE.Mesh(geo, mat);
          m.position.x += (this.rng() - 0.5) * 0.4;
          m.position.z += (this.rng() - 0.5) * 0.4;
          g.add(m);
        }
        break;
      }
      case 'bones': {
        const geo = this._track(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 5));
        const mat = this._mat(0xe8e4d8);
        const m = new THREE.Mesh(geo, mat);
        m.rotation.z = Math.PI / 2;
        g.add(m);
        break;
      }
      case 'pillar': {
        const geo = this._track(new THREE.CylinderGeometry(0.4, 0.45, CEIL_Y, 8));
        const mat = this._mat(0x77716a);
        g.add(new THREE.Mesh(geo, mat)).position.y = CEIL_Y / 2;
        break;
      }
      case 'candle': {
        const sGeo = this._track(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 6));
        const cGeo = this._track(new THREE.SphereGeometry(0.06, 6, 6));
        const sMat = this._mat(0xeee8dd);
        const cMat = this._mat(0xffcc66, { emissive: 0xffaa22, emissiveIntensity: 1.5 });
        const s = new THREE.Mesh(sGeo, sMat); s.position.y = 0.2; g.add(s);
        const c = new THREE.Mesh(cGeo, cMat); c.position.y = 0.45; g.add(c);
        break;
      }
      case 'goldPile': {
        const geo = this._track(new THREE.IcosahedronGeometry(0.2, 0));
        const mat = this._mat(0xffcc33, { metalness: 0.8, roughness: 0.3 });
        for (let i = 0; i < 4; i++) {
          const m = new THREE.Mesh(geo, mat);
          m.position.set((this.rng() - 0.5) * 0.6, 0.1, (this.rng() - 0.5) * 0.6);
          g.add(m);
        }
        break;
      }
      case 'anvil': {
        const geo = this._track(new THREE.BoxGeometry(0.7, 0.4, 0.4));
        const mat = this._mat(0x444444, { metalness: 0.7, roughness: 0.4 });
        g.add(new THREE.Mesh(geo, mat)).position.y = 0.35;
        break;
      }
      case 'bookshelf': {
        const geo = this._track(new THREE.BoxGeometry(1.2, 2.4, 0.5));
        const mat = this._mat(0x5a3a1a);
        g.add(new THREE.Mesh(geo, mat)).position.y = 1.2;
        break;
      }
      case 'weaponRack': {
        const geo = this._track(new THREE.BoxGeometry(1.4, 1.8, 0.3));
        const mat = this._mat(0x4a3a2a);
        g.add(new THREE.Mesh(geo, mat)).position.y = 0.9;
        break;
      }
      case 'altar': {
        const geo = this._track(new THREE.BoxGeometry(1.4, 1.0, 1.0));
        const mat = this._mat(0x8a7340, { metalness: 0.4 });
        g.add(new THREE.Mesh(geo, mat)).position.y = 0.5;
        break;
      }
      case 'chain': {
        const geo = this._track(new THREE.CylinderGeometry(0.05, 0.05, CEIL_Y, 5));
        const mat = this._mat(0x555555, { metalness: 0.8 });
        g.add(new THREE.Mesh(geo, mat)).position.y = CEIL_Y / 2;
        break;
      }
      default:
        break;
    }
    g.position.set(x, 0, z);
    this.group.add(g);
    this.meshes.push(g);
    this.cosmetic.push(g);
    // candle: attach a small cosmetic flame light at world position
    if (name === 'candle') {
      const src = { intensity: 1.2, distance: 6, decay: 1.5 };
      this._addPointLight(0xffbb44, x, 0.5, z, src, g, { cosmetic: true });
    }
  }

  // ---------------------------------------------------------------------
  // INSTANCED DECORATIVES (§13: one InstancedMesh per type per level)
  // ---------------------------------------------------------------------
  _buildInstancedStalactites(spots, poolSize) {
    const count = Math.min(spots.length, poolSize);
    if (count === 0) return;
    const geo = this._track(new THREE.ConeGeometry(0.35, 1.6, 5));
    const mat = this._mat(0x55504a, { roughness: 1 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = false;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    for (let i = 0; i < count; i++) {
      const s = spots[i];
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(s.x, CEIL_Y - 0.8 * s.s, s.z),
        q,
        new THREE.Vector3(s.s, s.s, s.s)
      );
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.instanced.push({ mesh, full: count, type: 'stalactite', spots, geo, mat, q });
  }

  _buildInstancedWater(spots, poolSize) {
    const count = Math.min(spots.length, poolSize);
    if (count === 0) return;
    const geo = this._track(new THREE.CircleGeometry(1, 16));
    const mat = this._trackMat(new THREE.MeshBasicMaterial({
      color: 0x2288cc, transparent: true, opacity: 0.55,
    }));
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < count; i++) {
      const s = spots[i];
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(s.x, 0.02, s.z),
        q,
        new THREE.Vector3(s.r, s.r, s.r)
      );
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.instanced.push({ mesh, full: count, type: 'water', spots, geo, mat, q });
  }

  _buildInstancedSkulls(spots) {
    const count = spots.length;
    if (count === 0) return;
    const geo = this._track(new THREE.SphereGeometry(0.2, 8, 6));
    const mat = this._mat(0xd8d4c8);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const s = spots[i];
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(s.x, 0.15, s.z),
        q,
        new THREE.Vector3(1, 0.8, 1)
      );
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.instanced.push({ mesh, full: count, type: 'skull', spots, geo, mat, q });
  }

  _buildInstancedBooks(spots) {
    const count = spots.length;
    if (count === 0) return;
    const geo = this._track(new THREE.BoxGeometry(0.35, 0.1, 0.25));
    const mat = this._mat(0x7a2020);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const s = spots[i];
      const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s.ry, 0));
      const m4 = new THREE.Matrix4().compose(
        new THREE.Vector3(s.x, 0.05, s.z),
        q2,
        new THREE.Vector3(1, 1, 1)
      );
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.meshes.push(mesh);
    this.instanced.push({ mesh, full: count, type: 'book', spots, geo, mat, q: new THREE.Quaternion() });
  }

  // ---------------------------------------------------------------------
  // UPDATE
  // ---------------------------------------------------------------------
  /**
   * Per-frame update.
   * @param {number} dt — seconds
   * @param {number} playerX
   * @param {number} playerZ
   */
  update(dt, playerX, playerZ, now = performance.now() / 1000) {
    if (this.disposed) return;
    this._updateInteractives(playerX, playerZ, dt);
    this._updateWisps(dt, now);
    this._updateDebris(dt);
  }

  _updateDebris(dt) {
    if (this._debris.length) {
      for (let i = this._debris.length - 1; i >= 0; i--) {
        const d = this._debris[i];
        const u = d.userData.debris;
        u.life -= dt;
        if (u.life <= 0) {
          this.group.remove(d);
          this.meshes.splice(this.meshes.indexOf(d), 1);
          this._debris.splice(i, 1);
          continue;
        }
        u.vy -= 6 * dt;
        d.position.x += u.vx * dt;
        d.position.y += u.vy * dt;
        d.position.z += u.vz * dt;
        if (d.position.y < 0.05) d.position.y = 0.05;
      }
    }
    if (this._smoke.length) {
      for (let i = this._smoke.length - 1; i >= 0; i--) {
        const s = this._smoke[i];
        const u = s.userData.smoke;
        u.life -= dt;
        if (u.life <= 0) {
          this.group.remove(s);
          this.meshes.splice(this.meshes.indexOf(s), 1);
          this._smoke.splice(i, 1);
          continue;
        }
        s.position.y += dt;
        s.material.opacity = 0.5 * (u.life / 0.6);
      }
    }
  }

  // ---------------------------------------------------------------------
  // DEGRADED MODE (§22)
  // ---------------------------------------------------------------------
  /**
   * @param {number} ratio — 0.5 → hide 50% of purely cosmetic props and
   *                         halve instanced water/stalactite counts.
   *                         Never touches hazards, breakables, interactives,
   *                         structural props or biome light props.
   */
  reduceDecorations(ratio = 0.5) {
    if (this.disposed || this.degraded) return;
    this.degraded = true;
    // random 50% of cosmetic prop groups (rubble, skull piles, blood decals,
    // anvils, chains, candles, ice crystals, mushrooms — lights included)
    for (const g of this.cosmetic) {
      if (this.rng() < ratio) {
        g.visible = false;
        // hide that group's own cosmetic point lights
        for (const l of this._cosmeticLights) {
          if (l.userData.owner === g) l.visible = false;
        }
      }
    }
    // shed tail instances of water/stalactite meshes (count halved)
    for (const inst of this.instanced) {
      if (inst.type === 'water' || inst.type === 'stalactite') {
        const keep = Math.max(0, Math.floor(inst.full * (1 - ratio)));
        inst.mesh.count = keep;
        inst.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------------------
  // COLLISION (exposed for Game §5.4/§26 — appended before enemy spawn)
  // ---------------------------------------------------------------------
  /** All prop AABBs (breakables + interactives). */
  collidableBoxes() {
    const out = [];
    for (const b of this.breakables) out.push(b.box);
    for (const it of this.interactives) out.push(it.box);
    return out;
  }

  // ---------------------------------------------------------------------
  // DISPOSE (§14)
  // ---------------------------------------------------------------------
  _disposeObject(obj) {
    obj.traverse(child => {
      if (child.geometry && this.geometries.includes(child.geometry) === false) {
        // geometry may be shared/tracked; still dispose if not in list
      }
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    });
  }

  dispose() {
    if (this.disposed) return; // guard against double dispose
    this.disposed = true;
    for (const mesh of this.meshes) {
      if (mesh.isInstancedMesh) mesh.dispose();
      this.scene.remove(mesh);
    }
    for (const light of this.lightList) {
      this.scene.remove(light);
    }
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.scene.remove(this.group);
    this.group.clear();
    this.breakables.length = 0;
    this.interactives.length = 0;
    this.hazards.length = 0;
    this.wisps.length = 0;
    this.cosmetic.length = 0;
    this.instanced.length = 0;
    this.lightList.length = 0;
    this.geometries.length = 0;
    this.materials.length = 0;
    this.meshes.length = 0;
    this._cosmeticLights = [];
  }
}

export default PropSystem;

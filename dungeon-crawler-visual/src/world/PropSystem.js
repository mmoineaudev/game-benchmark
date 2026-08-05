import * as THREE from 'three';
import { WORLD, PROPS, LIGHT_SOURCES } from '../core/Constants.js';
import { generateGlowTexture } from './Textures.js';
import { makeWood, makeStone, makeMetal, makeBone } from '../core/Materials.js';

// Props & decorations: breakables, interactives, structural collision props,
// and InstancedMesh decoratives. Placed per room type + biome rules (spec §6).
// Returns extra collision AABBs for pillars/bookshelves/sarcophagi so enemy
// pathing and the player respect them.
export class PropSystem {
  constructor(scene, dungeonData, biome, events) {
    this.scene = scene;
    this.data = dungeonData;
    this.biome = biome;
    this.events = events;
    this.collisionBoxes = [];
    this.breakables = []; // { mesh, x, z, radius, hp }
    this.interactives = []; // { mesh, x, z, radius, opened, ... }
    this.lavaPools = []; // { x, z, type, radius } — type: 'LAVA' | 'ACID' (BIOME_EXPANSION_PLAN §6.2)
    this._decoratives = []; // purely cosmetic props { objs, light } — perf safeguard target (Game degraded mode)
    this._textures = [];
    this._mats = [];
    this._shards = []; // pooled debris shards
    this._added = []; // every scene-added object, for clean removal in dispose()
    // Instanced decoratives (1 draw call per type per level):
    this._stalactiteMesh = null;   // ceiling cones, biome-tinted
    this._waterMesh = null;        // FLOODED_RUINS pools (shared material, global pulse)
    this._waterMat = null;
    this._waterPulsePhase = Math.random() * 10;
  }

  _add(obj) {
    this.scene.add(obj);
    this._added.push(obj);
    return obj;
  }

  place() {
    const cs = this.data.cellSize;
    const rooms = this._collectRooms();
    for (const room of rooms) {
      const count = PROPS.PROPS_PER_ROOM[room.type] || 6;
      const placed = { breakables: 0, interactives: 0, total: 0 };
      this._placeRoomProps(room, count, placed);
    }
    return { collisionBoxes: this.collisionBoxes };
  }

  _collectRooms() {
    // Dedup multi-cell rooms -> { type, cx, cz, w, h, cx0, cz0 }
    const rooms = [];
    const seen = new Set();
    const gs = this.data.gridSize;
    for (let cz = 0; cz < gs; cz++) {
      for (let cx = 0; cx < gs; cx++) {
        const meta = this.data.metadata[cz][cx];
        if (meta.type !== 'room') continue;
        let rx = cx, rz = cz;
        while (rz > 0 && this.data.metadata[rz - 1][cx].type === 'room') rz--;
        while (rx > 0 && this.data.metadata[cz][rx - 1].type === 'room') rx--;
        const key = `${rx},${rz}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Compute extent
        let w = 1, h = 1;
        while (rx + w < gs && this.data.metadata[rz][rx + w].type === 'room') w++;
        while (rz + h < gs && this.data.metadata[rz + h][rx].type === 'room') h++;
        rooms.push({ type: meta.roomType || 'CHAMBER', cx: rx, cz: rz, w, h });
      }
    }
    return rooms;
  }

  _cellCenter(cx, cz) {
    const cs = this.data.cellSize;
    return { x: cx * cs + cs / 2, z: cz * cs + cs / 2 };
  }

  _inRoom(room, x, z) {
    const cs = this.data.cellSize;
    return x >= room.cx * cs + 0.5 && x < (room.cx + room.w) * cs - 0.5
      && z >= room.cz * cs + 0.5 && z < (room.cz + room.h) * cs - 0.5;
  }

  _randomPointInRoom(room, margin = 1.0) {
    const cs = this.data.cellSize;
    const x = room.cx * cs + margin + Math.random() * (room.w * cs - margin * 2);
    const z = room.cz * cs + margin + Math.random() * (room.h * cs - margin * 2);
    return { x, z };
  }

  // Random point that also keeps the spawn/exit cells clear (structural
  // props like pillars/bookshelves must never cover the player's spawn).
  _randomPointInRoomClear(room, margin = 1.0) {
    for (let i = 0; i < 20; i++) {
      const p = this._randomPointInRoom(room, margin);
      if (this._nearEntrance(p.x, p.z)) continue;
      if (this._nearExit(p.x, p.z)) continue;
      return p;
    }
    return this._randomPointInRoom(room, margin);
  }

  _nearExit(x, z) {
    const exit = this.data.exitCell;
    const ex = exit.x * this.data.cellSize + this.data.cellSize / 2;
    const ez = exit.z * this.data.cellSize + this.data.cellSize / 2;
    return (x - ex) ** 2 + (z - ez) ** 2 < 4;
  }

  // Keep the player spawn spot clear — no decorative/structural props within
  // ~2u of the entrance cell center (spawning inside a prop is unplayable).
  _nearEntrance(x, z) {
    const ent = this.data.entranceCell;
    if (!ent) return false;
    const cs = this.data.cellSize;
    const ex = ent.x * cs + cs / 2;
    const ez = ent.z * cs + cs / 2;
    return (x - ex) ** 2 + (z - ez) ** 2 < 4;
  }

  _placeRoomProps(room, count, placed) {
    const is = (roomType) => room.type === roomType;
    const biome = this.biome;
    let attempts = 0;
    const maxAttempts = count * 20;
    let placedTotal = 0;

    while (placedTotal < count && attempts < maxAttempts) {
      attempts++;
      const p = this._randomPointInRoom(room);
      if (this._nearExit(p.x, p.z)) continue;
      if (this._nearEntrance(p.x, p.z)) continue;
      if (!this._inRoom(room, p.x, p.z)) continue;

      // Pick a prop from the weighted room+biome pool
      const prop = this._pickProp(room, biome);
      if (!prop) continue;

      // Structural props have fixed counts per room type (not density-driven)
      if (prop === 'PILLAR' || prop === 'BOOKSHELF') {
        const need = is('ARENA') && prop === 'PILLAR' ? 4 : 0;
        if (prop === 'PILLAR' && !is('ARENA') && !is('VAULT')) continue;
        continue; // handled by dedicated placement below
      }

      const placedOk = this._spawnProp(prop, p.x, p.z, room, placed);
      if (placedOk) { placedTotal++; placed.total++; }
    }

    // Dedicated structural placements
    if (is('ARENA')) this._placePillars(room, 4);
    if (is('VAULT')) this._placePillars(room, 2 + Math.floor(Math.random() * 3)); // 2-4
    if (is('LIBRARY')) this._placeBookshelves(room, 6 + Math.floor(Math.random() * 3)); // 6-8
    if (is('CRYPT')) this._placeSarcophagi(room, 2 + Math.floor(Math.random() * 2)); // 2-3
    if (is('ARMORY')) this._placeWeaponRacks(room, 4);
    // Will-o'-wisps: 1-2 per CRYPT room (crypt) or 1 per room (flooded ruins)
    if (is('CRYPT') && biome === 'HAUNTED_CRYPT') {
      this._placeWisps(room, 1 + Math.floor(Math.random() * 2), LIGHT_SOURCES.WISP.color); // 1-2
    }
    if (biome === 'FLOODED_RUINS') {
      this._placeWisps(room, 1, 0x55ddcc); // 1 aqua wisp per room (plan §6.1)
    }
    // --- Biome expansion: new room types (BIOME_EXPANSION_PLAN §4.1) ---
    if (is('CRYSTAL_CHAMBER')) {
      // Signature room: 3 crystal clusters + magenta stalactites
      for (let i = 0; i < 3; i++) {
        const p = this._randomPointInRoomClear(room, 1.2);
        this._spawnCrystalCluster(p.x, p.z);
      }
      const sp = this._randomPointInRoom(room, 1.2);
      this._spawnStalactite(sp.x, sp.z);
    }
    if (is('TEMPLE')) {
      this._placePillars(room, 2); // 2 pillars (gold-tinted via biome)
      const c = this._cellCenter(room.cx + room.w / 2, room.cz + room.h / 2);
      const cs = this.data.cellSize;
      // Altar centered on the back wall of the room
      this._spawnAltar(c.x, (room.cz + room.h) * cs - 1.2);
    }
  }

  _placeWisps(room, count, color) {
    for (let i = 0; i < count; i++) {
      const c = this._cellCenter(room.cx + room.w / 2, room.cz + room.h / 2);
      const spriteMat = new THREE.SpriteMaterial({
        map: generateGlowTexture(),
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.setScalar(0.5);
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xccffdd }),
      );
      const light = new THREE.PointLight(
        color, LIGHT_SOURCES.WISP.intensity,
        LIGHT_SOURCES.WISP.distance, LIGHT_SOURCES.WISP.decay,
      );
      this.wisps = this.wisps || [];
      this.wisps.push({
        sprite, core, light,
        cx: c.x, cz: c.z,       // patrol center (room center)
        radius: 2, speed: 0.5, y: 1.2,
        phase: Math.random() * Math.PI * 2,
        dir: 1,                  // patrol direction (bounce reverses)
      });
      this._add(sprite);
      this._add(core);
      this._add(light);
    }
  }

  _pickProp(room, biome) {
    const pool = [];
    const add = (p, w) => pool.push([p, w]);

    // Biome-generic decoratives
    add('BARREL', room.type === 'CHAMBER' || room.type === 'VAULT' ? 3 : 1);
    add('CRATE', room.type === 'CHAMBER' || room.type === 'HALL' ? 2 : 1);
    add('CHAIN', ['HALL', 'VAULT', 'ARMORY'].includes(room.type) ? 2 : 0);

    // Biome-specific (no hanging decorations — only chains hang from the ceiling)
    if (biome === 'HAUNTED_CRYPT' || biome === 'FUNGAL_CAVERN') {
      add('SKULL_PILE', room.type === 'CRYPT' || room.type === 'LIBRARY' ? 3 : 1);
      if (room.type === 'CRYPT' || room.type === 'ARENA') add('BLOOD', 2);
    }
    if (biome === 'FUNGAL_CAVERN' || biome === 'VOLCANIC_DEPTHS' || biome === 'FROZEN_HALLS') {
      add('RUBBLE', 1);
    }
    if (biome === 'FROZEN_HALLS') add('ICE_CRYSTAL', 2);
    if (biome === 'FUNGAL_CAVERN') add('GLOWING_MUSHROOM', 3);
    if (biome === 'VOLCANIC_DEPTHS') add('LAVA_POOL', 2);
    if (room.type === 'LIBRARY' || room.type === 'CRYPT' || room.type === 'HALL') {
      add('CANDLE', room.type === 'LIBRARY' ? 4 : 2);
    }
    if (biome === 'STONE') add('RUBBLE', 2);
    // --- Biome expansion: per-biome prop sets (BIOME_EXPANSION_PLAN §5.2) ---
    if (biome === 'CRYSTAL_DEPTHS') {
      add('CRYSTAL_CLUSTER', 3); // 1 light cluster per room (perf cap §5.1)
      add('STALACTITE', 2);      // magenta-tinted ceiling cones
      add('RUBBLE', 1);
    }
    if (biome === 'POISON_SWAMP') {
      add('ACID_POOL', 2);       // hazard pool (POOLS.ACID)
      add('STALACTITE', 2);      // toxic-green tint
      add('RUBBLE', 1);
      add('GLOWING_MUSHROOM', 3); // toxic recolors (cap 0xccff44)
    }
    if (biome === 'GOLDEN_TEMPLE') {
      add('RUBBLE', 1);
      add('CHAIN', 2);
    }
    if (biome === 'FLOODED_RUINS') {
      add('WATER_POOL', 2);      // decorative, instanced (no hazard)
      add('RUBBLE', 1);
      add('CHAIN', 2);
    }
    if (biome === 'EMBER_FORGE') {
      add('ANVIL', 2);
      add('LAVA_POOL', 2);       // lava pools reused as-is (§5.2)
      add('RUBBLE', 1);
      add('CHAIN', 2);
    }

    const sum = pool.reduce((a, [, w]) => a + w, 0);
    if (sum <= 0) return null;
    let r = Math.random() * sum;
    for (const [p, w] of pool) {
      r -= w;
      if (r <= 0) return p;
    }
    return pool[pool.length - 1][0];
  }

  _spawnProp(prop, x, z, room, placed) {
    const cs = this.data.cellSize;
    switch (prop) {
      case 'BARREL': return this._spawnBarrel(x, z, placed);
      case 'CRATE': return this._spawnCrate(x, z, placed);
      case 'CHAIN': return this._spawnChain(x, z);
      case 'SKULL_PILE': return this._spawnSkullPile(x, z);
      case 'BLOOD': return this._spawnBlood(x, z);
      case 'ICE_CRYSTAL': return this._spawnIceCrystal(x, z);
      case 'GLOWING_MUSHROOM': return this._spawnMushroom(x, z);
      case 'LAVA_POOL': return this._spawnLava(x, z);
      case 'CANDLE': return this._spawnCandle(x, z);
      case 'RUBBLE': return this._spawnRubble(x, z);
      // --- Biome expansion: new props (BIOME_EXPANSION_PLAN §5.1) ---
      case 'CRYSTAL_CLUSTER': return this._spawnCrystalCluster(x, z);
      case 'ACID_POOL': return this._spawnLava(x, z, 'ACID');
      case 'WATER_POOL': return this._spawnWater(x, z);
      case 'ANVIL': return this._spawnAnvil(x, z);
      case 'STALACTITE': return this._spawnStalactite(x, z);
      default: return false;
    }
  }

  // ------------------------------------------------------------ breakables

  _spawnBarrel(x, z, placed) {
    if (placed.breakables >= PROPS.MAX_BREAKABLES_PER_ROOM) return false;
    placed.breakables++;
    const group = new THREE.Group();
    const wood = makeWood(0x6a4a2a, { seed: 71, rough: 0.8, metal: 0.1 });
    const band = makeMetal(0x3a3a3a, { seed: 73, rough: 0.4, metal: 0.7 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 10), wood);
    body.position.y = 0.45;
    body.castShadow = true;
    group.add(body);
    for (const y of [0.2, 0.7]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.08, 10), band);
      b.position.y = y;
      group.add(b);
    }
    group.position.set(x, 0, z);
    this._add(group);
    this._mats.push(wood, band);
    this.breakables.push({ group, x, z, radius: 0.5, hp: PROPS.BREAKABLE_HP, type: 'BARREL', shards: 6 });
    return true;
  }

  _spawnCrate(x, z, placed) {
    if (placed.breakables >= PROPS.MAX_BREAKABLES_PER_ROOM) return false;
    placed.breakables++;
    const group = new THREE.Group();
    const wood = makeWood(0x7a5a3a, { seed: 79, rough: 0.8, metal: 0.1 });
    const plank = makeWood(0x5a3a2a, { seed: 83, rough: 0.8, metal: 0.1 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), wood);
    box.position.y = 0.5;
    box.castShadow = true;
    group.add(box);
    for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), plank);
      p.position.set(sx * 0.3, 0.5, sz * 0.3);
      group.add(p);
    }
    group.position.set(x, 0, z);
    group.rotation.y = Math.random() * Math.PI;
    this._add(group);
    this._mats.push(wood, plank);
    this.breakables.push({ group, x, z, radius: 0.55, hp: PROPS.BREAKABLE_HP, type: 'CRATE', shards: 8 });
    return true;
  }

  // ---------------------------------------------------------- decoratives

  _spawnChain(x, z) {
    const mat = makeMetal(0x4a4a52, { seed: 89, rough: 0.4, metal: 0.8 });
    // Variable chain length: hangs from the ceiling down toward the player's
    // head height (never below it). Max length reaches ~player eye height.
    const maxLen = WORLD.WALL_HEIGHT - 0.2 - WORLD.PLAYER_EYE_HEIGHT;
    const chainLen = 3 + Math.random() * Math.max(1, maxLen - 3);
    // Hang the chain from the ceiling, with a torch fixture at its bottom end.
    const group = new THREE.Group();
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, chainLen, 6), mat);
    chain.position.y = -chainLen / 2;
    group.add(chain);

    // Small iron cup holding the flame at the chain's extremity
    const cupGeo = new THREE.CylinderGeometry(0.12, 0.1, 0.16, 8);
    const cup = new THREE.Mesh(cupGeo, mat);
    cup.position.y = -chainLen - 0.05;
    group.add(cup);

    // Flame cone
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xff8830 });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 6, 1), flameMat);
    flame.position.y = -chainLen - 0.16;
    group.add(flame);

    // Point light casting a wide warm pool at floor level
    const light = new THREE.PointLight(
      0xff9944, 6, 21, 1.2,   // distance 26 -20% = 21
    );
    light.position.y = -chainLen - 0.2;
    group.add(light);

    group.position.set(x, WORLD.WALL_HEIGHT + 0.2, z);
    this._add(group);
    this._decoratives.push({ objs: [group] }); // light is a group child — hidden with it
    this._mats.push(mat, flameMat);
    this._chainLights = this._chainLights || [];
    this._chainLights.push({ light, phase: Math.random() * 10 });
    return true;
  }

  _spawnSkullPile(x, z) {
    // 8 skulls, instanced per pile via small meshes (kept cheap)
    const bone = makeBone(0xcfc6b0, { seed: 101, rough: 0.85, metal: 0.05 });
    const geo = new THREE.SphereGeometry(0.12, 6, 5);
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Mesh(geo, bone);
      s.position.set(
        x + (Math.random() - 0.5) * 0.8,
        0.08 + Math.random() * 0.15,
        z + (Math.random() - 0.5) * 0.8,
      );
      s.scale.y = 0.8;
      s.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      this._add(s);
      this._decoratives.push({ objs: [s] });
    }
    this._mats.push(bone);
    return true;
  }

  _spawnBlood(x, z) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#3a0a0a';
    for (let i = 0; i < 12; i++) {
      const r = Math.random() * size * 0.1 + 2;
      ctx.beginPath();
      ctx.arc(size / 2 + (Math.random() - 0.5) * size * 0.4, size / 2 + (Math.random() - 0.5) * size * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(canvas);
    this._textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.5, depthWrite: false,
    });
    const scale = 0.8 + Math.random() * 0.8;
    const blood = new THREE.Mesh(new THREE.PlaneGeometry(scale, scale), mat);
    blood.rotation.x = -Math.PI / 2;
    blood.position.set(x, 0.015, z);
    this._add(blood);
    this._decoratives.push({ objs: [blood] });
    return true;
  }

  _spawnRubble(x, z) {
    const mat = makeStone(0x3a3a40, { seed: 109, rough: 0.9, metal: 0.05 });
    const geo = new THREE.SphereGeometry(0.1, 4, 3);
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(geo, mat);
      r.position.set(x + (Math.random() - 0.5) * 1.2, 0.05 + Math.random() * 0.1, z + (Math.random() - 0.5) * 1.2);
      r.scale.setScalar(0.6 + Math.random() * 0.8);
      this._add(r);
      this._decoratives.push({ objs: [r] });
    }
    this._mats.push(mat);
    return true;
  }

  // ----------------------------------------------------------- structural

  _placePillars(room, count) {
    // Biome-tinted pillar stone (golden temple: warm gold; flooded ruins: teal)
    const tint = this.biome === 'GOLDEN_TEMPLE' ? 0x8a7a4a
      : this.biome === 'FLOODED_RUINS' ? 0x3a5a5e : 0x4a4a5a;
    const mat = makeStone(tint, { seed: 113, rough: 0.85, metal: 0.05 });
    const cs = this.data.cellSize;
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoomClear(room, 2.0);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.8, WORLD.WALL_HEIGHT, 0.8), mat);
      pillar.position.set(p.x, WORLD.WALL_HEIGHT / 2, p.z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this._add(pillar);
      this.collisionBoxes.push({
        minX: p.x - 0.4, maxX: p.x + 0.4, minZ: p.z - 0.4, maxZ: p.z + 0.4,
      });
    }
    this._mats.push(mat);
  }

  _placeBookshelves(room, count) {
    const wood = makeWood(0x5a3a2a, { seed: 127, rough: 0.85, metal: 0.1 });
    const shelfMat = makeWood(0x3a2a1a, { seed: 131, rough: 0.9, metal: 0.1 });
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoomClear(room, 1.5);
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 0.4), wood);
      shelf.position.set(p.x, 1.2, p.z);
      shelf.castShadow = true;
      this._add(shelf);
      for (let s = 0; s < 5; s++) {
        const plane = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.35), shelfMat);
        plane.position.set(p.x, 0.4 + s * 0.5, p.z);
        this._add(plane);
      }
      // Books (12 instanced boxes, random hues)
      for (let b = 0; b < 12; b++) {
        const hues = [0x8a3a3a, 0x3a5a8a, 0x5a7a3a, 0x8a7a3a, 0x5a3a7a];
        const bookMat = new THREE.MeshStandardMaterial({ color: hues[Math.floor(Math.random() * hues.length)], roughness: 0.8 });
        const book = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.06), bookMat);
        const bx = p.x + (Math.random() - 0.5) * 1.0;
        const by = 0.4 + Math.floor(Math.random() * 5) * 0.5 + 0.17;
        book.position.set(bx, by, p.z + (Math.random() > 0.5 ? 0.16 : -0.16));
        book.rotation.y = (Math.random() - 0.5) * 0.4;
        this._add(book);
      }
      this.collisionBoxes.push({
        minX: p.x - 0.7, maxX: p.x + 0.7, minZ: p.z - 0.2, maxZ: p.z + 0.2,
      });
    }
    this._mats.push(wood, shelfMat);
  }

  // --------------------------------------------------------- interactives

  _placeSarcophagi(room, count) {
    const stone = makeStone(0x6a6a5a, { seed: 137, rough: 0.9, metal: 0.05 });
    const lidMat = makeStone(0x7a7a6a, { seed: 139, rough: 0.9, metal: 0.05 });
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoomClear(room, 1.5);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 1.6), stone);
      base.position.set(p.x, 0.4, p.z);
      base.castShadow = true;
      this._add(base);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 1.7), lidMat);
      lid.position.set(p.x, 0.85, p.z);
      lid.castShadow = true;
      this._add(lid);
      this.collisionBoxes.push({
        minX: p.x - 0.5, maxX: p.x + 0.5, minZ: p.z - 0.8, maxZ: p.z + 0.8,
      });
      this.interactives.push({
        group: new THREE.Group(), base, lid, x: p.x, z: p.z,
        radius: 1.2, opened: false, openT: 0,
        type: 'SARCOPHAGUS',
      });
    }
    this._mats.push(stone, lidMat);
  }

  _placeWeaponRacks(room, count) {
    const wood = makeWood(0x4a3a2a, { seed: 149, rough: 0.8, metal: 0.1 });
    const metal = makeMetal(0x6a6a72, { seed: 151, rough: 0.4, metal: 0.9 });
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoomClear(room, 1.5);
      const stand = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.5), wood);
      stand.position.set(p.x, 0.05, p.z);
      this._add(stand);
      for (let w = 0; w < 3; w++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.7, 0.08), metal);
        blade.position.set(p.x - 0.4 + w * 0.4, 0.45, p.z);
        blade.castShadow = true;
        this._add(blade);
      }
    }
    this._mats.push(wood, metal);
  }

  // --------------------------------------------------------- light props

  _spawnCandle(x, z) {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.7 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffaa55 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 8), bodyMat);
    body.position.set(x, 0.09, z);
    this._add(body);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), flameMat);
    flame.position.set(x, 0.22, z);
    this._add(flame);
    const light = new THREE.PointLight(
      LIGHT_SOURCES.CANDLE.color, LIGHT_SOURCES.CANDLE.intensity,
      LIGHT_SOURCES.CANDLE.distance, LIGHT_SOURCES.CANDLE.decay,
    );
    light.position.set(x, 0.25, z);
    this._add(light);
    this._decoratives.push({ objs: [body, flame], light });
    this._mats.push(bodyMat, flameMat);
    return true;
  }

  _spawnIceCrystal(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9ad8ff, emissive: 0x66ccff, emissiveIntensity: 1.4,
      transparent: true, opacity: 0.8, roughness: 0.2,
    });
    const cluster = Math.floor(Math.random() * 3) + 3; // 3-5
    const meshes = [];
    for (let i = 0; i < cluster; i++) {
      const h = 0.5 + Math.random() * 0.7;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.1 + Math.random() * 0.1, h, 5), mat);
      c.position.set(
        x + (Math.random() - 0.5) * 1.5,
        h / 2,
        z + (Math.random() - 0.5) * 1.5,
      );
      c.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, 0);
      this._add(c);
      meshes.push(c);
    }
    const light = new THREE.PointLight(
      LIGHT_SOURCES.ICE.color, LIGHT_SOURCES.ICE.intensity,
      LIGHT_SOURCES.ICE.distance, LIGHT_SOURCES.ICE.decay,
    );
    light.position.set(x, 1.0, z);
    this._add(light);
    this._decoratives.push({ objs: meshes, light });
    this._mats.push(mat);
    return true;
  }

  _spawnMushroom(x, z) {
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.9 });
    // Poison swamp: toxic recolor (BIOME_EXPANSION_PLAN §5.2)
    const toxic = this.biome === 'POISON_SWAMP';
    const capColor = toxic ? 0xccff44 : 0x44ff88;
    const capMat = new THREE.MeshStandardMaterial({
      color: capColor, emissive: capColor, emissiveIntensity: 2.0, roughness: 0.6,
    });
    const cluster = Math.floor(Math.random() * 3) + 3; // 3-5
    const meshes = [];
    for (let i = 0; i < cluster; i++) {
      const h = 0.2 + Math.random() * 0.15;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6), stemMat);
      stem.position.set(x + (Math.random() - 0.5) * 1.5, h / 2, z + (Math.random() - 0.5) * 1.5);
      this._add(stem);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.1, 8), capMat);
      cap.position.set(stem.position.x, h + 0.05, stem.position.z);
      this._add(cap);
      meshes.push(stem, cap);
    }
    const light = new THREE.PointLight(
      LIGHT_SOURCES.MUSHROOM.color, LIGHT_SOURCES.MUSHROOM.intensity,
      LIGHT_SOURCES.MUSHROOM.distance, LIGHT_SOURCES.MUSHROOM.decay,
    );
    light.position.set(x, 0.5, z);
    this._add(light);
    this._decoratives.push({ objs: meshes, light });
    this._mats.push(stemMat, capMat);
    return true;
  }

  _spawnLava(x, z, type = 'LAVA') {
    // Pool hazard, keyed by PROPS.POOLS type (BIOME_EXPANSION_PLAN §6.2).
    // LAVA keeps its exact current numbers/colors; ACID is the poison recolor.
    const cfg = PROPS.POOLS[type] || PROPS.POOLS.LAVA;
    const mat = new THREE.MeshBasicMaterial({
      color: cfg.color, transparent: true, opacity: 0.85, depthWrite: false,
    });
    const radius = 1.5 + Math.random();
    const pool = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), mat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.02, z);
    this._add(pool);
    const lightCfg = type === 'ACID' ? LIGHT_SOURCES.ACID : LIGHT_SOURCES.LAVA;
    const light = new THREE.PointLight(
      lightCfg.color, lightCfg.intensity,
      lightCfg.distance, lightCfg.decay,
    );
    light.position.set(x, 0.6, z);
    this._add(light);
    this._mats.push(mat);
    this.lavaPools.push({ x, z, type, radius: cfg.radius });
    return true;
  }

  // -------------------------------------------------------------------------
  // Biome expansion props (BIOME_EXPANSION_PLAN §5.1)

  _spawnCrystalCluster(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcc88ff, emissive: 0xcc66ff, emissiveIntensity: 1.4,
      transparent: true, opacity: 0.8, roughness: 0.2,
    });
    const cluster = Math.floor(Math.random() * 3) + 3; // 3-5 crystals
    for (let i = 0; i < cluster; i++) {
      const h = 0.5 + Math.random() * 0.7;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.1 + Math.random() * 0.1, h, 5), mat);
      c.position.set(
        x + (Math.random() - 0.5) * 1.5,
        h / 2,
        z + (Math.random() - 0.5) * 1.5,
      );
      c.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, 0);
      this._add(c);
    }
    const light = new THREE.PointLight(
      LIGHT_SOURCES.CRYSTAL.color, LIGHT_SOURCES.CRYSTAL.intensity,
      LIGHT_SOURCES.CRYSTAL.distance, LIGHT_SOURCES.CRYSTAL.decay,
    );
    light.position.set(x, 1.0, z);
    this._add(light);
    this._mats.push(mat);
    return true;
  }

  _spawnWater(x, z) {
    // Instanced decorative pools: one InstancedMesh per level, shared material,
    // global opacity pulse (perf: 1 draw call total — §5.1).
    if (!this._waterMesh) {
      this._waterMat = new THREE.MeshBasicMaterial({
        color: 0x1a5a5a, transparent: true, opacity: 0.45, depthWrite: false,
      });
      const geo = new THREE.PlaneGeometry(1, 1);
      this._waterMesh = new THREE.InstancedMesh(geo, this._waterMat, 24);
      this._waterMesh.count = 0;
      this._waterMesh.rotation.x = -Math.PI / 2;
      this._add(this._waterMesh);
      this._mats.push(this._waterMat);
    }
    if (this._waterMesh.count >= this._waterMesh.instanceMatrix.count) return false;
    const i = this._waterMesh.count++;
    const scale = 1.5 + Math.random() * 1.5;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0.02, z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, 1),
    );
    this._waterMesh.setMatrixAt(i, m);
    this._waterMesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  _spawnAnvil(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a4a52, roughness: 0.4, metalness: 0.8,
    });
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), mat);
    body.position.y = 0.25;
    group.add(body);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 8), mat);
    horn.rotation.z = -Math.PI / 2;
    horn.position.set(0.35, 0.38, 0);
    group.add(horn);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 8), mat);
    base.position.y = 0.06;
    group.add(base);
    group.position.set(x, 0, z);
    group.rotation.y = Math.random() * Math.PI;
    this._add(group);
    this._decoratives.push({ objs: [group] });
    this._mats.push(mat);
    return true;
  }

  // -------------------------------------------------------------------------
  // Perf safeguard (Game degraded mode): hide `fraction` of purely cosmetic
  // props (+ their lights) in the CURRENT level. Gameplay items — hazards,
  // breakables, interactives, structural props, and biome light props
  // (crystal clusters, wisps, altars) — are never touched. Instanced meshes
  // (water pools, stalactites) shed their tail instances by count.
  reduceDecorations(fraction = 0.5) {
    for (const d of this._decoratives) {
      if (Math.random() < fraction) {
        for (const o of d.objs || []) o.visible = false;
        if (d.light) d.light.visible = false;
      }
    }
    for (const m of [this._waterMesh, this._stalactiteMesh]) {
      if (m && m.count > 0) m.count = Math.max(0, Math.floor(m.count * (1 - fraction)));
    }
  }

  _spawnAltar(x, z) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8b44a, roughness: 0.3, metalness: 0.8 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffcc66 });
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.2), stone);
    base.position.y = 0.25;
    group.add(base);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 1.26), gold);
    trim.position.y = 0.5;
    group.add(trim);
    for (const [fx, fz] of [[-0.2, 0], [0.2, 0]]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), flameMat);
      flame.position.set(fx, 0.62, fz);
      group.add(flame);
    }
    group.position.set(x, 0, z);
    this._add(group);
    const light = new THREE.PointLight(0xffcc66, 2.0, 8, 1.5);
    light.position.set(x, 1.0, z);
    this._add(light);
    this._mats.push(stone, gold, flameMat);
    return true;
  }

  _spawnStalactite(x, z) {
    // Instanced ceiling cones, biome-tinted (crystal: magenta, poison: green).
    if (!this._stalactiteMesh) {
      const tint = this.biome === 'CRYSTAL_DEPTHS' ? 0x6a4a8a : 0x6a6a2a;
      const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85 });
      const geo = new THREE.ConeGeometry(0.15, 1, 6);
      this._stalactiteMesh = new THREE.InstancedMesh(geo, mat, 60);
      this._stalactiteMesh.count = 0;
      this._add(this._stalactiteMesh);
      this._mats.push(mat);
    }
    const mesh = this._stalactiteMesh;
    if (mesh.count >= mesh.instanceMatrix.count) return false;
    const h = 0.6 + Math.random() * 0.6;
    const i = mesh.count++;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, WORLD.WALL_HEIGHT - h / 2, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, Math.random() * Math.PI)),
      new THREE.Vector3(0.5 + Math.random() * 0.5, 1, 1),
    );
    mesh.setMatrixAt(i, m);
    mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  _updateWisps(dt, time) {
    if (!this.wisps) return;
    const cs = this.data.cellSize;
    const gs = this.data.gridSize;
    for (const w of this.wisps) {
      w.phase += w.speed * dt * w.dir;
      // Patrol circle around room center; bounce when exiting room bounds
      let x = w.cx + Math.cos(w.phase) * w.radius;
      let z = w.cz + Math.sin(w.phase) * w.radius;
      const cx = Math.floor(x / cs);
      const cz = Math.floor(z / cs);
      if (cx < 0 || cz < 0 || cx >= gs || cz >= gs || this.data.grid[cz][cx] === 'empty') {
        w.dir *= -1;
        w.phase += w.speed * dt * w.dir;
        x = w.cx + Math.cos(w.phase) * w.radius;
        z = w.cz + Math.sin(w.phase) * w.radius;
      }
      const bob = Math.sin(time * 1.5 + w.phase) * 0.15;
      w.sprite.position.set(x, w.y + bob, z);
      w.core.position.copy(w.sprite.position);
      w.light.position.copy(w.sprite.position);
      // Flicker
      w.light.intensity = LIGHT_SOURCES.WISP.intensity * (1 + Math.sin(time * 3 + w.phase) * 0.15);
    }
  }

  // -------------------------------------------------------------- update

  update(dt, time, playerPos) {
    this._updateShards(dt);
    this._updateWisps(dt, time);
    // Water pools: global opacity pulse (1 shared material — §5.1)
    if (this._waterMat) {
      this._waterMat.opacity = 0.45 + Math.sin(time * 3 + this._waterPulsePhase) * 0.08;
    }
    // Hanging chain torch flames flicker gently
    if (this._chainLights) {
      for (const c of this._chainLights) {
        const flicker = Math.sin(time * 9 + c.phase) * 0.12 + Math.sin(time * 14 + c.phase * 2) * 0.08;
        c.light.intensity = 6 * (1 + flicker);
      }
    }
    // Interactive props (sarcophagus lid slide + wraith spawn handled once)
    for (const it of this.interactives) {
      if (it.opened && it.openT < 0.6) {
        it.openT += dt;
        it.lid.position.y = 0.85 + it.openT * 1.2;
        it.lid.position.z = it.z + it.openT * 0.8;
      }
      if (!it.opened) {
        const dx = playerPos.x - it.x;
        const dz = playerPos.z - it.z;
        if (dx * dx + dz * dz < PROPS.SARCOPHAGUS_TRIGGER ** 2) {
          it.opened = true;
          this.events?.emit('prop:opened', { type: 'SARCOPHAGUS', x: it.x, z: it.z });
        }
      }
    }
    // Lava hazard
    for (const lp of this.lavaPools) {
      const dx = playerPos.x - lp.x;
      const dz = playerPos.z - lp.z;
      if (dx * dx + dz * dz < lp.radius ** 2) {
        this.lavaHazard?.({ x: lp.x, z: lp.z });
      }
    }
  }

  // Breakable hit test: returns true if a breakable was hit
  hitBreakables(x, z) {
    for (const b of this.breakables) {
      const dx = x - b.x;
      const dz = z - b.z;
      if (dx * dx + dz * dz < b.radius ** 2) {
        b.hp--;
        if (b.hp <= 0) {
          this._breakProp(b);
          this.events?.emit('prop:broken', { type: b.type, x: b.x, z: b.z });
          return true;
        }
        return true;
      }
    }
    return false;
  }

  _breakProp(b) {
    const idx = this.breakables.indexOf(b);
    if (idx !== -1) this.breakables.splice(idx, 1);
    // Loot hook (Game: 5% chance to drop a temporary buff)
    this.onBreak?.(b.x, b.z);
    // Debris shards
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.8 });
    for (let i = 0; i < b.shards; i++) {
      const shard = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), shardMat);
      shard.position.set(b.x, 0.5, b.z);
      shard.velocity = {
        x: (Math.random() - 0.5) * 3,
        y: 1 + Math.random() * 2,
        z: (Math.random() - 0.5) * 3,
      };
      this._add(shard);
      this._shards.push({ mesh: shard, life: 0.6 });
    }
    this._mats.push(shardMat);
    this.scene.remove(b.group);
  }

  _updateShards(dt) {
    for (let i = this._shards.length - 1; i >= 0; i--) {
      const s = this._shards[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        this._shards.splice(i, 1);
        continue;
      }
      s.mesh.position.x += s.mesh.velocity.x * dt;
      s.mesh.position.y += s.mesh.velocity.y * dt;
      s.mesh.position.z += s.mesh.velocity.z * dt;
      s.mesh.velocity.y -= 4 * dt;
      if (s.mesh.position.y < 0.05) {
        s.mesh.position.y = 0.05;
        s.mesh.velocity.y *= -0.4;
        s.mesh.velocity.x *= 0.7;
        s.mesh.velocity.z *= 0.7;
      }
      s.mesh.rotation.x += dt * 5;
      s.mesh.rotation.z += dt * 4;
    }
  }

  dispose() {
    for (const b of this.breakables) this.scene.remove(b.group);
    for (const it of this.interactives) {
      this.scene.remove(it.base);
      this.scene.remove(it.lid);
    }
    for (const s of this._shards) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    for (const obj of this._added) {
      this.scene.remove(obj);
      obj.traverse?.((m) => {
        if (m.isMesh) {
          if (m.geometry) m.geometry.dispose();
          if (m.material && !m.material._propDisposed) {
            m.material._propDisposed = true;
            m.material.dispose();
          }
        }
      });
    }
    for (const c of this._chainLights || []) {
      if (c.light) c.light.dispose?.();
      this.scene.remove(c.light);
    }
    for (const m of this._mats) {
      if (!m._propDisposed) { m._propDisposed = true; m.dispose(); }
    }
    for (const t of this._textures) t.dispose();
    this.breakables = [];
    this.interactives = [];
    this.lavaPools = [];
    this._shards = [];
    this._added = [];
    this._chainLights = [];
    this._waterMesh = null;
    this._waterMat = null;
    this._stalactiteMesh = null;
    this._decoratives = [];
    this.collisionBoxes = [];
  }
}

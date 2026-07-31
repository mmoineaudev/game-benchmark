import * as THREE from 'three';
import { WORLD, PROPS, LIGHT_SOURCES } from '../core/Constants.js';
import { generateGlowTexture } from './Textures.js';

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
    this.lavaPools = []; // { x, z, radius }
    this._textures = [];
    this._mats = [];
    this._shards = []; // pooled debris shards
    this._added = []; // every scene-added object, for clean removal in dispose()
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

  _nearExit(x, z) {
    const exit = this.data.exitCell;
    const cs = this.data.cellSize;
    const ex = exit.x * cs + cs / 2;
    const ez = exit.z * cs + cs / 2;
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
    // Will-o'-wisps: 1-2 per CRYPT room (moving lights)
    if (is('CRYPT') && biome === 'HAUNTED_CRYPT') {
      this._placeWisps(room, 1 + Math.floor(Math.random() * 2)); // 1-2
    }
  }

  _placeWisps(room, count) {
    for (let i = 0; i < count; i++) {
      const c = this._cellCenter(room.cx + room.w / 2, room.cz + room.h / 2);
      const spriteMat = new THREE.SpriteMaterial({
        map: generateGlowTexture(),
        color: LIGHT_SOURCES.WISP.color,
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
        LIGHT_SOURCES.WISP.color, LIGHT_SOURCES.WISP.intensity,
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
    add('BANNER', ['HALL', 'VAULT', 'ARENA'].includes(room.type) ? 2 : 0);

    // Biome-specific
    if (biome === 'HAUNTED_CRYPT' || biome === 'FUNGAL_CAVERN') {
      add('SKULL_PILE', room.type === 'CRYPT' || room.type === 'LIBRARY' ? 3 : 1);
      add('ROOT', 1);
      if (room.type === 'CRYPT') add('WEB', 2);
      if (room.type === 'CRYPT' || room.type === 'ARENA') add('BLOOD', 2);
    }
    if (biome === 'FUNGAL_CAVERN' || biome === 'VOLCANIC_DEPTHS' || biome === 'FROZEN_HALLS') {
      add('STALACTITE', 2);
    }
    if (biome === 'FROZEN_HALLS') add('ICE_CRYSTAL', 2);
    if (biome === 'FUNGAL_CAVERN') add('GLOWING_MUSHROOM', 3);
    if (biome === 'VOLCANIC_DEPTHS') add('LAVA_POOL', 2);
    if (room.type === 'LIBRARY' || room.type === 'CRYPT' || room.type === 'HALL') {
      add('CANDLE', room.type === 'LIBRARY' ? 4 : 2);
    }
    if (['HALL', 'VAULT', 'ARENA'].includes(room.type) && biome !== 'FUNGAL_CAVERN') {
      add('CHANDELIER', 1);
    }
    if (biome === 'STONE') add('RUBBLE', 2);

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
      case 'BANNER': return this._spawnBanner(x, z, room);
      case 'SKULL_PILE': return this._spawnSkullPile(x, z);
      case 'ROOT': return this._spawnRoot(x, z);
      case 'WEB': return this._spawnWeb(x, z);
      case 'BLOOD': return this._spawnBlood(x, z);
      case 'STALACTITE': return this._spawnStalactite(x, z);
      case 'ICE_CRYSTAL': return this._spawnIceCrystal(x, z);
      case 'GLOWING_MUSHROOM': return this._spawnMushroom(x, z);
      case 'LAVA_POOL': return this._spawnLava(x, z);
      case 'CANDLE': return this._spawnCandle(x, z);
      case 'CHANDELIER': return this._spawnChandelier(x, z);
      case 'RUBBLE': return this._spawnRubble(x, z);
      default: return false;
    }
  }

  // ------------------------------------------------------------ breakables

  _spawnBarrel(x, z, placed) {
    if (placed.breakables >= PROPS.MAX_BREAKABLES_PER_ROOM) return false;
    placed.breakables++;
    const group = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.8 });
    const band = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.7 });
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
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 });
    const plank = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.8 });
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.4, metalness: 0.8 });
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.5, 6), mat);
    chain.position.set(x, WORLD.WALL_HEIGHT - 1.25, z);
    this._add(chain);
    this._mats.push(mat);
    return true;
  }

  _spawnBanner(x, z, room) {
    const palettes = {
      STONE: 0x7a2a2a, HAUNTED_CRYPT: 0x2a3a5a, FUNGAL_CAVERN: 0x2a5a3a,
      VOLCANIC_DEPTHS: 0x7a3a1a, FROZEN_HALLS: 0x2a4a6a,
    };
    const mat = new THREE.MeshStandardMaterial({
      color: palettes[this.biome] || 0x7a2a2a,
      side: THREE.DoubleSide, roughness: 0.9,
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8), mat);
    banner.position.set(x, 2.2, z);
    banner.rotation.y = Math.random() * Math.PI;
    this._add(banner);
    this._mats.push(mat);
    return true;
  }

  _spawnSkullPile(x, z) {
    // 8 skulls, instanced per pile via small meshes (kept cheap)
    const bone = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.85 });
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
    }
    this._mats.push(bone);
    return true;
  }

  _spawnRoot(x, z) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a3a2a, roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 1.2, 5), mat);
      r.position.set(x + (Math.random() - 0.5), WORLD.WALL_HEIGHT - 0.6 + (Math.random() - 0.5), z + (Math.random() - 0.5));
      r.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, 0.1 + Math.random() * 0.3);
      this._add(r);
    }
    this._mats.push(mat);
    return true;
  }

  _spawnWeb(x, z) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = 'rgba(220,220,230,0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2 + Math.cos(a) * size / 2, size / 2 + Math.sin(a) * size / 2);
      ctx.stroke();
    }
    for (let r = 0.2; r <= 0.5; r += 0.1) {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    this._textures.push(tex);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false,
    });
    const web = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), mat);
    web.position.set(x, 2.6, z);
    web.rotation.y = Math.random() * Math.PI;
    this._add(web);
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
    return true;
  }

  _spawnStalactite(x, z) {
    const tints = { FUNGAL_CAVERN: 0x3a4a3e, VOLCANIC_DEPTHS: 0x4a3a30, FROZEN_HALLS: 0x8ac0d8 };
    const mat = new THREE.MeshStandardMaterial({ color: tints[this.biome] || 0x4a4a5a, roughness: 0.85 });
    const h = 0.6 + Math.random() * 0.6;
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.15 + Math.random() * 0.15, h, 6), mat);
    s.position.set(x, WORLD.WALL_HEIGHT - h / 2, z);
    s.rotation.z = Math.PI;
    this._add(s);
    this._mats.push(mat);
    return true;
  }

  _spawnRubble(x, z) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.9 });
    const geo = new THREE.SphereGeometry(0.1, 4, 3);
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(geo, mat);
      r.position.set(x + (Math.random() - 0.5) * 1.2, 0.05 + Math.random() * 0.1, z + (Math.random() - 0.5) * 1.2);
      r.scale.setScalar(0.6 + Math.random() * 0.8);
      this._add(r);
    }
    this._mats.push(mat);
    return true;
  }

  // ----------------------------------------------------------- structural

  _placePillars(room, count) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a4a5a, roughness: 0.85 });
    const cs = this.data.cellSize;
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoom(room, 2.0);
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
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a2a, roughness: 0.85 });
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoom(room, 1.5);
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
    const stone = new THREE.MeshStandardMaterial({ color: 0x6a6a5a, roughness: 0.9 });
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x7a7a6a, roughness: 0.9 });
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoom(room, 1.5);
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
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x6a6a72, roughness: 0.4, metalness: 0.9 });
    for (let i = 0; i < count; i++) {
      const p = this._randomPointInRoom(room, 1.5);
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
    this._mats.push(bodyMat, flameMat);
    return true;
  }

  _spawnChandelier(x, z) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.4, metalness: 0.8 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 16), iron);
    ring.position.set(x, 3.2, z);
    this._add(ring);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 6), iron);
      candle.position.set(x + Math.cos(a) * 0.45, 3.05, z + Math.sin(a) * 0.45);
      this._add(candle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6),
        new THREE.MeshBasicMaterial({ color: 0xff9944 }));
      flame.position.set(x + Math.cos(a) * 0.45, 3.0, z + Math.sin(a) * 0.45);
      this._add(flame);
      const light = new THREE.PointLight(
        LIGHT_SOURCES.CHANDELIER.color, LIGHT_SOURCES.CHANDELIER.intensity,
        LIGHT_SOURCES.CHANDELIER.distance, LIGHT_SOURCES.CHANDELIER.decay,
      );
      light.position.set(x + Math.cos(a) * 0.45, 3.1, z + Math.sin(a) * 0.45);
      this._add(light);
    }
    this._mats.push(iron);
    return true;
  }

  _spawnIceCrystal(x, z) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x9ad8ff, emissive: 0x66ccff, emissiveIntensity: 1.4,
      transparent: true, opacity: 0.8, roughness: 0.2,
    });
    const cluster = Math.floor(Math.random() * 3) + 3; // 3-5
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
      LIGHT_SOURCES.ICE.color, LIGHT_SOURCES.ICE.intensity,
      LIGHT_SOURCES.ICE.distance, LIGHT_SOURCES.ICE.decay,
    );
    light.position.set(x, 1.0, z);
    this._add(light);
    this._mats.push(mat);
    return true;
  }

  _spawnMushroom(x, z) {
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.9 });
    const capMat = new THREE.MeshStandardMaterial({
      color: 0x44ff88, emissive: 0x44ff88, emissiveIntensity: 2.0, roughness: 0.6,
    });
    const cluster = Math.floor(Math.random() * 3) + 3; // 3-5
    for (let i = 0; i < cluster; i++) {
      const h = 0.2 + Math.random() * 0.15;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6), stemMat);
      stem.position.set(x + (Math.random() - 0.5) * 1.5, h / 2, z + (Math.random() - 0.5) * 1.5);
      this._add(stem);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.1, 8), capMat);
      cap.position.set(stem.position.x, h + 0.05, stem.position.z);
      this._add(cap);
    }
    const light = new THREE.PointLight(
      LIGHT_SOURCES.MUSHROOM.color, LIGHT_SOURCES.MUSHROOM.intensity,
      LIGHT_SOURCES.MUSHROOM.distance, LIGHT_SOURCES.MUSHROOM.decay,
    );
    light.position.set(x, 0.5, z);
    this._add(light);
    this._mats.push(stemMat, capMat);
    return true;
  }

  _spawnLava(x, z) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff5522, transparent: true, opacity: 0.85, depthWrite: false,
    });
    const radius = 1.5 + Math.random();
    const pool = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), mat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.02, z);
    this._add(pool);
    const light = new THREE.PointLight(
      LIGHT_SOURCES.LAVA.color, LIGHT_SOURCES.LAVA.intensity,
      LIGHT_SOURCES.LAVA.distance, LIGHT_SOURCES.LAVA.decay,
    );
    light.position.set(x, 0.6, z);
    this._add(light);
    this._mats.push(mat);
    this.lavaPools.push({ x, z, radius: PROPS.LAVA_RADIUS });
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
    for (const m of this._mats) {
      if (!m._propDisposed) { m._propDisposed = true; m.dispose(); }
    }
    for (const t of this._textures) t.dispose();
    this.breakables = [];
    this.interactives = [];
    this.lavaPools = [];
    this._shards = [];
    this._added = [];
    this.collisionBoxes = [];
  }
}

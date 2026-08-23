// PropSystem.js — props/decorations: weighted per-room pools, breakables, interactives,
// hazards (lava/acid), instanced decoratives, degraded-mode reducer (§7.3/§19/§22)
import * as THREE from 'three';
import { PROPS, HAZARD, BIOMES } from '../core/Constants.js';

export default class PropSystem {
  constructor() {
    this.group = null;
    this.collisionBoxes = [];
    this.breakables = [];     // {mesh, alive, pos}
    this.sarcophagi = [];     // {group, lid, opened, pos, cellCenter}
    this.hazards = [];        // {x, z, kind}  lava | acid
    this.wisps = [];          // {sprite, light, roomCx, roomCz, t, vx, vz}
    this._disposables = [];
    this._decorativeMeshes = []; // for reduceDecorations
    this._decorativeLights = [];
    this.degraded = false;
  }

  build(scene, dungeon, biomeId, rng) {
    const group = new THREE.Group();
    this.group = group;
    scene.add(group);
    const { rooms, cellSize } = dungeon;
    const pal = BIOMES[biomeId];
    let propCount = 0;

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 1 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3f24, roughness: 0.9 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x707a86, roughness: 0.4, metalness: 0.8 });
    this._disposables.push(stoneMat, woodMat, metalMat);

    const dummy = new THREE.Object3D();

    for (const room of rooms) {
      const cx = (room.cx + (room.w - 1) / 2) * cellSize;
      const cz = (room.cz + (room.h - 1) / 2) * cellSize;
      const rw = room.w * cellSize * 0.4;
      const rh = room.h * cellSize * 0.4;

      // pillars for ARENA (instanced per type is overkill at ≤4; use shared geo/mats)
      if (room.type === 'ARENA') {
        for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.75, 10, 8), stoneMat);
          pillar.position.set(cx + ox * rw, 5, cz + oz * rh);
          pillar.castShadow = true;
          group.add(pillar); propCount++;
          this._registerDecorative(pillar);
        }
      }

      // crystal clusters
      if (room.type === 'CRYSTAL_CHAMBER' || biomeId === 'CRYSTAL_DEPTHS' || biomeId === 'FROZEN_HALLS') {
        const nClusters = room.type === 'CRYSTAL_CHAMBER' ? 1 : (biomeId === 'FROZEN_HALLS' ? 2 : 1);
        for (let i = 0; i < nClusters; i++) {
          const px = cx + (rng() - .5) * rw * 2, pz = cz + (rng() - .5) * rh * 2;
          const cluster = new THREE.Group();
          for (let k = 0; k < 3; k++) {
            const hgt = 0.7 + rng() * 1.2;
            const shard = new THREE.Mesh(
              new THREE.ConeGeometry(0.16, hgt, 5),
              new THREE.MeshStandardMaterial({
                color: biomeId === 'FROZEN_HALLS' ? 0xaad8ff : 0xb07aff,
                emissive: biomeId === 'FROZEN_HALLS' ? 0x4488cc : 0x7733dd,
                emissiveIntensity: 1.2, roughness: 0.2
              }));
            shard.position.set((rng() - .5) * .6, hgt / 2, (rng() - .5) * .6);
            shard.rotation.z = (rng() - .5) * 0.4;
            cluster.add(shard);
          }
          const light = new THREE.PointLight(biomeId === 'FROZEN_HALLS' ? 0x8ad0ff : 0xb07aff, 1.0, 11, 1.3);
          light.position.y = 1.2;
          cluster.add(light);
          this._decorativeLights.push(light);
          cluster.position.set(px, 0, pz);
          group.add(cluster); propCount++;
        }
      }

      // mushrooms: ~6 clusters per MUSHROOM_GROVE, ~2 elsewhere in FUNGAL; toxic in POISON
      if (room.type === 'MUSHROOM_GROVE' || ((biomeId === 'FUNGAL_CAVERN' || biomeId === 'POISON_SWAMP') && rng() < 0.8)) {
        const n = room.type === 'MUSHROOM_GROVE' ? 6 : 2;
        const cap = biomeId === 'POISON_SWAMP' ? 0x99ff33 : 0x44ff88;
        for (let i = 0; i < n; i++) {
          const px = cx + (rng() - .5) * rw * 2, pz = cz + (rng() - .5) * rh * 2;
          const cl = new THREE.Group();
          for (let k = 0; k < 3; k++) {
            const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.5 + rng() * 0.5), stoneMat);
            stem.position.set((rng() - .5) * .5, 0.3, (rng() - .5) * .5);
            const capM = new THREE.Mesh(
              new THREE.SphereGeometry(0.22 + rng() * 0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
              new THREE.MeshStandardMaterial({ color: cap, emissive: cap, emissiveIntensity: 0.9, roughness: 0.7 }));
            capM.position.copy(stem.position); capM.position.y += 0.25;
            cl.add(stem, capM);
          }
          // each cluster emits a green point light — the torchless biomes are lit by their own glow
          const light = new THREE.PointLight(cap, 3.2, 12, 1.2);
          light.position.y = 1.0;
          cl.add(light);
          this._decorativeLights.push(light);
          cl.position.set(px, 0, pz);
          group.add(cl); propCount++;
        }
      }

      // weapon racks + breakables in ARMORY
      if (room.type === 'ARMORY') {
        for (let i = 0; i < 2; i++) {
          const rack = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.6, 0.2), woodMat);
          rack.position.set(cx + (i === 0 ? -rw : rw) * 0.7, 0.8, cz + (rng() - .5) * rh);
          rack.rotation.y = rng() * Math.PI;
          rack.castShadow = true;
          group.add(rack); propCount++;
        }
      }

      // bookshelves LIBRARY
      if (room.type === 'LIBRARY') {
        for (let i = 0; i < 3; i++) {
          const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.4), woodMat);
          shelf.position.set(cx + (i - 1) * 2, 1.1, cz - rh * 0.7);
          shelf.castShadow = true;
          group.add(shelf); propCount++;
          this.collisionBoxes.push({ minX: shelf.position.x - 0.8, maxX: shelf.position.x + 0.8, minZ: shelf.position.z - 0.25, maxZ: shelf.position.z + 0.25 });
        }
      }

      // sarcophagi CRYPT (interactive)
      if (room.type === 'CRYPT') {
        const sx = cx + (rng() - .5) * rw, sz = cz + (rng() - .5) * rh;
        const sarco = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 2.2), stoneMat);
        base.position.y = 0.45; base.castShadow = true;
        const lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.18, 2.25), stoneMat);
        lid.position.y = 0.95;
        sarco.add(base, lid);
        sarco.position.set(sx, 0, sz);
        group.add(sarco); propCount++;
        this.sarcophagi.push({ group: sarco, lid, opened: false, pos: new THREE.Vector3(sx, 0, sz) });
        this.collisionBoxes.push({ minX: sx - 0.55, maxX: sx + 0.55, minZ: sz - 1.15, maxZ: sz + 1.15 });
      }

      // altar TEMPLE
      if (room.type === 'TEMPLE') {
        const altar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), new THREE.MeshStandardMaterial({ color: 0xc8a84e, roughness: 0.35, metalness: 0.7 }));
        altar.position.set(cx, 0.5, cz);
        altar.castShadow = true;
        group.add(altar); propCount++;
        this._registerDecorative(altar);
      }

      // generic rubble/bones decoratives
      if (propCount < PROPS.MAX_PER_LEVEL && (room.type === 'CHAMBER' || room.type === 'HALL') && rng() < 0.7) {
        const rubble = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.3, 0), stoneMat);
        rubble.position.set(cx + (rng() - .5) * rw * 2, 0.15, cz + (rng() - .5) * rh * 2);
        rubble.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        group.add(rubble); propCount++;
        this._registerDecorative(rubble);
      }

      // breakables (≤3/room): barrels/crates — individual meshes, HP 1
      if (room.type !== 'HALL') {
        const nb = 1 + Math.floor(rng() * PROPS.BREAKABLES_PER_ROOM);
        for (let i = 0; i < nb && propCount < PROPS.MAX_PER_LEVEL; i++) {
          const barrel = new THREE.Mesh(
            new THREE.CylinderGeometry(0.32, 0.32, 0.8, 8),
            woodMat.clone());
          const bx = cx + (rng() - .5) * rw * 2, bz = cz + (rng() - .5) * rh * 2;
          barrel.position.set(bx, 0.4, bz);
          barrel.castShadow = true;
          barrel.userData.biomeCached = false;
          group.add(barrel); propCount++;
          this.breakables.push({ mesh: barrel, alive: true, pos: new THREE.Vector3(bx, 0, bz) });
        }
      }

      // hazards: lava (VOLCANIC/EMBER) or acid (POISON) — 1-2/room, never within 3 u of exit marker
      const hazardKind = (biomeId === 'VOLCANIC_DEPTHS' || biomeId === 'EMBER_FORGE') ? 'lava'
        : (biomeId === 'POISON_SWAMP' ? 'acid' : null);
      if (hazardKind && dungeon.exitCell && roomContains(room, dungeon.exitCell)) {
        // no hazards in the exit room
      } else if (hazardKind) {
        const nh = 1 + (rng() < 0.5 ? 1 : 0);
        for (let i = 0; i < nh; i++) {
          const hx = cx + (rng() - .5) * rw * 1.6, hz = cz + (rng() - .5) * rh * 1.6;
          const ex = dungeon.exitCell.x * cellSize, ez = dungeon.exitCell.z * cellSize;
          if ((hx - ex) ** 2 + (hz - ez) ** 2 < HAZARD.EXIT_CLEARANCE ** 2) continue;
          const pool = new THREE.Mesh(
            new THREE.CircleGeometry(1.0 + rng() * 0.6, 16),
            new THREE.MeshBasicMaterial({
              color: hazardKind === 'lava' ? 0xff5a1e : 0x99ff33,
              transparent: true, opacity: 0.85
            }));
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(hx, 0.03, hz);
          group.add(pool);
          this.hazards.push({ x: hx, z: hz, kind: hazardKind });
        }
      }

      // wisps: 1–2 per CRYPT room in HAUNTED_CRYPT; exactly 1 per room (aqua) in FLOODED_RUINS
      if ((biomeId === 'HAUNTED_CRYPT' && room.type === 'CRYPT') || biomeId === 'FLOODED_RUINS') {
        const nw = biomeId === 'FLOODED_RUINS' ? 1 : (1 + (rng() < 0.5 ? 1 : 0));
        const wispColor = biomeId === 'FLOODED_RUINS' ? 0x4adfc8 : 0x88aaff;
        for (let i = 0; i < nw; i++) {
          const spriteMat = new THREE.SpriteMaterial({
            map: rng(), color: wispColor,
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85
          });
          const spr = new THREE.Sprite(spriteMat);
          spr.scale.set(0.5, 0.5, 1);
          spr.position.set(cx, 1.2, cz);
          const light = new THREE.PointLight(wispColor, 0.8, 8, 1.5);
          spr.add(light);
          group.add(spr);
          this.wisps.push({ sprite: spr, light, roomCx: cx, roomCz: cz, radius: Math.min(rw, rh), t: rng() * 10, vx: 0.5, vz: 0.4 });
        }
      }

      // water puddle handled by Game (_placeWaterPuddles) — VAULT only
    }

    return { group, propCount };
  }

  _registerDecorative(mesh) { this._decorativeMeshes.push(mesh); }

  // Degraded mode: hide a random 50% of purely cosmetic props + shed lights.
  // NEVER touched: hazards, breakables, interactives, structural props, biome light props.
  reduceDecorations(factor = 0.5) {
    this.degraded = true;
    for (const m of this._decorativeMeshes) if (Math.random() < factor) m.visible = false;
    for (const l of this._decorativeLights) if (Math.random() < factor) l.visible = false;
  }

  update(dt, time) {
    for (const w of this.wisps) {
      w.t += dt;
      // patrol radius 2 u at y 1.2 around the room center, bounce at room bounds
      const r = 2;
      w.sprite.position.x += w.vx * dt; w.sprite.position.z += w.vz * dt;
      if (Math.abs(w.sprite.position.x - w.roomCx) > r) w.vx *= -1;
      if (Math.abs(w.sprite.position.z - w.roomCz) > r) w.vz *= -1;
      w.sprite.position.y = 1.2 + Math.sin(w.t * 2) * 0.15;
    }
  }

  dispose(scene) {
    if (this.group && scene) scene.remove(this.group);
    this.group.traverse?.(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !o.material.map?.userData?.biomeCached) o.material.dispose();
    });
    this.breakables = [];
    this.sarcophagi = [];
    this.hazards = [];
    this.wisps = [];
    this._decorativeMeshes = [];
    this._decorativeLights = [];
    this.group = null;
  }
}

function roomContains(room, cell) {
  return cell.x >= room.cx && cell.x < room.cx + room.w && cell.z >= room.cz && cell.z < room.cz + room.h;
}

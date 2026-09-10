/**
 * HazardSystem.js — P7 hazards (SPEC §5 sectors 3-4, §8 instancing budget).
 *
 * Owns every live hazard object across all loaded chunks:
 *   - crystals (crystal-fields): clusters of 4–8 instanced octahedra, 3
 *     shared translucent materials (cyan/magenta/mint), drift + tumble;
 *     destructible — takeDamageCrystal(c, dmg) removes, bursts, and
 *     emits 'hazard:crystalDestroyed' (EventBus, {position, color}).
 *   - pulsars (crystal-fields): bright core sphere + TWO counter-rotating
 *     additive beam cones (length HAZARDS.pulsarBeamLength); beam touch =
 *     damageHook(HAZARDS.pulsarDamage) via distance-to-axis check.
 *   - mines (asteroid-belt + plasma-storm): instanced spiky spheres (ONE
 *     InstancedMesh per chunk); proximity < HAZARDS.mineExplodeRadius →
 *     damageHook(HAZARDS.mineDamage) + remove.
 *   - storm clouds (plasma-storm): 3–5 dark billboarded sprite clusters per
 *     chunk (SHARED sprite material) + lightning: every 2–4 s a bolt between
 *     two close clouds, HAZARDS.boltTelegraph s telegraph (clouds brighten)
 *     then damageHook(HAZARDS.boltDamage) if the player is within
 *     HAZARDS.boltDamageRadius of the bolt midline.
 *
 * Materialization: SectorGenerator.populate() emits hazard DESCRIPTORS
 * (positions only, deterministic from the chunk seed); the caller (main.js)
 * passes them to `materialize(descriptors, chunkCenter)` when a chunk
 * loads. `clear()` removes everything (restart, SPEC §11).
 *
 * Performance (SPEC §8): all geometry/materials are module-level shared
 * singletons; crystals and mines are strictly ONE InstancedMesh per chunk
 * (1 draw call per class per chunk); pulsars/clouds/bolts are cheap
 * shared-geometry meshes (counts tiny per chunk).
 */
import * as THREE from 'three';
import { HAZARDS, WORLD_SAFE_RADIUS } from '../core/Constants.js';
import { EventBus } from '../core/EventBus.js';

// ---------------------------------------------------------------------------
// Shared module-level singletons (SPEC §8: no per-hazard allocation)
// ---------------------------------------------------------------------------

/** Crystal shape: unit octahedron. */
const _crystalGeo = new THREE.OctahedronGeometry(1, 0);

/** Crystal colors — 3 shared translucent materials (SPEC §5 cyan/magenta/mint). */
const _crystalMats = [
  new THREE.MeshStandardMaterial({
    color: 0x38bdf8, emissive: 0x0e4a6e, transparent: true, opacity: 0.85,
    roughness: 0.1, metalness: 0.4,
  }),
  new THREE.MeshStandardMaterial({
    color: 0xd946ef, emissive: 0x4a0e4e, transparent: true, opacity: 0.85,
    roughness: 0.1, metalness: 0.4,
  }),
  new THREE.MeshStandardMaterial({
    color: 0x4ade80, emissive: 0x0a3a1e, transparent: true, opacity: 0.85,
    roughness: 0.1, metalness: 0.4,
  }),
];

/** Crystal destruction burst colors (index-aligned with _crystalMats). */
const _crystalBurstColors = ['#38bdf8', '#d946ef', '#4ade80'];

/** Pulsar core: small bright sphere (emissive). */
const _pulsarCoreGeo = new THREE.SphereGeometry(1, 12, 8);
const _pulsarCoreMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0x8ecbff, emissiveIntensity: 2.5,
});

/** Pulsar beam: unit cone, tip at +Y, additive + double-sided. */
const _beamGeo = new THREE.ConeGeometry(1, 1, 8, 1, true);
const _beamMat = new THREE.MeshBasicMaterial({
  color: 0x67e8f9, transparent: true, opacity: 0.28,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
});

/** Mine: small spiky sphere = icosahedron body + 6 spike octahedra.
 *  ONE InstancedMesh per chunk: body instances carry the mine centers;
 *  spike instances are offset around each center (shared geometry+material). */
const _mineGeo = new THREE.IcosahedronGeometry(1, 0);
const _mineSpikeGeo = new THREE.OctahedronGeometry(1, 0);
const _mineMat = new THREE.MeshStandardMaterial({
  color: 0x5b6570, flatShading: true, metalness: 0.5, roughness: 0.7,
  emissive: 0x330000, emissiveIntensity: 0.6,
});

/** Storm cloud: dark billboarded sprite (SHARED material, SPEC §11). */
const _cloudMat = new THREE.SpriteMaterial({
  color: 0x1e293b, transparent: true, opacity: 0.7, depthWrite: false,
});

/** Lightning bolt: additive LineSegments, ONE shared geometry for all bolts. */
const _boltMat = new THREE.LineBasicMaterial({
  color: 0xbfefff, transparent: true, opacity: 0.95,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

/** Bolt pool cap + jagged segment count per bolt. */
const _MAX_BOLTS = 8;
const _BOLT_SEGMENTS = 6;

// Black hole shared visuals (THE ABYSS): event horizon, accretion disks, jets.
const _bhHorizonGeo = new THREE.SphereGeometry(1, 16, 12);
const _bhDiskGeo = new THREE.TorusGeometry(1, 0.16, 8, 32);
const _bhHorizonMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const _bhDiskMat = new THREE.MeshBasicMaterial({
  color: 0xb06aff, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});
const _bhJetMat = new THREE.MeshBasicMaterial({
  color: 0xd0b0ff, transparent: true, opacity: 0.35,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
/** Fallback player radius for the event-horizon check (avoids a circular
 *  import of PLAYER from Constants — HAZARDS already imports fine, but the
 *  player radius lives in PLAYER; hardcode-mirror it here). */
const PLAYER_RADIUS_FALLBACK = 2.5;
/** PERF (FIX #4): crystals animate only within this range of the player, u. */
const _CRYSTAL_ANIM_RANGE = 2500;
const _CRYSTAL_ANIM_RANGE2 = _CRYSTAL_ANIM_RANGE * _CRYSTAL_ANIM_RANGE;

// Death star shared visuals (DEAD STAR REACH): massive grey battlestation.
const _dsSphereGeo = new THREE.IcosahedronGeometry(1, 2);
const _dsPlateGeo = new THREE.BoxGeometry(1, 1, 1);
const _dsHullMat = new THREE.MeshStandardMaterial({
  color: 0x3a3f46, flatShading: true, metalness: 0.7, roughness: 0.45,
});
const _dsTrimMat = new THREE.MeshStandardMaterial({
  color: 0x2a2e34, flatShading: true, metalness: 0.8, roughness: 0.35,
});
const _dsLaserMat = new THREE.MeshBasicMaterial({
  color: 0xff2020, blending: THREE.AdditiveBlending, depthWrite: false,
});
const _dsTrenchMat = new THREE.MeshBasicMaterial({
  color: 0x66ff88, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending,
});

// Ship-graveyard shared visuals (bone-rot palette): wrecked hull parts +
// alien worm segments.
const _gvHullGeo = new THREE.IcosahedronGeometry(1, 1);
const _gvHullMat = new THREE.MeshStandardMaterial({
  color: 0x5a4a3a, flatShading: true, metalness: 0.55, roughness: 0.7,
  emissive: new THREE.Color(0x1a0f08), emissiveIntensity: 0.3,
});
const _gvFinGeo = new THREE.BoxGeometry(1, 1, 1);
const _gvWreckColors = [0x5a4a3a, 0x4a4a52, 0x52483a, 0x3e4a44];
// Worm: obsidian flesh with sickly bioluminescent rings.
const _wormBodyGeo = new THREE.SphereGeometry(1, 8, 6);
const _wormBodyMat = new THREE.MeshStandardMaterial({
  color: 0x241a20, flatShading: true, metalness: 0.3, roughness: 0.8,
  emissive: new THREE.Color(0x1a0508), emissiveIntensity: 0.5,
});
const _wormRingMat = new THREE.MeshBasicMaterial({
  color: 0xff8830, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
// Worm head: maw (cone mouth + teeth ring).
const _wormMawGeo = new THREE.ConeGeometry(2.6, 4.5, 8, 1, true);
const _wormMawMat = new THREE.MeshStandardMaterial({
  color: 0x3a1015, flatShading: true, metalness: 0.4, roughness: 0.6,
  emissive: new THREE.Color(0xff3020), emissiveIntensity: 0.7,
  side: THREE.DoubleSide,
});

class _HazardSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {Function} damageHook (amount, position) → player damage hook
   *   (main.js routes this into DamageSystem.hitPlayer, which owns the
   *   0.75 s invuln window).
   */
  constructor(scene, damageHook) {
    /** @type {THREE.Scene} */
    this._scene = scene;
    /** @type {Function} */
    this._damageHook = damageHook;

    // -- Public arrays (collision hooks) --------------------------------------
    /** @type {Array<object>} live crystals (crystal-fields). */
    this.crystals = [];
    /** @type {Array<object>} live black holes (the-abyss). */
    this.blackHoles = [];
    /** @type {Array<object>} live death stars (dead-star-reach). */
    this.deathStars = [];
    /** @type {Array<object>} live graveyard wrecks. */
    this.graveHulks = [];
    /** @type {Array<object>} live alien worms. */
    this.worms = [];
    /** Scratch #3 (worm steering/chain math). */
    this._p3 = new THREE.Vector3();
    /** @type {Array<object>} live red laser bolts from death stars. */
    this.deathStarLasers = [];
    /** Scratch up-vector for death star heading math. */
    this._upV = new THREE.Vector3(0, 1, 0);
    /** Second scratch vector (death star battery tips). */
    this._p2 = new THREE.Vector3();
    /** @type {Array<object>} live pulsars (crystal-fields). */
    this.pulsars = [];
    /** @type {Array<object>} live minefields — one entry per chunk (instanced). */
    this.mines = [];
    /** @type {Array<object>} live storm clusters (plasma-storm). */
    this.storms = [];

    // -- Bolt pool (shared geometry + material, ≤ _MAX_BOLTS bolts) ----------
    const segCount = _MAX_BOLTS * _BOLT_SEGMENTS;
    this._boltGeo = new THREE.BufferGeometry();
    this._boltGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(segCount * 2 * 3), 3),
    );
    this._boltGeo.setDrawRange(0, 0);
    this._boltLines = new THREE.LineSegments(this._boltGeo, _boltMat);
    this._boltLines.frustumCulled = false;
    this._scene.add(this._boltLines);
    /** @type {Array<object>} bolt pool entries. */
    this._bolts = [];
    /** PERF (FIX #8): bolt buffer rewrite only when bolt state changed. */
    this._boltsDirty = true;
    for (let i = 0; i < _MAX_BOLTS; i++) {
      this._bolts.push({
        active: false, life: 0, telegraph: 0, sprites: null,
        a: new THREE.Vector3(), b: new THREE.Vector3(),
      });
    }

    // Scratch (no per-frame allocation).
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._ab = new THREE.Vector3();
  }

  // -------------------------------------------------------------------------
  // Materialization (called by main.js on chunk load)
  // -------------------------------------------------------------------------

  /**
   * Build hazard meshes from SectorGenerator hazard descriptors for one chunk.
   * Descriptor `position` is in LOCAL chunk space (chunk-group-relative); it
   * is converted to world space against `chunkCenter` here.
   * @param {Array<object>} descriptors descriptor array (any types; non-hazard
   *   descriptors are ignored).
   * @param {THREE.Vector3} chunkCenter world center of the chunk cube.
   */
  materialize(descriptors, chunkCenter, chunkKey) {
    // PERF (FIX #3): hazard records carry their owning chunk key so
    // unloadChunk() can detach exactly the hazards of an unloaded chunk
    // (before this, hazards were added to the scene root and lived until a
    // full restart — hundreds of simulated entities far from the player).
    for (const d of descriptors) {
      if (!d || !d.position) continue; // descriptors without position (e.g. enemy-spawn-points) are not hazards
      const world = this._p.copy(d.position).add(chunkCenter).clone();
      switch (d.type) {
        case 'crystal-cluster':
          this._spawnCrystalCluster(world, d.rng, d.count, chunkKey);
          break;
        case 'pulsar':
          this._spawnPulsar(world, chunkKey);
          break;
        case 'mine-field':
          this._spawnMineField(world, d.rng, d.count, chunkKey);
          break;
        case 'storm-cloud':
          this._spawnStorm(world, d.rng, d.count, chunkKey);
          break;
        case 'black-hole':
          this._spawnBlackHole(world, chunkKey);
          break;
        case 'death-star':
          this._spawnDeathStar(world, d.rng, chunkKey);
          break;
        case 'grave-hulk':
          this._spawnGraveHulk(world, d.rng, chunkKey);
          break;
        case 'grave-worm':
          this._spawnGraveWorm(world, d.rng, chunkKey);
          break;
        default:
          break;
      }
    }
  }

  // -- Chunk unload (PERF FIX #3) ----------------------------------------------

  /**
   * Detach + drop every hazard owned by `chunkKey` (called by main.js when
   * a chunk unloads). Mirrors clear() but scoped to one chunk; shared
   * geometry/material singletons are never disposed.
   * @param {string} chunkKey
   */
  unloadChunk(chunkKey) {
    // Crystals: remove the InstancedMeshes whose FIRST crystal belongs to
    // this chunk (all instances of one mesh share the chunk key).
    const deadMeshes = new Set();
    for (let i = this.crystals.length - 1; i >= 0; i--) {
      const c = this.crystals[i];
      if (c.chunkKey !== chunkKey) continue;
      deadMeshes.add(c.mesh);
      this.crystals.splice(i, 1);
    }
    for (const mesh of deadMeshes) {
      if (mesh.parent) this._scene.remove(mesh);
      mesh.dispose();
    }

    // Pulsars.
    for (let i = this.pulsars.length - 1; i >= 0; i--) {
      const pl = this.pulsars[i];
      if (pl.chunkKey !== chunkKey) continue;
      if (pl.group && pl.group.parent) this._scene.remove(pl.group);
      this.pulsars.splice(i, 1);
    }

    // Mines.
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const field = this.mines[i];
      if (field.chunkKey !== chunkKey) continue;
      if (field.mesh && field.mesh.parent) this._scene.remove(field.mesh);
      field.mesh.dispose();
      this.mines.splice(i, 1);
    }

    // Storms (sprites share one material — detach only).
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const st = this.storms[i];
      if (st.chunkKey !== chunkKey) continue;
      for (const s of st.sprites) {
        if (s.parent) this._scene.remove(s);
      }
      this.storms.splice(i, 1);
    }

    // Black holes.
    for (let i = this.blackHoles.length - 1; i >= 0; i--) {
      const bh = this.blackHoles[i];
      if (bh.chunkKey !== chunkKey) continue;
      if (bh.group && bh.group.parent) this._scene.remove(bh.group);
      this.blackHoles.splice(i, 1);
    }

    // Death stars.
    for (let i = this.deathStars.length - 1; i >= 0; i--) {
      const ds = this.deathStars[i];
      if (ds.chunkKey !== chunkKey) continue;
      if (ds.group && ds.group.parent) this._scene.remove(ds.group);
      this.deathStars.splice(i, 1);
    }

    // Ship graveyard wrecks + worms (worm rings are per-instance geos).
    for (let i = this.graveHulks.length - 1; i >= 0; i--) {
      const h = this.graveHulks[i];
      if (h.chunkKey !== chunkKey) continue;
      if (h.group && h.group.parent) this._scene.remove(h.group);
      this.graveHulks.splice(i, 1);
    }
    for (let i = this.worms.length - 1; i >= 0; i--) {
      const w = this.worms[i];
      if (w.chunkKey !== chunkKey) continue;
      if (w.group && w.group.parent) this._scene.remove(w.group);
      for (const s of w.segs) {
        if (s.ring) s.ring.geometry.dispose();
      }
      this.worms.splice(i, 1);
    }
  }

  // -- Crystals ------------------------------------------------------------

  /**
   * One crystal cluster = ONE InstancedMesh of N octahedra (4–8). All
   * instances share one of the 3 shared translucent materials (the cluster
   * picks one; per-instance color variety is out of scope for InstancedMesh
   * without custom shaders).
   * @param {THREE.Vector3} worldPos cluster center (world).
   * @param {Function} rng seeded PRNG [0,1).
   * @param {number} count 4–8.
   */
  _spawnCrystalCluster(worldPos, rng, count, chunkKey) {
    const n = Math.max(
      HAZARDS.crystalClusterMin,
      Math.min(HAZARDS.crystalClusterMax, Math.floor(count) || HAZARDS.crystalClusterMin),
    );
    const matColor = Math.floor(rng() * _crystalMats.length);
    const inst = new THREE.InstancedMesh(_crystalGeo, _crystalMats[matColor], n);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) {
      const position = new THREE.Vector3(
        (rng() * 2 - 1) * 14,
        (rng() * 2 - 1) * 14,
        (rng() * 2 - 1) * 14,
      ).add(worldPos);
      const rot = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2),
      );
      const scale = 2 + rng() * 4; // 2–6 u
      this._m.compose(position, rot, this._s.setScalar(scale));
      inst.setMatrixAt(i, this._m);
      this.crystals.push({
        mesh: inst, index: i, alive: true, hp: HAZARDS.crystalHp,
        position, scale, chunkKey,
        rotAxis: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
        rotSpeed: 0.3 + rng() * 0.7,
        drift: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(1.5),
        _rot: rot,
        matColor,
      });
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    this._scene.add(inst);
  }

  /**
   * Damage one crystal: remove + burst + 'hazard:crystalDestroyed'.
   * @param {object} c a crystal from this.crystals.
   * @param {number} dmg damage points (unused: crystals shatter in one hit
   *   by design — the projectile loop calls this directly on hit).
   */
  takeDamageCrystal(c, dmg) {
    if (!c || !c.alive) return;
    c.alive = false;

    // Compact: copy the LAST instance's transform into c's slot, shrink count.
    const mesh = c.mesh;
    const lastIdx = mesh.count - 1;
    if (c.index !== lastIdx) {
      const last = this.crystals.find(
        (o) => o.alive && o.mesh === mesh && o.index === lastIdx,
      );
      if (last) {
        this._m.compose(last.position, last._rot, this._s.setScalar(last.scale));
        mesh.setMatrixAt(c.index, this._m);
        last.index = c.index;
      }
    }
    mesh.count = lastIdx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.count <= 0) {
      this._scene.remove(mesh);
      mesh.dispose(); // free the per-instance GPU buffer (geo/mat stay shared)
    }

    const i = this.crystals.indexOf(c);
    if (i !== -1) this.crystals.splice(i, 1);

    // Burst cue + event (main.js / HUD can react).
    EventBus.emit('hazard:crystalDestroyed', {
      position: c.position,
      color: _crystalBurstColors[c.matColor] ?? _crystalBurstColors[0],
    });
  }

  // -- Pulsars ---------------------------------------------------------------

  /**
   * One pulsar: bright core sphere + TWO counter-rotating additive beam cones
   * (length HAZARDS.pulsarBeamLength, centered on the core).
   * @param {THREE.Vector3} worldPos world position.
   */
  _spawnPulsar(worldPos, chunkKey) {
    const group = new THREE.Group();
    group.position.copy(worldPos);

    const core = new THREE.Mesh(_pulsarCoreGeo, _pulsarCoreMat);
    core.scale.setScalar(4);
    group.add(core);

    const L = HAZARDS.pulsarBeamLength;
    const beamA = new THREE.Mesh(_beamGeo, _beamMat);
    const beamB = new THREE.Mesh(_beamGeo, _beamMat);
    // Cone is Y-up with tip at +Y/2 and base at -Y/2 in unit space; scale
    // (r, L, r) centers the beam on the group origin with half-length L/2.
    beamA.scale.set(1.6, L, 1.6);
    beamB.scale.set(1.6, L, 1.6);
    group.add(beamA, beamB);

    this._scene.add(group);
    this.pulsars.push({
      group, core, beamA, beamB,
      position: worldPos.clone(),
      chunkKey,
      spin: 0.6 + Math.random() * 0.6, // rad/s (beamB counter-rotates)
      angle: Math.random() * Math.PI * 2,
    });
  }

  // -- Mines -----------------------------------------------------------------

  /**
   * One minefield = ONE InstancedMesh of N spiky spheres for a whole chunk:
   * body instances (icosahedra) carry the mine centers; 6 spike instances
   * per mine are offset around each center. All share _mineGeo/_mineMat.
   * @param {THREE.Vector3} worldPos field center (world, chunk center).
   * @param {Function} rng seeded PRNG [0,1).
   * @param {number} count mines in the field.
   */
  _spawnMineField(worldPos, rng, count, chunkKey) {
    const n = Math.max(1, Math.floor(count) || 1);
    const spikePerMine = 6;
    const inst = new THREE.InstancedMesh(_mineGeo, _mineMat, n * (1 + spikePerMine));
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const mines = [];
    for (let i = 0; i < n; i++) {
      const position = new THREE.Vector3(
        (rng() * 2 - 1) * 400,
        (rng() * 2 - 1) * 400,
        (rng() * 2 - 1) * 400,
      ).add(worldPos);
      const rot = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2),
      );
      const scale = 1.0 + rng() * 0.6;

      // Body instance.
      this._m.compose(position, rot, this._s.setScalar(scale));
      inst.setMatrixAt(i * (1 + spikePerMine), this._m);

      // 6 spike instances around the body.
      for (let k = 0; k < spikePerMine; k++) {
        const dir = new THREE.Vector3(
          rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1,
        ).normalize();
        const spikePos = position.clone().addScaledVector(dir, 1.2 * scale);
        const spikeRot = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), dir,
        );
        this._m.compose(
          spikePos, spikeRot,
          this._s.set(0.4 * scale, 1.0 * scale, 0.4 * scale),
        );
        inst.setMatrixAt(i * (1 + spikePerMine) + 1 + k, this._m);
      }
      mines.push({ index: i, position, alive: true });
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    this._scene.add(inst);

    this.mines.push({
      mesh: inst,
      mines,
      chunkKey,
      /** @type {THREE.Vector3} scratch for the proximity check. */
      _v: new THREE.Vector3(),
    });
  }

  // -- Storms ----------------------------------------------------------------

  /**
   * One storm cluster: N (3–5) dark billboarded sprites (SHARED material)
   * near a center; owns its 2–4 s lightning timer.
   * @param {THREE.Vector3} worldPos cluster center (world).
   * @param {Function} rng
   * @param {number} count 3–5.
   */
  _spawnStorm(worldPos, rng, count, chunkKey) {
    const n = Math.max(
      HAZARDS.stormCloudsMin,
      Math.min(HAZARDS.stormCloudsMax, Math.floor(count) || HAZARDS.stormCloudsMin),
    );
    const sprites = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(_cloudMat); // SHARED material (SPEC §11)
      s.position.set(
        worldPos.x + (rng() * 2 - 1) * 40,
        worldPos.y + (rng() * 2 - 1) * 40,
        worldPos.z + (rng() * 2 - 1) * 40,
      );
      s.scale.setScalar(28 + rng() * 22);
      this._scene.add(s);
      sprites.push(s);
    }
    this.storms.push({
      sprites,
      boltTimer: 2 + rng() * 2, // first bolt in 2–4 s
      chunkKey,
    });
  }

  /**
   * Allocate one pooled bolt between two clouds.
   * @param {THREE.Sprite} a
   * @param {THREE.Sprite} b
   * @returns {object|null} the bolt (null if pool exhausted).
   */
  _allocBolt(a, b) {
    const bolt = this._bolts.find((x) => !x.active);
    if (!bolt) return null;
    bolt.active = true;
    bolt.life = HAZARDS.boltLife;
    bolt.telegraph = HAZARDS.boltTelegraph;
    bolt.sprites = [a, b];
    bolt.a.copy(a.position);
    bolt.b.copy(b.position);
    return bolt;
  }

  // -- Update ----------------------------------------------------------------

  /**
   * Per-frame: drift/tumble crystals, spin pulsars + beam-touch damage,
   * mine proximity detonation, storm lightning telegraph/strike.
   * @param {number} dt delta, s (capped by Game loop).
   * @param {number} time absolute time, s (phase reference, unused oscillations).
   * @param {THREE.Vector3} playerPos player world position.
   */
  update(dt, time, playerPos, ship, spawnHook) {
    // World safe zone: no hazard damage inside WORLD_SAFE_RADIUS of the
    // spawn station (90, 25, 420) — the spawn area is threat-free (mines
    // don't detonate, pulsar beams and storm lightning don't touch the
    // player there).
    const safe =
      Math.hypot(playerPos.x - 90, playerPos.y - 25, playerPos.z - 420) <
      WORLD_SAFE_RADIUS;
    this._updateCrystals(dt, playerPos);
    this._updatePulsars(dt, playerPos, safe);
    this._updateMines(playerPos, safe);
    this._updateStorms(dt, playerPos, safe);
    // Black holes (the-abyss): gravity pull + event-horizon damage. Ship
    // velocity is mutated directly (gravity is a force, not damage).
    this._updateBlackHoles(dt, playerPos, ship ?? { _velocity: { addScaledVector() {} } }, safe);
    // Death stars (dead-star-reach): movement AI + red lasers + ship waves.
    this._updateDeathStars(dt, playerPos, spawnHook, safe);
    // Ship graveyard (ship-graveyard): tumbling wrecks + hunting worms.
    this._updateGraveyard(dt, playerPos, this._damageHook, safe);
  }

  _updateCrystals(dt, playerPos) {
    // PERF (FIX #4): no per-frame Map rebuild — iterate the crystals array
    // directly, grouping the matrix writes per mesh via a dirty set. Crystals
    // far from the player keep their last transform (they are background
    // dressing; the drift/tumble is only visible up close).
    let needsUpload = false;
    for (const c of this.crystals) {
      if (!c.alive) continue;
      // Far crystals: skip the per-instance animation entirely (squared
      // distance, cheap reject). They were composed once at spawn.
      if (playerPos) {
        if (c.position.distanceToSquared(playerPos) > _CRYSTAL_ANIM_RANGE2) {
          continue;
        }
      }
      c.position.addScaledVector(c.drift, dt);
      this._q.setFromAxisAngle(c.rotAxis, c.rotSpeed * dt);
      c._rot.multiply(this._q);
      this._m.compose(c.position, c._rot, this._s.setScalar(c.scale));
      c.mesh.setMatrixAt(c.index, this._m);
      c._dirty = true;
      needsUpload = true;
    }
    if (needsUpload) {
      // One needsUpdate flag per touched mesh (set, not Map).
      for (const c of this.crystals) {
        if (c._dirty) {
          c._dirty = false;
          c.mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  _updatePulsars(dt, playerPos, safe) {
    for (const pl of this.pulsars) {
      pl.angle += pl.spin * dt;
      pl.beamA.rotation.set(0, 0, pl.angle);
      pl.beamB.rotation.set(0, 0, -pl.angle);
      // Beam touch: point-to-axis distance of the (rotating) beamA axis.
      if (!safe && this._pointToBeamAxis(pl, playerPos) < HAZARDS.pulsarBeamRadius) {
        this._damageHook(HAZARDS.pulsarDamage, pl.position);
      }
    }
  }

  /**
   * Distance from point P to beamA's axis (line through the pulsar center
   * along the beam's local Y after rotation.z = pl.angle).
   * @param {object} pl pulsar.
   * @param {THREE.Vector3} P world point (player).
   * @returns {number} distance, u.
   */
  _pointToBeamAxis(pl, P) {
    // BeamA axis dir after rotation.z = angle: local (0,1,0) → (−sin a, cos a, 0).
    const a = pl.angle;
    const dx = -Math.sin(a), dy = Math.cos(a);
    const ox = P.x - pl.position.x;
    const oy = P.y - pl.position.y;
    const oz = P.z - pl.position.z;
    // |(O×D)| with D=(dx,dy,0).
    const cx = oy * 0 - oz * dy;
    const cy = oz * dx - ox * 0;
    const cz = ox * dy - oy * dx;
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  _updateMines(playerPos, safe) {
    for (const field of this.mines) {
      const inst = field.mesh;
      for (let i = field.mines.length - 1; i >= 0; i--) {
        const m = field.mines[i];
        if (!m.alive) continue;
        if (!safe && m.position.distanceTo(playerPos) < HAZARDS.mineExplodeRadius) {
          this._damageHook(HAZARDS.mineDamage, m.position);
          this._explodeMine(field, m);
        }
      }
      // Remove the whole InstancedMesh once every mine in the chunk is gone.
      if (field.mines.every((m) => !m.alive) && inst.parent) {
        this._scene.remove(inst);
        inst.dispose();
      }
    }
  }

  /**
   * Detonate one mine: hide its instance (compact body slot to tail, drop
   * spike slots to zero-scale), mark dead, emit nothing (damage via hook).
   * @param {object} field the minefield entry.
   * @param {object} m the mine entry.
   */
  _explodeMine(field, m) {
    m.alive = false;
    const inst = field.mesh;
    const spikes = 6;
    const per = 1 + spikes;
    const base = m.index * per;
    const total = field.mines.length * per;

    // Zero the spike slots (hides the spikes).
    this._s.setScalar(0);
    this._m.makeScale(this._s);
    for (let k = 1; k < per; k++) {
      inst.setMatrixAt(base + k, this._m);
    }
    // Body slot: compact from the last LIVE mine (swap-with-last), or zero it.
    const lastLive = field.mines.find((x) => x.alive);
    if (lastLive) {
      const lb = lastLive.index * per;
      // PERF (FIX #8): reuse one scratch Matrix4 instead of allocating per slot.
      for (let k = 0; k < per; k++) {
        inst.getMatrixAt(lb + k, this._m);
        inst.setMatrixAt(base + k, this._m);
      }
      lastLive.index = m.index;
    } else {
      inst.setMatrixAt(base, this._m); // zero-scale body
    }
    inst.instanceMatrix.needsUpdate = true;
    void total;
  }

  _updateStorms(dt, playerPos, safe) {
    for (const st of this.storms) {
      st.boltTimer -= dt;
      if (st.boltTimer > 0) continue;
      st.boltTimer = 2 + Math.random() * 2; // next bolt in 2–4 s
      const a = st.sprites[Math.floor(Math.random() * st.sprites.length)];
      let b = st.sprites[Math.floor(Math.random() * st.sprites.length)];
      if (st.sprites.length > 1 && a === b) {
        b = st.sprites[(st.sprites.indexOf(a) + 1) % st.sprites.length];
      }
      this._allocBolt(a, b); // pool-exhausted → skip this strike (budget)
    }
    // Bolt telegraph/strike: shared pass over the pool.
    for (const bolt of this._bolts) {
      if (!bolt.active) continue;
      if (bolt.telegraph > 0) {
        bolt.telegraph -= dt;
        // Telegraph: brighten both clouds.
        const base = 0.7;
        this._boltsDirty = true;
        for (const s of bolt.sprites) {
          s.material.opacity = base + (bolt.telegraph / HAZARDS.boltTelegraph) * 0.3;
        }
        if (bolt.telegraph <= 0) {
          // Strike: damage if player is near the bolt midline.
          this._boltsDirty = true;
          const mid = this._ab.copy(bolt.a).add(bolt.b).multiplyScalar(0.5);
          if (!safe && mid.distanceTo(playerPos) < HAZARDS.boltDamageRadius) {
            this._damageHook(HAZARDS.boltDamage, mid);
          }
          for (const s of bolt.sprites) s.material.opacity = 0.7;
        }
      } else {
        // Post-strike flash (bolt visible while life > 0), then retire.
        bolt.life -= dt;
        this._boltsDirty = true;
        if (bolt.life <= 0) bolt.active = false;
      }
    }
    this._writeBoltGeometry(dt);
  }

  /**
   * Write the shared LineSegments buffer: active post-strike bolts get their
   * jagged segments; everything past that is collapsed to the origin.
   */
  _writeBoltGeometry(dt) {
    // PERF (FIX #8): skip the full buffer rewrite when nothing changed —
    // before, every frame rewrote all segments + flagged the attribute dirty
    // (bufferSubData/copyArray showed in profiles even with zero bolts).
    if (dt !== undefined && !this._boltsDirty) return;
    this._boltsDirty = false;
    const attr = this._boltGeo.attributes.position;
    let idx = 0;
    for (const bolt of this._bolts) {
      if (!bolt.active || bolt.telegraph > 0) continue;
      const a = bolt.a, b = bolt.b;
      for (let s = 0; s < _BOLT_SEGMENTS; s++) {
        const t0 = s / _BOLT_SEGMENTS;
        const t1 = (s + 1) / _BOLT_SEGMENTS;
        const p0 = this._p.copy(a).lerp(b, t0);
        const p1 = this._p.copy(a).lerp(b, t1);
        // Jagged jitter (deterministic per bolt endpoints + time-free for cost).
        p0.x += Math.sin(t0 * 43) * 8; p0.y += Math.cos(t0 * 51) * 8;
        p1.x += Math.sin(t1 * 43) * 8; p1.y += Math.cos(t1 * 51) * 8;
        attr.setXYZ(idx++, p0.x, p0.y, p0.z);
        attr.setXYZ(idx++, p1.x, p1.y, p1.z);
      }
    }
    for (let i = idx; i < this._bolts.length * _BOLT_SEGMENTS * 2; i++) {
      attr.setXYZ(i, 0, 0, 0);
    }
    attr.needsUpdate = true;
    this._boltGeo.setDrawRange(0, idx);
    this._boltsDirty = false;
  }

  // -- Death stars (DEAD STAR REACH) ------------------------------------------

  /**
   * One death star: massive grey battlestation — layered icosahedron hull,
   * armor plating blocks, a glowing trench ring, 4 red laser batteries on
   * long masts, and a hangar bay (spawn point for interceptor ships).
   * Movement: boost-thrust accelerations toward orbit + sharp-turn braking
   * (slow down → pivot → re-accelerate), per user feedback.
   * @param {THREE.Vector3} worldPos
   * @param {Function} rng
   */
  _spawnDeathStar(worldPos, rng, chunkKey) {
    const R = HAZARDS.deathStarRadius;
    const group = new THREE.Group();
    group.position.copy(worldPos);

    // Core hull: big faceted sphere.
    const hull = new THREE.Mesh(_dsSphereGeo, _dsHullMat);
    hull.scale.setScalar(R);
    group.add(hull);

    // Equatorial trench: glowing green ring (the iconic trench).
    const trench = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.02, 2.4, 6, 48), _dsTrenchMat);
    trench.rotation.x = Math.PI / 2;
    group.add(trench);

    // Surface armor plates (8 large blocks glued to the sphere).
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tilt = (i % 2 ? 0.5 : -0.5);
      const plate = new THREE.Mesh(_dsPlateGeo, _dsTrimMat);
      plate.position.set(
        Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.5, Math.sin(a) * R * 0.92);
      plate.scale.set(R * 0.5, R * 0.25, R * 0.35);
      plate.lookAt(0, 0, 0);
      plate.rotation.z = tilt;
      group.add(plate);
    }

    // 4 laser battery masts (long spikes with red emitter tips).
    const batteries = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const mast = new THREE.Mesh(_dsPlateGeo, _dsTrimMat);
      mast.position.set(Math.cos(a) * R * 1.12, 0, Math.sin(a) * R * 1.12);
      mast.scale.set(R * 0.16, R * 0.16, R * 0.4);
      mast.lookAt(group.position.clone().multiplyScalar(2));
      group.add(mast);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(3.2, 8, 6), _dsLaserMat);
      tip.position.copy(mast.position).multiplyScalar(1.12);
      group.add(tip);
      batteries.push({ tip, cooldown: i * 0.7 }); // staggered fire
    }

    // Hangar bay marker (green glow disc, spawn point for ships).
    const hangar = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.18, R * 0.18, 2, 12), _dsTrenchMat);
    hangar.position.set(0, R * 0.75, 0);
    group.add(hangar);

    this._scene.add(group);
    this.deathStars.push({
      group, position: worldPos.clone(),
      chunkKey,
      batteries,
      hullRadius: R,
      // Movement state: heading + throttle (AI drives boost/turn).
      heading: new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(),
      throttle: 0,
      speed: 0,
      turnTimer: 2 + rng() * 4,
      spawnTimer: HAZARDS.deathStarSpawnInterval,
      liveShips: 0,
    });
  }

  /**
   * Per-frame death-star AI (called from update; ship spawning delegated to
   * the caller via the spawnHook — HazardSystem doesn't own EnemyManager).
   * Movement: pick a direction → boost (fast acceleration) → approach
   * min-distance → brake hard (sharp turn) → pivot → re-accelerate.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {Function} spawnHook (position) → spawn one interceptor ship.
   * @param {boolean} safe inside the spawn safe zone (hold fire).
   */
  _updateDeathStars(dt, playerPos, spawnHook, safe) {
    for (const ds of this.deathStars) {
      // -- Movement AI --------------------------------------------------------
      const toPlayer = this._p.copy(playerPos).sub(ds.position);
      const dist = toPlayer.length();
      ds.turnTimer -= dt;

      // Boost toward an orbit band around the player (900–1400 u).
      const wantCloser = dist > 1400;
      const wantAway = dist < 900;
      if (ds.turnTimer <= 0) {
        // Sharp turn maneuver: brake to near-zero, pivot the heading, then
        // re-accelerate (the thrust model does the rest).
        ds.speed *= 0.2;
        if (wantAway) {
          ds.heading.copy(toPlayer).normalize().negate();
        } else {
          // Drift sideways + slightly toward the player (menacing sweep).
          ds.heading.copy(toPlayer).normalize();
          ds.heading.applyAxisAngle(this._upV, (Math.random() - 0.5) * 1.6);
          ds.heading.y = (Math.random() - 0.5) * 0.4;
          ds.heading.normalize();
        }
        ds.turnTimer = 3 + Math.random() * 4;
      }
      // Thrust: boost accel when far, cruise when in band, brake when close.
      let thrust = 0;
      if (wantCloser || wantAway) thrust = HAZARDS.deathStarBoost;
      else thrust = -HAZARDS.deathStarTurnThrust * 0.5; // hold: brake gently
      ds.speed = Math.max(0, Math.min(
        HAZARDS.deathStarSpeed * 4, ds.speed + thrust * dt));
      ds.group.position.addScaledVector(ds.heading, ds.speed * dt);
      ds.position.copy(ds.group.position);
      // Slow stately spin.
      ds.group.rotation.y += 0.05 * dt;

      // -- Laser batteries ----------------------------------------------------
      if (!safe && dist < HAZARDS.deathStarLaserRange) {
        for (const bat of ds.batteries) {
          bat.cooldown -= dt;
          if (bat.cooldown > 0) continue;
          bat.cooldown = HAZARDS.deathStarLaserInterval;
          // Red laser: fast beam from the battery tip toward the player.
          const tip = bat.tip.getWorldPosition(this._p2);
          const dir = this._p.copy(playerPos).sub(tip).normalize();
          // Telegraph via a stretched bolt mesh (brief visual + damage done
          // via the shared weapon pool by the caller wiring? Simpler: a
          // dedicated laser projectile registered here).
          this.deathStarLasers.push({
            pos: tip.clone(),
            vel: dir.multiplyScalar(HAZARDS.deathStarLaserSpeed),
            life: 2.2,
            mesh: (() => {
              const m = new THREE.Mesh(
                new THREE.BoxGeometry(0.8, 0.8, 18), _dsLaserMat);
              m.position.copy(tip);
              m.lookAt(playerPos);
              this._scene.add(m);
              return m;
            })(),
          });
        }
      }

      // -- Hangar ship waves ----------------------------------------------------
      ds.spawnTimer -= dt;
      if (ds.spawnTimer <= 0 && ds.liveShips < HAZARDS.deathStarMaxShips && spawnHook) {
        ds.spawnTimer = HAZARDS.deathStarSpawnInterval;
        const hangarPos = ds.group.position.clone();
        hangarPos.y += ds.hullRadius * 0.75;
        for (let i = 0; i < HAZARDS.deathStarWaveSize; i++) {
          const jitter = new this._p.constructor(
            (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 30);
          spawnHook(hangarPos.add(jitter));
          ds.liveShips += 1;
        }
      }
    }

    // -- Red lasers: advance + hit check -------------------------------------
    for (let i = this.deathStarLasers.length - 1; i >= 0; i--) {
      const l = this.deathStarLasers[i];
      l.life -= dt;
      l.pos.addScaledVector(l.vel, dt);
      l.mesh.position.copy(l.pos);
      const hitDist = this._p.copy(playerPos).sub(l.pos).length();
      if (hitDist < PLAYER_RADIUS_FALLBACK + 3) {
        this._damageHook(HAZARDS.deathStarLaserDamage, l.pos);
        l.life = 0;
      }
      if (l.life <= 0) {
        this._scene.remove(l.mesh);
        l.mesh.geometry.dispose();
        this.deathStarLasers.splice(i, 1);
      }
    }
  }

  // -- Black holes (THE ABYSS) ----------------------------------------------

  /**
   * One black hole: black event-horizon sphere + two counter-tilted additive
   * accretion disks (they spin in update) + vertical jet cones. The GROUP
   * is the visual; gravity is applied in _updateBlackHoles.
   * @param {THREE.Vector3} worldPos
   */
  _spawnBlackHole(worldPos, chunkKey) {
    const group = new THREE.Group();
    group.position.copy(worldPos);
    const horizon = new THREE.Mesh(
      _bhHorizonGeo,
      _bhHorizonMat,
    );
    horizon.scale.setScalar(HAZARDS.blackHoleRadius);
    group.add(horizon);
    // Accretion disks (counter-tilted pair, spinning in update).
    const diskA = new THREE.Mesh(_bhDiskGeo, _bhDiskMat);
    diskA.scale.setScalar(HAZARDS.blackHoleRadius * 2.2);
    diskA.rotation.x = Math.PI / 2;
    const diskB = new THREE.Mesh(_bhDiskGeo, _bhDiskMat);
    diskB.scale.setScalar(HAZARDS.blackHoleRadius * 1.6);
    diskB.rotation.x = Math.PI / 2.6;
    diskB.rotation.y = 0.4;
    group.add(diskA, diskB);
    // Polar jets (thin cones up/down).
    const jetGeo = new THREE.ConeGeometry(1.6, HAZARDS.blackHoleRadius * 5, 8, 1, true);
    const jetU = new THREE.Mesh(jetGeo, _bhJetMat);
    jetU.position.y = HAZARDS.blackHoleRadius * 3;
    const jetD = new THREE.Mesh(jetGeo, _bhJetMat);
    jetD.position.y = -HAZARDS.blackHoleRadius * 3;
    jetD.rotation.x = Math.PI;
    group.add(jetU, jetD);
    this._scene.add(group);
    this.blackHoles.push({
      group, position: worldPos.clone(),
      chunkKey,
      diskA, diskB,
      spin: 0.8 + Math.random() * 0.6,
    });
  }

  /**
   * Per-frame: spin the accretion disks + apply the gravity pull to the
   * caller-provided ship state (main.js passes ship + applies velocity).
   * Damage inside the event horizon routes through the damage hook.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {object} ship PlayerShip (velocity mutated by gravity).
   * @param {boolean} safe inside the spawn safe zone (no damage, still pull).
   */
  _updateBlackHoles(dt, playerPos, ship, safe) {
    for (const bh of this.blackHoles) {
      // Visuals: counter-rotating disks.
      bh.diskA.rotation.z += bh.spin * dt;
      bh.diskB.rotation.z -= bh.spin * dt * 1.4;

      // Gravity: accel = pull / dist² clamped to max, toward the hole.
      const toHole = this._p.copy(bh.position).sub(playerPos);
      const dist = Math.max(toHole.length(), 1);
      if (dist > HAZARDS.blackHoleReach) continue;
      const accel = Math.min(
        HAZARDS.blackHoleMaxAccel,
        HAZARDS.blackHolePull / (dist * dist),
      );
      toHole.normalize();
      ship._velocity.addScaledVector(toHole, accel * dt);

      // Event horizon: heavy damage per second while inside.
      if (!safe && dist < HAZARDS.blackHoleRadius + PLAYER_RADIUS_FALLBACK) {
        this._damageHook(HAZARDS.blackHoleDamage * dt * 3, bh.position);
      }
    }
  }

  // -- THE SHIP GRAVEYARD ------------------------------------------------------

  /**
   * One broken-ship wreck: a large hull chunk + torn fin plates + hanging
   * antenna masts, slowly tumbling. Pure decoration/debris (non-hostile),
   * but collidable-feeling via its size.
   * @param {THREE.Vector3} worldPos
   * @param {Function} rng
   */
  _spawnGraveHulk(worldPos, rng, chunkKey) {
    const group = new THREE.Group();
    group.position.copy(worldPos);
    const colorIdx = Math.floor(rng() * _gvWreckColors.length);
    const mat = new THREE.MeshStandardMaterial({
      color: _gvWreckColors[colorIdx],
      flatShading: true, metalness: 0.6, roughness: 0.65,
      emissive: new THREE.Color(0x140d08), emissiveIntensity: 0.35,
    });
    // Main torn hull: stretched icosahedron chunk.
    const hull = new THREE.Mesh(_gvHullGeo, mat);
    hull.scale.set(14 + rng() * 14, 8 + rng() * 8, 20 + rng() * 22);
    hull.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    group.add(hull);
    // Torn fin plates sticking out.
    for (let i = 0; i < 3; i++) {
      const fin = new THREE.Mesh(_gvFinGeo, mat);
      fin.position.set((rng() - 0.5) * 26, (rng() - 0.5) * 14, (rng() - 0.5) * 30);
      fin.scale.set(1 + rng() * 3, 6 + rng() * 8, 3 + rng() * 5);
      fin.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      group.add(fin);
    }
    // Antenna masts (bent, thin).
    for (let i = 0; i < 2; i++) {
      const mast = new THREE.Mesh(_gvFinGeo, mat);
      mast.position.set((rng() - 0.5) * 18, 8 + rng() * 8, (rng() - 0.5) * 22);
      mast.scale.set(0.6, 8 + rng() * 8, 0.6);
      mast.rotation.z = (rng() - 0.5) * 1.2;
      group.add(mast);
    }
    // Slow tumble.
    const spin = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5)
      .multiplyScalar(0.15);
    this._scene.add(group);
    this.graveHulks.push({ group, spin, alive: true, chunkKey });
  }

  /**
   * One alien worm: a 10-segment serpentine chain with a glowing maw head.
   * The head seeks the player (tries to EAT the ship — bite damage on
   * contact) and segments follow-the-leader for the serpentine swim.
   * @param {THREE.Vector3} worldPos
   * @param {Function} rng
   */
  _spawnGraveWorm(worldPos, rng, chunkKey) {
    const group = new THREE.Group();
    group.position.copy(worldPos);
    const segs = [];
    const n = HAZARDS.wormSegments;
    for (let i = 0; i < n; i++) {
      // Head bigger, tapering tail; every 2nd segment gets a glowing ring.
      const t = 1 - (i / n) * 0.75; // 1 → 0.25
      const seg = new THREE.Mesh(_wormBodyGeo, _wormBodyMat);
      seg.scale.setScalar(2.6 * t + 0.6);
      seg.position.copy(worldPos);
      group.add(seg);
      let ring = null;
      if (i > 0 && i % 2 === 0) {
        ring = new THREE.Mesh(new THREE.TorusGeometry(2.6 * t + 0.7, 0.28, 6, 12), _wormRingMat);
        seg.add(ring);
      }
      segs.push({ mesh: seg, ring });
    }
    // Maw head: cone jaws attached to the head segment, pointing forward.
    const maw = new THREE.Mesh(_wormMawGeo, _wormMawMat);
    maw.rotation.x = -Math.PI / 2; // mouth opens forward (+Z of head travel)
    maw.scale.setScalar(1.1);
    segs[0].mesh.add(maw);

    this._scene.add(group);
    this.worms.push({
      group, segs, maw,
      position: worldPos.clone(),
      chunkKey,
      // Motion state: head velocity + wander/aggro.
      vel: new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(10),
      pulsePhase: rng() * Math.PI * 2,
      alive: true,
    });
  }

  /**
   * Per-frame graveyard update: tumble wrecks; worms hunt the player —
   * serpentine follow-the-leader chain, bite damage on head contact.
   * @param {number} dt
   * @param {THREE.Vector3} playerPos
   * @param {Function} damageHook (amount) → player damage.
   * @param {boolean} safe inside the spawn safe zone (worms don't bite).
   */
  _updateGraveyard(dt, playerPos, damageHook, safe) {
    // Wrecks: slow tumble.
    for (const h of this.graveHulks) {
      if (!h.alive) continue;
      h.group.rotation.x += h.spin.x * dt;
      h.group.rotation.y += h.spin.y * dt;
      h.group.rotation.z += h.spin.z * dt;
    }

    // Worms: serpentine pursuit.
    for (const worm of this.worms) {
      if (!worm.alive) continue;
      const head = worm.segs[0].mesh;
      const headPos = head.getWorldPosition(this._p);
      const toPlayer = this._p2.copy(playerPos).sub(headPos);
      const dist = toPlayer.length();

      // Steering: aggro → seek the player; else wander in a slow circle.
      const steer = this._p3;
      if (dist < HAZARDS.wormAggro) {
        steer.copy(toPlayer).normalize();
        // Lateral weave so the swim reads alive, not a straight rush.
        // PERF (FIX #10): no per-frame clones — reuse worm-local scratch.
        const lateral = worm._scratch ?? (worm._scratch = new THREE.Vector3());
        lateral.crossVectors(this._upV, steer).normalize();
        const weave = Math.sin(worm.pulsePhase * 1.7) * 0.55;
        steer.addScaledVector(lateral, weave).normalize();
      } else {
        // Wander: gentle drifting turn.
        steer.copy(worm.vel).normalize()
          .applyAxisAngle(this._upV, Math.sin(worm.pulsePhase * 0.4) * 0.5);
      }
      worm.vel.addScaledVector(steer, HAZARDS.wormSpeed * 1.5 * dt);
      if (worm.vel.lengthSq() > HAZARDS.wormSpeed * HAZARDS.wormSpeed) {
        worm.vel.setLength(HAZARDS.wormSpeed);
      }
      headPos.addScaledVector(worm.vel, dt);
      // PERF (FIX #10): reuse worm-local scratch instead of headPos.clone().
      const headLocal = worm._scratch2 ?? (worm._scratch2 = new THREE.Vector3());
      head.position.copy(head.group.worldToLocal(headLocal.copy(headPos)));

      // Orient the head along its velocity (maw opens toward travel).
      if (worm.vel.lengthSq() > 1) {
        // PERF (FIX #10): scratch dirs + scratch quaternion, zero allocations.
        const from = worm._scratch3 ?? (worm._scratch3 = new THREE.Vector3());
        const dir = worm._scratch5 ?? (worm._scratch5 = new THREE.Vector3());
        from.set(0, 0, 1);
        dir.copy(worm.vel).normalize();
        const q = worm._scratchQ ?? (worm._scratchQ = new THREE.Quaternion());
        q.setFromUnitVectors(from, dir);
        head.quaternion.copy(q);
      }

      // Follow-the-leader: each segment chases the previous one, keeping
      // spacing — serpentine motion emerges from the chain lag.
      // PERF (FIX #10): delta reuses worm-local scratch (no clone per segment).
      const delta = worm._scratch4 ?? (worm._scratch4 = new THREE.Vector3());
      for (let i = 1; i < worm.segs.length; i++) {
        const prev = worm.segs[i - 1].mesh;
        const seg = worm.segs[i].mesh;
        const prevWorld = prev.getWorldPosition(this._p3);
        const segWorld = seg.getWorldPosition(this._p);
        delta.copy(prevWorld).sub(segWorld);
        const d = delta.length() || 1;
        if (d > HAZARDS.wormSegSpacing) {
          seg.position.add(delta.multiplyScalar((d - HAZARDS.wormSegSpacing) / d));
        }
        // Face the previous segment (chain alignment).
        seg.quaternion.copy(prev.quaternion);
      }

      // Maw bite: head within (head radius + player radius) of the ship.
      if (!safe && dist < 4.5 + PLAYER_RADIUS_FALLBACK) {
        damageHook(HAZARDS.wormBiteDamage);
        // Recoil: worm backs off briefly after a bite (it "swallows").
        worm.vel.addScaledVector(
          this._p2.copy(headPos).sub(playerPos).normalize(), 60);
      }

      worm.pulsePhase += dt * (1.5 + worm.segs.length * 0.05);
      // Rings pulse along the body (bioluminescent shimmer).
      for (let i = 0; i < worm.segs.length; i++) {
        const ring = worm.segs[i].ring;
        if (ring) {
          ring.material.opacity = 0.5 + Math.sin(worm.pulsePhase * 2 + i) * 0.35;
        }
      }
    }
  }

  // -- Clear (restart, SPEC §11) ---------------------------------------------

  /** Remove every hazard + reset the bolt pool (restart cleanup, SPEC §11). */
  clear() {
    // Crystals: remove every InstancedMesh (geo/mat are shared — no dispose).
    const seenMeshes = new Set();
    for (const c of this.crystals) {
      if (c.mesh && !seenMeshes.has(c.mesh)) {
        seenMeshes.add(c.mesh);
        if (c.mesh.parent) this._scene.remove(c.mesh);
        c.mesh.dispose();
      }
    }
    this.crystals.length = 0;

    // Pulsars: shared geo/mat — just detach groups.
    for (const pl of this.pulsars) {
      if (pl.group && pl.group.parent) this._scene.remove(pl.group);
    }
    this.pulsars.length = 0;

    // Mines: remove every InstancedMesh.
    for (const field of this.mines) {
      if (field.mesh && field.mesh.parent) this._scene.remove(field.mesh);
      field.mesh.dispose();
    }
    this.mines.length = 0;

    // Storms: shared sprite material — detach sprites only.
    for (const st of this.storms) {
      for (const s of st.sprites) {
        if (s.parent) this._scene.remove(s);
      }
    }
    this.storms.length = 0;

    // Black holes: shared geo/mat — detach groups.
    for (const bh of this.blackHoles) {
      if (bh.group && bh.group.parent) this._scene.remove(bh.group);
    }
    this.blackHoles.length = 0;

    // Death stars: shared geo/mat — detach groups; dispose laser meshes.
    for (const ds of this.deathStars) {
      if (ds.group && ds.group.parent) this._scene.remove(ds.group);
    }
    this.deathStars.length = 0;
    for (const l of this.deathStarLasers) {
      if (l.mesh && l.mesh.parent) this._scene.remove(l.mesh);
      l.mesh.geometry.dispose();
    }
    this.deathStarLasers.length = 0;

    // Ship graveyard: detach wreck groups + worm groups (worm ring torus
    // geos are per-instance — dispose them).
    for (const h of this.graveHulks) {
      if (h.group && h.group.parent) this._scene.remove(h.group);
    }
    this.graveHulks.length = 0;
    for (const w of this.worms) {
      if (w.group && w.group.parent) this._scene.remove(w.group);
      for (const s of w.segs) {
        if (s.ring) s.ring.geometry.dispose();
      }
    }
    this.worms.length = 0;

    // Bolt pool.
    for (const b of this._bolts) b.active = false;
    this._boltGeo.setDrawRange(0, 0);
    this._boltsDirty = true; // force one clean rewrite after clear
  }
}

export { _HazardSystem as HazardSystem };
export default _HazardSystem;

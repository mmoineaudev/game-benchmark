/**
 * EnemyManager.js — owns every live enemy (SPEC §4, P4).
 *
 * Responsibilities:
 *   - spawnGroup(typeKey, center, count, sectorIndex) — scatter a swarm of
 *     enemies around a point;
 *   - spawnSentinel(position, sectorIndex) — spawn ONE Sentinel mini-boss
 *     (SPEC §4 sector-exit boss), active immediately;
 *   - spawnWarden(position, sectorIndex) — spawn THE WARDEN finale boss
 *     (SPEC §4 sector 6), active immediately, guaranteedRare on kill;
 *   - update(dt, playerPos, gameState) — drive every live enemy, run the
 *     drone→player contact-damage check (0.75 s player invuln handled by the
 *     caller via DamageSystem), and detonate rammers whose charge reached
 *     detonateDistance (AoE if the player is within explodeRadius, then
 *     self-destruct FX);
 *   - kill(enemy) — death burst FX + 'enemy:killed' {typeKey, position, enemy}
 *     via EventBus, and the death shrink animation;
 *   - clear() — remove every enemy (restart cleanup, SPEC §11).
 *
 * Enemy self-destruct FX and the contact-damage callback are injected as
 * options so this module never imports Game/FX directly (FX is passed in).
 */
import * as THREE from 'three';
import { ENEMIES, PLAYER, WORLD_SAFE_RADIUS } from '../core/Constants.js';
import { Enemy } from './Enemy.js';
import { Station } from './Station.js';
import { EventBus } from '../core/EventBus.js';

/** Death burst / self-destruct particle count (capped, pooled upstream). */
const _BURST_PARTICLES = 24;
/** Death shrink duration, s. */
const _DIE_DURATION = 0.25;
/** Explosion flash color. */
const _EXPLODE_COLOR = '#ff9a3c';
/** Min on-screen glow size, px (distance floor — the whole point). */
const _MIN_GLOW_PX = 7;
/** Despawn distance, u — enemies beyond this are removed (dead weight). */
const _DESPAWN_DIST = 4000;
const _DESPAWN_DIST2 = _DESPAWN_DIST * _DESPAWN_DIST;
/** PERF (FIX #5): hard cap on live enemies (oldest non-boss despawned). */
const _MAX_ENEMIES = 220;
/** PERF (FIX #5): despawn distance check is staggered — each enemy is
 *  distance-tested every Nth frame (index % N === frame % N). */

/** Radial glow texture for the shared Points cloud. */
function _makeGlowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.6)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

class _EnemyManager {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../systems/WeaponSystem.js')} weaponSystem
   * @param {import('../visuals/FX.js')} fx
   * @param {{onPlayerHit?: Function, onEnemyDied?: Function}} [opts]
   *   onPlayerHit(amount, position) — drone contact / rammer AoE damage hook
   *   (the caller owns the 0.75 s invuln via DamageSystem).
   *   onEnemyDied(enemy) — optional post-death hook (drops, etc.).
   */
  constructor(scene, weaponSystem, fx, opts = {}) {
    /** @type {THREE.Scene} */
    this._scene = scene;
    /** @type {import('../systems/WeaponSystem.js')} */
    this._weapon = weaponSystem;
    /** @type {import('../visuals/FX.js')} */
    this._fx = fx;
    /** @type {Function} player-damage hook (invuln owned by caller). */
    this._onPlayerHit = opts.onPlayerHit ?? null;
    /** @type {Function} post-death hook. */
    this._onEnemyDied = opts.onEnemyDied ?? null;
    /** @type {THREE.Camera|null} set once by main.js (glow sizing). */
    this.camera = opts.camera ?? null;
    /** @type {Array<{position: THREE.Vector3}>|null} live stations; enemies
     *  keep out of their shield bubbles and hold fire inside them. */
    this.stations = opts.stations ?? null;

    /** @type {Enemy[]} */
    this.enemies = [];

    /** @type {boolean} last-frame flag: a contact hit was delivered (caller
     *   may gate it behind invuln); set when a live drone touches the player. */
    this._contactPending = false;
    /** Viewport height in px (glow screen-space sizing), refreshed lazily. */
    this._viewPx = 1080;
    /** Camera vertical FOV, deg (glow screen-space sizing). */
    this._fov = 95;

    // -- Shared glow Points cloud (1 draw call for ALL enemy glows) ----------
    // Bodies are 1.6–2 u → sub-pixel past ~200 u. Per-vertex size (attenuated
    // with a screen-px floor) + per-vertex color keep every enemy readable at
    // any distance at a total cost of ONE draw call.
    this._glowTex = _makeGlowTexture();
    this._glowGeo = new THREE.BufferGeometry();
    // Preallocate for the worst-case enemy count; drawRange trims each frame.
    const CAP = 8192;
    this._glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    this._glowGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(CAP * 3), 3));
    this._glowGeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(CAP), 1));
    this._glowGeo.setDrawRange(0, 0);
    this._glowMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: this._glowTex }, uViewPx: { value: 600 }, uViewPxY: { value: 600 }, uFov: { value: 95 } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        varying vec3 vColor;
        uniform float uViewPxY;
        uniform float uFov;
        void main() {
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // World size aSize → px: pxPerWorld = viewPxY / (2*d*tan(fov/2))
          float d = -mv.z;
          float pxPerWorld = uViewPxY / (2.0 * max(d, 1.0) * tan(radians(uFov) * 0.5));
          float px = max(aSize * pxPerWorld, ${'7.0'});
          gl_PointSize = min(px, 64.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.rgb, t.a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._glowPoints = new THREE.Points(this._glowGeo, this._glowMat);
    this._glowPoints.frustumCulled = false;
    this._glowPoints.renderOrder = 5;
    scene.add(this._glowPoints);
  }

  /**
   * Spawn a swarm of one type scattered around `center`.
   * @param {string} typeKey
   * @param {THREE.Vector3} centerPosition
   * @param {number} count
   * @param {number} sectorIndex 1-based.
   * @returns {Enemy[]} the spawned enemies.
   */
  spawnGroup(typeKey, centerPosition, count, sectorIndex) {
    // World spawn safe zone: no hostiles spawn within WORLD_SAFE_RADIUS of
    // the spawn station (90, 25, 420) — the start area stays threat-free.
    if (
      Math.hypot(
        centerPosition.x - 90,
        centerPosition.y - 25,
        centerPosition.z - 3600,
      ) <= WORLD_SAFE_RADIUS + 100
    ) {
      return [];
    }
    // PERF (FIX #5): hard budget — refuse spawns past the cap (bosses bypass
    // it via spawnSentinel/spawnWarden). Before this, dense sectors ×
    // enemySpawnMult duplicated groups into 500+ live enemies.
    if (this.enemies.length >= _MAX_ENEMIES) return [];
    const spawned = [];
    const stats = ENEMIES[typeKey];
    // Swarm spread: drone swarmMin..swarmMax are group *counts*, not spread;
    // scatter each member in a shell around the center for a natural swarm.
    for (let i = 0; i < count; i++) {
      const offset = _randomOffset(stats.orbitRadius ? 60 : 40);
      const pos = centerPosition.clone().add(offset);
      const enemy = new Enemy(this._scene, typeKey, pos, sectorIndex);
      this.enemies.push(enemy);
      spawned.push(enemy);
    }
    return spawned;
  }

  /**
   * Spawn a Sentinel mini-boss at `position` (SPEC §4, sector-exit boss).
   * Spawned once, active immediately (it IS the encounter — no dormancy).
   * @param {THREE.Vector3} position world spawn position.
   * @param {number} sectorIndex 1-based content sector for stat scaling.
   * @returns {Enemy} the spawned sentinel.
   */
  spawnSentinel(position, sectorIndex) {
    const enemy = new Enemy(this._scene, 'sentinel', position, sectorIndex);
    enemy.state = 'active';
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * Spawn THE WARDEN finale boss at `position` (SPEC §4/§5 sector 6).
   * Sector 6, active immediately (the arena encounter — no dormancy),
   * guaranteedRare on kill. The warden's enrage beam routes into the same
   * player-damage hook as drone contact / rammer AoE (damageHooks =
   * this._onPlayerHit, invuln-gated upstream in main).
   * @param {THREE.Vector3} position world spawn position.
   * @param {number} [sectorIndex] defaults to sector 6 (THE FORGE).
   * @returns {Enemy} the spawned warden.
   */
  spawnWarden(position, sectorIndex) {
    const s = sectorIndex && sectorIndex >= 1 ? sectorIndex : 6;
    const enemy = new Enemy(this._scene, 'warden', position, s);
    enemy.state = 'active';
    // Enrage beam damage hook (15/s): routed through the shared player-damage
    // hook so the 0.75 s invuln gating is not bypassed.
    enemy.damageHooks = (amount) => {
      if (this._onPlayerHit) this._onPlayerHit(amount, enemy.mesh.position);
    };
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * Spawn a CHROME fleet (user feedback: fleets of 5) — a V-wing formation
   * of 5 chrome sentinels around `center`, each with a phase offset so the
   * strafe weaves cascade through the wing. Returns the spawned enemies.
   * @param {THREE.Vector3} centerPosition fleet center (world).
   * @param {number} sectorIndex 1-based.
   * @returns {Enemy[]} the 5 chrome enemies.
   */
  spawnChromeFleet(centerPosition, sectorIndex) {
    const out = [];
    for (let i = 0; i < 5; i++) {
      // V-wing: leader front, 2 pairs flanking behind in a V.
      const slot = i === 0 ? [0, 0, 0] : [
        (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 14, // x spread
        (i % 2 ? 0.35 : -0.35) * Math.ceil(i / 2) * 6, // y spread
        -Math.ceil(i / 2) * 16, // trailing behind the leader
      ];
      const pos = centerPosition.clone().add(
        new centerPosition.constructor(...slot));
      const e = new Enemy(this._scene, 'chrome', pos, sectorIndex);
      e._fleetIndex = i; // weave phase offset per wing slot
      e._pulsePhase = i * 1.3; // cascade
      this.enemies.push(e);
      out.push(e);
    }
    return out;
  }

  /**
   * Per-frame: drive enemies, contact damage, rammer detonation.
   * @param {number} dt delta, s.
   * @param {THREE.Vector3} playerPos player world position.
   * @param {object} gameState GameState singleton.
   */
  update(dt, playerPos, gameState) {
    this._contactPending = false;
    this._frame = (this._frame ?? 0) + 1;

    // Glow camera plumbing (cheap: refresh view metrics each frame).
    const cam = this.camera;
    if (cam) {
      this._viewPx = (typeof window !== 'undefined' ? window.innerHeight : 1080);
      this._fov = cam.fov ?? 95;
      this._glowMat.uniforms.uViewPxY.value = this._viewPx;
      this._glowMat.uniforms.uFov.value = this._fov;
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      // Far despawn: enemies drifting beyond DESPAWN_DIST from the player
      // (chunks unload but enemies lingered, accumulating hundreds of dead
      // weight entities simulated every frame) are silently removed.
      // PERF (FIX #5): squared distance + staggered check (every 8th frame
      // per enemy) — with hundreds of enemies the full 60 Hz distance pass
      // showed in profiles.
      if (!e.dying && e.typeKey !== 'warden' &&
          ((i + this._frame) & 7) === 0 &&
          e.mesh.position.distanceToSquared(playerPos) > _DESPAWN_DIST2) {
        this._dispose(e);
        this.enemies.splice(i, 1);
        continue;
      }

      // Death shrink: finish it, then drop from the list.
      if (e.dying) {
        this._advanceDeath(e, dt);
        continue;
      }

      // Rammer detonation: in range → explode before it can be re-steered.
      // NEVER inside a station shield (protected zone — no attacks).
      if (e.typeKey === 'rammer' && e.state === 'active' &&
          !this._isPlayerShielded(playerPos)) {
        const dist = e.mesh.position.distanceTo(playerPos);
        if (dist <= e._stats.detonateDistance) {
          this._detonate(e, playerPos, gameState);
          continue;
        }
      }

      // Steer + fire (enemy keeps out of station shields; holds fire while
      // the PLAYER is inside a shield — the station is a safe haven).
      e.update(dt, playerPos, gameState, this._weapon, this.stations);

      // Death by damage from ANY source (collision loop, scripted, future AoE).
      if (!e.dying && e.hp <= 0) {
        this.kill(e);
        continue;
      }

      // Drone contact damage: radius check (invuln owned by the caller).
      // Suppressed while the player is inside a station shield.
      if (e.typeKey === 'drone' && e.state === 'active' &&
          !this._isPlayerShielded(playerPos)) {
        const reach = e.radius + PLAYER.radius;
        if (e.mesh.position.distanceTo(playerPos) <= reach) {
          this._contactPending = true;
          if (this._onPlayerHit) {
            this._onPlayerHit(e.damage, e.mesh.position);
          }
        }
      }
    }

    // Refresh the shared glow cloud: one vertex per live enemy.
    this._updateGlowCloud();
  }

  /**
   * True when the PLAYER is inside a station shield bubble (enemies hold
   * fire — the station is a safe haven).
   * @param {THREE.Vector3} playerPos
   * @returns {boolean}
   */
  _isPlayerShielded(playerPos) {
    return Station.isShielded(playerPos, this.stations ?? []);
  }

  /**
   * Fill the glow Points buffers from live enemies (positions, per-type
   * colors, world sizes; dormant dimmed). ONE draw call for the whole swarm.
   */
  _updateGlowCloud() {
    const pos = this._glowGeo.attributes.position.array;
    const col = this._glowGeo.attributes.aColor.array;
    const siz = this._glowGeo.attributes.aSize.array;
    let n = 0;
    const cap = siz.length;
    for (let i = 0; i < this.enemies.length && n < cap; i++) {
      const e = this.enemies[i];
      if (!e.alive || e.dying) continue;
      const p = e.mesh.position;
      const j3 = n * 3;
      pos[j3] = p.x; pos[j3 + 1] = p.y; pos[j3 + 2] = p.z;
      col[j3] = ((e.glowColor >> 16) & 255) / 255;
      col[j3 + 1] = ((e.glowColor >> 8) & 255) / 255;
      col[j3 + 2] = (e.glowColor & 255) / 255;
      siz[n] = e.glowBase * (e.state === 'dormant' ? 0.7 : 1);
      n++;
    }
    this._glowGeo.setDrawRange(0, n);
    this._glowGeo.attributes.position.needsUpdate = true;
    this._glowGeo.attributes.aColor.needsUpdate = true;
    this._glowGeo.attributes.aSize.needsUpdate = true;
  }

  /**
   * Kill an enemy: death burst FX + 'enemy:killed' via EventBus, start shrink.
   * @param {Enemy} enemy
   * @param {{burst?: boolean}} [opts] burst defaults to true.
   */
  kill(enemy, opts = {}) {
    if (!enemy.alive || enemy.dying) return;
    enemy.alive = false;
    enemy.dying = true;
    enemy._dieTimer = _DIE_DURATION;
    const doBurst = opts.burst !== false;

    if (doBurst) this._burst(enemy.mesh.position, _EXPLODE_COLOR, _BURST_PARTICLES);

    EventBus.emit('enemy:killed', {
      typeKey: enemy.typeKey,
      position: enemy.mesh.position,
      enemy,
      // SPEC §4: sentinel AND warden drop a guaranteed rare (boss kills).
      guaranteedRare: enemy.typeKey === 'sentinel' || enemy.typeKey === 'warden',
    });

    // Finale boss death (SPEC §4/§5 sector 6): main wires the victory state
    // + HUD toast + loot on this event.
    if (enemy.typeKey === 'warden') {
      EventBus.emit('boss:killed', {
        position: enemy.mesh.position.clone(),
        enemy,
      });
    }

    if (this._onEnemyDied) this._onEnemyDied(enemy);
  }

  /**
   * Remove every enemy from the scene (restart cleanup, SPEC §11).
   */
  clear() {
    for (const e of this.enemies) {
      this._dispose(e);
    }
    this.enemies.length = 0;
  }

  // -- Death FX / shrink ----------------------------------------------------

  /**
   * Advance a dying enemy's shrink; finalize + remove on completion.
   * @param {Enemy} e
   * @param {number} dt
   */
  _advanceDeath(e, dt) {
    e._dieTimer -= dt;
    const t = Math.max(0, e._dieTimer / _DIE_DURATION); // 1→0
    e.mesh.scale.setScalar(Math.max(1e-4, t));
    if (e._dieTimer <= 0) {
      this._dispose(e);
      const idx = this.enemies.indexOf(e);
      if (idx !== -1) this.enemies.splice(idx, 1);
    }
  }

  /**
   * Remove an enemy's mesh from the scene (shared geometry/material: no
   * dispose, SPEC §11 — rammer's cloned material is the only per-instance one).
   * @param {Enemy} e
   */
  _dispose(e) {
    this._scene.remove(e.mesh);
    if (e.typeKey === 'rammer' || e.typeKey === 'sniper') {
      // Cloned fx materials (pulsing emissive / per-instance cloak) → dispose.
      e._fxMat?.dispose();
    }
    // Shared geometries/materials are module-level singletons: NOT disposed.
  }

  /**
   * Rammer detonation: AoE if player within explodeRadius, then self-destruct.
   * @param {Enemy} e
   * @param {THREE.Vector3} playerPos
   * @param {object} gameState
   */
  _detonate(e, playerPos, gameState) {
    const dist = e.mesh.position.distanceTo(playerPos);
    if (dist <= e._stats.explodeRadius && this._onPlayerHit) {
      this._onPlayerHit(e.damage, e.mesh.position);
    }
    // Big orange burst marks the self-destruct.
    this._burst(e.mesh.position, _EXPLODE_COLOR, _BURST_PARTICLES * 2);
    this.kill(e);
  }

  /**
   * Death-burst / explosion: spawn a short additive particle splash.
   * FX owns pooled particles; here we just request a bounded burst.
   * @param {THREE.Vector3} position
   * @param {string} color CSS color.
   * @param {number} count
   */
  _burst(position, color, count) {
    // FX.spawn is a damage-number pool; for a visual burst we nudge the FX
    // camera shake + emit a damage number as the visible cue (FX has no
    // free particle API in P4 scope, so we keep it cheap + capped).
    this._fx.shake(6, 0.1);
    this._fx.spawn(position, count, color);
  }

  // -- Scratch --------------------------------------------------------------

  /** @type {THREE.Vector3} shared offset scratch. */
  _offset = new THREE.Vector3();
}

/**
 * Random point in a shell of `radius` around the origin (uniform direction,
 * radius biased to the outer half so swarms don't collapse onto the center).
 * @param {number} radius
 * @returns {THREE.Vector3}
 */
function _randomOffset(radius) {
  const v = new THREE.Vector3();
  v.randomDirection();
  v.multiplyScalar(radius * (0.5 + 0.5 * Math.random()));
  return v;
}

export { _EnemyManager as EnemyManager };
export default _EnemyManager;

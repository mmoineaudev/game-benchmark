/**
 * WeaponSystem.js — pooled projectile weapon (SPEC §2/§3/§8).
 *
 * "Pulse Autocannon": pooled projectiles, dmg 10, rate 6/s, speed 500 u/s,
 * life 1.6 s. One shared box geometry + 2 shared emissive materials
 * (cyan = player shots, orange = enemy shots). Pool pre-allocated from
 * PERF.projectilesPool via POOLS.projectiles (player 60 / enemy 140 share).
 *
 * No collision here (P2 wiring does sphere checks in the main loop).
 * Public API:
 *   new WeaponSystem(scene)
 *   weapon.update(dt, input, gameState, ship) — fire on Space/LMB held + rate
 *   weapon.updateProjectiles(dt) — move/age pool
 *   weapon.fire(origin, dir, opts) — activate one from pool
 *   weapon.reset() — deactivate all (restart, SPEC §11)
 */
import * as THREE from 'three';
import { PLAYER, POOLS, WEAPON_ATTACKS, FEEDBACK } from '../core/Constants.js';
import { FX } from '../visuals/FX.js';

// -- Attack constants (WEAPON_ATTACKS in Constants.js) ------------------------
const IEM_RADIUS = WEAPON_ATTACKS.iem.radius;
const IEM_DAMAGE = WEAPON_ATTACKS.iem.damage;
const IEM_COOLDOWN = WEAPON_ATTACKS.iem.cooldown;
const MISSILE_DAMAGE = WEAPON_ATTACKS.missiles.damage;
const MISSILE_SPEED = WEAPON_ATTACKS.missiles.speed;
const MISSILE_LIFE = WEAPON_ATTACKS.missiles.life;
const MISSILE_TURN_RATE = WEAPON_ATTACKS.missiles.turnRate;
const MISSILE_HIT_RADIUS = WEAPON_ATTACKS.missiles.hitRadius;
const VOLLEY_COOLDOWN = WEAPON_ATTACKS.missiles.cooldown;
const VOLLEY_GAP = WEAPON_ATTACKS.missiles.salvoGap;

// Missile scratch (no per-frame allocation).
const _missileUp = new THREE.Vector3(0, 1, 0);
const _missileZ = new THREE.Vector3(0, 0, 1);
const _missileTo = new THREE.Vector3();
const _missileToB = new THREE.Vector3();
const _missileAxis = new THREE.Vector3();

/** Emissive colors per shot owner (fixed palette). */
const PLAYER_SHOT_COLOR = 0x38bdf8; // cyan
const ENEMY_SHOT_COLOR = 0xff9a3c; // orange
const MISSILE_COLOR = 0xff4dd2; // neon magenta

class _WeaponSystem {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene;

    // -- Shared resources (geometries + materials, SPEC §11 no unique mats) --
    /** @type {THREE.BoxGeometry} elongated glowing bolt, +Z aligned. */
    this._geo = new THREE.BoxGeometry(0.5, 0.5, 2.6);
    /** @type {THREE.MeshStandardMaterial} player shots, emissive cyan. */
    this._playerMat = new THREE.MeshStandardMaterial({
      color: 0x0b1e2a,
      emissive: new THREE.Color(PLAYER_SHOT_COLOR),
      emissiveIntensity: 2.0,
      flatShading: true,
    });
    /** @type {THREE.MeshStandardMaterial} enemy shots, emissive orange. */
    this._enemyMat = new THREE.MeshStandardMaterial({
      color: 0x2a160b,
      emissive: new THREE.Color(ENEMY_SHOT_COLOR),
      emissiveIntensity: 2.0,
      flatShading: true,
    });

    // -- Missile pool (autoguided volley, attack 3) ----------------------------
    this._missileGeo = new THREE.ConeGeometry(0.35, 2.2, 6);
    this._missileGeo.rotateX(Math.PI / 2); // nose +Z
    this._missileMat = new THREE.MeshStandardMaterial({
      color: 0x2a0b1e,
      emissive: new THREE.Color(MISSILE_COLOR),
      emissiveIntensity: 2.2,
      flatShading: true,
    });
    /**
     * @type {Array<{mesh: THREE.Mesh, active: boolean, velocity: THREE.Vector3,
     *               life: number, damage: number, target: object|null}>}
     */
    this.missiles = [];
    for (let i = 0; i < 15; i++) {
      const mesh = new THREE.Mesh(this._missileGeo, this._missileMat);
      mesh.visible = false;
      scene.add(mesh);
      this.missiles.push({
        mesh,
        active: false,
        velocity: new THREE.Vector3(),
        life: 0,
        damage: 0,
        target: null,
      });
    }

    // Triple-volley queue: 3 salvos of 5, spaced VOLLEY_GAP s apart.
    /** @type {Array<{targets: (object|null)[], dir: THREE.Vector3, shipPos: THREE.Vector3, delay: number}>} */
    this._salvos = [];

    // -- Pool (PERF.projectilesPool total; POOLS.projectiles mirrors it) -----
    const total = POOLS.projectiles; // === PERF.projectilesPool
    /**
     * @type {Array<{mesh: THREE.Mesh, active: boolean, velocity: THREE.Vector3,
     *               life: number, damage: number, fromPlayer: boolean}>}
     * @public read-only access for P2 collision wiring in the main loop.
     */
    this.pool = new Array(total);
    for (let i = 0; i < total; i++) {
      const isPlayer = i < POOLS.projectilesPlayer;
      const mesh = new THREE.Mesh(
        this._geo,
        isPlayer ? this._playerMat : this._enemyMat,
      );
      mesh.visible = false;
      scene.add(mesh);
      this.pool[i] = {
        mesh,
        active: false,
        /** @type {THREE.Vector3} velocity, u/s. */
        velocity: new THREE.Vector3(),
        /** Remaining lifetime, s. */
        life: 0,
        /** Damage per hit. */
        damage: 0,
        /** True if fired by the player. */
        fromPlayer: isPlayer,
      };
    }

    // -- Fire state -----------------------------------------------------------
    /** Cooldown timer until next shot, s. */
    this._cooldown = 0;
    /** IEM shutdown timer, s remaining (0 = ready). */
    this._iemCooldown = 0;
    /** Missile volley cooldown timer, s remaining (0 = ready). */
    this._volleyCooldown = 0;

    // Swept collision: remember each projectile's position before this
    // frame's move so the main loop can test the whole segment (fast shots
    // otherwise tunnel through small targets between frames).
    for (const p of this.pool) {
      /** @type {THREE.Vector3} position at the start of this frame. */
      p.prev = new THREE.Vector3();
    }
  }

  /**
   * Fire the player weapon toward an explicit world aim direction.
   * Firing + direction are resolved by main.js: KeyF → ship nose aim
   * (cursor); MMB held → camera-forward aim. Cooldown-rate gated here.
   * @param {number} dt delta, s (capped by Game loop).
   * @param {import('../core/GameState.js')} gameState
   * @param {import('../entities/PlayerShip.js')} ship
   * @param {THREE.Vector3} aimWorld normalized world aim direction.
   * @param {boolean} firing whether the trigger is pressed this frame.
   */
  update(dt, gameState, ship, aimWorld, firing) {
    const run = gameState.run;
    if (!run || !run.alive) return;
    this._cooldown = Math.max(0, this._cooldown - dt);
    // Secondary attack cooldowns tick regardless of the trigger.
    this._iemCooldown = Math.max(0, this._iemCooldown - dt);
    this._volleyCooldown = Math.max(0, this._volleyCooldown - dt);
    if (!firing) return;
    if (this._cooldown > 0) return;
    this._cooldown = 1 / gameState.weaponRate();

    // Muzzle at the ship nose (offset along the aim axis).
    const origin = ship.group.position
      .clone()
      .addScaledVector(aimWorld, 3);
    this.fire(origin, aimWorld, { fromPlayer: true });
  }

  /**
   * Activate one pooled projectile.
   * @param {THREE.Vector3} origin world position.
   * @param {THREE.Vector3} dir normalized direction.
   * @param {{fromPlayer?: boolean, damage?: number, speed?: number, life?: number}} [opts]
   * @returns {object|null} the activated projectile (null if pool exhausted).
   */
  fire(origin, dir, opts = {}) {
    const fromPlayer = opts.fromPlayer !== false;
    const pool = this.pool;
    const start = fromPlayer ? 0 : POOLS.projectilesPlayer;
    const end = fromPlayer ? POOLS.projectilesPlayer : pool.length;
    let p = null;
    for (let i = start; i < end; i++) {
      if (!pool[i].active) {
        p = pool[i];
        break;
      }
    }
    if (!p) {
      // Exhausted: fall back to any free slot of the other owner class.
      for (let i = 0; i < pool.length; i++) {
        if (!pool[i].active) {
          p = pool[i];
          break;
        }
      }
    }
    if (!p) return null;

    p.active = true;
    p.fromPlayer = fromPlayer;
    p.velocity.copy(dir).multiplyScalar(opts.speed ?? PLAYER.weapon.projectileSpeed);
    p.life = opts.life ?? PLAYER.weapon.projectileLife;
    p.damage = opts.damage ?? PLAYER.weapon.damage;
    p.mesh.position.copy(origin);
    p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    p.mesh.visible = true;
    return p;
  }

  /**
   * Move active projectiles and age them; deactivate at life 0.
   * @param {number} dt delta, s.
   */
  updateProjectiles(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.prev.copy(p.mesh.position);
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.life -= dt;
      if (p.life <= 0) this._deactivate(p);
    }
  }

  /** Deactivate a projectile back into the pool. */
  _deactivate(p) {
    p.active = false;
    p.mesh.visible = false;
  }

  /**
   * Deactivate all projectiles + missiles (restart cleanup, SPEC §11).
   */
  reset() {
    this._cooldown = 0;
    this._iemCooldown = 0;
    this._volleyCooldown = 0;
    this._salvos.length = 0;
    for (const p of this.pool) {
      if (p.active) this._deactivate(p);
    }
    for (const m of this.missiles) {
      m.active = false;
      m.mesh.visible = false;
    }
  }

  // -- Attack 2: IEM (AoE burst, KeyC) ---------------------------------------

  /**
   * Detonate the IEM: destroys (heavy damage) every live enemy within
   * IEM_RADIUS of the ship, then the system "shuts down" for IEM_COOLDOWN s
   * (no re-fire until it elapses).
   * @param {import('../entities/EnemyManager.js')} enemyManager
   * @param {import('../entities/PlayerShip.js')} ship
   * @param {import('../visuals/FX.js')} fx
   * @returns {boolean} whether the burst fired (false = still shutdown).
   */
  fireIem(enemyManager, ship, fx) {
    if (this._iemCooldown > 0) return false;
    this._iemCooldown = IEM_COOLDOWN;
    const pos = ship.group.position;
    let hits = 0;
    for (const e of enemyManager.enemies) {
      if (!e.alive || e.dying) continue;
      if (e.mesh.position.distanceTo(pos) <= IEM_RADIUS) {
        FX.flashMesh(e.mesh, FEEDBACK.hitFlashDuration);
        e.takeDamage(IEM_DAMAGE);
        hits++;
        if (e.hp <= 0) enemyManager.kill(e);
      }
    }
    fx.shake(10, 0.35);
    fx.spawn(pos.clone(), hits > 0 ? `IEM ×${hits}` : 'IEM', '#22d3ee');
    return true;
  }

  // -- Attack 3: autoguided missile volley (KeyV) -----------------------------

  /**
   * Fire a triple missile volley: 3 salvos of 5 autoguided missiles,
   * spaced VOLLEY_GAP s apart. Targets: each salvo re-picks the 5 closest
   * live enemies at launch time (duplicates cycle if fewer). Each missile
   * steers toward its target (homing) at MISSILE_TURN_RATE rad/s and
   * detonates on proximity.
   * @param {import('../entities/EnemyManager.js')} enemyManager
   * @param {import('../entities/PlayerShip.js')} ship
   * @param {THREE.Vector3} fallbackDir direction when no targets (ship fwd).
   */
  fireMissileVolley(enemyManager, ship, fallbackDir) {
    if (this._volleyCooldown > 0) return;
    this._volleyCooldown = VOLLEY_COOLDOWN;
    // Salvo 1 fires NOW; salvos 2 and 3 queue at +0.5 s and +1.0 s.
    this._launchSalvo(enemyManager, ship, fallbackDir);
    this._salvos.push(
      { enemyManager, ship, dir: fallbackDir.clone(), delay: VOLLEY_GAP },
      { enemyManager, ship, dir: fallbackDir.clone(), delay: VOLLEY_GAP * 2 },
    );
  }

  /**
   * Launch one 5-missile salvo at the nearest live enemies.
   * @param {import('../entities/EnemyManager.js')} enemyManager
   * @param {import('../entities/PlayerShip.js')} ship
   * @param {THREE.Vector3} fallbackDir
   */
  _launchSalvo(enemyManager, ship, fallbackDir) {
    const pos = ship.group.position;
    const live = enemyManager.enemies
      .filter((e) => e.alive && !e.dying)
      .sort((a, b) =>
        a.mesh.position.distanceTo(pos) - b.mesh.position.distanceTo(pos));
    const targets = [];
    for (let i = 0; i < 5; i++) {
      targets.push(live.length ? live[i % live.length] : null);
    }
    for (let i = 0; i < 5; i++) {
      const m = this.missiles.find((ms) => !ms.active);
      if (!m) break;
      m.active = true;
      m.target = targets[i];
      m.damage = MISSILE_DAMAGE;
      m.life = MISSILE_LIFE;
      m.mesh.position.copy(pos);
      m.mesh.visible = true;
      // Launch: outward spread around the ship forward, then home in.
      const spread = (i - 2) * 0.35;
      m.velocity.copy(fallbackDir)
        .applyAxisAngle(_missileUp, spread)
        .multiplyScalar(MISSILE_SPEED);
      m.mesh.quaternion.setFromUnitVectors(_missileZ, m.velocity.clone().normalize());
    }
  }

  /**
   * Per-frame: tick the queued salvos (triple volley) + advance active
   * missiles (homing steer, proximity detonation, lifetime).
   * @param {number} dt delta, s.
   * @param {import('../entities/EnemyManager.js')} enemyManager
   * @param {import('../visuals/FX.js')} fx
   */
  updateMissiles(dt, enemyManager, fx) {
    // Queued salvos (salvos 2 and 3 of the triple volley).
    for (let i = this._salvos.length - 1; i >= 0; i--) {
      const s = this._salvos[i];
      s.delay -= dt;
      if (s.delay <= 0) {
        this._launchSalvo(s.enemyManager, s.ship, s.dir);
        this._salvos.splice(i, 1);
      }
    }
    for (const m of this.missiles) {
      if (!m.active) continue;
      m.life -= dt;
      // Homing: steer velocity toward the target (damped turn).
      const t = m.target;
      if (t && t.alive && !t.dying) {
        const to = _missileTo.copy(t.mesh.position).sub(m.mesh.position).normalize();
        const cur = _missileToB.copy(m.velocity).normalize();
        const angle = cur.angleTo(to);
        if (angle > 1e-4) {
          const step = Math.min(angle, MISSILE_TURN_RATE * dt);
          _missileAxis.copy(cur).cross(to);
          if (_missileAxis.lengthSq() > 1e-8) {
            cur.applyAxisAngle(_missileAxis.normalize(), step);
            m.velocity.copy(cur).multiplyScalar(MISSILE_SPEED);
          }
        }
        m.mesh.quaternion.setFromUnitVectors(_missileZ, cur);
      }
      m.mesh.position.addScaledVector(m.velocity, dt);
      // Proximity detonation vs any live enemy (swept-radius generous).
      let detonated = false;
      for (const e of enemyManager.enemies) {
        if (!e.alive || e.dying) continue;
        if (e.mesh.position.distanceTo(m.mesh.position) < MISSILE_HIT_RADIUS + (e.radius || 2)) {
          FX.flashMesh(e.mesh, FEEDBACK.hitFlashDuration);
          fx.spawn(e.mesh.position, m.damage, '#ff4dd2');
          e.takeDamage(m.damage);
          if (e.hp <= 0) enemyManager.kill(e);
          detonated = true;
          break;
        }
      }
      if (detonated || m.life <= 0) {
        if (!detonated) fx.spawn(m.mesh.position, '·', '#ff4dd2');
        m.active = false;
        m.mesh.visible = false;
      }
    }
  }
}

export { _WeaponSystem as WeaponSystem };
export default _WeaponSystem;

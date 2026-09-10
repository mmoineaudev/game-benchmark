/**
 * PlayerShip.js — the player's low-poly fighter (SPEC §3).
 *
 * Builds a flat-shaded hull (cone + box composite, ~4 u long), two wing
 * plates and an engine glow sprite, all sharing one accent color.
 * update() nose-steers the ship toward the mouse-aim direction (rev 3:
 * the cursor is the crosshair), throttle from the scroll wheel (up = accel,
 * down = brake), B boost (cooldown), Q/E roll flourish, and writes
 * position/velocity/throttle into GameState.run.
 */
import * as THREE from 'three';
import { PLAYER, CONTROLS, SUN } from '../core/Constants.js';
import { GameState } from '../core/GameState.js';

class _PlayerShip {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    /** @type {THREE.Group} */
    this.group = new THREE.Group();
    /** @type {THREE.Quaternion} ship orientation (yaw/pitch/roll). */
    this.orientation = new THREE.Quaternion();

    // Hull children live in a sub-group so switching ships can rebuild just
    // the visual hull (user feedback: the 3 ships must be separate DESIGNS,
    // not recolors) while flight state / scratch objects persist.
    this._hull = new THREE.Group();
    this.group.add(this._hull);

    // Accent color + hull tones, flat shading. Kept as instance fields so
    // the per-ship hull builders share them.
    this._hullMat = new THREE.MeshStandardMaterial({
      color: 0x8f9bb0,
      flatShading: true,
      metalness: 0.55,
      roughness: 0.45,
    });
    this._darkMat = new THREE.MeshStandardMaterial({
      color: 0x3a4354,
      flatShading: true,
      metalness: 0.6,
      roughness: 0.5,
    });
    this._accentMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.6,
      flatShading: true,
      metalness: 0.2,
      roughness: 0.6,
    });
    this._canopyMat = new THREE.MeshStandardMaterial({
      color: 0x0e2a3d,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.35,
      flatShading: true,
      metalness: 0.9,
      roughness: 0.15,
    });

    // The three hull DESIGNS are built by _buildHull (below): distinct
    // silhouettes per user feedback — Explorer (red scout), Fighter (stock
    // gunship), Flagship (heavy cruiser). This constructor block only sets
    // up shared materials.

    // -- Engine glow sprite behind the ship (built per hull design) -----------
    this._glowTex = _makeGlowTexture();
    this._glowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0x38bdf8,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    /** @type {THREE.Sprite} */
    this._glow = new THREE.Sprite(this._glowMat);

    // Boost reactors: cloned material (RED charging / BLUE ready).
    this._reactorMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.6,
      flatShading: true,
      metalness: 0.2,
      roughness: 0.6,
    });

    // Build the initial hull design (per current ship).
    this._buildHull();

    scene.add(this.group);

    // -- Flight state --------------------------------------------------------
    /** @type {THREE.Vector3} velocity, u/s. */
    this._velocity = new THREE.Vector3();
    /** Throttle target (0..1) set by the scroll wheel; eased toward each frame. */
    this._throttleTarget = 0;
    /** Boost burn timer, s remaining. */
    this._boostTimer = 0;
    /** Boost cooldown timer, s remaining. */
    this._boostCooldown = 0;
    /** Frames since the last real aim-steer input (drives nose-straighten). */
    this._aimIdleTime = 0;
    /** Turret mode: heading locked, camera free-aims (main.js reads this). */
    this.turretMode = false;
    /** Boost reactor state (true = blue/ready; false = red/charging). */
    this._reactorReady = true;
    /** Boost charge pool (Explorer: 2; others: 1). Refills over cooldown. */
    this._charges = 2;
    /** Refill timer for the next charge, s. */
    this._chargeCooldown = 0;

    // -- Scratch objects (no per-frame allocation) ---------------------------
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();
    this._qRoll = new THREE.Quaternion();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._ax = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /**
   * (Re)build the ship hull for the current ship: clears the _hull group
   * and assembles the ship-specific composite. Each of the 3 ships is a
   * DISTINCT design (user feedback) — silhouette, parts, and layout differ.
   */
  _buildHull() {
    const ship = GameState.currentShip();
    // Clear previous hull (shared geos/mats: just detach children).
    while (this._hull.children.length) this._hull.remove(this._hull.children[0]);
    if (ship.id === 'flagship') this._buildHullFlagship();
    else if (ship.id === 'fighter') this._buildHullFighter();
    else this._buildHullExplorer();

    // Glow sprite: position/size per hull (rebuilt each time).
    this._glow.position.set(0, this._glowY ?? -0.1, this._glowZ ?? -2.2);
    this._glow.scale.set(this._glowS ?? 1, this._glowS ?? 1, 1);
    // Ship IDENTITY COLORS (user feedback: the cosmetics must visibly change
    // with the ship). The hull gets a desaturated ship-color tint, the
    // accent strips/reactors the full-charge color, the canopy a matching
    // dark tone. Without this every ship rendered the same grey/blue.
    const col = new THREE.Color(ship.color);
    // Accent: full ship color.
    this._accentMat.color.copy(col);
    this._accentMat.emissive.copy(col);
    this._reactorMat.color.copy(col);
    this._reactorMat.emissive.copy(col);
    // Hull: blend grey base toward the ship color (~45%) so the design
    // detail (flat-shaded facets) still reads.
    const hullCol = new THREE.Color(0x8f9bb0).lerp(col, 0.45);
    this._hullMat.color.copy(hullCol);
    // Dark parts: ship color at low mix (keeps contrast).
    const darkCol = new THREE.Color(0x3a4354).lerp(col, 0.3);
    this._darkMat.color.copy(darkCol);
    // Canopy: ship-tinted dark glass.
    const canopyCol = new THREE.Color(0x0e2a3d).lerp(col, 0.35);
    this._canopyMat.color.copy(canopyCol);
    this._canopyMat.emissive.copy(col).multiplyScalar(0.5);
  }

  /**
   * EXPLORER — red scout: slim arrow-body, long forward canards, single
   * central engine, sensor mast. Small and pointy.
   */
  _buildHullExplorer() {
    const hullMat = this._hullMat;
    const darkMat = this._darkMat;
    const accentMat = this._accentMat;
    const canopyMat = this._canopyMat;
    const add = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz);
      this._hull.add(m);
      return m;
    };

    // Slim arrow fuselage (nose-heavy).
    const noseGeo = new THREE.ConeGeometry(0.32, 2.6, 5);
    noseGeo.rotateX(Math.PI / 2);
    add(noseGeo, hullMat, 0, 0, 2.4);
    const bodyGeo = new THREE.CylinderGeometry(0.16, 0.4, 2.6, 5);
    bodyGeo.rotateX(Math.PI / 2);
    add(bodyGeo, hullMat, 0, 0, 0);

    // Sensor mast + dish on the spine.
    add(new THREE.BoxGeometry(0.08, 0.8, 0.08), darkMat, 0, 0.55, -0.4);
    add(new THREE.SphereGeometry(0.2, 6, 5), accentMat, 0, 1.0, -0.4);

    // Small glazed canopy behind the nose.
    const canopyGeo = new THREE.SphereGeometry(0.24, 6, 4);
    canopyGeo.scale(0.8, 0.75, 1.6);
    add(canopyGeo, canopyMat, 0, 0.3, 1.0);

    // Forward canards (close to the nose) + small rear fins.
    const canGeo = new THREE.BoxGeometry(1.6, 0.07, 0.7);
    add(canGeo, hullMat, -0.95, 0, 1.4, 0, 0.25);
    add(canGeo, hullMat, 0.95, 0, 1.4, 0, -0.25);
    add(new THREE.BoxGeometry(0.07, 0.7, 0.9), darkMat, -0.7, 0.2, -1.2, 0, 0, -0.4);
    add(new THREE.BoxGeometry(0.07, 0.7, 0.9), darkMat, 0.7, 0.2, -1.2, 0, 0, 0.4);

    // Single central engine + reactor ring (ONE reactor = 2 boost charges
    // shown as a double-pulse ring).
    add(new THREE.CylinderGeometry(0.3, 0.36, 1.0, 6), darkMat, 0, 0, -1.5)
      .rotation.x = Math.PI / 2;
    const nozGeo = new THREE.TorusGeometry(0.3, 0.08, 6, 10);
    const noz = new THREE.Mesh(nozGeo, this._reactorMat);
    noz.position.set(0, 0, -2.1);
    this._hull.add(noz);
    // Second thin ring behind (the 2-charge cue).
    const noz2 = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 10), this._reactorMat);
    noz2.position.set(0, 0, -2.3);
    this._hull.add(noz2);

    this._glowY = 0;
    this._glowZ = -2.6;
    this._glowS = 0.8;
  }

  /**
   * FIGHTER — the classic gunship: delta wings, twin nacelles, wingtip
   * cannons, dorsal fin (the original stock design).
   */
  _buildHullFighter() {
    const hullMat = this._hullMat;
    const darkMat = this._darkMat;
    const accentMat = this._accentMat;
    const canopyMat = this._canopyMat;
    const add = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz);
      this._hull.add(m);
      return m;
    };

    const noseGeo = new THREE.ConeGeometry(0.5, 1.8, 6);
    noseGeo.rotateX(Math.PI / 2);
    add(noseGeo, hullMat, 0, 0, 2.1);
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.62, 2.8, 6);
    bodyGeo.rotateX(Math.PI / 2);
    bodyGeo.rotateZ(Math.PI / 6);
    add(bodyGeo, hullMat, 0, 0, -0.1);
    add(new THREE.BoxGeometry(0.55, 0.4, 1.6), darkMat, 0, 0.4, -0.9);
    const canopyGeo = new THREE.SphereGeometry(0.34, 6, 4);
    canopyGeo.scale(0.8, 0.75, 1.6);
    add(canopyGeo, canopyMat, 0, 0.42, 0.75);
    const wingGeo = new THREE.BoxGeometry(3.4, 0.1, 1.3);
    add(wingGeo, hullMat, -1.95, -0.05, -0.7, 0, 0.3, 0.08);
    add(wingGeo, hullMat, 1.95, -0.05, -0.7, 0, -0.3, -0.08);
    const stripGeo = new THREE.BoxGeometry(3.4, 0.09, 0.26);
    add(stripGeo, accentMat, -1.95, 0.03, -0.2, 0, 0.3);
    add(stripGeo, accentMat, 1.95, 0.03, -0.2, 0, -0.3);
    const tipGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.9, 6);
    tipGeo.rotateX(Math.PI / 2);
    add(tipGeo, accentMat, -3.35, -0.02, -0.1);
    add(tipGeo, accentMat, 3.35, -0.02, -0.1);
    add(new THREE.BoxGeometry(0.1, 0.9, 1.0), accentMat, 0, 0.65, -1.2, -0.35);
    const nacGeo = new THREE.CylinderGeometry(0.26, 0.3, 1.3, 6);
    nacGeo.rotateX(Math.PI / 2);
    add(nacGeo, darkMat, -0.62, -0.1, -1.2);
    add(nacGeo, darkMat, 0.62, -0.1, -1.2);
    const nozGeo = new THREE.TorusGeometry(0.26, 0.07, 6, 10);
    add(nozGeo, this._reactorMat, -0.62, -0.1, -1.85);
    add(nozGeo, this._reactorMat, 0.62, -0.1, -1.85);

    this._glowY = -0.1;
    this._glowZ = -2.2;
    this._glowS = 1;
  }

  /**
   * FLAGSHIP — heavy cruiser: wide armored slab hull, 4 engine block,
   * broad armored wings with turret mounts, bridge tower.
   */
  _buildHullFlagship() {
    const hullMat = this._hullMat;
    const darkMat = this._darkMat;
    const accentMat = this._accentMat;
    const canopyMat = this._canopyMat;
    const add = (geo, mat, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.rotation.set(rx, ry, rz);
      m.scale.set(sx, sy, sz);
      this._hull.add(m);
      return m;
    };

    // Broad armored prow (chiseled wedge, wide).
    const prowGeo = new THREE.ConeGeometry(0.9, 2.4, 4);
    prowGeo.rotateX(Math.PI / 2);
    prowGeo.rotateZ(Math.PI / 4); // diamond cross-section
    add(prowGeo, hullMat, 0, 0, 2.2);
    // Slab main hull (long box, beveled by scale).
    add(new THREE.BoxGeometry(1.8, 0.7, 4.2), hullMat, 0, 0, 0);
    // Bridge tower (tall, glazed top).
    add(new THREE.BoxGeometry(0.5, 0.9, 0.9), darkMat, 0, 0.7, -1.0);
    const bridgeGeo = new THREE.SphereGeometry(0.3, 6, 4);
    bridgeGeo.scale(1, 0.6, 1.3);
    add(bridgeGeo, canopyMat, 0, 1.25, -1.0);

    // Broad armored wings with turret mounts (accent cylinders on top).
    const wingGeo = new THREE.BoxGeometry(2.6, 0.22, 2.0);
    add(wingGeo, darkMat, -2.2, 0, -0.4);
    add(wingGeo, darkMat, 2.2, 0, -0.4);
    const tGeo = new THREE.CylinderGeometry(0.16, 0.2, 0.5, 6);
    add(tGeo, accentMat, -2.2, 0.3, -0.2);
    add(tGeo, accentMat, 2.2, 0.3, -0.2);
    add(tGeo, accentMat, -1.2, 0.3, -1.1);
    add(tGeo, accentMat, 1.2, 0.3, -1.1);

    // Armor side plates.
    add(new THREE.BoxGeometry(0.3, 1.0, 2.6), hullMat, -1.05, 0, -0.2);
    add(new THREE.BoxGeometry(0.3, 1.0, 2.6), hullMat, 1.05, 0, -0.2);

    // 4-engine block (quad reactors).
    const nacGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.9, 6);
    nacGeo.rotateX(Math.PI / 2);
    for (const [x, y] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) {
      add(nacGeo, darkMat, x, y, -2.2);
      const nozGeo = new THREE.TorusGeometry(0.2, 0.06, 6, 10);
      add(nozGeo, this._reactorMat, x, y, -2.75);
    }

    this._glowY = 0;
    this._glowZ = -3.2;
    this._glowS = 1.5;
  }

  /**
   * Reset flight state to a clean run (death→restart, SPEC §11).
   */
  reset() {
    // Spawn NEAR the sun (origin), never inside it: offset along +Z by
    // SUN.spawnDistance, close to the spawn station (90, 25, 3600).
    this.group.position.set(0, 0, SUN.spawnDistance);
    this.orientation.identity();
    this.group.quaternion.identity();
    this._velocity.set(0, 0, 0);
    this._throttleTarget = 0;
    this._boostTimer = 0;
    this._boostCooldown = 0;
    // Charge pool refilled on restart (cap per current ship).
    this._charges = GameState.currentShip().boostCharges;
    this._chargeCooldown = 0;
    this._reactorReady = true;
    // REBUILD THE HULL (user feedback: "the shape does not change") — the
    // design must swap with the ship, not just the stats. _buildHull also
    // re-applies the identity colors (it overrides the blue set below).
    this._buildHull();
    this._aimIdleTime = 0;
    this.turretMode = false;
  }

  /**
   * Per-frame flight update — nose-steer toward the mouse aim direction.
   *
   * Control model (rev 3): the CURSOR IS THE CROSSHAIR. Each frame the caller
   * (main.js) resolves a world steer direction from the cursor ray against the
   * camera. The ship banks its nose toward it (limited turn rate, roll kept)
   * and thrusts forward along the nose. Throttle comes from the scroll wheel:
   * scroll up = accelerate, scroll down = brake. When `aim.steer` is false
   * (middle-click free-look active), the ship holds its heading and the weapon
   * fires toward the camera instead — see main.js.
   *
   * @param {number} dt delta, s (capped by Game loop).
   * @param {import('../systems/InputSystem.js')} input
   * @param {import('../core/GameState.js')} gameState
   * @param {{dir: THREE.Vector3, steer: boolean}} aim resolved aim direction.
   */
  update(dt, input, gameState, aim) {
    const run = gameState.run;
    if (!run) return;

    // -- Nose-steer toward the cursor aim (world unit dir) -------------------
    // Damped steering: full turn rate far from the aim, decaying inside the
    // damp band so the nose SETTLES on the aim instead of circling it.
    // Turret mode: heading locked entirely; the camera free-aims instead.
    // STEER-ONLY-WHILE-MOVING (user feedback: hands-off mouse must fly
    // straight): the cursor steering is an ACTIVE input — steering toward a
    // stationary cursor fights the velocity-straightener forever (tug of
    // war, the ship never flies straight). So: cursor moves (or was moved in
    // the last 0.4 s) → nose tracks it; mouse idle → straighten onto the
    // trajectory.
    const mouseIdleMs = performance.now() - (input.lastMoveTime || 0);
    const steerActive = !this.turretMode && aim && aim.dir && mouseIdleMs < 400;
    if (this.turretMode || !steerActive) {
      this._aimIdleTime += dt;
    } else {
      const target = aim.dir;
      this._fwd.set(0, 0, 1).applyQuaternion(this.orientation);
      const dot = this._fwd.dot(target);
      if (dot < 0.9999) {
        this._tmp.copy(this._fwd).cross(target);
        const crossLen = this._tmp.length();
        if (crossLen > 1e-6) {
          const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
          // Damping factor: 1 outside the band, → 0 as error → aimDampEnd.
          const damp = THREE.MathUtils.clamp(
            (ang - CONTROLS.aimDampEnd) / (CONTROLS.aimDampStart - CONTROLS.aimDampEnd),
            0, 1,
          );
          const step = Math.min(ang, CONTROLS.turnRate * damp * dt);
          if (step > 1e-5) {
            this._qRoll.setFromAxisAngle(this._tmp.normalize(), step);
            this.orientation.premultiply(this._qRoll);
            this.orientation.normalize();
            this._aimIdleTime = 0;
          } else {
            // Settled on the aim (inside deadband) — start idling.
            this._aimIdleTime += dt;
          }
        }
      } else {
        this._aimIdleTime = 0;
      }
    }
    // -- Nose-straighten: after ~1 s without steering, nose back onto the
    // velocity vector so the ship flies straight along its trajectory.
    if (this._aimIdleTime > 1 && this._velocity.lengthSq() > 25) {
      this._fwd.set(0, 0, 1).applyQuaternion(this.orientation);
      this._tmp.copy(this._velocity).normalize();
      const dot = this._fwd.dot(this._tmp);
      const ang = Math.acos(Math.min(1, Math.max(-1, dot)));
      if (ang > 0.01 && ang < CONTROLS.straightenMaxError) {
        this._tmp.copy(this._fwd).cross(this._tmp);
        if (this._tmp.lengthSq() > 1e-8) {
          const step = Math.min(ang, CONTROLS.straightenRate * dt);
          this._qRoll.setFromAxisAngle(this._tmp.normalize(), step);
          this.orientation.premultiply(this._qRoll);
          this.orientation.normalize();
        }
      }
    }
    // Q/E roll still available as a flourish (independent of aim steering).
    const rollIn =
      (input.isDown('KeyQ') ? 1 : 0) - (input.isDown('KeyE') ? 1 : 0);
    if (rollIn !== 0) {
      this._qYaw.setFromAxisAngle(this._fwd.set(0, 0, 1), rollIn * CONTROLS.rollRate * dt);
      this.orientation.multiply(this._qYaw);
      this.orientation.normalize();
    }

    // -- Throttle from scroll wheel: up = accelerate, down = brake -----------
    // Each wheel notch steps a target throttle; the actual throttle eases
    // toward it so a fast spin never snaps, and scroll-down past 0 actively
    // retro-brakes.
    const wheel = input.consumeWheel(); // sign: + = scroll down (brake)
    if (wheel !== 0) {
      this._throttleTarget += -wheel * CONTROLS.wheelStepPerNotch;
      this._throttleTarget = Math.min(1, Math.max(0, this._throttleTarget));
    }
    const dtEase = Math.min(1, CONTROLS.throttleSmooth * dt);
    run.throttle += (this._throttleTarget - run.throttle) * dtEase;
    run.throttle = Math.min(1, Math.max(0, run.throttle));
    const braking = wheel > 0 && this._throttleTarget === 0;

    // -- Boost (Shift): ×2.2 speed, 4.5 s burn, 8 s cooldown, charge pool ----
    // Charge pool (user feedback: Explorer has 2 charges): each charge burns
    // independently; a charge refills after CONTROLS.boostCooldown of not
    // boosting. Reactor rings: RED while any charge burning/missing, BLUE
    // when the FULL pool is ready.
    const maxCharges = GameState.currentShip().boostCharges;
    if (this._chargeCooldown > 0) this._chargeCooldown -= dt;
    if (this._boostTimer > 0) this._boostTimer -= dt;
    // Trigger: needs a spare charge AND not mid-burn. At a FULL pool
    // charges === maxCharges (must be allowed!): the burn consumes one on
    // start, so the usable test is charges >= 1.
    if (
      input.isDown('ShiftLeft') &&
      this._boostTimer <= 0 &&
      this._charges >= 1
    ) {
      this._boostTimer = CONTROLS.boostDuration;
      this._charges -= 1;
      // Start the refill timer only when the pool just dropped below full.
      if (this._charges === maxCharges - 1) this._chargeCooldown = CONTROLS.boostCooldown;
    }
    // Refill one charge per cooldown period while not actively burning.
    if (this._boostTimer <= 0 && this._charges < maxCharges) {
      if (this._chargeCooldown <= 0) {
        this._charges = Math.min(maxCharges, this._charges + 1);
        if (this._charges < maxCharges) this._chargeCooldown = CONTROLS.boostCooldown;
      }
    }
    const boosting = this._boostTimer > 0;
    run.boosting = boosting;
    // Boost reactors (user feedback): RED while burning/charges missing,
    // BLUE when the full pool is ready.
    const ready = this._charges >= maxCharges && this._boostTimer <= 0;
    if (ready && !this._reactorReady) {
      this._reactorReady = true;
      this._reactorMat.color.setHex(0x38bdf8); // blue — ready
      this._reactorMat.emissive.setHex(0x38bdf8);
    } else if (!ready && this._reactorReady) {
      this._reactorReady = false;
      this._reactorMat.color.setHex(0xff3b30); // red — active/recharging
      this._reactorMat.emissive.setHex(0xff3b30);
    }
    // Reactor glow: hot while burning, ramps with recharge progress.
    if (boosting) {
      this._reactorMat.emissiveIntensity = 1.6;
    } else if (!ready) {
      const t = maxCharges > 0
        ? 1 - this._chargeCooldown / CONTROLS.boostCooldown
        : 1;
      this._reactorMat.emissiveIntensity = 0.6 + Math.max(0, Math.min(1, t)) * 0.6;
    } else {
      this._reactorMat.emissiveIntensity = 0.6;
    }
    const maxSpeed = boosting
      ? gameState.maxSpeed() * PLAYER.boostMultiplier
      : gameState.maxSpeed();

    // -- Acceleration ---------------------------------------------------------
    this._fwd.set(0, 0, 1).applyQuaternion(this.orientation);
    this._right.set(1, 0, 0).applyQuaternion(this.orientation);

    // Thrust along forward * throttle.
    // Acceleration scales with the CURRENT max speed so that the max-speed
    // clamp is the real terminal velocity: accel = maxSpeed × drag. (User
    // feedback: boost was barely noticeable — fixed drag capped all ships
    // at 120 u/s regardless of maxSpeed.)
    this._ax.copy(this._fwd).multiplyScalar(maxSpeed * PLAYER.drag * run.throttle);

    // Integrate, then apply drag.
    this._velocity.addScaledVector(this._ax, dt);
    if (braking) {
      // Retro-burn (scroll fully down): bleed velocity hard, no reverse.
      this._velocity.multiplyScalar(Math.max(0, 1 - CONTROLS.brakeDecel * dt));
    }
    this._velocity.multiplyScalar(Math.max(0, 1 - PLAYER.drag * dt));

    // Clamp speed.
    const speed = this._velocity.length();
    if (speed > maxSpeed) {
      this._velocity.multiplyScalar(maxSpeed / speed);
    }

    // -- Integrate position, sync to run state ------------------------------
    this.group.position.addScaledVector(this._velocity, dt);
    // Ladder odometer (SPEC §5): monotonic distance = max so far (u).
    gameState.run.distance = Math.max(gameState.run.distance || 0, this.group.position.length());
    this.group.quaternion.copy(this.orientation);

    run.position.x = this.group.position.x;
    run.position.y = this.group.position.y;
    run.position.z = this.group.position.z;
    run.velocity.x = this._velocity.x;
    run.velocity.y = this._velocity.y;
    run.velocity.z = this._velocity.z;

    // -- Engine glow scales with throttle -------------------------------------
    const glowScale = 0.6 + run.throttle * 1.8 + (boosting ? 1.0 : 0);
    this._glow.scale.set(glowScale, glowScale, 1);
  }

}

/**
 * Radial glow texture for the engine sprite.
 * @returns {THREE.CanvasTexture}
 */
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

export { _PlayerShip as PlayerShip };
export default _PlayerShip;

/**
 * CameraRig.js — full 6DOF chase camera.
 *
 * NORMAL mode: the camera frame is the SHIP's frame — offset rotated by the
 * full ship quaternion (no yaw/pitch decomposition), so the ship flies
 * freely in all directions (vertical/diagonal flight is identical to
 * horizontal) and the camera is always behind the nose. Ship-frame up → the
 * view rolls with the ship. MMB free-look orbits around the ship and eases
 * back to the chase position (~1 s, CONTROLS.orbitReturn) when released.
 * FOV 72 → 95 by throttle, +4 kick while boosting (smoothed).
 *
 * Turret mode (ship.turretMode): the camera is FULLY decoupled from the
 * ship heading — it rides behind the ship's current heading, lifted so the
 * ship sits low in frame, and looks at the cursor's world point. The aim is
 * exactly the mouse (crosshair follows the cursor, no pointer lock); the
 * ship keeps flying its trajectory.
 */
import * as THREE from 'three';
import { CAMERA, CONTROLS } from '../core/Constants.js';
import { InputSystem } from '../systems/InputSystem.js';

/** Look-ahead distance ahead of the ship, u. */
const LOOK_AHEAD = 10;

class _CameraRig {
  /**
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(camera) {
    this._camera = camera;
    /** Desired (unlerped) camera position. */
    this._desired = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._right = new THREE.Vector3(1, 0, 0);
    /** Turret free-aim orbit (yaw/pitch accumulated from mouse deltas). */
    this._turretYaw = 0;
    this._turretPitch = 0;
    /** Stable turret aim direction (derived from yaw/pitch each frame). */
    this._turretAim = new THREE.Vector3(0, 0, 1);
    /** Smoothed boost FOV kick, degrees. */
    this._fovKick = 0;

    const off = new THREE.Vector3(CAMERA.offsetX, CAMERA.offsetY, CAMERA.offsetZ);
    this._desired.copy(off);
    camera.position.copy(off);
  }

  /** Snap the orbit back to the chase position (turret-mode entry).
   *  Seeds the turret yaw/pitch from the CURRENT view direction so entering
   *  turret mode doesn't snap the aim to a default axis. */
  resetOrbit() {
    const f = this._fwd.set(0, 0, 1);
    this._camera.getWorldDirection(f);
    this._turretYaw = Math.atan2(f.x, f.z);
    this._turretPitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
  }

  /**
   * Per-frame camera update.
   *
   * NORMAL mode: chase camera — offset rotated by ship yaw+pitch around the
   * ship, lerp, lookAt a point ahead of the nose. MMB free-look orbits and
   * eases back.
   *
   * TURRET mode (ship.turretMode): the camera is FULLY decoupled from the
   * ship's heading — an independent world-space orbit. The cursor drives the
   * orbit angles (persistent, no ease-back, no pitch clamp beyond ±90°), the
   * camera hangs at a fixed distance behind the orbit position, and it always
   * looks AT the ship — so the view direction is purely cursor-controlled and
   * the player can free-aim 360° while the ship keeps flying its trajectory.
   * @param {number} dt delta, s.
   * @param {import('../entities/PlayerShip.js')} ship
   * @param {import('../core/GameState.js')} gameState
   */
  update(dt, ship, gameState) {
    const run = gameState.run;
    if (!run) return;
    const shipPos = ship.group.position;
    const shipQuat = ship.orientation;

    // Turret mode restores world-up (the turret view is world-anchored).
    this._camera.up.set(0, 1, 0);

    // -- Turret mode: mouse-delta free aim (STABLE) ---------------------------
    // The old implementation re-unprojected the cursor through the camera
    // every frame: camera moves → cursor ray moves → camera moves (feedback
    // loop, violent spin when looking backward). Now the view is an
    // accumulated yaw/pitch orbit driven ONLY by mouse deltas — the camera
    // never feeds back into the aim, so any angle (including dead backward)
    // is rock stable.
    if (ship.turretMode) {
      const mouse = InputSystem.consumeMouseDelta();
      this._turretYaw -= mouse.dx * CONTROLS.mouseOrbitRate;
      this._turretPitch -= mouse.dy * CONTROLS.mouseOrbitRate;
      // Clamp just short of the poles so the yaw basis never degenerates.
      this._turretPitch = THREE.MathUtils.clamp(this._turretPitch, -1.45, 1.45);
      const cp = Math.cos(this._turretPitch);
      this._turretAim.set(
        Math.sin(this._turretYaw) * cp,
        Math.sin(this._turretPitch),
        Math.cos(this._turretYaw) * cp,
      ).normalize();

      // Position: opposite the aim from the ship; look along the aim.
      this._desired.copy(shipPos).addScaledVector(this._turretAim, -CAMERA.turretDist);
      this._desired.y += CAMERA.turretLift * Math.max(0, Math.cos(this._turretPitch));
      this._camera.position.copy(this._desired);
      this._target.copy(shipPos).addScaledVector(this._turretAim, CAMERA.turretAimDist);
      this._camera.up.set(0, 1, 0);
      this._camera.lookAt(this._target);

      this._updateFov(dt, run);
      return;
    }

    // Normal mode: discard accumulated mouse deltas so entering turret mode
    // doesn't jump from a stale pre-turret buffer.
    InputSystem.consumeMouseDelta();

    // -- Full 6DOF chase: the camera frame is the SHIP's frame ----------------
    // No yaw/pitch decomposition — the ship flies freely in all directions
    // (horizontal means nothing), and the camera sits behind the nose in
    // whatever orientation the ship is in. This removes the yaw-degeneracy
    // entirely (no atan2 on a vertical forward vector, no gimbal lock).
    // NOTE: no MMB free-look — free look IS turret mode (KeyG) per the
    // user's control remap; MMB is the IEM burst trigger.
    this._local.set(CAMERA.offsetX, CAMERA.offsetY, CAMERA.offsetZ);
    this._orbitYaw = 0;
    this._orbitPitch = 0;

    // Offset in SHIP-local space (not world yaw+pitch): behind the nose,
    // above its dorsal side — correct at every orientation, including
    // vertical flight and rolls.
    this._desired.copy(shipPos);
    this._desired.add(this._local.applyQuaternion(shipQuat));

    // -- Lerp position toward desired, 8/s ----------------------------------
    const t = 1 - Math.exp(-CAMERA.lerp * dt);
    this._camera.position.lerp(this._desired, t);

    // -- Look at a point 10 u ahead of the ship (ship frame), up = ship up ---
    // Ship-frame up keeps the horizon rolling WITH the ship (6DOF feel) and
    // is never parallel to the view direction, so lookAt cannot degenerate.
    const f = this._fwd.set(0, 0, 1).applyQuaternion(shipQuat);
    this._target.copy(shipPos).addScaledVector(f, LOOK_AHEAD);
    this._camera.up.set(0, 1, 0).applyQuaternion(shipQuat);
    this._camera.lookAt(this._target);

    // -- FOV: base + throttle*(95-72), +boost kick (smoothed) ---------------
    this._updateFov(dt, run);
  }

  /** Shared FOV logic (both camera modes). */
  _updateFov(dt, run) {
    const throttle = run.throttle ?? 0;
    const baseFov = CAMERA.fovMin + throttle * (CAMERA.fovMax - CAMERA.fovMin);
    // Boost kick: active while the ship reports boosting (PlayerShip sets
    // run.boosting) or while the previous kick is still decaying.
    const boosting = run.boosting || this._fovKick > 0.01 ? 1 : 0;
    const kickTarget = boosting ? CAMERA.boostKick : 0;
    this._fovKick += (kickTarget - this._fovKick) * Math.min(1, 8 * dt);
    const fov = baseFov + this._fovKick;
    if (Math.abs(fov - this._camera.fov) > 1e-3) {
      this._camera.fov = fov;
      this._camera.updateProjectionMatrix();
    }
  }
}

export { _CameraRig as CameraRig };
export default _CameraRig;

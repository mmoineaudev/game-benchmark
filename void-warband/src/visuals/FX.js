/**
 * FX.js — hit feedback visuals (SPEC §3):
 *   (a) flashMesh() — white emissive hit flash, restores original (central
 *       registry so meshes can be passed without importing Game);
 *   (b) screen shake — shake(amount, duration), applied post-CameraRig;
 *   (c) damage numbers — pooled absolutely-positioned divs
 *       (max POOLS.damageNumbers), worldPos → screen via stored camera,
 *       rise + fade 0.7 s.
 *
 * Game.js is NEVER imported — the camera is passed in the constructor.
 */
import * as THREE from 'three';
import { POOLS } from '../core/Constants.js';

/** Damage number lifetime, s (rise + fade). */
const DAMAGE_NUMBER_LIFE = 0.7;
/** Damage number rise distance, px. */
const DAMAGE_NUMBER_RISE = 40;

/** White flash color. */
const _WHITE = new THREE.Color(0xffffff);

/** Central flash registry: meshes currently flashing (mesh → timer, s). */
const _matFlashes = new Map();

class _FX {
  /**
   * @param {THREE.PerspectiveCamera} camera stored for screen projection.
   */
  constructor(camera) {
    /** @type {THREE.PerspectiveCamera} */
    this._camera = camera;

    // -- Screen shake ---------------------------------------------------------
    /** Remaining shake time, s. */
    this._shakeTime = 0;
    /** Total shake duration (for falloff), s. */
    this._shakeTotal = 1;
    /** Shake amplitude, px. */
    this._shakeAmount = 0;

    // -- Damage numbers (pooled divs, max POOLS.damageNumbers) ---------------
    /**
     * @type {Array<{el: HTMLDivElement, active: boolean, t: number,
     *               world: THREE.Vector3|null, color: string}>}
     */
    this._nums = [];
    /** Scratch (no per-frame allocation). */
    this._v3 = new THREE.Vector3();

    const root = document.createElement('div');
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '900',
    });
    document.body.appendChild(root);
    this._root = root;

    for (let i = 0; i < POOLS.damageNumbers; i++) {
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        transform: 'translate(-50%, -50%)',
        font: '700 16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        textShadow: '0 1px 2px rgba(0,0,0,0.8)',
        willChange: 'transform, opacity',
        display: 'none',
      });
      root.appendChild(el);
      this._nums.push({ el, active: false, t: 0, world: null, color: '' });
    }
  }

  // -- (a) Hit flash ------------------------------------------------------------

  /**
   * Static helper: white emissive hit flash on a mesh for `duration` s.
   * Stores the original emissive so restore is exact.
   * @param {THREE.Mesh} mesh
   * @param {number} duration seconds.
   */
  static flashMesh(mesh, duration) {
    // Composite enemy bodies: flash the hull children (the root is an
    // invisible anchor with no material). Children of one enemy SHARE the
    // type material — dedupe by material and capture the original emissive
    // exactly ONCE per material, otherwise a later child captures the
    // already-whitened state and the restore leaves it stuck white.
    const mats = new Set();
    if (mesh.material?.emissive) mats.add(mesh.material);
    for (const c of mesh.children) {
      if (c.isMesh && c.material?.emissive) mats.add(c.material);
    }
    for (const mat of mats) {
      // Key the flash map by material (shared → one entry, one restore).
      let entry = _matFlashes.get(mat);
      if (!entry) {
        _matFlashes.set(mat, {
          original: mat.emissive.clone(),
          originalIntensity: mat.emissiveIntensity,
          timer: duration,
        });
      } else {
        entry.timer = Math.max(entry.timer, duration);
      }
      mat.emissive.copy(_WHITE);
    }
  }

  /**
   * Per-frame: run down flash timers and restore originals.
   * @param {number} dt delta, s.
   */
  _updateFlashes(dt) {
    if (_matFlashes.size === 0) return;
    for (const [mat, flash] of _matFlashes) {
      flash.timer -= dt;
      if (flash.timer <= 0) {
        mat.emissive.copy(flash.original);
        mat.emissiveIntensity = flash.originalIntensity;
        _matFlashes.delete(mat);
      }
    }
  }

  // -- (b) Screen shake ----------------------------------------------------------

  /**
   * Queue a screen shake.
   * @param {number} amount amplitude, px.
   * @param {number} duration duration, s.
   */
  shake(amount, duration) {
    this._shakeAmount = Math.max(this._shakeAmount, amount);
    this._shakeTime = Math.max(this._shakeTime, duration);
    this._shakeTotal = Math.max(this._shakeTotal, duration);
  }

  /**
   * Per-frame: apply random shake offset to the camera (call AFTER
   * CameraRig.update — it nudges the camera off its rig position), then
   * advance flashes + damage numbers.
   * @param {number} dt delta, s.
   * @param {THREE.PerspectiveCamera} camera
   */
  update(dt, camera) {
    if (this._shakeTime > 0) {
      this._shakeTime = Math.max(0, this._shakeTime - dt);
      const falloff = this._shakeTime / this._shakeTotal;
      const a = this._shakeAmount * falloff;
      camera.position.x += (Math.random() * 2 - 1) * a;
      camera.position.y += (Math.random() * 2 - 1) * a;
      if (this._shakeTime === 0) {
        this._shakeAmount = 0;
        this._shakeTotal = 1;
      }
    }
    this._updateFlashes(dt);
    this._updateDamageNumbers(dt);
  }

  // -- (c) Damage numbers ---------------------------------------------------------

  /**
   * Spawn a floating damage number at a world position (pooled; the oldest
   * live number is recycled if the pool is exhausted).
   * @param {THREE.Vector3} worldPos
   * @param {number|string} amount text (damage number).
   * @param {string} color CSS color.
   */
  spawn(worldPos, amount, color) {
    let num = this._nums.find((n) => !n.active);
    if (!num) {
      // Pool exhausted: recycle the oldest (smallest t).
      num = this._nums[0];
      for (const n of this._nums) {
        if (n.active && n.t < num.t) num = n;
      }
    }
    num.active = true;
    num.t = DAMAGE_NUMBER_LIFE;
    num.world = worldPos.clone();
    num.color = color;
    num.el.textContent = String(amount);
    num.el.style.color = color;
    num.el.style.display = 'block';
  }

  /**
   * Advance rise+fade; reproject to screen each frame; hide at end of life.
   * @param {number} dt delta, s.
   */
  _updateDamageNumbers(dt) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const num of this._nums) {
      if (!num.active) continue;
      num.t -= dt;
      if (num.t <= 0) {
        num.active = false;
        num.el.style.display = 'none';
        continue;
      }
      const progress = 1 - num.t / DAMAGE_NUMBER_LIFE; // 0→1
      // Project stored world pos to screen (camera moves → numbers track).
      this._v3.copy(num.world).project(this._camera);
      if (this._v3.z > 1) {
        num.el.style.display = 'none';
        continue;
      }
      const x = (this._v3.x * 0.5 + 0.5) * w;
      const y = (-this._v3.y * 0.5 + 0.5) * h - progress * DAMAGE_NUMBER_RISE;
      num.el.style.display = 'block';
      num.el.style.transform =
        `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      num.el.style.opacity = String(1 - progress);
    }
  }
}

export { _FX as FX };
export default _FX;

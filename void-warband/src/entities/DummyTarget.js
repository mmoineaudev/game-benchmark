/**
 * DummyTarget.js — P2 test target (SPEC P2: shoot/damage/destroy dummy).
 *
 * Icosahedron r=6, flat-shaded grey, hp 50, collision radius 6.
 * takeDamage(amount, fx): hp-, white hit flash (FX.flashMesh), floating
 * damage number (fx.spawn), die → shrink + remove, then emit
 * 'combat:dummyDied' via EventBus.
 */
import * as THREE from 'three';
import { FEEDBACK } from '../core/Constants.js';
import { FX } from '../visuals/FX.js';
import { EventBus } from '../core/EventBus.js';

/** Dummy test-target stats (P2 test fixtures). */
const DUMMY = {
  /** Radius, u. */
  radius: 6,
  /** HP. */
  hp: 50,
  /** Grey hull color. */
  color: 0x8a9199,
};

/** Death shrink duration, s. */
const DIE_DURATION = 0.25;

class _DummyTarget {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position world position.
   */
  constructor(scene, position) {
    /** @type {number} remaining HP. */
    this.hp = DUMMY.hp;
    /** @type {number} collision radius, u. */
    this.radius = DUMMY.radius;
    /** @type {boolean} */
    this.alive = true;
    /** @type {boolean} death shrink in progress. */
    this.dying = false;

    /** @type {THREE.Mesh} flat-shaded grey icosahedron. */
    this.mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(DUMMY.radius, 0),
      new THREE.MeshStandardMaterial({
        color: DUMMY.color,
        flatShading: true,
        metalness: 0.3,
        roughness: 0.8,
      }),
    );
    this.mesh.position.copy(position);
    scene.add(this.mesh);

    /** Death shrink timer, s remaining. */
    this._dieTimer = 0;
    /** @type {THREE.Scene} */
    this._scene = scene;

    /** @type {THREE.Vector3} respawn position (for restart, SPEC §11). */
    this._spawnPos = position.clone();
  }

  /**
   * Reset to a fresh target at its spawn position (restart cleanup, SPEC §11).
   */
  reset() {
    this.hp = DUMMY.hp;
    this.alive = true;
    this.dying = false;
    this._dieTimer = 0;
    this.mesh.position.copy(this._spawnPos);
    this.mesh.scale.setScalar(1);
    this.mesh.visible = true;
  }

  /**
   * Apply damage: flash, damage number, die at hp ≤ 0.
   * @param {number} amount
   * @param {import('../visuals/FX.js')} fx
   */
  takeDamage(amount, fx) {
    if (!this.alive || this.dying) return;
    this.hp -= amount;
    FX.flashMesh(this.mesh, FEEDBACK.hitFlashDuration);
    fx.spawn(
      this.mesh.position,
      amount,
      '#ffd166',
    );
    if (this.hp <= 0) {
      this.hp = 0;
      this._startDeath();
    }
  }

  /** Begin the death shrink+remove, emit 'combat:dummyDied' on completion. */
  _startDeath() {
    this.dying = true;
    this.alive = false;
    this._dieTimer = DIE_DURATION;
  }

  /**
   * Per-frame death shrink; removes the mesh and emits
   * 'combat:dummyDied' once.
   * @param {number} dt delta, s.
   */
  update(dt) {
    if (!this.dying) return;
    this._dieTimer -= dt;
    const t = Math.max(0, this._dieTimer / DIE_DURATION); // 1→0
    const s = Math.max(1e-4, t);
    this.mesh.scale.setScalar(s);
    if (this._dieTimer <= 0) {
      // Remove + dispose (non-shared geometry/material, SPEC §11).
      this._scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.dying = false;
      // Event name per task spec: 'combat:dummyDied' (no constant yet in EVENTS).
      EventBus.emit('combat:dummyDied', this);
    }
  }
}

export { _DummyTarget as DummyTarget };
export default _DummyTarget;

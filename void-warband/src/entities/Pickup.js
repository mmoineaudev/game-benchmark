/**
 * Pickup.js — a single ground pickup (SPEC §6).
 *
 * Visual magnetism, cheap:
 *   - shared geometries by SILHOUETTE key (scrap=small box, cell=capsule-ish
 *     cylinder, mod=octahedron, core=icosahedron, relic/rare=tetra star via
 *     two tetras, crate=box);
 *   - exactly one shared MeshStandardMaterial per TIER (4 materials total,
 *     emissive tier color, emissiveIntensity 0.6) — never unique materials;
 *   - bob + rotate in update(dt, time);
 *   - NO per-pickup dynamic lights; rare+ get a rarity beam: shared additive
 *     cylinder geometry (visible 800 u tall) at the pickup position.
 */
import * as THREE from 'three';
import { TIERS, ITEMS, ITEM_EFFECTS } from '../core/Constants.js';

// ---------------------------------------------------------------------------
// Shared module-level singletons (SPEC §8: never per-instance)
// ---------------------------------------------------------------------------

/**
 * Silhouette key for an item: shared geometry per key.
 * scrap → small box, *cell* → capsule-ish cylinder, *mod* → octahedron,
 * *core* → icosahedron, crate → box, relic/exotic → tetra star (two tetras),
 * rare data/voucher → tetra star, everything else → box.
 * @param {object} itemDef
 * @returns {string}
 */
function _shapeKey(itemDef) {
  const id = itemDef.id;
  if (id === 'scrap') return 'scrap';
  if (id === 'crate') return 'crate';
  if (id.includes('cell')) return 'cell';
  if (id.includes('mod')) return 'mod';
  if (id.includes('core')) return 'core';
  if (itemDef.tier === 'exotic' || id === 'void_relic' || id === 'data_fragment') {
    return 'star';
  }
  if (itemDef.tier === 'rare') return 'star';
  return 'box';
}

/** Shared geometries by shape key. */
const _GEOS = {
  scrap: new THREE.BoxGeometry(1.4, 1.4, 1.4),
  crate: new THREE.BoxGeometry(2.6, 2.6, 2.6),
  cell: new THREE.CylinderGeometry(0.9, 0.9, 2.6, 8),
  mod: new THREE.OctahedronGeometry(1.5, 0),
  core: new THREE.IcosahedronGeometry(1.6, 0),
  star: new THREE.TetrahedronGeometry(1.7, 0),
  box: new THREE.BoxGeometry(1.8, 1.8, 1.8),
};

/**
 * One shared material per TIER (4 total): emissive tier color,
 * emissiveIntensity 0.6 (SPEC §6 fixed tier colors).
 */
const _TIER_MATERIALS = Object.fromEntries(
  Object.keys(TIERS).map((tier) => [
    tier,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(TIERS[tier]),
      emissive: new THREE.Color(TIERS[tier]),
      emissiveIntensity: 0.6,
      metalness: 0.4,
      roughness: 0.5,
    }),
  ]),
);

/**
 * Shared rarity-beam geometry (additive cylinder, visible 800 u tall,
 * SPEC §6). Scale/height per use stays at 1 × 800 via material opacity.
 */
const _BEAM_GEO = new THREE.CylinderGeometry(0.8, 0.8, ITEM_EFFECTS.rarityBeamVisible, 8, 1, true);

/** Shared rarity-beam material (additive, opacity 0.25). */
const _BEAM_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(TIERS.rare),
  transparent: true,
  opacity: 0.25,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Bob amplitude, u. */
const _BOB_AMPLITUDE = 1.2;
/** Bob frequency, rad/s. */
const _BOB_FREQUENCY = 2.0;
/** Spin rate, rad/s. */
const _SPIN_RATE = 1.2;

class _Pickup {
  /**
   * @param {THREE.Scene} scene
   * @param {object} itemDef entry from ITEMS.
   * @param {THREE.Vector3} position world position.
   */
  constructor(scene, itemDef, position) {
    /** @type {object} */
    this.itemDef = itemDef;
    /** @type {THREE.Vector3} */
    this.position = position.clone();
    /** @type {boolean} */
    this.taken = false;

    /** @type {THREE.Group} root at pickup position (holds shape + beam). */
    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    // -- Shape: shared geometry by silhouette key, shared material by tier --
    const geo = _GEOS[_shapeKey(itemDef)];
    this._shape = new THREE.Mesh(geo, _TIER_MATERIALS[itemDef.tier]);
    if (_shapeKey(itemDef) === 'star') {
      // Tetra star: two tetras at opposite rotations (shared geometry).
      const twin = new THREE.Mesh(geo, _TIER_MATERIALS[itemDef.tier]);
      twin.rotation.y = Math.PI / 2;
      twin.rotation.z = Math.PI / 2;
      this._shape.add(twin);
    }
    this.group.add(this._shape);

    // -- Rarity beam: rare+ only (additive cylinder, 800 u, no lights) -----
    this._beam = null;
    if (itemDef.tier === 'rare' || itemDef.tier === 'exotic') {
      this._beam = new THREE.Mesh(_BEAM_GEO, _BEAM_MAT);
      this.group.add(this._beam);
    }

    scene.add(this.group);
    this.group.userData.pickup = this;
  }

  /**
   * Per-frame bob + rotate (visual magnetism only).
   * @param {number} dt delta, s.
   * @param {number} time absolute time, s.
   */
  update(dt, time) {
    if (this.taken) return;
    this._shape.position.y = Math.sin(time * _BOB_FREQUENCY) * _BOB_AMPLITUDE;
    this._shape.rotation.y += dt * _SPIN_RATE;
    this._shape.rotation.x += dt * _SPIN_RATE * 0.5;
  }

  /** Remove from scene (shared geometry/material: nothing to dispose). */
  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

export { _Pickup as Pickup };
export default _Pickup;

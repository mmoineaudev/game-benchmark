/**
 * Breakables.js — destructible space debris props (user feedback: distinct
 * breakable models). Four prop types, each a shared-geometry composite:
 *
 *   container  — Kessler freight crate: ribbed box, frame edges. 80 HP.
 *                Loot bias: raw resources (scrap/plates/coolant).
 *   podcluster — cluster of 3–5 small cargo pods tethered together. 50 HP.
 *                Loot bias: consumables (ammo/hull patch/shield cell).
 *   satellite  — Aurora comms wreck: dish + solar panels + truss. 60 HP.
 *                Loot bias: tech (data fragments, mods).
 *   buoy       — defense buoy: armored sphere + spikes + blinker. 100 HP.
 *                Loot bias: weapons (ammo cells, weapon mods).
 *
 * All materials shared module-level (SPEC §8/§11): zero per-instance allocs.
 */
import * as THREE from 'three';

// -- Shared geometry ----------------------------------------------------------
const _BOX = new THREE.BoxGeometry(1, 1, 1);
const _CYL = new THREE.CylinderGeometry(1, 1, 1, 8);
const _SPHERE = new THREE.SphereGeometry(1, 10, 8);
const _CONE = new THREE.ConeGeometry(1, 1, 5);
const _DISH = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3);

// -- Shared materials -----------------------------------------------------------
const _M = {
  container: new THREE.MeshStandardMaterial({
    color: 0x8a6d3b, emissive: new THREE.Color(0x2a1f0a), emissiveIntensity: 0.25,
    flatShading: true, metalness: 0.5, roughness: 0.75,
  }),
  pod: new THREE.MeshStandardMaterial({
    color: 0x5d7a52, emissive: new THREE.Color(0x1a2a12), emissiveIntensity: 0.2,
    flatShading: true, metalness: 0.3, roughness: 0.7,
  }),
  satellite: new THREE.MeshStandardMaterial({
    color: 0x7d8a96, emissive: new THREE.Color(0x1a2733), emissiveIntensity: 0.3,
    flatShading: true, metalness: 0.7, roughness: 0.4,
  }),
  buoy: new THREE.MeshStandardMaterial({
    color: 0x9a4438, emissive: new THREE.Color(0x33110a), emissiveIntensity: 0.35,
    flatShading: true, metalness: 0.55, roughness: 0.6,
  }),
  panel: new THREE.MeshStandardMaterial({
    color: 0x2c3e50, emissive: new THREE.Color(0x10202e), emissiveIntensity: 0.4,
    flatShading: true, metalness: 0.8, roughness: 0.3,
  }),
  blinker: new THREE.MeshStandardMaterial({
    color: 0x330d0d, emissive: new THREE.Color(0xff3030), emissiveIntensity: 1.4,
  }),
};

/** Prop stats: radius (collision/reticle), HP, loot bias source table. */
export const BREAKABLE_TYPES = {
  container:  { radius: 14, hp: 80,  loot: 'container' },
  podcluster: { radius: 12, hp: 50,  loot: 'podcluster' },
  satellite:  { radius: 13, hp: 60,  loot: 'satellite' },
  buoy:       { radius: 10, hp: 100, loot: 'buoy' },
};

/**
 * Build one prop of `type` at the origin of a fresh Group.
 * @param {string} type key of BREAKABLE_TYPES.
 * @param {Function} [rng] seeded PRNG (optional; Math.random fallback).
 * @returns {THREE.Group}
 */
export function buildBreakable(type, rng = Math.random) {
  const g = new THREE.Group();
  const part = (geo, mat, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };

  if (type === 'container') {
    // Ribbed freight crate: main box + frame ribs + corner caps.
    part(_BOX, _M.container, 0, 0, 0, 18, 9, 9);
    for (let i = -2; i <= 2; i++) {
      part(_BOX, _M.container, i * 3.6, 0, 0, 0.7, 9.6, 9.6);
    }
    part(_BOX, _M.panel, 0, 4.8, 0, 18.6, 0.6, 9.6);
  } else if (type === 'podcluster') {
    // 3–5 cargo pods around a small hub.
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.5;
      const r = 5 + rng() * 4;
      part(_BOX, _M.pod,
        Math.cos(a) * r, (rng() - 0.5) * 5, Math.sin(a) * r,
        4.5, 4.5, 6.5, rng() * 0.6, rng() * Math.PI, rng() * 0.6);
    }
    part(_CYL, _M.pod, 0, 0, 0, 1.2, 4, 1.2);
  } else if (type === 'satellite') {
    // Comms wreck: dish + truss + 2 solar panels.
    part(_DISH, _M.satellite, 0, 0, 2.5, 5, 5, 5, -Math.PI / 2.3);
    part(_CYL, _M.satellite, 0, 0, 0, 0.9, 10, 0.9, Math.PI / 2);
    part(_BOX, _M.panel, 0, 0, 0, 12, 0.4, 4);
    part(_BOX, _M.panel, 0, 0, 0, 12, 0.4, 4).position.x = 0; // panel pair below
    part(_BOX, _M.panel, 0, -2.6, 0, 10, 0.4, 3.4);
    part(_BOX, _M.satellite, 0, 2.6, 0, 3, 2, 3);
  } else if (type === 'buoy') {
    // Defense buoy: armored sphere + 6 spikes + red blinker.
    part(_SPHERE, _M.buoy, 0, 0, 0, 5.5, 5.5, 5.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(_CONE, _M.buoy,
        Math.cos(a) * 6.5, i % 2 ? 2.2 : -2.2, Math.sin(a) * 6.5,
        1.1, 3.2, 1.1,
        0, 0, Math.cos(a) * Math.PI * 0.5 * -1);
    }
    part(_SPHERE, _M.blinker, 0, 4.4, 0, 1.4, 1.4, 1.4);
  }
  return g;
}

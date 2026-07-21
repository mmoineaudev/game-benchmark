// VOID DRIFT — MathHelpers.js
// Seeded PRNG + small vector helpers.

import * as THREE from 'three';

/** mulberry32 — deterministic seeded PRNG. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seed from 3D chunk coordinates. */
export function chunkSeed(cx, cy, cz) {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ (cx & 0xffff), 16777619);
  h = Math.imul(h ^ (cy & 0xffff), 16777619);
  h = Math.imul(h ^ (cz & 0xffff), 16777619);
  return h >>> 0;
}

/** Hash a string key to [0,1). */
export function hashKey(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) & 0xffffff;
  return (hash % 10000) / 10000;
}

/** Fresh vector — never pool-mutate across calls in cold paths. */
export function getVector3(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}

/** Random unit vector from rng. */
export function randomUnitVector(rng, out = new THREE.Vector3()) {
  const u = rng() * 2 - 1;
  const phi = rng() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(phi), s * Math.sin(phi), u);
}

/** Random point in sphere of given radius. */
export function randomInSphere(rng, radius, out = new THREE.Vector3()) {
  randomUnitVector(rng, out);
  return out.multiplyScalar(Math.cbrt(rng()) * radius);
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }

// ============================================================
// MathHelpers — Vector pooling, random helpers, seeded RNG
// ============================================================
import * as THREE from 'three';

const _pool = [];
const POOL_SIZE = 64;

// Pre-allocate pool
for (let i = 0; i < POOL_SIZE; i++) {
  _pool.push(new THREE.Vector3());
}
let _poolIndex = 0;

/**
 * Get a pooled Vector3 to avoid GC pressure.
 * Call .copy() to copy values in, and don't hold references.
 */
export function getVector3(x = 0, y = 0, z = 0) {
  const v = _pool[_poolIndex % POOL_SIZE];
  v.set(x, y, z);
  _poolIndex++;
  return v;
}

/**
 * Seeded PRNG — Mulberry32
 * @param {number} seed
 * @returns {Function} random function [0, 1)
 */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a chunk coordinate to a seed
 */
export function chunkSeed(x, z) {
  const h = (x * 374761393 + z * 668265263) ^ 0x5bd1e995;
  return (h ^ (h >>> 13)) >>> 0;
}

/**
 * Random float in range
 */
export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Random integer in range (inclusive)
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Clamp a value
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Smoothstep
 */
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Map a value from one range to another
 */
export function mapRange(value, inMin, inMax, outMin, outMax) {
  return lerp(outMin, outMax, clamp((value - inMin) / (inMax - inMin), 0, 1));
}

/**
 * Generate a random unit vector on a sphere
 */
export function randomDirection() {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
    Math.cos(phi)
  );
}

/**
 * Generate a random vector within a sphere of given radius
 */
export function randomInSphere(radius) {
  const dir = randomDirection();
  const r = Math.cbrt(Math.random()) * radius;
  return dir.multiplyScalar(r);
}

/**
 * Generate a random vector within a cylinder (for asteroid placement)
 */
export function randomInCylinder(radius, height) {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radius;
  return new THREE.Vector3(
    Math.cos(angle) * r,
    (Math.random() - 0.5) * height,
    Math.sin(angle) * r
  );
}

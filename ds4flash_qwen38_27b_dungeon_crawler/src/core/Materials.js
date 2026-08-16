/**
 * Materials.js — seeded procedural material factories (§15).
 *
 * `makeBone/Metal/Cloth/Leather/Hide/Stone/Wood` produce fresh
 * MeshStandardMaterials sharing cached procedural normal/roughness maps
 * (styles: grain / stripes / pits; ImageData-based, Sobel-style
 * height→tangent-space normal, seeded mulberry32 so a key always yields the
 * same map; cached by `style:seed:strength`).
 *
 * `makeBasic/makeGlow/makeSpriteGlow` for unlit/emissive uses.
 *
 * HEADLESS SHIM (§27): all factories degrade to map-less materials when the
 * canvas image-data API is absent — `canvasCapable()` gates map generation.
 */

import * as THREE from 'three';
import { MATERIALS } from './Constants.js';

// ---------------------------------------------------------------------------
// Capability gate (§27)
// ---------------------------------------------------------------------------

/**
 * True only when the canvas 2D API supports the image-data calls the map
 * generators need. In headless Node (or a stubbed canvas) this is false and
 * every factory returns map-less materials.
 */
export function canvasCapable() {
  try {
    if (typeof document === 'undefined') return false;
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    return (
      !!ctx &&
      typeof ctx.createImageData === 'function' &&
      typeof ctx.putImageData === 'function' &&
      typeof ctx.getImageData === 'function'
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// mulberry32 PRNG
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Procedural map generation (height → normal + roughness)
// ---------------------------------------------------------------------------

const mapCache = new Map();

/**
 * Generate {normalMap, roughnessMap} for a key `style:seed:strength`.
 * Sobel-style: a seeded height field is converted into a tangent-space normal
 * map and a roughness map. Cached so a key always yields the same maps.
 * @returns {{normalMap:THREE.Texture, roughnessMap:THREE.Texture}|null}
 */
function getMaps(style, seed, strength, size = MATERIALS.TEXTURE_SIZE) {
  if (!canvasCapable()) return null;
  const key = `${style}:${seed}:${strength}`;
  const cached = mapCache.get(key);
  if (cached) return cached;

  const rand = mulberry32(seed);
  const heights = new Float32Array(size * size);

  // Base height: per-style pattern + seeded noise.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = rand();
      if (style === 'grain') {
        h = rand();
      } else if (style === 'stripes') {
        h = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 8 * (1 + rand() * 0.2));
        h = (h + rand() * 0.3) / 1.3;
      } else if (style === 'pits') {
        // sparse pits
        h = rand() < 0.08 ? 0 : 0.5 + rand() * 0.5;
      }
      heights[y * size + x] = h;
    }
  }

  const normalData = new ImageData(size, size);
  const roughData = new ImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      const hl = heights[y * size + xm];
      const hr = heights[y * size + xp];
      const hu = heights[ym * size + x];
      const hd = heights[yp * size + x];
      // Sobel-style derivatives scaled by strength
      const dx = (hl - hr) * strength;
      const dy = (hu - hd) * strength;
      const nz = 1.0;
      const len = Math.sqrt(dx * dx + dy * dy + nz * nz);
      const nx = dx / len;
      const ny = dy / len;
      const nzN = nz / len;

      const rough = Math.max(0, Math.min(1, 0.5 + (heights[i] - 0.5) * 2 * strength * 0.5));
      const rv = Math.round(rough * 255);

      const ni = i * 4;
      normalData.data[ni + 0] = Math.round((nx * 0.5 + 0.5) * 255);
      normalData.data[ni + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalData.data[ni + 2] = Math.round((nzN * 0.5 + 0.5) * 255);
      normalData.data[ni + 3] = 255;

      roughData.data[ni + 0] = rv;
      roughData.data[ni + 1] = rv;
      roughData.data[ni + 2] = rv;
      roughData.data[ni + 3] = 255;
    }
  }

  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const normalCtx = normalCanvas.getContext('2d');
  normalCtx.putImageData(normalData, 0, 0);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext('2d');
  roughCtx.putImageData(roughData, 0, 0);

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(MATERIALS.TEXTURE_REPEAT, MATERIALS.TEXTURE_REPEAT);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(MATERIALS.TEXTURE_REPEAT, MATERIALS.TEXTURE_REPEAT);

  const result = { normalMap, roughnessMap };
  mapCache.set(key, result);
  return result;
}

/**
 * Build a fresh MeshStandardMaterial, attaching cached procedural
 * normal/roughness maps when canvas-capable.
 * @param {number} color
 * @param {string} style 'grain' | 'stripes' | 'pits'
 * @param {number} seed
 * @param {number} strength
 * @param {object} [opts] extra material params (metalness, roughness, etc.)
 */
function makeStandard(color, style, seed, strength, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.8,
    metalness: opts.metalness ?? 0.0,
    ...opts,
  });
  const maps = getMaps(style, seed, strength);
  if (maps) {
    mat.normalMap = maps.normalMap;
    mat.roughnessMap = maps.roughnessMap;
    mat.normalScale = new THREE.Vector2(strength, strength);
  }
  return mat;
}

// ---------------------------------------------------------------------------
// Standard (lit) material factories — fresh instances each call
// ---------------------------------------------------------------------------

/** Bone: off-white, grain. */
export function makeBone(seed = 1) {
  return makeStandard(0xd8d2c0, 'grain', seed, 0.6, { roughness: 0.85 });
}

/** Metal: cool grey, metallic, stripes. */
export function makeMetal(seed = 2) {
  return makeStandard(0x8a8f96, 'stripes', seed, 0.9, { metalness: 0.9, roughness: 0.35 });
}

/** Cloth: muted blue-grey, grain, high roughness. */
export function makeCloth(seed = 3) {
  return makeStandard(0x5a6270, 'grain', seed, 0.5, { roughness: 0.95 });
}

/** Leather: tan, pits, medium roughness. */
export function makeLeather(seed = 4) {
  return makeStandard(0x8a6a3a, 'pits', seed, 0.7, { roughness: 0.7 });
}

/** Hide: brown, grain. */
export function makeHide(seed = 5) {
  return makeStandard(0x7a5a3a, 'grain', seed, 0.6, { roughness: 0.8 });
}

/** Stone: grey, pits, high roughness. */
export function makeStone(seed = 6) {
  return makeStandard(0x6b6560, 'pits', seed, 0.8, { roughness: 0.95 });
}

/** Wood: warm brown, stripes. */
export function makeWood(seed = 7) {
  return makeStandard(0x7a5a2a, 'stripes', seed, 0.6, { roughness: 0.75 });
}

// ---------------------------------------------------------------------------
// Unlit / emissive factories
// ---------------------------------------------------------------------------

/** Basic (unlit) material. */
export function makeBasic(color = 0xffffff) {
  return new THREE.MeshBasicMaterial({ color });
}

/** Emissive glow material (self-illuminated). */
export function makeGlow(color = 0xffffff, emissiveIntensity = 1.5) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    roughness: 0.4,
    metalness: 0.0,
  });
}

/** Sprite glow material (additive, transparent). */
export function makeSpriteGlow(color = 0xffffff) {
  return new THREE.SpriteMaterial({
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

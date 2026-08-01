import * as THREE from 'three';

// ---------------------------------------------------------------- canvas util
// The headless verification scripts stub `document.createElement('canvas')`
// with a bare-bones 2D context that has none of the imageData API. Everything
// here must degrade gracefully: when no real pixel access exists, we return
// map-less materials (pure color/roughness/metalness) so the six regression
// scripts still pass. In the real browser we generate normal/roughness maps.

let _canvasCapable = null;
function canvasCapable() {
  if (_canvasCapable !== null) return _canvasCapable;
  try {
    const c = document.createElement('canvas');
    if (!c || typeof c.getContext !== 'function') return (_canvasCapable = false);
    const ctx = c.getContext('2d');
    _canvasCapable = !!ctx
      && typeof ctx.createImageData === 'function'
      && typeof ctx.putImageData === 'function'
      && typeof ctx.getImageData === 'function';
  } catch {
    _canvasCapable = false;
  }
  return _canvasCapable;
}

// Tiny seeded PRNG so a given cache key always produces the same map.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _cache = new Map(); // key -> THREE.Texture
const _matCache = new Map(); // `bone:0xcfc6b0` style key -> material clone factory

// Grab one shared 2D context (many small canvases is wasteful).
let _sharedCtx = null;
function ctx2d(size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  _sharedCtx = c.getContext('2d');
  return { canvas: c, ctx: _sharedCtx };
}

// Build an ImageData-based height/normal map. `style` picks a noise pattern:
//  - 'grain'  : fine isotropic noise (skin, hide, stone)
//  - 'stripes': directional streaks (metal, wood grain, cloth weave)
//  - 'pits'   : sparse darker pits (bone, aged leather)
// Returns a THREE.CanvasTexture (RGB = tangent-space normal, +strength applied)
// or null when the canvas API isn't available.
function generateNormalMap(style = 'grain', seed = 7, strength = 0.6, size = 128) {
  if (!canvasCapable()) return null;
  const key = `normal:${style}:${seed}:${strength}:${size}`;
  if (_cache.has(key)) return _cache.get(key);

  const { canvas, ctx } = ctx2d(size);
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(seed + style.length * 7919);
  const strengthScale = strength * 5;

  // Base height field.
  const height = new Float32Array(size * size);
  if (style === 'stripes') {
    const dirX = rand() > 0.5 ? 1 : -1;
    const period = 6 + rand() * 6;
    for (let i = 0; i < height.length; i++) {
      const y = Math.floor(i / size);
      const x = i % size;
      const coord = dirX > 0 ? x : y;
      height[i] = Math.sin((coord / period) * Math.PI * 2) * 0.5
        + (rand() - 0.5) * 0.25;
    }
  } else {
    for (let i = 0; i < height.length; i++) {
      let v = (rand() - 0.5) * 2;
      if (style === 'pits') {
        v = (rand() - 0.5) * 0.5 - (rand() < 0.08 ? 1.2 : 0);
      } else {
        // reinforce subtle clumps for a natural grain
        v += (rand() - 0.5) * 0.5;
      }
      height[i] = Math.tanh(v);
    }
  }

  // Sobel-ish finite difference -> tangent-space normal, packed as RGB.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const yt = (y - 1 + size) % size, yb = (y + 1) % size;
      const dx = height[yt * size + xr] - height[yb * size + xl];
      const dy = height[yt * size + xl] - height[yb * size + xr];
      const nx = -dx * strengthScale;
      const ny = -dy * strengthScale;
      const nz = 1.0;
      const o = (y * size + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _cache.set(key, tex);
  return tex;
}

// Roughness map: brighter = rougher. Returns texture or null.
function generateRoughnessMap(style = 'grain', seed = 11, base = 0.6, size = 128) {
  if (!canvasCapable()) return null;
  const key = `rough:${style}:${seed}:${base}:${size}`;
  if (_cache.has(key)) return _cache.get(key);
  const { canvas, ctx } = ctx2d(size);
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(seed + style.length * 104729);
  for (let i = 0; i < img.data.length; i += 4) {
    let v = base + (rand() - 0.5) * 0.25;
    if (style === 'stripes') v = base + (rand() - 0.5) * 0.1;
    if (style === 'pits') v = base + (rand() < 0.08 ? 0.45 : (rand() - 0.5) * 0.12);
    const c = Math.max(0, Math.min(1, v)) * 255;
    img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _cache.set(key, tex);
  return tex;
}

// ----------------------------------------------------------------- material
// Every material factory returns a FRESH material so per-entity opacity
// (death fade) stays independent, but shares cached map textures and config.
// opts.color may be a hex number; every factory is shim-safe (maps null-checks).

function applyMaps(mat, normal, rough) {
  if (normal) { mat.normalMap = normal; mat.normalScale.set(1, 1); }
  if (rough) { mat.roughnessMap = rough; }
  return mat;
}

export function makeBone(hex, opts = {}) {
  const { seed = 7, strength = 0.5, rough = 0.7, metal = 0.05 } = opts;
  return applyMaps(new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal, transparent: true,
  }), generateNormalMap('pits', seed, strength), generateRoughnessMap('grain', seed + 40, rough));
}

export function makeMetal(hex, opts = {}) {
  const { seed = 13, strength = 0.9, rough = 0.35, metal = 0.85 } = opts;
  return applyMaps(new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal, transparent: true,
  }), generateNormalMap('stripes', seed, strength), generateRoughnessMap('stripes', seed + 41, rough * 0.7));
}

export function makeCloth(hex, opts = {}) {
  const { seed = 17, strength = 0.7, rough = 0.9, metal = 0.0 } = opts;
  return applyMaps(new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal, transparent: true,
  }), generateNormalMap('stripes', seed, strength), generateRoughnessMap('grain', seed + 42, rough));
}

export function makeLeather(hex, opts = {}) {
  const { seed = 19, strength = 0.6, rough = 0.7, metal = 0.05 } = opts;
  return applyMaps(new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal, transparent: true,
  }), generateNormalMap('pits', seed, strength), generateRoughnessMap('grain', seed + 43, rough));
}

export function makeHide(hex, opts = {}) {
  const { seed = 23, strength = 0.5, rough = 0.8, metal = 0.0 } = opts;
  return applyMaps(new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal, transparent: true,
  }), generateNormalMap('grain', seed, strength), generateRoughnessMap('grain', seed + 44, rough));
}

export function makeStone(hex, opts = {}) {
  const { seed = 29, strength = 0.6, rough = 0.9, metal = 0.05 } = opts;
  return applyMaps(new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal, transparent: true,
  }), generateNormalMap('grain', seed, strength), generateRoughnessMap('grain', seed + 45, rough));
}

export function makeWood(hex, opts = {}) {
  const { seed = 31, strength = 0.8, rough = 0.8, metal = 0.1 } = opts;
  return applyMaps(new THREE.MeshStandardMaterial({
    color: hex, roughness: rough, metalness: metal, transparent: true,
  }), generateNormalMap('stripes', seed, strength), generateRoughnessMap('stripes', seed + 46, rough));
}

// Flat/no-map material helpers (still transparent for the shared death fade).
export function makeBasic(hex, opts = {}) {
  return new THREE.MeshBasicMaterial({ color: hex, ...opts });
}

// Emissive material (eyes, cores, orbs) — no normal map needed.
export function makeGlow(hex, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color: hex, transparent: true, depthWrite: false, ...opts,
  });
}

export function makeSpriteGlow(hex, map, opts = {}) {
  return new THREE.SpriteMaterial({
    map, color: hex, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, ...opts,
  });
}

// Expose the generator for custom map needs (and for the budget check to
// introspect). Also expose cache stats.
export const Materials = { makeBone, makeMetal, makeCloth, makeLeather, makeHide, makeStone, makeWood, makeBasic, makeGlow, makeSpriteGlow };
export const textureCacheStats = () => ({ maps: _cache.size, capable: canvasCapable() });

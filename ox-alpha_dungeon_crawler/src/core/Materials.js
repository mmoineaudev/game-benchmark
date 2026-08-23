// Materials.js — seeded procedural material factories (§15).
// Headless shim: all factories degrade to map-less materials when the canvas
// ImageData API is absent (check scripts stub the canvas) — canvasCapable() gates maps.

const _normalCache = new Map();  // style:seed:strength -> CanvasTexture
const _roughCache = new Map();

export function canvasCapable() {
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    return !!(ctx && ctx.createImageData && ctx.putImageData && ctx.getImageData);
  } catch { return false; }
}

// mulberry32 — same key always yields the same map
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sobel-style height → tangent-space normal map
function makeNormalMap(style, seed, strength, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  // height field
  const h = new Float32Array(size * size);
  const rnd = mulberry32(seed);
  for (let i = 0; i < h.length; i++) h[i] = rnd();
  if (style === 'stripes') for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] += 0.5 * Math.sin(x * 0.5);
  else if (style === 'pits') { for (let k = 0; k < 24; k++) { const px = (rnd() * size) | 0, py = (rnd() * size) | 0, r = 2 + rnd() * 5; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = (px + dx + size) % size, yy = (py + dy + size) % size; if (dx * dx + dy * dy <= r * r) h[yy * size + xx] -= 0.6; } } }
  else { /* grain */ for (let i = 0; i < h.length; i++) h[i] = h[i]; }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const ym = (y - 1 + size) % size, yp = (y + 1) % size;
      const dx = (h[y * size + xp] - h[y * size + xm]) * strength;
      const dy = (h[yp * size + x] - h[ym * size + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * size + x) * 4;
      img.data[o] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[o + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      img.data[o + 2] = inv * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function cachedMap(cache, style, seed, strength, builder) {
  const key = `${style}:${seed}:${strength}`;
  let tex = cache.get(key);
  if (!tex) { tex = builder(); cache.set(key, tex); }
  return tex;
}

function applyMaps(mat, style, seed, strength) {
  if (!canvasCapable()) return mat; // headless shim — map-less material
  const THREE = globalThis.__THREE__;
  if (!THREE) return mat; // pure-Node use without three loaded
  const normalTex = cachedMap(_normalCache, style, seed, strength, () => {
    const t = new THREE.CanvasTexture(makeNormalMap(style, seed, strength, 128));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
  mat.normalMap = normalTex;
  mat.normalScale = new THREE.Vector2(0.6, 0.6);
  return mat;
}

function std(params) {
  const THREE = globalThis.__THREE__;
  return new THREE.MeshStandardMaterial(params);
}

function factory(base, style) {
  return (tintHex) => {
    const mat = std({ color: tintHex ?? base.color, roughness: base.roughness, metalness: base.metalness });
    return applyMaps(mat, style, base.seed, 1.2);
  };
}

export const makeBone   = factory({ color: 0xcfc7ae, roughness: 0.8, metalness: 0.0, seed: 101 }, 'grain');
export const makeMetal  = factory({ color: 0x8a919c, roughness: 0.35, metalness: 0.85, seed: 202 }, 'stripes');
export const makeCloth  = factory({ color: 0x7a3f3f, roughness: 0.95, metalness: 0.0, seed: 303 }, 'grain');
export const makeLeather= factory({ color: 0x5e4028, roughness: 0.85, metalness: 0.05, seed: 404 }, 'grain');
export const makeHide   = factory({ color: 0x6b5638, roughness: 0.9, metalness: 0.0, seed: 505 }, 'grain');
export const makeStone  = factory({ color: 0x777066, roughness: 0.95, metalness: 0.0, seed: 606 }, 'pits');
export const makeWood   = factory({ color: 0x6a4a2c, roughness: 0.9, metalness: 0.0, seed: 707 }, 'stripes');

export function makeBasic(color, opts = {}) {
  const THREE = globalThis.__THREE__;
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

export function makeGlow(color, intensity = 1) {
  const THREE = globalThis.__THREE__;
  return new THREE.MeshBasicMaterial({ color });
}

export function makeSpriteGlow(color) {
  const THREE = globalThis.__THREE__;
  return new THREE.SpriteMaterial({ color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
}

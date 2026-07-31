import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Shared GLSL — simplex noise + fBm (spec §10)
// ---------------------------------------------------------------------------
export const GLSL_SNOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
}

float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
        value += amplitude * snoise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}
`;

// ---------------------------------------------------------------------------
// Soft round dot texture (avoids square PointsMaterial / hard particles)
// ---------------------------------------------------------------------------
let _softDotTexture = null;

export function softDotTexture() {
  if (_softDotTexture) return _softDotTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _softDotTexture = new THREE.CanvasTexture(canvas);
  _softDotTexture.needsUpdate = true;
  return _softDotTexture;
}

/** Soft dark blob texture for smoke trails / comets. */
let _smokeTexture = null;

export function smokeTexture() {
  if (_smokeTexture) return _smokeTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _smokeTexture = new THREE.CanvasTexture(canvas);
  _smokeTexture.needsUpdate = true;
  return _smokeTexture;
}

// ---------------------------------------------------------------------------
// Starfield shader — soft round dots, per-layer parallax handled in CPU
// ---------------------------------------------------------------------------
export const STAR_VERTEX = `
uniform float uPixelRatio;
uniform float uSizeScale;
attribute float aSize;
attribute vec3 aColor;
attribute float aTwinkle;
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vColor = aColor;
  vTwinkle = aTwinkle;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uSizeScale * uPixelRatio * (280.0 / max(1.0, -mvPosition.z));
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const STAR_FRAGMENT = `
uniform float uTime;
varying vec3 vColor;
varying float vTwinkle;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float alpha = smoothstep(0.5, 0.08, d);
  alpha *= 0.75 + 0.25 * sin(uTime * 2.0 + vTwinkle * 6.2831);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha);
}
`;

// ---------------------------------------------------------------------------
// Nebula billboard shader — fbm clouds, biome tint, uTime drift/pulse
// ---------------------------------------------------------------------------
export const NEBULA_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_FRAGMENT = `
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;
uniform float uScale;
uniform float uSeed;
varying vec2 vUv;
${GLSL_SNOISE}
void main() {
  vec3 p = vec3(vUv * uScale, uSeed);
  p.x += uTime * 0.02;
  float n = fbm(p);
  float alpha = smoothstep(0.25, 0.8, n) * uOpacity;
  alpha *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
  alpha *= smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  if (alpha < 0.01) discard;
  vec3 col = mix(uColorA, uColorB, clamp(n, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------
// Accretion disk shader — radial falloff + Doppler beaming
// ---------------------------------------------------------------------------
export const DISK_VERTEX = `
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const DISK_FRAGMENT = `
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vec2 p = vPos.xy;
  float r = length(p);
  float theta = atan(p.y, p.x);
  float radial = smoothstep(0.32, 1.0, r);
  // Doppler beaming: approaching side (rotating CCW) is brighter
  float doppler = 1.0 + 0.9 * sin(theta + uTime * uSpeed);
  vec3 inner = vec3(1.0, 0.97, 0.85);
  vec3 outer = vec3(1.0, 0.45, 0.08);
  vec3 col = mix(inner, outer, radial);
  col *= (0.35 + 0.65 * doppler) * radial;
  float alpha = radial * (0.55 + 0.45 * doppler);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

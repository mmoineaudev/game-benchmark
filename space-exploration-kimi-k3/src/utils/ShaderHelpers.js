// VOID DRIFT — ShaderHelpers.js
// Shared GLSL chunks. Compose: `${SIMPLEX_3D_GLSL}\n${BODY}`.

export const SIMPLEX_3D_GLSL = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
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
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float f = 0.0;
  f += 0.5 * snoise(p); p *= 2.02;
  f += 0.25 * snoise(p); p *= 2.03;
  f += 0.125 * snoise(p);
  return f;
}
`;

// Nebula billboard fragment body. Expects uniforms: uTime, uColor1, uColor2, uColor3, uOpacity.
export const NEBULA_FRAGMENT_BODY = /* glsl */`
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uOpacity;
void main(){
  vec2 centered = vUv - 0.5;
  float r = length(centered) * 2.0;
  float falloff = smoothstep(1.0, 0.15, r);
  vec3 p = vec3(vUv * 3.0, uTime * 0.05);
  float n = fbm(p);
  float n2 = fbm(p * 1.7 + vec3(4.7, 1.3, 2.9));
  vec3 color = mix(uColor1, uColor2, smoothstep(-0.4, 0.6, n));
  color = mix(color, uColor3, smoothstep(0.1, 0.9, n2) * 0.6);
  float alpha = falloff * (0.35 + 0.65 * smoothstep(-0.5, 0.8, n)) * uOpacity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

export const NEBULA_VERTEX = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Engine flame shader (cone, animated flicker along length).
export const ENGINE_FLAME_VERTEX = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const ENGINE_FLAME_FRAGMENT = /* glsl */`
varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
void main(){
  float t = vUv.y;
  float flicker = 0.85 + 0.15 * sin(uTime * 40.0 + vUv.x * 12.5663);
  float core = smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(0.55, 1.0, t));
  vec3 color = mix(uColor, vec3(1.0), pow(t, 3.0) * 0.6);
  float alpha = core * flicker * uIntensity;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

// Planet surface shader: procedural bands + fresnel rim.
export const PLANET_VERTEX = /* glsl */`
varying vec3 vNormal;
varying vec3 vPosition;
void main(){
  vNormal = normalize(normalMatrix * normal);
  vPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const PLANET_FRAGMENT = /* glsl */`
varying vec3 vNormal;
varying vec3 vPosition;
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uRim;
float band(vec3 p, float freq, float speed){
  return sin(p.y * freq + uTime * speed + sin(p.z * 1.3 + uTime * 0.2) * 1.4);
}
void main(){
  vec3 viewDir = normalize(-vPosition);
  vec3 nrm = normalize(vNormal);
  vec3 p = normalize(vPosition);
  float flow = band(p, 6.0, 0.25) + 0.4 * band(p, 14.0, 0.1);
  vec3 color = mix(uColor1, uColor2, smoothstep(-1.0, 1.0, flow));
  color = mix(color, uColor3, smoothstep(0.3, 1.0, band(p * 1.7, 9.0, -0.15)) * 0.5);
  float fresnel = pow(1.0 - max(dot(viewDir, nrm), 0.0), 2.6);
  color += uRim * fresnel * 0.45;
  float alpha = 0.75 + fresnel * 0.22;
  gl_FragColor = vec4(color, alpha);
}
`;

// Wormhole tunnel cylinder.
export const WORMHOLE_VERTEX = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
export const WORMHOLE_FRAGMENT = /* glsl */`
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
void main(){
  float swirl = fbm(vec3(vUv * vec2(6.0, 2.0), uTime * 0.3));
  float bands = sin(vUv.y * 40.0 - uTime * 3.0 + swirl * 6.0);
  vec3 color = mix(uColor1, uColor2, smoothstep(-0.8, 0.8, bands));
  float alpha = 0.22 + 0.18 * smoothstep(-0.5, 1.0, bands);
  gl_FragColor = vec4(color, alpha);
}
`;

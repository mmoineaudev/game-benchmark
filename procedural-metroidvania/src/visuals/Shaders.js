import * as THREE from 'three';

/**
 * Shaders.js — shared GLSL shaders for the metroidvania.
 *
 * Visual style: low-poly toon-shaded with neon rim glow, retro-GameCube aesthetic.
 */

// ═══════════════════════════════════════════════════════════════════════════
// TOON SHADER — diffuse bands + specular highlight + rim glow
// ═══════════════════════════════════════════════════════════════════════════
export const TOON_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}`;

export const TOON_FRAG = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
varying vec3 vViewDir;

uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uHitFlash;
uniform float uTime;
uniform float uAlpha;

void main() {
  vec3 lightDir = normalize(vec3(0.5, 0.8, 0.6));
  float NdotL = dot(vNormal, lightDir);

  // Toon bands (3-step)
  float band = smoothstep(-0.1, 0.3, NdotL);
  float band2 = smoothstep(0.3, 0.65, NdotL);
  float band3 = smoothstep(0.65, 1.0, NdotL);
  vec3 diffuse = uColor * 0.35;
  diffuse = mix(diffuse, uColor * 0.7, band);
  diffuse = mix(diffuse, uColor * 1.0, band2);
  diffuse = mix(diffuse, uColor * 1.2, band3);

  // Specular (blinn-phong style)
  vec3 halfVec = normalize(lightDir + normalize(vec3(0.0, 0.0, 1.0)));
  float spec = pow(max(dot(vNormal, halfVec), 0.0), 32.0);
  spec = step(0.6, spec) * 0.4;

  // Rim glow
  float rim = 1.0 - abs(dot(vNormal, vViewDir));
  rim = pow(rim, uRimPower);
  vec3 rimContrib = uRimColor * rim * 0.55;

  vec3 col = diffuse + rimContrib + spec;

  // Hit flash
  col = mix(col, vec3(1.0), uHitFlash * 0.75);

  // Subtle time-based pulse on rim
  float pulse = 1.0 + sin(uTime * 3.0) * 0.15;
  col += rimContrib * pulse * 0.1;

  gl_FragColor = vec4(col, uAlpha);
}`;

// ═══════════════════════════════════════════════════════════════════════════
// ENEMY RIM SHADER — base dark, bright rim (for drones)
// ═══════════════════════════════════════════════════════════════════════════
export const RIM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}`;

export const RIM_FRAG = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uHitFlash;
uniform float uTime;

void main() {
  float rim = 1.0 - abs(dot(vNormal, vViewDir));
  rim = pow(rim, uRimPower);
  vec3 col = mix(uColor * 0.12, uColor, rim * 0.65 + 0.35);
  col += uRimColor * rim * 0.55;
  col = mix(col, vec3(1.0), uHitFlash * 0.7);

  // Subtle pulse
  col += uRimColor * rim * sin(uTime * 4.0 + vWorldPos.y) * 0.08;

  gl_FragColor = vec4(col, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM SHADER — toon with edge glow line
// ═══════════════════════════════════════════════════════════════════════════
export const PLATFORM_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}`;

export const PLATFORM_FRAG = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;

uniform vec3 uColor;
uniform vec3 uEdgeColor;
uniform float uTime;

void main() {
  float rim = 1.0 - abs(dot(vNormal, vViewDir));
  rim = pow(rim, 2.5);

  vec3 col = uColor;
  // Subtle edge glow
  col = mix(col, uEdgeColor, rim * 0.4);
  // Subtle top-surface brightening
  float topFacing = dot(vNormal, vec3(0.0, 0.0, 1.0));
  col += uColor * max(topFacing * 0.12, 0.0);

  gl_FragColor = vec4(col, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════
// GLOW PULSE SHADER — for ability pickups and pickups
// ═══════════════════════════════════════════════════════════════════════════
export const GLOW_PULSE_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const GLOW_PULSE_FRAG = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;

void main() {
  float pulse = 0.6 + sin(uTime * 4.0) * 0.4;
  float glow = pulse * uIntensity;
  vec3 col = uColor * glow;
  // Fresnel-like falloff
  float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0)));
  col *= 1.0 + fresnel * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`;

// ═══════════════════════════════════════════════════════════════════════════
// Helper: create a ShaderMaterial from the toon shader
// ═══════════════════════════════════════════════════════════════════════════
export function createToonMaterial(color, rimColor, rimPower = 3.5, alpha = 1.0) {
  return new THREE.ShaderMaterial({
    vertexShader: TOON_VERT,
    fragmentShader: TOON_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uRimPower: { value: rimPower },
      uHitFlash: { value: 0 },
      uTime: { value: 0 },
      uAlpha: { value: alpha },
    },
    transparent: alpha < 1.0,
    depthWrite: alpha >= 0.95,
  });
}

export function createRimMaterial(color, rimColor, rimPower = 3.5) {
  return new THREE.ShaderMaterial({
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uRimPower: { value: rimPower },
      uHitFlash: { value: 0 },
      uTime: { value: 0 },
    },
  });
}

export function createPlatformMaterial(color, edgeColor) {
  return new THREE.ShaderMaterial({
    vertexShader: PLATFORM_VERT,
    fragmentShader: PLATFORM_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uEdgeColor: { value: new THREE.Color(edgeColor) },
      uTime: { value: 0 },
    },
  });
}

/**
 * Update time uniforms on all shader materials in a mesh tree.
 */
export function updateShaderTime(mesh, time) {
  mesh.traverse(c => {
    if (c.material && c.material.uniforms && c.material.uniforms.uTime) {
      c.material.uniforms.uTime.value = time;
    }
  });
}

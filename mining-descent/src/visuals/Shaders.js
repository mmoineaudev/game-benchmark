// =============================================================================
// Shaders — custom shader materials for enemy fresnel rim, ore glow.
// For MVP, ore glow is handled by additive InstancedMesh in TerrainRenderer.
// This module provides the fresnel rim shader for enemies.
// =============================================================================

import * as THREE from 'three';

export const Shaders = {
  /**
   * Fresnel rim shader material for enemies.
   * Edges glow with the provided rimColor.
   */
  createFresnelRimMaterial(baseColor, rimColor, rimPower = 2.0) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uBaseColor: { value: new THREE.Color(baseColor) },
        uRimColor: { value: new THREE.Color(rimColor) },
        uRimPower: { value: rimPower },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        uniform vec3 uBaseColor;
        uniform vec3 uRimColor;
        uniform float uRimPower;
        void main() {
          float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
          fresnel = pow(fresnel, uRimPower);
          vec3 color = mix(uBaseColor, uRimColor, fresnel);
          // Dim base but boost rim
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      lights: false,
    });
  },
};

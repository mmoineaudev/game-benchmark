// ============================================================
// Starfield — Multi-layer parallax particle starfield
// Enhanced with streaking at high speed, twinkling, and GPU-based parallax
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { STAR_VERTEX_SHADER, STAR_FRAGMENT_SHADER } from '../utils/ShaderHelpers.js';
import { mulberry32 } from '../utils/MathHelpers.js';

class Starfield {
  constructor(scene) {
    this.scene = scene;
    this.layers = [];
  }

  init() {
    // Create multiple layers with different sizes, colors, and parallax factors
    this._createLayer('far',   Constants.PARTICLE.STAR_FAR_COUNT,  0.3,  0.02, 0x8899cc, 0.05, 0.15);
    this._createLayer('mid',   Constants.PARTICLE.STAR_MID_COUNT,  0.8,  0.04, 0xaabbdd, 0.15, 0.35);
    this._createLayer('near',  Constants.PARTICLE.STAR_NEAR_COUNT, 1.8,  0.08, 0xccddff, 0.35, 0.8);
    this._createLayer('bright', Constants.PARTICLE.STAR_BRIGHT_COUNT, 3.0, 0.15, 0xffffff, 0.8, 1.2);

    return this.layers;
  }

  _createLayer(name, count, sizeBase, sizeSpread, colorHex, parallaxMin, parallaxMax) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const twinkleSpeeds = new Float32Array(count);
    const twinkleOffsets = new Float32Array(count);
    const parallaxFactors = new Float32Array(count);

    const seed = mulberry32(42 + name.charCodeAt(0) * 1000);
    const baseColor = new THREE.Color(colorHex);

    for (let i = 0; i < count; i++) {
      const theta = seed() * Math.PI * 2;
      const phi = Math.acos(2 * seed() - 1);
      const r = 200 + seed() * 400;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      sizes[i] = sizeBase + seed() * sizeSpread;

      const variation = 0.9 + seed() * 0.1;
      colors[i * 3] = baseColor.r * variation;
      colors[i * 3 + 1] = baseColor.g * variation;
      colors[i * 3 + 2] = baseColor.b * variation;

      twinkleSpeeds[i] = name === 'near' ? (1 + seed() * 4) : (0.3 + seed() * 1);
      twinkleOffsets[i] = seed() * Math.PI * 2;
      parallaxFactors[i] = parallaxMin + seed() * (parallaxMax - parallaxMin);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('twinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
    geometry.setAttribute('twinkleOffset', new THREE.BufferAttribute(twinkleOffsets, 1));
    geometry.setAttribute('parallaxFactor', new THREE.BufferAttribute(parallaxFactors, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uCameraOffset: { value: new THREE.Vector3(0, 0, 0) },
      },
      vertexShader: STAR_VERTEX_SHADER,
      fragmentShader: STAR_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.userData.layer = name;
    points.userData.parallaxFactor = parallaxMax; // For legacy compatibility

    this.scene.add(points);
    this.layers.push(points);

    return points;
  }

  /**
   * Update starfield based on ship movement for parallax effect
   * All parallax and streaking is done in the shader (GPU) — no CPU iteration needed.
   */
  update(shipPosition, speedRatio, dt) {
    for (const layer of this.layers) {
      // Update time uniform for twinkle
      layer.material.uniforms.uTime.value += dt;
      layer.material.uniforms.uSpeed.value = speedRatio;

      // Pass camera offset to shader for parallax
      layer.material.uniforms.uCameraOffset.value.copy(shipPosition);
    }
  }

  /**
   * Destroy starfield
   */
  destroy() {
    for (const layer of this.layers) {
      this.scene.remove(layer);
      layer.geometry.dispose();
      layer.material.dispose();
    }
    this.layers = [];
  }
}

export default Starfield;

// ============================================================
// Starfield — Multi-layer parallax particle starfield
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';
import { STAR_VERTEX_SHADER, STAR_FRAGMENT_SHADER } from '../utils/ShaderHelpers.js';
import { mulberry32, randomRange } from '../utils/MathHelpers.js';

class Starfield {
  constructor(scene) {
    this.scene = scene;
    this.layers = [];
    this._starPositions = null;
    this._starSizes = null;
    this._starColors = null;
    this._starTwinkleSpeeds = null;
    this._starTwinkleOffsets = null;
  }

  init() {
    // Create a single combined buffer for all stars (single draw call per layer)
    this._createLayer('far', Constants.PARTICLE.STAR_FAR_COUNT, 0.3, 0.02, 0x8899cc);
    this._createLayer('mid', Constants.PARTICLE.STAR_MID_COUNT, 0.8, 0.04, 0xaabbdd);
    this._createLayer('near', Constants.PARTICLE.STAR_NEAR_COUNT, 1.8, 0.08, 0xccddff);
    this._createLayer('bright', Constants.PARTICLE.STAR_BRIGHT_COUNT, 3.0, 0.15, 0xffffff);

    return this.layers;
  }

  _createLayer(name, count, sizeBase, sizeSpread, colorHex) {
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const twinkleSpeeds = new Float32Array(count);
    const twinkleOffsets = new Float32Array(count);

    // Seeded RNG for deterministic star positions
    const seed = mulberry32(42);
    const color = new THREE.Color(colorHex);

    // Create stars in a large sphere around origin
    for (let i = 0; i < count; i++) {
      // Random position in a large box
      const theta = seed() * Math.PI * 2;
      const phi = Math.acos(2 * seed() - 1);
      const r = 200 + seed() * 400;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      sizes[i] = sizeBase + seed() * sizeSpread;

      // Slight color variation
      const variation = 0.9 + seed() * 0.1;
      colors[i * 3] = color.r * variation;
      colors[i * 3 + 1] = color.g * variation;
      colors[i * 3 + 2] = color.b * variation;

      // Twinkle parameters (only relevant for near layer)
      twinkleSpeeds[i] = 1 + seed() * 3;
      twinkleOffsets[i] = seed() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('twinkleSpeed', new THREE.BufferAttribute(twinkleSpeeds, 1));
    geometry.setAttribute('twinkleOffset', new THREE.BufferAttribute(twinkleOffsets, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
      },
      vertexShader: STAR_VERTEX_SHADER,
      fragmentShader: STAR_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const points = new THREE.Points(geometry, material);
    points.userData.layer = name;
    points.userData.parallaxFactor = name === 'far' ? 0.1 : name === 'mid' ? 0.3 : name === 'near' ? 0.8 : 1.2;
    
    this.scene.add(points);
    this.layers.push(points);

    return points;
  }

  /**
   * Update starfield based on ship movement for parallax effect
   */
  update(shipPosition, speedRatio, dt) {
    for (const layer of this.layers) {
      // Update time uniform for twinkle
      layer.material.uniforms.uTime.value += dt;
      layer.material.uniforms.uSpeed.value = speedRatio;

      // Parallax offset based on camera movement
      const parallax = layer.userData.parallaxFactor;
      const offsetX = -shipPosition.x * parallax * 0.01;
      const offsetY = -shipPosition.y * parallax * 0.01;

      // Apply subtle offset to star positions for parallax
      const posAttr = layer.geometry.getAttribute('position');
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        // Only apply small parallax to keep stars in view
        posAttr.setXYZ(i,
          x + offsetX * 0.001,
          y + offsetY * 0.001,
          posAttr.getZ(i)
        );
      }
      posAttr.needsUpdate = true;
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

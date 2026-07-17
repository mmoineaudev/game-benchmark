// ============================================================
// PostProcessingSystem — UnrealBloomPass, chromatic aberration, vignette, film grain
// ============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import Constants from '../core/Constants.js';

// Chromatic Aberration shader
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uOffset: { value: 0.003 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uOffset;
    varying vec2 vUv;
    void main() {
      vec2 offset = (vUv - 0.5) * uOffset;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

// Vignette shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDarkness: { value: 0.5 },
    uOffset: { value: 0.2 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uDarkness;
    uniform float uOffset;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float dist = distance(vUv, vec2(0.5));
      float vignette = smoothstep(uOffset + 0.3, uOffset - 0.2, dist);
      color.rgb = mix(color.rgb * (1.0 - uDarkness), color.rgb, vignette);
      gl_FragColor = color;
    }
  `,
};

// Film Grain shader
const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.03 },
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uIntensity;
    uniform float uTime;
    varying vec2 vUv;
    
    float random(vec2 coord) {
      return fract(sin(dot(coord, vec2(12.9898, 78.233))) * 43758.5453);
    }
    
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float grain = random(vUv * uTime * 1000.0) * uIntensity;
      color.rgb += grain - uIntensity * 0.5;
      gl_FragColor = color;
    }
  `,
};

class PostProcessingSystem {
  constructor(renderer, camera, scene) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.composer = null;
    this.bloomPass = null;
    this.chromaticPass = null;
    this.vignettePass = null;
    this.filmGrainPass = null;
    this._lowEnd = this._detectLowEnd();
  }

  _detectLowEnd() {
    const cores = navigator.hardwareConcurrency || 4;
    return cores <= 4;
  }

  init() {
    this.composer = new EffectComposer(this.renderer);

    // 1. RenderPass
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // 2. UnrealBloomPass
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      Constants.POST_PROCESSING.BLOOM_STRENGTH,
      Constants.POST_PROCESSING.BLOOM_RADIUS,
      Constants.POST_PROCESSING.BLOOM_THRESHOLD
    );
    this.composer.addPass(this.bloomPass);

    // 3. Chromatic Aberration (skip on low-end)
    if (!this._lowEnd) {
      this.chromaticPass = new ShaderPass(ChromaticAberrationShader);
      this.chromaticPass.uniforms.uOffset.value = 0;
      this.composer.addPass(this.chromaticPass);
    }

    // 4. Vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms.uDarkness.value = Constants.POST_PROCESSING.VIGNETTE_DARKNESS;
    this.vignettePass.uniforms.uOffset.value = Constants.POST_PROCESSING.VIGNETTE_OFFSET;
    this.composer.addPass(this.vignettePass);

    // 5. Film Grain (skip on low-end)
    if (!this._lowEnd) {
      this.filmGrainPass = new ShaderPass(FilmGrainShader);
      this.filmGrainPass.uniforms.uIntensity.value = Constants.POST_PROCESSING.FILM_GRAIN_INTENSITY;
      this.composer.addPass(this.filmGrainPass);
    }

    // Output pass for proper tone mapping
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  /**
   * Update chromatic aberration based on speed ratio
   */
  updateChromaticAberration(speedRatio) {
    if (this.chromaticPass) {
      const maxOffset = 0.008;
      this.chromaticPass.uniforms.uOffset.value = speedRatio * maxOffset;
    }
  }

  /**
   * Update film grain time
   */
  updateFilmGrain(time) {
    if (this.filmGrainPass) {
      this.filmGrainPass.uniforms.uTime.value = time;
    }
  }

  /**
   * Render the scene through the post-processing pipeline
   */
  render() {
    this.composer.render();
  }

  /**
   * Handle window resize
   */
  resize(width, height) {
    this.composer.setSize(width, height);
  }
}

export default PostProcessingSystem;

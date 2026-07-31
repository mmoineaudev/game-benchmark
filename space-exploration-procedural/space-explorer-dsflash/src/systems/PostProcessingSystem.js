import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Constants } from '../core/Constants.js';

// Post-processing pipeline (spec §5.4):
// RenderPass → Bloom → ChromaticAberration → Vignette → FilmGrain → WormholeBlur.
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDarkness: { value: Constants.VIGNETTE.darkness },
    uOffset: { value: Constants.VIGNETTE.offset },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uDarkness; uniform float uOffset;
    varying vec2 vUv;
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      float vig = 1.0 - uDarkness * smoothstep(uOffset, 0.75, d);
      gl_FragColor = vec4(col.rgb * vig, col.a);
    }`,
};

const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: Constants.FILM_GRAIN.intensity },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uIntensity; uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float n = hash(vUv * 500.0 + uTime * 60.0) - 0.5;
      gl_FragColor = vec4(col.rgb + n * uIntensity, col.a);
    }`,
};

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uOffset: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uOffset;
    varying vec2 vUv;
    void main() {
      float o = uOffset;
      float r = texture2D(tDiffuse, vUv + vec2(o, 0.0)).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - vec2(o, 0.0)).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }`,
};

const WormholeBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uIntensity; uniform float uTime;
    varying vec2 vUv;
    void main() {
      float blur = uIntensity * 0.035;
      vec2 uv = vUv;
      vec4 sum = texture2D(tDiffuse, uv) * 2.0;
      sum += texture2D(tDiffuse, uv + vec2(blur, 0.0));
      sum += texture2D(tDiffuse, uv - vec2(blur, 0.0));
      sum += texture2D(tDiffuse, uv + vec2(0.0, blur));
      sum += texture2D(tDiffuse, uv - vec2(0.0, blur));
      sum += texture2D(tDiffuse, uv + vec2(blur * 0.7, blur * 0.7));
      sum += texture2D(tDiffuse, uv - vec2(blur * 0.7, blur * 0.7));
      vec4 col = sum / 8.0;
      // swirling distortion
      vec2 d = uv - 0.5;
      float swirl = uIntensity * 0.12;
      col.rgb += (texture2D(tDiffuse, uv + vec2(d.y * swirl, -d.x * swirl)).rgb - col.rgb) * 0.4;
      // chromatic fringe
      float fr = 0.025 * uIntensity;
      col.r = texture2D(tDiffuse, uv + vec2(fr, 0.0)).r;
      col.b = texture2D(tDiffuse, uv - vec2(fr, 0.0)).b;
      gl_FragColor = col;
    }`,
};

export class PostProcessingSystem {
  constructor(renderer, scene, camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      Constants.BLOOM.strength,
      Constants.BLOOM.radius,
      Constants.BLOOM.threshold,
    );
    this.composer.addPass(this.bloomPass);

    this.lowEnd = (navigator.hardwareConcurrency || 8) < 4;

    this.caPass = new ShaderPass(ChromaticAberrationShader);
    this.caPass.uniforms.uOffset.value = 0;
    this.stormCA = 0; // storm distortion (v2.0 §3.4.3)
    this.composer.addPass(this.caPass);
    this.vignettePass = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignettePass);

    this.grainPass = new ShaderPass(GrainShader);
    this.composer.addPass(this.grainPass);

    this.wormholePass = new ShaderPass(WormholeBlurShader);
    this.composer.addPass(this.wormholePass);

    if (this.lowEnd) {
      this.caPass.enabled = false;
      this.grainPass.enabled = false;
    }
  }

  /** Per-rung bloom threshold (v2.0 §5). */
  setBloomThreshold(t) {
    this.bloomPass.threshold = t;
  }

  /** Speed fraction 0..1 drives chromatic aberration (spec §5.9). */
  update(dt, speedFraction, wormholeBlurIntensity) {
    this.caPass.uniforms.uOffset.value = Constants.CHROMATIC_ABERRATION_MAX * speedFraction + this.stormCA;
    this.grainPass.uniforms.uTime.value += dt;
    this.wormholePass.uniforms.uTime.value += dt;
    this.wormholePass.uniforms.uIntensity.value = wormholeBlurIntensity;
    this.wormholePass.enabled = wormholeBlurIntensity > 0.01;
    this.composer.render();
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  dispose() {
    this.composer.dispose();
  }
}

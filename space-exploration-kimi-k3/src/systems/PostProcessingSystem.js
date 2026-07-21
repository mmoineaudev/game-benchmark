// VOID DRIFT — PostProcessingSystem.js
// Composer: Render → Bloom → [Chromatic | Grain] → Vignette → Output.
// Chromatic aberration + film grain skipped on low-end hardware.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as Constants from '../core/Constants.js';

const ChromaticAberrationShader = {
  uniforms: { tDiffuse: { value: null }, uOffset: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uOffset;
    varying vec2 vUv;
    void main(){
      vec2 dir = vUv - 0.5;
      float d = length(dir);
      vec2 off = normalize(dir + 1e-6) * uOffset * d;
      float r = texture2D(tDiffuse, vUv + off).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - off).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDarkness: { value: Constants.POST.VIGNETTE_DARKNESS },
    uOffset: { value: Constants.POST.VIGNETTE_OFFSET },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uDarkness;
    uniform float uOffset;
    varying vec2 vUv;
    void main(){
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float vig = 1.0 - uDarkness * smoothstep(uOffset, 1.6, length(uv));
      gl_FragColor = vec4(color.rgb * vig, color.a);
    }
  `,
};

const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uIntensity: { value: Constants.POST.GRAIN_INTENSITY },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uTime * 61.7) * 43758.5453); }
    void main(){
      vec4 color = texture2D(tDiffuse, vUv);
      float g = hash(vUv * vec2(1920.0, 1080.0));
      color.rgb += (g - 0.5) * uIntensity;
      gl_FragColor = color;
    }
  `,
};

export class PostProcessingSystem {
  constructor(renderer, camera, scene) {
    this._renderer = renderer;
    this._camera = camera;
    this._scene = scene;
    this.composer = null;
    this._isLowEnd = (navigator.hardwareConcurrency || 8) <= Constants.POST.LOW_END_CORES;
    this._chromaticPass = null;
    this._grainPass = null;
    this._bloomPass = null;
  }

  init() {
    const size = this._renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this._renderer);
    this.composer.addPass(new RenderPass(this._scene, this._camera));

    this._bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      Constants.POST.BLOOM_MIN, Constants.POST.BLOOM_RADIUS, Constants.POST.BLOOM_THRESHOLD);
    this.composer.addPass(this._bloomPass);

    if (!this._isLowEnd) {
      this._chromaticPass = new ShaderPass(ChromaticAberrationShader);
      this.composer.addPass(this._chromaticPass);
    }

    const vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(vignette);

    if (!this._isLowEnd) {
      this._grainPass = new ShaderPass(FilmGrainShader);
      this.composer.addPass(this._grainPass);
    }

    this.composer.addPass(new OutputPass());
  }

  updateSpeedEffects(speedRatio, time) {
    if (this._bloomPass) {
      this._bloomPass.strength = Constants.POST.BLOOM_MIN +
        (Constants.POST.BLOOM_MAX - Constants.POST.BLOOM_MIN) * speedRatio;
    }
    if (this._chromaticPass) {
      this._chromaticPass.uniforms.uOffset.value = speedRatio * Constants.POST.CHROMATIC_MAX_OFFSET;
    }
    if (this._grainPass) {
      this._grainPass.uniforms.uTime.value = time;
    }
  }

  setSize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
  }

  render() {
    if (this.composer) this.composer.render();
    else this._renderer.render(this._scene, this._camera);
  }

  dispose() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }
}

// PostProcessing.js — EffectComposer pipeline + enemy-glow layer pass (§12)
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import { RENDERER, ENEMY_GLOW } from '../core/Constants.js';

// EnemyGlowShader — final composite adding the enemy highlight.
// uSharp: half-res flat render; uBlur: blurred mask.
const EnemyGlowShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSharp: { value: null },
    uBlur: { value: null },
    uIntensity: { value: 0 },
    uPulse: { value: 1 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse, uSharp, uBlur;
    uniform float uIntensity, uPulse;
    varying vec2 vUv;
    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      vec3 sharp = texture2D(uSharp, vUv).rgb;
      vec3 blur = texture2D(uBlur, vUv).rgb;
      vec3 glow = (blur * ${ENEMY_GLOW.COMPOSITE_BLUR.toFixed(3)} * uPulse + sharp * ${ENEMY_GLOW.COMPOSITE_SHARP.toFixed(3)}) * uIntensity;
      gl_FragColor = scene + vec4(glow, 0.0);
    }`
};

const GLOW_MAT = new THREE.MeshBasicMaterial({ color: 0xff4422 });

export default class PostProcessing {
  constructor(renderer, scene, camera) {
    this.enabled = true;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.size = new THREE.Vector2();
    renderer.getSize(this.size);

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // the "5% rule": a barely-there bloom
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(this.size.x, this.size.y),
      RENDERER.BLOOM_STRENGTH, RENDERER.BLOOM_RADIUS, RENDERER.BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);

    this.saturation = new ShaderPass(HueSaturationShader);
    this.saturation.uniforms.saturation.value = RENDERER.SATURATION;
    this.composer.addPass(this.saturation);

    // enemy-glow targets: clone camera on layer 1, half-res RTs
    this.glowCamera = camera.clone();
    this.glowCamera.layers.set(1);
    this.glowCamera.layers.enable(0); // must see nothing else? No — layer 1 ONLY
    this.glowCamera.layers.set(1);

    const hw = Math.max(2, Math.floor(this.size.x / 2));
    const hh = Math.max(2, Math.floor(this.size.y / 2));
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtSharp = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    this.rtPing = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    this.rtPong = new THREE.WebGLRenderTarget(hw, hh, rtOpts);

    // 5-tap gaussian blur passes (horizontal then vertical ping-pong)
    this.blurH = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uDir: { value: [1 / hw, 0] }, uW: { value: [...ENEMY_GLOW.BLUR_WEIGHTS] } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec3 uW; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb * uW.x;
          c += texture2D(tDiffuse, vUv + uDir * 1.4).rgb * uW.y;
          c += texture2D(tDiffuse, vUv - uDir * 1.4).rgb * uW.y;
          c += texture2D(tDiffuse, vUv + uDir * 3.4).rgb * uW.z;
          c += texture2D(tDiffuse, vUv - uDir * 3.4).rgb * uW.z;
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    this.blurV = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uDir: { value: [0, 1 / hh] }, uW: { value: [...ENEMY_GLOW.BLUR_WEIGHTS] } },
      vertexShader: this.blurH.vertexShader,
      fragmentShader: this.blurH.fragmentShader
    });
    this.glowComposite = new ShaderPass(EnemyGlowShader);

    this.enemyTargets = [];
    this._overrideMat = GLOW_MAT;
  }

  setEnemyTargets(list) { this.enemyTargets = list || []; }

  setSize(w, h) {
    this.size.set(w, h);
    this.composer.setSize(w, h);
    const hw = Math.max(2, Math.floor(w / 2)), hh = Math.max(2, Math.floor(h / 2));
    this.rtSharp.setSize(hw, hh); this.rtPing.setSize(hw, hh); this.rtPong.setSize(hw, hh);
    this.blurH.uniforms.uDir.value = [1 / hw, 0];
    this.blurV.uniforms.uDir.value = [0, 1 / hh];
  }

  _renderEnemyMask(renderer) {
    // mark/unmark handled by callers via layers; here we render layer-1 view with override material
    const oldTarget = renderer.getRenderTarget();
    const oldOverride = this.scene.overrideMaterial;
    const oldBg = this.scene.background;
    const oldFog = this.scene.fog;
    this.scene.overrideMaterial = this._overrideMat;
    this.scene.background = null;
    this.scene.fog = null;
    this.glowCamera.position.copy(this.camera.position);
    this.glowCamera.quaternion.copy(this.camera.quaternion);
    this.glowCamera.projectionMatrix.copy(this.camera.projectionMatrix);
    this.glowCamera.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse);
    renderer.setRenderTarget(this.rtSharp);
    renderer.render(this.scene, this.glowCamera);
    this.scene.overrideMaterial = oldOverride;
    this.scene.background = oldBg;
    this.scene.fog = oldFog;

    // separable gaussian: sharp → H(ping) → V(pong)
    this.blurH.uniforms.tDiffuse.value = this.rtSharp.texture;
    this.blurH.renderToScreen = false;
    if (this.blurH.renderToScreen !== undefined) {}
    // manual pass rendering into RTs:
    this._renderPassTo(renderer, this.blurH, this.rtPing);
    this.blurV.uniforms.tDiffuse.value = this.rtPing.texture;
    this._renderPassTo(renderer, this.blurV, this.rtPong);
    renderer.setRenderTarget(oldTarget);
  }

  _renderPassTo(renderer, pass, target) {
    // Use the internal FullScreenQuad of ShaderPass
    if (pass.material === undefined && pass.fsQuad === undefined) return;
    pass.uniforms.tDiffuse.value = pass.uniforms.tDiffuse.value; // already set by caller
    const oldTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    if (pass.fsQuad) {
      pass.material.uniforms.tDiffuse = pass.material.uniforms.tDiffuse || { value: null };
      pass.fsQuad.render(renderer);
    }
    renderer.setRenderTarget(oldTarget);
  }

  render(time, nearestEnemyDist) {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const anyEnemies = this.enemyTargets.length > 0;
    let intensity = 0;
    if (anyEnemies && nearestEnemyDist != null) {
      // enemies glow when FAR (small), fade as they close
      const fade = Math.min(1, Math.max(0.15, (nearestEnemyDist - 1.2) / 4.5));
      intensity = Math.min(1, 1 * 0.05) * fade;
    }
    const pulse = 0.75 + 0.25 * Math.sin(time * 0.003);

    if (anyEnemies) {
      this._renderEnemyMask(this.renderer);
      this.glowComposite.uniforms.uSharp.value = this.rtSharp.texture;
      this.glowComposite.uniforms.uBlur.value = this.rtPong.texture;
      this.glowComposite.uniforms.uIntensity.value = intensity;
      this.glowComposite.uniforms.uPulse.value = pulse;
      if (!this.composer.passes.includes(this.glowComposite)) this.composer.addPass(this.glowComposite);
      this.glowComposite.renderToScreen = true;
      for (const p of this.composer.passes) if (p !== this.glowComposite) p.renderToScreen = false;
    } else {
      if (this.composer.passes.includes(this.glowComposite)) this.composer.removePass(this.glowComposite);
      const last = this.composer.passes[this.composer.passes.length - 1];
      for (const p of this.composer.passes) p.renderToScreen = false;
      if (last) last.renderToScreen = true;
    }
    // keep camera transforms in sync before composing
    this.renderPass.camera = this.camera;
    this.composer.render(time);
  }

  dispose() {
    this.rtSharp.dispose(); this.rtPing.dispose(); this.rtPong.dispose();
    this.composer.dispose?.();
  }
}

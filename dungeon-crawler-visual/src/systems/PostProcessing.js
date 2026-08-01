import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';

// Final composite: adds the enemy highlight glow on top of the graded scene.
// The glow is a soft blurred aura (uEnemyBlur) plus a dim sharp core
// (uEnemyTex), pulsing slowly so hostiles read clearly even in fog.
const EnemyGlowShader = {
  uniforms: {
    tDiffuse: { value: null },
    uEnemyTex: { value: null },
    uEnemyBlur: { value: null },
    uPulse: { value: 1 },
    uIntensity: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D uEnemyTex;
    uniform sampler2D uEnemyBlur;
    uniform float uPulse;
    uniform float uIntensity;
    varying vec2 vUv;
    void main() {
      vec4 scene = texture2D(tDiffuse, vUv);
      vec3 glow = texture2D(uEnemyBlur, vUv).rgb;
      vec3 core = texture2D(uEnemyTex, vUv).rgb;
      // uIntensity scales both the aura and the sharp silhouette so the
      // VISION buff reads as a clear wall-piercing x-ray, not a subtle glow.
      vec3 add = (glow * (1.6 * uPulse) + core * 0.5) * uIntensity;
      gl_FragColor = vec4(scene.rgb + add, 1.0);
    }
  `,
};

// Separable 5-tap gaussian (weights 0.227/0.194/0.121) — softens the enemy
// silhouette into a glow. Direction set per pass (horizontal, vertical).
const GaussianBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    direction: { value: new THREE.Vector2(1, 0) },
    uTexel: { value: new THREE.Vector2(0, 0) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 direction;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 texel = uTexel;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270270;
      sum += texture2D(tDiffuse, vUv + direction * texel * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv - direction * texel * 1.3846153846) * 0.3162162162;
      sum += texture2D(tDiffuse, vUv + direction * texel * 3.2307692308) * 0.0702702703;
      sum += texture2D(tDiffuse, vUv - direction * texel * 3.2307692308) * 0.0702702703;
      gl_FragColor = sum;
    }
  `,
};

export class PostProcessing {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = false; // post-processing OFF by default (lighter + clearer)
    this.composer = null;
    this._enemyGroups = [];
    this._enemyMeshes = new Set();
    this._enemyCam = null;
    this._enemyMat = null;
    this._enemyRT = null;
    this._enemyBlurRT = null;
    this._enemyBlurRT2 = null;
    this._blurQuad = null;
  }

  init() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const size = new THREE.Vector2(w, h);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom — restrained: no persistent ghosting, just a soft glow on light
    // sources. (Strength 1.9 + afterimage ghosting made it look like smoke.)
    this.bloomPass = new UnrealBloomPass(size, 1.1, 0.5, 0.5);
    this.composer.addPass(this.bloomPass);

    // Punchier colors (saturation 1.35x)
    this.saturationPass = new ShaderPass(HueSaturationShader);
    this.saturationPass.uniforms['saturation'].value = 0.35;
    this.composer.addPass(this.saturationPass);

    // Moderate dungeon vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value = 0.9;
    this.vignettePass.uniforms['darkness'].value = 0.7;
    this.composer.addPass(this.vignettePass);

    // Enemy highlight (final pass — added last so it pops on top)
    this.enemyGlowPass = new ShaderPass(EnemyGlowShader);
    this.composer.addPass(this.enemyGlowPass);

    // Enemy glow pipeline: enemy-only layer render -> gaussian blur -> composite
    this._enemyCam = this.camera.clone();
    this._enemyCam.layers.set(1);
    this._enemyMat = new THREE.MeshBasicMaterial({ color: 0xff5522 });
    // VISION buff: same glow but rendered through walls (no depth test)
    this._enemyXrayMat = new THREE.MeshBasicMaterial({
      color: 0xff7733, depthTest: false, depthWrite: false,
    });
    this.xray = false;
    this.enemyDist = 30; // nearest living enemy distance (for the highlight fade)
    const hw = Math.max(1, Math.floor(w / 2));
    const hh = Math.max(1, Math.floor(h / 2));
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this._enemyRT = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    this._enemyBlurRT = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    this._enemyBlurRT2 = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    this._blurQuad = new FullScreenQuad(new THREE.ShaderMaterial(GaussianBlurShader));
    this._blurQuad.material.uniforms.uTexel.value.set(2 / hw, 2 / hh);
    this.enemyGlowPass.uniforms.uEnemyTex.value = this._enemyRT.texture;
    this.enemyGlowPass.uniforms.uEnemyBlur.value = this._enemyBlurRT2.texture;

    this.composer.renderToScreen = true;
  }

  // Alive enemy groups to highlight. Marks their meshes on the enemy-only
  // camera layer (idempotent) and un-marks anything that left the set
  // (e.g. corpses), so only living mobs glow.
  setEnemyTargets(groups) {
    this._enemyGroups = groups;
    const current = new Set();
    for (const g of groups) {
      g.traverse((o) => {
        if (o.isMesh || o.isSprite) {
          o.layers.enable(1);
          current.add(o);
        }
      });
    }
    for (const m of this._enemyMeshes) {
      if (!current.has(m)) m.layers.disable(1);
    }
    this._enemyMeshes = current;
  }

  // Render the living enemies as a flat red-orange silhouette, blur it, and
  // let the composite pass add the glow on top of the scene.
  _renderEnemyGlow() {
    if (this._enemyMeshes.size === 0) return;
    const prevTarget = this.renderer.getRenderTarget();
    const prevOverride = this.scene.overrideMaterial;
    const prevBg = this.scene.background;
    // VISION buff renders enemies through walls (no depth test)
    this.scene.overrideMaterial = this.xray ? this._enemyXrayMat : this._enemyMat;
    this.scene.background = null;

    // Enemy-only camera: same transform as the main camera, layer 1 only
    this._enemyCam.matrixWorld.copy(this.camera.matrixWorld);
    this._enemyCam.matrixWorldInverse.copy(this.camera.matrixWorldInverse);
    this._enemyCam.projectionMatrix.copy(this.camera.projectionMatrix);
    this._enemyCam.layers.set(1);

    // 1) sharp silhouette
    this.renderer.setRenderTarget(this._enemyRT);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this._enemyCam);

    this.scene.overrideMaterial = prevOverride;
    this.scene.background = prevBg;
    this.renderer.setRenderTarget(prevTarget);

    // 2) separable gaussian: h then v (ping-pong into the two blur buffers)
    this._blurQuad.material.uniforms.direction.value.set(1, 0);
    this._blurQuad.material.uniforms.tDiffuse.value = this._enemyRT.texture;
    this.renderer.setRenderTarget(this._enemyBlurRT);
    this._blurQuad.render(this.renderer);

    this._blurQuad.material.uniforms.direction.value.set(0, 1);
    this._blurQuad.material.uniforms.tDiffuse.value = this._enemyBlurRT.texture;
    this.renderer.setRenderTarget(this._enemyBlurRT2);
    this._blurQuad.render(this.renderer);

    this.renderer.setRenderTarget(prevTarget);
  }

  // Nearest living enemy, refreshed each frame. Drives the highlight fade:
  // enemies are only highlighted when FAR (small / hard to see); once they
  // close in they stop glowing (and stop blinding the player).
  setEnemyDist(d) { this.enemyDist = d; }

  render() {
    // Compose normally when post is enabled. ALSO force the composer when the
    // VISION buff (xray) is active — its enemy-glow pass is the only thing that
    // visualizes "see enemies through walls", so it must render even when
    // post-processing is otherwise off (the game starts with post disabled).
    if ((this.enabled || this.xray) && this.composer) {
      this._renderEnemyGlow();
      // Slow pulse (~2s period) so the highlight reads as alive, not static
      this.enemyGlowPass.uniforms.uPulse.value = 0.75 + 0.25 * Math.sin(performance.now() * 0.003);
      // Distance fade: glow strongly when far, fade out as enemies approach
      const d = this.enemyDist || 30;
      const far = THREE.MathUtils.clamp((d - 1.2) / 4.5, 0.15, 1.0);
      const intensity = (this.xray ? 1.5 : 1.0) * far + (this.xray ? 0.7 : 0.1);
      this.enemyGlowPass.uniforms.uIntensity.value = intensity;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  resize(w, h) {
    if (this.composer) {
      this.composer.setSize(w, h);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(w, h);
    }
    if (this._enemyRT) {
      const hw = Math.max(1, Math.floor(w / 2));
      const hh = Math.max(1, Math.floor(h / 2));
      this._enemyRT.setSize(hw, hh);
      this._enemyBlurRT.setSize(hw, hh);
      this._enemyBlurRT2.setSize(hw, hh);
      if (this._blurQuad) this._blurQuad.material.uniforms.uTexel.value.set(2 / hw, 2 / hh);
    }
  }

  dispose() {
    if (this.composer) {
      this.composer.passes.forEach((p) => {
        if (p.dispose) p.dispose();
      });
      this.composer = null;
    }
    if (this._enemyRT) {
      this._enemyRT.dispose();
      this._enemyBlurRT.dispose();
      this._enemyBlurRT2.dispose();
      this._enemyRT = null;
      this._enemyBlurRT = null;
      this._enemyBlurRT2 = null;
    }
    if (this._blurQuad) {
      this._blurQuad.dispose();
      this._blurQuad = null;
    }
    if (this._enemyMat) {
      this._enemyMat.dispose();
      this._enemyMat = null;
    }
    if (this._enemyXrayMat) {
      this._enemyXrayMat.dispose();
      this._enemyXrayMat = null;
    }
    this._enemyMeshes = new Set();
    this._enemyGroups = [];
  }
}

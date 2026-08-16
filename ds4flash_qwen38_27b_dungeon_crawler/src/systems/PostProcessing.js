/**
 * PostProcessing.js — EffectComposer pipeline (§12.2, binding order):
 *
 *   1. RenderPass
 *   2. UnrealBloomPass(resolution, 0.055, 0.5, 0.5)   — the "5%" rule
 *   3. ShaderPass(HueSaturationShader)  saturation = 0.0175
 *   4. ShaderPass(EnemyGlowShader)      — final enemy-highlight composite
 *
 * Enemy highlight pipeline (§12.2):
 *   - clone camera with layers.set(1); enemy meshes opt in via
 *     setEnemyTargets(arr) (idempotent, unmark when dead)
 *   - each frame: scene rendered with a flat red-orange overrideMaterial
 *     to a HALF-RES render target → separable 5-tap gaussian blur
 *     (weights 0.227/0.194/0.121, horizontal then vertical ping-pong) →
 *     the composite pass adds
 *       (blur × 1.6 × uPulse + sharp × 0.5) × uIntensity
 *     to the scene
 *   - uPulse = 0.75 + 0.25·sin(now·0.003)
 *   - uIntensity = min(1, base × 0.05) with distance fade
 *     far = clamp((d − 1.2) / 4.5, 0.15, 1) — enemies glow when FAR and
 *     fade as they close
 *
 * render(now): composer when enabled, else direct renderer.render.
 * toggle() via P; default ON.
 *
 * Headless shim (§27): no document/window access at module top level. If
 * EffectComposer / WebGL rendering is unavailable (headless Node), the
 * constructor degrades to a safe no-op (this.available = false) and
 * render() falls back to a plain renderer.render when possible.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HueSaturationShader } from 'three/examples/jsm/shaders/HueSaturationShader.js';
import { RENDERER } from '../core/Constants.js';

/** Camera layer for the enemy-glow pass (§12.1: layer 1). */
const ENEMY_GLOW_LAYER = 1;

// 5-tap separable gaussian weights (center, ±1, ±2)
const BLUR_WEIGHTS = [0.227, 0.194, 0.121];

const BLUR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uDirection; // 0 = horizontal, 1 = vertical
varying vec2 vUv;
void main() {
  vec2 dir = (uDirection < 0.5) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 sum = texture2D(tDiffuse, vUv) * 0.227;
  vec2 s1 = dir / 1024.0;
  vec2 s2 = dir * 2.0 / 1024.0;
  sum += texture2D(tDiffuse, vUv - s1) * 0.194;
  sum += texture2D(tDiffuse, vUv + s1) * 0.194;
  sum += texture2D(tDiffuse, vUv - s2) * 0.121;
  sum += texture2D(tDiffuse, vUv + s2) * 0.121;
  gl_FragColor = sum;
}`;

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;   // scene (post-bloom/saturation)
uniform sampler2D tEnemyBlur; // blurred half-res enemy pass
uniform sampler2D tEnemySharp;// sharp half-res enemy pass
uniform float uPulse;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec4 scene = texture2D(tDiffuse, vUv);
  vec4 blur = texture2D(tEnemyBlur, vUv);
  vec4 sharp = texture2D(tEnemySharp, vUv);
  vec3 add = (blur.rgb * 1.6 * uPulse + sharp.rgb * 0.5) * uIntensity;
  gl_FragColor = vec4(scene.rgb + add, scene.a);
}`;

export class PostProcessing {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    /** @type {boolean} P toggles this; default ON (§12.2). */
    this.enabled = true;
    this.available = false;
    this.composer = null;
    this.enemyTargets = new Set(); // enemy meshes marked onto layer 1

    this._sharpRT = null;
    this._blurA = null;
    this._blurB = null;
    this._glowCam = null;
    this._overrideMat = null;
    this._compositePass = null;
    this._hsvPass = null;
    this._blurH = null;
    this._blurV = null;
    this._prevOverride = null;
    this._prevLay = null;
    this._prevSize = new THREE.Vector2();

    try {
      this._init(renderer, scene, camera);
    } catch (e) {
      // Headless / no WebGL: degrade to a no-op (safe fallback per §27).
      this.available = false;
      this.composer = null;
    }
  }

  _init(renderer, scene, camera) {
    if (!renderer || !scene || !camera) throw new Error('PostProcessing: missing args');

    const size = new THREE.Vector2();
    renderer.getSize(size);
    const half = new THREE.Vector2(size.x / 2, size.y / 2);

    // --- composer (§12.2 order) -------------------------------------------
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      RENDERER.POST_BLOOM_STRENGTH,   // 0.055
      RENDERER.POST_BLOOM_RADIUS,     // 0.5
      RENDERER.POST_BLOOM_THRESHOLD,  // 0.5
    );
    composer.addPass(bloom);

    const hsv = new ShaderPass(HueSaturationShader);
    hsv.uniforms['saturation'].value = RENDERER.POST_SATURATION; // 0.0175
    this._hsvPass = hsv;
    composer.addPass(hsv);

    // --- enemy glow buffers (half-res) ------------------------------------
    const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this._sharpRT = new THREE.WebGLRenderTarget(half.x, half.y, rtOpts);
    this._blurA = new THREE.WebGLRenderTarget(half.x, half.y, rtOpts);
    this._blurB = new THREE.WebGLRenderTarget(half.x, half.y, rtOpts);

    this._glowCam = camera.clone();
    this._glowCam.layers.set(ENEMY_GLOW_LAYER);
    this._overrideMat = new THREE.MeshBasicMaterial({ color: 0xff4411 }); // flat red-orange

    // 5-tap separable gaussian (0.227/0.194/0.121), horizontal + vertical
    this._blurH = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uDirection: { value: 0 } },
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
    });
    this._blurV = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uDirection: { value: 1 } },
      vertexShader: BLUR_VERT,
      fragmentShader: BLUR_FRAG,
    });

    // --- final composite pass (adds glow on top of the scene) --------------
    const composite = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        tEnemyBlur: { value: this._blurB.texture },
        tEnemySharp: { value: this._sharpRT.texture },
        uPulse: { value: RENDERER.ENEMY_GLOW_PULSE },
        uIntensity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: COMPOSITE_FRAG,
    });
    this._compositePass = composite;
    composer.addPass(composite);

    this.composer = composer;
    this.available = true;
    this._prevSize.copy(size);
  }

  /**
   * Mark enemy meshes onto layer 1 (idempotent). Pass a dead enemy's mesh
   * (or `null`) to unmark.
   * @param {Array<THREE.Object3D|null>} enemies
   */
  setEnemyTargets(enemies) {
    const list = enemies || [];
    const next = new Set();
    for (const e of list) {
      if (!e) continue;
      e.traverse((o) => o.layers.enable(ENEMY_GLOW_LAYER));
      e.layers.enable(ENEMY_GLOW_LAYER);
      next.add(e);
    }
    // unmark anything previously marked that is no longer in the list (dead)
    for (const old of this.enemyTargets) {
      if (!next.has(old)) {
        old.traverse((o) => o.layers.disable(ENEMY_GLOW_LAYER));
        old.layers.disable(ENEMY_GLOW_LAYER);
      }
    }
    this.enemyTargets = next;
    return this;
  }

  /** P key: toggle post-processing (default ON, §12.2). */
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /**
   * Render one frame. Composer when enabled + available, else a direct
   * renderer.render.
   * @param {number} now — milliseconds (performance.now-style)
   */
  render(now = 0) {
    if (!this.available || !this.composer) {
      if (this.renderer && this.renderer.render) {
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this._resize();
    this._renderEnemyGlow();

    // uPulse = 0.75 + 0.25·sin(now·0.003)
    this._compositePass.uniforms.uPulse.value =
      RENDERER.ENEMY_GLOW_PULSE +
      (1 - RENDERER.ENEMY_GLOW_PULSE) * Math.sin(now * RENDERER.ENEMY_GLOW_PULSE_SPEED);
    // uIntensity = min(1, base × 0.05); base is the per-enemy distance fade,
    // evaluated for the nearest marked enemy (1 when none are marked... use
    // full base far-fade so a populated level glows at the 0.05 scale).
    const d = this._nearestEnemyDistance();
    const base = d === Infinity
      ? RENDERER.ENEMY_GLOW_FAR_FADE_START
      : clamp((d - RENDERER.ENEMY_GLOW_FAR_FADE_START) / (RENDERER.ENEMY_GLOW_FAR_FADE_END - RENDERER.ENEMY_GLOW_FAR_FADE_START),
              RENDERER.ENEMY_GLOW_MIN_FADE, 1);
    this._compositePass.uniforms.uIntensity.value =
      Math.min(1, base * RENDERER.ENEMY_GLOW_INTENSITY_SCALE);

    this.composer.render();
  }

  /**
   * Enemy pass: render layer-1 scene with overrideMaterial to the half-res
   * sharp RT, then 5-tap gaussian H → V ping-pong into the blur RTs.
   */
  _renderEnemyGlow() {
    const renderer = this.renderer;
    const scene = this.scene;
    if (this.enemyTargets.size === 0) {
      // nothing marked → clear the sharp buffer so the composite adds nothing
      renderer.setRenderTarget(this._sharpRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.setRenderTarget(this._blurA);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.setRenderTarget(this._blurB);
      renderer.clear();
      renderer.setRenderTarget(null);
      return;
    }

    // 1) sharp half-res pass
    renderer.setRenderTarget(this._sharpRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this._applyOverride();
    renderer.render(scene, this._glowCam);
    this._restoreOverride();

    // 2) horizontal blur: sharp → A
    this._blurH.uniforms.tDiffuse.value = this._sharpRT.texture;
    renderer.setRenderTarget(this._blurA);
    this._blurH.render(renderer);

    // 3) vertical blur: A → B
    this._blurV.uniforms.tDiffuse.value = this._blurA.texture;
    renderer.setRenderTarget(this._blurB);
    this._blurV.render(renderer);

    renderer.setRenderTarget(null);
  }

  _applyOverride() {
    this._prevOverride = this.scene.overrideMaterial;
    this.scene.overrideMaterial = this._overrideMat;
  }

  _restoreOverride() {
    if (this._prevOverride !== null || this.scene.overrideMaterial === this._overrideMat) {
      this.scene.overrideMaterial = this._prevOverride || null;
      this._prevOverride = null;
    }
  }

  _resize() {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    if (size.x === this._prevSize.x && size.y === this._prevSize.y) return;
    this._prevSize.copy(size);
    this.composer.setSize(size.x, size.y);
    const half = { x: Math.max(1, size.x >> 1), y: Math.max(1, size.y >> 1) };
    this._sharpRT.setSize(half.x, half.y);
    this._blurA.setSize(half.x, half.y);
    this._blurB.setSize(half.x, half.y);
  }

  /** Nearest marked enemy distance to the camera (Infinity when none). */
  _nearestEnemyDistance() {
    const cp = this.camera.position;
    let best = Infinity;
    for (const e of this.enemyTargets) {
      const p = e.position;
      const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < best) best = d;
    }
    return best;
  }

  /** Dispose composer render targets + glow buffers (§14). */
  dispose() {
    if (this._overrideMat) { this._overrideMat.dispose(); this._overrideMat = null; }
    if (this._sharpRT) { this._sharpRT.dispose(); this._sharpRT = null; }
    if (this._blurA) { this._blurA.dispose(); this._blurA = null; }
    if (this._blurB) { this._blurB.dispose(); this._blurB = null; }
    if (this.composer) {
      for (const pass of this.composer.passes) {
        if (pass.material && pass.material.dispose) pass.material.dispose();
      }
      this.composer.dispose();
      this.composer = null;
    }
    this.enemyTargets.clear();
    this._glowCam = null;
    this._hsvPass = null;
    this._compositePass = null;
    this.available = false;
    this.enabled = false;
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

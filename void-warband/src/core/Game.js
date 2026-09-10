/**
 * Game.js — orchestrator singleton (SPEC §9).
 * Owns: THREE.Scene, PerspectiveCamera, WebGLRenderer (appended to #app,
 * which it creates if missing), the systems array, and the RAF loop +
 * state machine (HANGAR → FLIGHT → DEATH).
 *
 * P0 scope: FLIGHT is the live phase; HANGAR/DEATH are stubs that render.
 * ESC toggles pause; KeyR restarts on death; delta capped at PERF.deltaCap.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CAMERA, PERF } from './Constants.js';
import { GameState, GamePhase } from './GameState.js';
import { EventBus, EVENTS } from './EventBus.js';
import { InputSystem } from '../systems/InputSystem.js';
import { PerfProbe } from '../utils/PerfProbe.js';

/**
 * A system is any module with `update(dt, game)`; called once per frame in
 * array order.
 */
class _Game {
  constructor() {
    // -- Scene graph ---------------------------------------------------------
    /** @type {THREE.Scene} */
    this.scene = new THREE.Scene();

    // -- Lighting --------------------------------------------------------------
    // MeshStandardMaterial is used everywhere; without lights every hull
    // renders black (only emissive parts were visible). Key + fill + ambient
    // gives readable form; the directional acts as the "sun" for the sector.
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.8));
    const _key = new THREE.DirectionalLight(0xffffff, 1.6);
    _key.position.set(0.5, 0.8, 0.6);
    this.scene.add(_key);
    /** Key light exposed for BiomeVisuals (per-sector tint). */
    this.keyLight = _key;
    const _fill = new THREE.DirectionalLight(0x6d7cff, 0.65);
    _fill.position.set(-0.6, -0.3, -0.7);
    this.scene.add(_fill);

    /** @type {THREE.PerspectiveCamera} (constants from CAMERA). */
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fovMin,
      window.innerWidth / window.innerHeight,
      0.1,
      10000,
    );
    this.camera.position.set(0, CAMERA.offsetY, CAMERA.offsetZ);
    this.camera.lookAt(0, 0, 0);

    // -- Renderer -----------------------------------------------------------
    // Antialias ON (user feedback: jaggies on ship edges); DPR still capped.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF.dprCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // -- Bloom postprocessing (user feedback: shaders on light sources) -------
    // Every emissive surface (engines, reactor rings, the sun corona, laser
    // bolts, worm maws, glow clouds, loot sprites) blooms with a real halo.
    this._composer = new EffectComposer(this.renderer);
    this._composer.addPass(new RenderPass(this.scene, this.camera));
    this._bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,  // strength — halo intensity
      0.4,  // radius — halo falloff spread
      0.75, // threshold — only brighter-than-this pixels bloom
    );
    this._composer.addPass(this._bloom);
    this._composer.addPass(new OutputPass()); // tone-map + color-space at the end
    this._mount();

    // -- State --------------------------------------------------------------
    /** @type {object} */
    this.state = GameState;
    /** @type {boolean} */
    this.paused = false;

    /**
     * @type {Array<{update: Function}>} per-frame systems, in order.
     */
    this.systems = [InputSystem, PerfProbe];

    // -- Loop ----------------------------------------------------------------
    this._running = false;
    this._lastTime = 0;

    // -- Listeners ----------------------------------------------------------
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onResize = this._onResize.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('resize', this._onResize);
  }

  /**
   * Append renderer canvas to #app, creating the div if missing.
   */
  _mount() {
    let mount = document.getElementById('app');
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'app';
      document.body.appendChild(mount);
    }
    mount.appendChild(this.renderer.domElement);
  }

  /**
   * Begin the RAF loop (idempotent).
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    requestAnimationFrame(this._loop.bind(this));
  }

  /** Stop the RAF loop. */
  stop() {
    this._running = false;
  }

  /**
   * Start a run (from the hangar LAUNCH or a fresh boot): clean run state,
   * FLIGHT. Works from HANGAR or DEATH (SPEC §9 state machine).
   */
  restart() {
    if (this.state.phase === GamePhase.FLIGHT) return;
    this.state.reset();
    this.state.phase = GamePhase.FLIGHT;
    this.state.run.alive = true;
    InputSystem.reset();
    EventBus.emit(EVENTS.RESTART);
    EventBus.emit(EVENTS.RUN_START);
  }

  // -- Per-frame -------------------------------------------------------------

  /**
   * One frame: capped delta, update systems (skipped when paused), render.
   * HANGAR/DEATH phases render-only for now (P0 stubs).
   * @param {number} now performance.now() ms.
   */
  _loop(now) {
    if (!this._running) return;
    requestAnimationFrame(this._loop.bind(this));

    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    dt = Math.min(Math.max(dt, 0), PERF.deltaCap);

    if (!this.paused) {
      for (const system of this.systems) {
        system.update(dt, this);
      }
    }

    // Pause menu visibility follows the flag (P or Escape, any phase) —
    // but NOT while the station trade menu is open (it owns the screen).
    if (this._hud) this._hud.setPaused(this.paused && !this._tradeOpen?.());

    // Render through the bloom composer (light-source halo shader chain).
    this._composer.render();
  }

  // -- Handlers --------------------------------------------------------------

  /**
   * Keydown: ESC/P/F1 toggle pause (F1 = help/controls menu); KeyR restarts
   * (death only, SPEC §2).
   * @param {KeyboardEvent} e
   */
  _onKeyDown(e) {
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'F1') {
      this.paused = !this.paused;
    } else if (e.code === 'KeyR' && this.state.phase === GamePhase.DEATH) {
      this.restart();
    }
  }

  /** Window resize: keep camera aspect + renderer size in sync. */
  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PERF.dprCap));
    this.renderer.setSize(w, h);
    this._composer.setSize(w, h);
  }
}

/** Singleton game orchestrator. */
export const Game = new _Game();

export default Game;

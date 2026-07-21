// VOID DRIFT — AudioSystem.js
// Fully procedural Web Audio: engine drone, laser, explosion, collision,
// warning beeps, pickup chime, biome ambience. Lazy init on first gesture.

import * as Constants from '../core/Constants.js';
import { GameState } from '../core/GameState.js';
import { EventBus } from '../core/EventBus.js';

export class AudioSystem {
  constructor() {
    this._ctx = null;
    this._master = null;
    this._engineOsc = null;
    this._engineFilter = null;
    this._engineGain = null;
    this._ambienceOsc = null;
    this._ambienceFilter = null;
    this._ambienceGain = null;
    this._muted = GameState.muted;
    this._lastWarning = 0;
    this._currentBiome = '';
    this._unsub = [];
  }

  init() {
    const tryInit = () => {
      if (this._ctx) return;
      this._createContext();
      EventBus.emit('audio:ready');
    };
    const onGesture = () => tryInit();
    window.addEventListener('pointerdown', onGesture, { once: false });
    window.addEventListener('keydown', onGesture, { once: false });
    this._domCleanup = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };

    this._unsub.push(EventBus.on('audio:mute', (muted) => this._applyMute(muted)));
  }

  _createContext() {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    const ctx = this._ctx;

    this._master = ctx.createGain();
    this._master.gain.value = this._muted ? 0 : Constants.AUDIO.MASTER_GAIN;
    this._master.connect(ctx.destination);

    // Engine drone: sawtooth → bandpass → gain.
    this._engineOsc = ctx.createOscillator();
    this._engineOsc.type = 'sawtooth';
    this._engineOsc.frequency.value = Constants.AUDIO.ENGINE_FREQ_MIN;
    this._engineFilter = ctx.createBiquadFilter();
    this._engineFilter.type = 'bandpass';
    this._engineFilter.frequency.value = 320;
    this._engineFilter.Q.value = 0.8;
    this._engineGain = ctx.createGain();
    this._engineGain.gain.value = Constants.AUDIO.ENGINE_GAIN_MIN;
    this._engineOsc.connect(this._engineFilter).connect(this._engineGain).connect(this._master);
    this._engineOsc.start();

    // Biome ambience: low sine drone.
    this._ambienceOsc = ctx.createOscillator();
    this._ambienceOsc.type = 'sine';
    this._ambienceOsc.frequency.value = 48;
    this._ambienceFilter = ctx.createBiquadFilter();
    this._ambienceFilter.type = 'lowpass';
    this._ambienceFilter.frequency.value = 220;
    this._ambienceGain = ctx.createGain();
    this._ambienceGain.gain.value = 0.0;
    this._ambienceOsc.connect(this._ambienceFilter).connect(this._ambienceGain).connect(this._master);
    this._ambienceOsc.start();
  }

  resume() {
    if (this._ctx && this._ctx.state === 'suspended') this._ctx.resume();
  }

  /** Called every frame with current speed ratio. */
  updateEngine(speedRatio, thrusting) {
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    const freq = Constants.AUDIO.ENGINE_FREQ_MIN +
      (Constants.AUDIO.ENGINE_FREQ_MAX - Constants.AUDIO.ENGINE_FREQ_MIN) * speedRatio;
    const gain = Constants.AUDIO.ENGINE_GAIN_MIN +
      (Constants.AUDIO.ENGINE_GAIN_MAX - Constants.AUDIO.ENGINE_GAIN_MIN) *
      Math.min(speedRatio + (thrusting ? 0.25 : 0), 1);
    this._engineOsc.frequency.setTargetAtTime(freq, now, 0.1);
    this._engineGain.gain.setTargetAtTime(this._muted ? 0 : gain, now, 0.1);
  }

  /** Crossfade ambience on biome change. */
  setBiome(biomeName) {
    if (!this._ctx || biomeName === this._currentBiome) return;
    this._currentBiome = biomeName;
    const now = this._ctx.currentTime;
    const table = {
      'Open Space':      { freq: 42,  gain: 0.020 },
      'Asteroid Belt':   { freq: 55,  gain: 0.045 },
      'Nebula Corridor': { freq: 66,  gain: 0.040 },
      'Wormhole Tunnel': { freq: 88,  gain: 0.055 },
    };
    const cfg = table[biomeName] || { freq: 42, gain: 0.02 };
    this._ambienceOsc.frequency.setTargetAtTime(cfg.freq, now, 1.2);
    this._ambienceGain.gain.setTargetAtTime(this._muted ? 0 : cfg.gain, now, 1.2);
  }

  playLaser() {
    if (!this._ctx || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(Constants.AUDIO.LASER_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(Constants.AUDIO.LASER_FREQ_END, now + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(g).connect(this._master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  playExplosion(size = 1) {
    if (!this._ctx || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const dur = Constants.AUDIO.EXPLOSION_DURATION;
    const buffer = this._noiseBuffer(dur);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800 * Math.max(size, 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter).connect(g).connect(this._master);
    src.start(now);
  }

  playCollision() {
    if (!this._ctx || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const dur = Constants.AUDIO.COLLISION_DURATION;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter).connect(g).connect(this._master);
    src.start(now);
  }

  playWarning() {
    if (!this._ctx || this._muted) return;
    const now = performance.now() / 1000;
    if (now - this._lastWarning < Constants.AUDIO.WARNING_COOLDOWN) return;
    this._lastWarning = now;
    const ctx = this._ctx;
    const t0 = ctx.currentTime;
    for (let i = 0; i < Constants.AUDIO.WARNING_BEEPS; i++) {
      const t = t0 + i * (Constants.AUDIO.WARNING_BEEP_DURATION + Constants.AUDIO.WARNING_BEEP_GAP);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = Constants.AUDIO.WARNING_FREQ;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + Constants.AUDIO.WARNING_BEEP_DURATION);
      osc.connect(g).connect(this._master);
      osc.start(t);
      osc.stop(t + Constants.AUDIO.WARNING_BEEP_DURATION + 0.05);
    }
  }

  playPickup() {
    if (!this._ctx || this._muted) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      const t = now + i * 0.07;
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g).connect(this._master);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  toggleMute() {
    this._muted = !this._muted;
    GameState.muted = this._muted;
    GameState.saveMuted();
    this._applyMute(this._muted);
    return this._muted;
  }

  _applyMute(muted) {
    this._muted = muted;
    if (!this._ctx) return;
    const now = this._ctx.currentTime;
    this._master.gain.setTargetAtTime(muted ? 0 : Constants.AUDIO.MASTER_GAIN, now, 0.02);
    if (muted) {
      this._engineGain.gain.setTargetAtTime(0, now, 0.02);
      this._ambienceGain.gain.setTargetAtTime(0, now, 0.02);
    }
  }

  _noiseBuffer(duration) {
    const ctx = this._ctx;
    if (!this._cachedNoise || this._cachedNoise.duration < duration) {
      const len = Math.ceil(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._cachedNoise = buffer;
    }
    return this._cachedNoise;
  }

  destroy() {
    if (this._domCleanup) this._domCleanup();
    for (const u of this._unsub) u();
    this._unsub = [];
    if (this._ctx) {
      try { this._ctx.close(); } catch { /* already closed */ }
      this._ctx = null;
    }
  }
}

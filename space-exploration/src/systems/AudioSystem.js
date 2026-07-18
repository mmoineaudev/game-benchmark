// ============================================================
// AudioSystem — Web Audio API wrapper, handles autoplay policy
// ============================================================
import * as THREE from 'three';
import Constants from '../core/Constants.js';

class AudioSystem {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._engineOsc = null;
    this._engineFilter = null;
    this._engineGain = null;
    this._isInitialized = false;
    this._isMuted = false;
  }

  init() {
    // AudioContext must be created in response to a user gesture.
    // We register handlers but don't create the context until one fires.
    const initOnce = () => {
      if (this._isInitialized) return;
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this._ctx = new Ctx();
        this._masterGain = this._ctx.createGain();
        this._masterGain.gain.value = 0.3;
        this._masterGain.connect(this._ctx.destination);
        this._setupEngineSound();
        this._isInitialized = true;
        // Remove listeners after successful init
        this._removeInitListeners();
      } catch (e) {
        console.warn('[Audio] Failed to initialize:', e.message);
      }
    };

    this._initClickHandler = () => initOnce();
    this._initKeyHandler = (e) => {
      // Only init on non-modifier keys
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      initOnce();
    };

    window.addEventListener('click', this._initClickHandler, { once: false });
    window.addEventListener('keydown', this._initKeyHandler);
  }

  _removeInitListeners() {
    window.removeEventListener('click', this._initClickHandler);
    window.removeEventListener('keydown', this._initKeyHandler);
  }

  /**
   * Resume AudioContext if suspended (autoplay policy)
   */
  async _resumeContext() {
    if (!this._ctx) return false;
    if (this._ctx.state === 'running') return true;
    try {
      await this._ctx.resume();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Play laser shot
   */
  playLaser() {
    if (!this._isInitialized || this._isMuted) return;
    if (this._ctx.state !== 'running') return;

    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(Constants.AUDIO.LASER_FREQ_START, this._ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Constants.AUDIO.LASER_FREQ_END, this._ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.08, this._ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start();
    osc.stop(this._ctx.currentTime + 0.15);
  }

  /**
   * Play explosion
   */
  playExplosion(size = 1) {
    if (!this._isInitialized || this._isMuted) return;
    if (this._ctx.state !== 'running') return;

    const bufferSize = this._ctx.sampleRate * 0.5;
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }

    const source = this._ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800 * size;

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(0.15 * size, this._ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + Constants.AUDIO.EXPLOSION_DECAY);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._masterGain);
    source.start();
  }

  /**
   * Play collision hit
   */
  playCollision() {
    if (!this._isInitialized || this._isMuted) return;
    if (this._ctx.state !== 'running') return;

    const bufferSize = this._ctx.sampleRate * 0.4;
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3)) * 0.7;
    }

    const source = this._ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(0.2, this._ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + Constants.AUDIO.COLLISION_DECAY);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._masterGain);
    source.start();
  }

  _lastWarningTime = 0;
  _warningCooldown = 1.5; // seconds between warning bursts

  /**
   * Play warning beeps
   */
  playWarning() {
    if (!this._isInitialized || this._isMuted) return;
    if (this._ctx.state !== 'running') return;

    // Cooldown: only fire once per cooldown period
    if (this._ctx.currentTime - this._lastWarningTime < this._warningCooldown) return;
    this._lastWarningTime = this._ctx.currentTime;

    for (let i = 0; i < Constants.AUDIO.WARNING_BEIPS; i++) {
      const osc = this._ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = Constants.AUDIO.WARNING_FREQ;

      const gain = this._ctx.createGain();
      const startTime = this._ctx.currentTime + i * Constants.AUDIO.WARNING_INTERVAL;
      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.setValueAtTime(0.12, startTime + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.2);

      osc.connect(gain);
      gain.connect(this._masterGain);
      osc.start(startTime);
      osc.stop(startTime + 0.25);
    }
  }

  /**
   * Update engine rumble sound
   */
  updateEngine(thrusting, speedRatio) {
    if (!this._isInitialized || this._isMuted) return;
    if (this._ctx.state !== 'running') return;
    if (!this._engineOsc) return;

    const now = this._ctx.currentTime;
    const freq = Constants.AUDIO.ENGINE_FREQ_MIN + speedRatio * (Constants.AUDIO.ENGINE_FREQ_MAX - Constants.AUDIO.ENGINE_FREQ_MIN);
    const vol = thrusting ? 0.12 + speedRatio * 0.15 : 0.05;

    this._engineOsc.frequency.setTargetAtTime(freq, now, 0.1);
    this._engineGain.gain.setTargetAtTime(this._isMuted ? 0 : vol, now, 0.1);
  }

  /**
   * Set mute state
   */
  toggleMute() {
    this._isMuted = !this._isMuted;
    // Notify listeners of mute state change
    EventBus.emit('audio:mute', this._isMuted);
    if (this._engineGain) {
      const now = this._ctx?.currentTime || 0;
      this._engineGain.gain.setTargetAtTime(this._isMuted ? 0 : 0.15, now, 0.05);
    }
    if (this._masterGain) {
      const now = this._ctx?.currentTime || 0;
      this._masterGain.gain.setTargetAtTime(this._isMuted ? 0 : 0.3, now, 0.05);
    }
  }

  get isMuted() {
    return this._isMuted;
  }

  _setupEngineSound() {
    // Engine rumble — low freq sawtooth + low-pass filter
    this._engineOsc = this._ctx.createOscillator();
    this._engineOsc.type = 'sawtooth';
    this._engineOsc.frequency.value = Constants.AUDIO.ENGINE_FREQ_MIN;

    this._engineFilter = this._ctx.createBiquadFilter();
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = 200;
    this._engineFilter.Q.value = 1;

    this._engineGain = this._ctx.createGain();
    this._engineGain.gain.value = 0.15;

    this._engineOsc.connect(this._engineFilter);
    this._engineFilter.connect(this._engineGain);
    this._engineGain.connect(this._masterGain);
    this._engineOsc.start();
  }

  destroy() {
    this._removeInitListeners();
    if (this._engineOsc) {
      try { this._engineOsc.stop(); } catch (e) {}
    }
    if (this._ctx) {
      try { this._ctx.close(); } catch (e) {}
    }
    this._isInitialized = false;
    this._isMuted = false;
    this._lastWarningTime = 0;
  }
}

export default AudioSystem;

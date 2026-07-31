import { Constants } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';

// Web Audio API procedural synthesis — no audio files (spec §8).
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._engineGain = null;
    this._engineOsc = null;
    this._engineFilter = null;
    this._warningTimer = null;
    this._shieldOsc = null;
    this._shieldGain = null;
    this._initUnsub = eventBus.on(Events.AUDIO_MUTED, (m) => this.setMuted(m.muted));
    this._resumeHandler = () => this._ensureContext();
    window.addEventListener('pointerdown', this._resumeHandler);
    window.addEventListener('keydown', this._resumeHandler);
  }

  _ensureContext() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this._buildEngine();
    } catch (err) {
      console.warn('[Audio] Web Audio unavailable:', err);
    }
  }

  _buildEngine() {
    // Engine rumble: 60Hz sawtooth + lowpass 200Hz, gain scales with thrust
    this._engineOsc = this.ctx.createOscillator();
    this._engineOsc.type = 'sawtooth';
    this._engineOsc.frequency.value = 60;
    this._engineFilter = this.ctx.createBiquadFilter();
    this._engineFilter.type = 'lowpass';
    this._engineFilter.frequency.value = 200;
    this._engineGain = this.ctx.createGain();
    this._engineGain.gain.value = 0;
    this._engineOsc.connect(this._engineFilter).connect(this._engineGain).connect(this.master);
    this._engineOsc.start();
  }

  setThrust(fraction) {
    if (!this.ctx) return;
    const target = 0.04 + fraction * 0.12;
    this._engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
  }

  /** Shield hum loop while active. */
  setShield(active) {
    if (!this.ctx) return;
    if (active && !this._shieldOsc) {
      this._shieldOsc = this.ctx.createOscillator();
      this._shieldOsc.type = 'triangle';
      this._shieldOsc.frequency.value = 220;
      this._shieldGain = this.ctx.createGain();
      this._shieldGain.gain.value = 0;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      this._shieldOsc.connect(filter).connect(this._shieldGain).connect(this.master);
      this._shieldOsc.start();
      this._shieldGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.08);
    } else if (!active && this._shieldOsc) {
      this._shieldGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      const osc = this._shieldOsc;
      this._shieldOsc = null;
      setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 400);
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  /** One-shot synthesized sounds. */
  play(name, opts = {}) {
    if (!this.ctx || this.muted) return;
    const volume = opts.volume ?? 0.5;
    switch (name) {
      case 'laser': this._laser(volume); break;
      case 'explosion': this._explosion(volume); break;
      case 'collision': this._collision(volume); break;
      case 'biome': this._biome(volume); break;
      case 'consumption': this._consumption(volume); break;
      case 'comet': this._comet(volume); break;
      case 'shield': this._shieldPing(volume); break;
      case 'collapse': this._collapseBoom(volume); break;
      default: break;
    }
  }

  _noiseBuffer() {
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _laser(vol) {
    const t = this.ctx.currentTime;
    // noise burst 50ms
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.05);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.06);
    // frequency sweep 800→200
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(vol * 0.2, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  _explosion(vol) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(80, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.55);
  }

  _collision(vol) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  _biome(vol) {
    const t = this.ctx.currentTime;
    for (const [i, f] of [200, 300, 500].entries()) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      const start = t + i * 0.3;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(vol * 0.3, start + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(g).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.32);
    }
  }

  _consumption(vol) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.42);
    // sub thump
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 45;
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc2.connect(g2).connect(this.master);
    osc2.start(t);
    osc2.stop(t + 0.27);
  }

  _comet(vol) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.65);
    // crackle
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(vol * 0.3, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.52);
  }

  /** Shield deflection: metallic ping. */
  _shieldPing(vol) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.1);
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 2500;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.2, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(nf).connect(ng).connect(this.master);
    src.start(t);
    src.stop(t + 0.06);
  }

  /** Black hole collapse: massive deep boom. */
  _collapseBoom(vol) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1500, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.35);
    // sub drop 120→25 Hz
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 1.0);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(vol * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.15);
  }

  /** Warning beep loop while health < 30 (800Hz, 3 pulses, repeats 2s). */
  setWarning(active) {
    if (!this.ctx) return;
    if (active && !this._warningTimer) {
      const beep = () => {
        const t = this.ctx.currentTime;
        for (let i = 0; i < 3; i++) {
          const osc = this.ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = 800;
          const g = this.ctx.createGain();
          const start = t + i * 0.2;
          g.gain.setValueAtTime(0.0001, start);
          g.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
          osc.connect(g).connect(this.master);
          osc.start(start);
          osc.stop(start + 0.06);
        }
      };
      beep();
      this._warningTimer = setInterval(beep, 2000);
    } else if (!active && this._warningTimer) {
      clearInterval(this._warningTimer);
      this._warningTimer = null;
    }
  }

  dispose() {
    window.removeEventListener('pointerdown', this._resumeHandler);
    window.removeEventListener('keydown', this._resumeHandler);
    if (this._warningTimer) clearInterval(this._warningTimer);
    if (this.ctx) {
      this._engineOsc?.stop();
      this.ctx.close();
    }
  }
}

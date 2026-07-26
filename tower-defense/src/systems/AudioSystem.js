export default class AudioSystem {
  constructor() {
    this._ctx = null;
    this.enabled = true;
  }
  _get() {
    if (!this._ctx) this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    return this._ctx;
  }
  _tone(freq, t, type='sine', vol=0.08) {
    if (!this.enabled) return;
    const ctx = this._get();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + t);
  }
  playPlace() { this._tone(520, 0.1, 'square', 0.07); this._tone(880, 0.08, 'sine', 0.04); }
  playUpgrade() { this._tone(660, 0.12, 'triangle', 0.06); this._tone(1320, 0.1, 'sine', 0.05); }
  playFire() { this._tone(110, 0.05, 'sawtooth', 0.03); }
  playHit() { this._tone(220, 0.08, 'square', 0.04); }
  playExplosion() { this._tone(60, 0.25, 'sine', 0.08); this._tone(30, 0.35, 'triangle', 0.05); }
  playBossAlert() { this._tone(440, 0.4, 'sawtooth', 0.06); }
  playWaveEnd() { this._tone(520, 0.2, 'sine', 0.06); setTimeout(()=> this._tone(660,0.2,'sine',0.06),180); }
}

import { eventBus, Events } from '../core/EventBus.js';
import { Constants } from '../core/Constants.js';

// DOM overlay HUD (spec §7): score, distance, health, biome, thrust,
// warnings, mute icon, flash, controls hint, pause overlay.
export class HUD {
  constructor(uiOverlay) {
    this.root = uiOverlay;
    this._build();
    this._bind();
  }

  _el(tag, cls, parent) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    (parent || this.root).appendChild(el);
    return el;
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = `
      .hud-el { position: absolute; color: rgba(200,220,255,0.9); font: 600 16px/1.2 'Segoe UI', system-ui, sans-serif;
        text-shadow: 0 0 6px rgba(80,140,255,0.6); letter-spacing: 0.5px; pointer-events: none; z-index: 20; }
      #hud-score { top: 14px; left: 16px; font-size: 20px; }
      #hud-rung { top: 44px; left: 16px; font-size: 12px; color: #7dffd4; text-shadow: 0 0 8px rgba(51,255,204,0.5); }
      #hud-rung-bar { margin-top: 3px; width: 140px; height: 4px; background: rgba(51,255,204,0.18); border-radius: 2px; overflow: hidden; }
      #hud-rung-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #33ffcc, #66ddff); }
      #hud-announce { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%); text-align: center;
        font: 800 30px/1.3 'Segoe UI', system-ui, sans-serif; color: #b8ffe0; letter-spacing: 4px; text-shadow: 0 0 24px rgba(80,255,190,0.8);
        opacity: 0; transition: opacity 0.6s; pointer-events: none; z-index: 30; }
      #hud-aq { bottom: 6px; right: 6px; font-size: 10px; opacity: 0.6; color: #ffd880; }
      #hud-static { position: absolute; inset: 0; background: rgba(160,255,220,0.04); opacity: 0; pointer-events: none; z-index: 16;
        animation: staticFlicker 0.05s steps(2) infinite; }
      @keyframes staticFlicker { 0% { filter: none; } 50% { filter: brightness(1.4); } 100% { filter: none; } }
      #hud-distance { top: 14px; left: 50%; transform: translateX(-50%); font-size: 18px; }
      #hud-biome { top: 14px; right: 16px; font-size: 15px; opacity: 0.9; transition: opacity 0.6s; }
      #hud-mute { top: 40px; right: 16px; font-size: 14px; opacity: 0.7; }
      #hud-health-wrap { bottom: 22px; left: 50%; transform: translateX(-50%); width: 320px; max-width: 60vw; }
      #hud-health-bg { width: 100%; height: 12px; background: rgba(10,20,40,0.7); border: 1px solid rgba(120,180,255,0.4); border-radius: 6px; overflow: hidden; }
      #hud-health-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #22cc44, #88ff44); border-radius: 6px; transition: width 0.15s, background 0.3s; }
      #hud-health-label { text-align: center; margin-top: 4px; font-size: 12px; }
      #hud-shield-wrap { bottom: 52px; left: 50%; transform: translateX(-50%); width: 260px; max-width: 50vw; }
      #hud-shield-bg { width: 100%; height: 7px; background: rgba(10,20,40,0.7); border: 1px solid rgba(80,180,255,0.45); border-radius: 4px; overflow: hidden; }
      #hud-shield-fill { height: 100%; width: 100%; background: linear-gradient(90deg, #1a6bff, #66ddff); border-radius: 4px; transition: width 0.15s; }
      #hud-shield-label { text-align: center; margin-top: 2px; font-size: 10px; letter-spacing: 1.5px; opacity: 0.8; }
      #hud-shield-btn { position: absolute; bottom: 70px; right: 16px; width: 64px; height: 64px; border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, rgba(80,180,255,0.55), rgba(20,60,140,0.75));
        border: 2px solid rgba(120,200,255,0.8); color: #dff1ff; font-size: 26px; display: none;
        align-items: center; justify-content: center; pointer-events: auto; user-select: none; z-index: 25; }
      #hud-thrust { bottom: 22px; left: 16px; width: 120px; }
      #hud-thrust-label { font-size: 11px; opacity: 0.7; margin-bottom: 3px; }
      #hud-thrust-bg { width: 100%; height: 6px; background: rgba(10,20,40,0.7); border-radius: 3px; overflow: hidden; }
      #hud-thrust-fill { height: 100%; width: 0%; background: linear-gradient(90deg, #3366ff, #66ccff); }
      #hud-warnings { bottom: 70px; left: 50%; transform: translateX(-50%); text-align: center; }
      .hud-warn { font-size: 22px; font-weight: 800; color: #ff3333; letter-spacing: 3px;
        text-shadow: 0 0 12px rgba(255,40,40,0.9), 0 0 30px rgba(255,20,20,0.6); display: none;
        animation: warnPulse 0.6s ease-in-out infinite alternate; }
      @keyframes warnPulse { from { opacity: 0.55; } to { opacity: 1; } }
      #hud-flash { position: absolute; inset: 0; background: rgba(255,30,30,0.35); opacity: 0; pointer-events: none; z-index: 15; transition: opacity 0.35s; }
      #hud-lowhp { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(255,0,0,0.28)); opacity: 0; pointer-events: none; z-index: 14; }
      #hud-hint { bottom: 22px; right: 16px; font-size: 11px; opacity: 0.55; text-align: right; line-height: 1.5; }
      #hud-pause { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column;
        background: rgba(0,5,15,0.5); z-index: 40; pointer-events: auto; }
      #hud-pause h1 { color: #cfe0ff; font-size: 34px; letter-spacing: 6px; margin-bottom: 10px; text-shadow: 0 0 20px rgba(100,160,255,0.8); }
      #hud-pause p { color: rgba(200,220,255,0.75); font-size: 14px; margin: 4px 0; }
    `;
    this.root.appendChild(style);

    this.score = this._el('div', 'hud-el', this.root); this.score.id = 'hud-score';
    const rungWrap = this._el('div', 'hud-el', this.root); rungWrap.id = 'hud-rung';
    this.rungLabel = this._el('span', '', rungWrap);
    const rungBar = this._el('div', '', rungWrap); rungBar.id = 'hud-rung-bar';
    this.rungFill = this._el('div', '', rungBar); this.rungFill.id = 'hud-rung-fill';
    this.announceEl = this._el('div', '', this.root); this.announceEl.id = 'hud-announce';
    this.aqEl = this._el('div', 'hud-el', this.root); this.aqEl.id = 'hud-aq';
    this.distance = this._el('div', 'hud-el', this.root); this.distance.id = 'hud-distance';
    this.biome = this._el('div', 'hud-el', this.root); this.biome.id = 'hud-biome';
    this.mute = this._el('div', 'hud-el', this.root); this.mute.id = 'hud-mute';

    const hw = this._el('div', 'hud-el', this.root); hw.id = 'hud-health-wrap';
    const hb = this._el('div', '', hw); hb.id = 'hud-health-bg';
    this.healthFill = this._el('div', '', hb); this.healthFill.id = 'hud-health-fill';
    this.healthLabel = this._el('div', '', hw); this.healthLabel.id = 'hud-health-label';

    const sw = this._el('div', 'hud-el', this.root); sw.id = 'hud-shield-wrap';
    const sb = this._el('div', '', sw); sb.id = 'hud-shield-bg';
    this.shieldFill = this._el('div', '', sb); this.shieldFill.id = 'hud-shield-fill';
    const sl = this._el('div', '', sw); sl.id = 'hud-shield-label';
    sl.textContent = 'SHIELD (RIGHT CLICK)';

    // Touch shield button (hidden on desktop)
    this.shieldBtn = this._el('div', '', this.root); this.shieldBtn.id = 'hud-shield-btn';
    this.shieldBtn.textContent = '🛡';
    const press = () => eventBus.emit('input:shield', { active: true });
    const release = () => eventBus.emit('input:shield', { active: false });
    this.shieldBtn.addEventListener('pointerdown', press);
    this.shieldBtn.addEventListener('pointerup', release);
    this.shieldBtn.addEventListener('pointerleave', release);
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      this.shieldBtn.style.display = 'flex';
    }

    const tw = this._el('div', 'hud-el', this.root); tw.id = 'hud-thrust';
    this._el('div', '', tw).id = 'hud-thrust-label';
    this.thrustLabel = tw.firstChild;
    this.thrustLabel.textContent = 'THRUST';
    const tb = this._el('div', '', tw); tb.id = 'hud-thrust-bg';
    this.thrustFill = this._el('div', '', tb); this.thrustFill.id = 'hud-thrust-fill';

    const warns = this._el('div', 'hud-el', this.root); warns.id = 'hud-warnings';
    this.warnHorizon = this._el('div', 'hud-warn', warns);
    this.warnHorizon.textContent = '⚠ EVENT HORIZON';
    this.warnStar = this._el('div', 'hud-warn', warns);
    this.warnStar.textContent = '⚠ STELLAR REMNANT';
    this.warnPulsar = this._el('div', 'hud-warn', warns);
    this.warnPulsar.textContent = '⚠ PULSAR BEAM';

    this.flashEl = this._el('div', '', this.root); this.flashEl.id = 'hud-flash';
    this.lowhp = this._el('div', '', this.root); this.lowhp.id = 'hud-lowhp';
    this.staticEl = this._el('div', '', this.root); this.staticEl.id = 'hud-static';

    this.hint = this._el('div', 'hud-el', this.root); this.hint.id = 'hud-hint';
    this.hint.innerHTML = 'Z/S pitch · Q/D strafe · A/E roll · Mouse look<br>Scroll throttle 0-100% · Space fire · Esc pause · M mute';

    this.pause = this._el('div', '', this.root); this.pause.id = 'hud-pause';
    const h1 = this._el('h1', '', this.pause); h1.textContent = 'PAUSED';
    this._el('p', '', this.pause).textContent = 'Press Esc to resume';
    this._el('p', '', this.pause).textContent = 'Z/S pitch · Q/D strafe · A/E roll · Mouse look · Scroll throttle · Space fire';

    // Touch throttle slider (hidden on desktop)
    const sliderWrap = this._el('div', 'hud-el', this.root);
    sliderWrap.id = 'hud-throttle-slider';
    sliderWrap.style.cssText = 'bottom: 26px; right: 16px; width: 140px; pointer-events: auto; display: none;';
    const sliderLabel = this._el('div', '', sliderWrap);
    sliderLabel.style.cssText = 'font-size: 11px; opacity: 0.7; margin-bottom: 2px;';
    sliderLabel.textContent = 'THROTTLE';
    this.throttleSlider = this._el('input', '', sliderWrap);
    this.throttleSlider.type = 'range';
    this.throttleSlider.min = '0';
    this.throttleSlider.max = '100';
    this.throttleSlider.value = '0';
    this.throttleSlider.style.cssText = 'width: 100%; accent-color: #66ccff;';
    this.throttleSlider.addEventListener('input', () => {
      eventBus.emit('input:throttleSet', { value: parseFloat(this.throttleSlider.value) / 100 });
    });
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      sliderWrap.style.display = 'block';
    }
  }

  _bind() {
    this._unsubs = [
      eventBus.on(Events.SCORE_CHANGED, (e) => this.setScore(e.score)),
      eventBus.on(Events.BIOME_CHANGED, (e) => this.setBiome(e.to)),
      eventBus.on(Events.AUDIO_MUTED, (e) => this.setMuted(e.muted)),
      eventBus.on(Events.PLAYER_HEALTH_CHANGED, (e) => this.setHealth(e.health, e.maxHealth)),
      eventBus.on(Events.PLAYER_HEALTH_REGEN, (e) => this.setHealth(e.health, e.maxHealth)),
      eventBus.on(Events.STORM_STATIC_CHANGED, (e) => this.setStatic(e.active, e.intensity)),
    ];
  }

  setScore(score) { this.score.textContent = `SCORE: ${score.toLocaleString()}`; }
  setRung(name, progress, isFinale) {
    this.rungLabel.textContent = isFinale ? 'SECTOR 9 — DEAD CITY' : `SECTOR ${this._rungNum} — ${name.toUpperCase()}`;
    this.rungFill.style.width = isFinale ? '100%' : `${Math.round(progress * 100)}%`;
  }
  setRungNumber(n) { this._rungNum = n; }
  announce(text, seconds = 5) {
    this.announceEl.textContent = text;
    this.announceEl.style.opacity = '1';
    clearTimeout(this._announceTimer);
    this._announceTimer = setTimeout(() => { this.announceEl.style.opacity = '0'; }, seconds * 1000);
  }
  setAQ(level) { this.aqEl.textContent = level > 0 ? `AQ${level}` : ''; }
  setStatic(active, intensity) {
    this.staticEl.style.opacity = active ? String(intensity) : '0';
  }
  setDistance(d) { this.distance.textContent = `DISTANCE: ${Math.floor(d).toLocaleString()} u`; }
  setBiome(name) {
    const label = name.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    this.biome.textContent = label;
  }
  setHealth(health, max) {
    const pct = Math.max(0, (health / max) * 100);
    this.healthFill.style.width = `${pct}%`;
    if (pct > 50) this.healthFill.style.background = 'linear-gradient(90deg, #22cc44, #88ff44)';
    else if (pct > 30) this.healthFill.style.background = 'linear-gradient(90deg, #ddaa22, #ffcc44)';
    else this.healthFill.style.background = 'linear-gradient(90deg, #dd2222, #ff4444)';
    this.healthLabel.textContent = `${Math.ceil(health)} / ${max}`;
    this.lowhp.style.opacity = pct < 30 && pct > 0 ? '1' : '0';
  }
  setThrust(f) { this.thrustFill.style.width = `${Math.round(f * 100)}%`; }
  setShield(fraction, active) {
    const pct = Math.round(fraction * 100);
    this.shieldFill.style.width = `${pct}%`;
    this.shieldFill.style.background = active
      ? 'linear-gradient(90deg, #44ccff, #aaffff)'
      : 'linear-gradient(90deg, #1a6bff, #66ddff)';
  }
  setWarning(name, active) {
    if (name === 'eventHorizon') this.warnHorizon.style.display = active ? 'block' : 'none';
    else if (name === 'stellarRemnant') this.warnStar.style.display = active ? 'block' : 'none';
    else if (name === 'pulsarBeam') this.warnPulsar.style.display = active ? 'block' : 'none';
  }
  setMuted(muted) { this.mute.textContent = muted ? '🔇 muted (M)' : '🔊 (M to mute)'; }
  flash(color = 'rgba(255,30,30,0.35)') {
    this.flashEl.style.background = color;
    this.flashEl.style.opacity = '1';
    setTimeout(() => { this.flashEl.style.opacity = '0'; }, 120);
  }
  showPause(on) { this.pause.style.display = on ? 'flex' : 'none'; }

  reset() {
    this.setScore(0);
    this.setDistance(0);
    this.setHealth(Constants.MAX_HEALTH, Constants.MAX_HEALTH);
    this.setThrust(0);
    this.setShield(1, false);
    this.setRung('Open Space', 0, false);
    this.setAQ(0);
    this.announceEl.style.opacity = '0';
    this.setStatic(false, 0);
    this.setWarning('eventHorizon', false);
    this.setWarning('stellarRemnant', false);
    this.setWarning('pulsarBeam', false);
    this.showPause(false);
    this.lowhp.style.opacity = '0';
  }

  dispose() {
    for (const unsub of this._unsubs) unsub();
    this._unsubs = [];
  }
}

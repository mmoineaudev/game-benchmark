/**
 * HUD.js — DOM overlay HUD (SPEC §3, §6).
 *
 *   - hull bar (red), shield bar (blue);
 *   - scrap count, cargo slots used/max;
 *   - sector name + distance, kills;
 *   - crosshair (CSS center dot + ring);
 *   - boss HP bar (top center; rendered when `hud.bossHp` is set by
 *     main.js — `{hp, max}` from the live warden, null otherwise);
 *   - pickup toast area + discovery popup (animated fade).
 *
 * Wired via EventBus:
 *   'loot:pickedUp'      → toast "+ Item Name"
 *   'loot:firstDiscovery' → showDiscovery(itemDef) animated fade popup.
 *
 * `update(gameState)` re-reads run + meta each frame (cheap DOM writes only
 * when a value actually changed, to avoid layout thrash).
 */
import { EventBus } from '../core/EventBus.js';
import { SECTORS } from '../core/Constants.js';
import * as THREE from 'three';

/** Scratch for setAimPoint projection. */
const _aimV = new THREE.Vector3();

/** Toast lifetime, s. */
const TOAST_LIFE = 1.5;
/** Discovery popup lifetime, s. */
const DISCOVERY_LIFE = 2.5;

class _HUD {
  constructor() {
    /** @type {HTMLElement[]} live toasts (for fade-out timers). */
    this._toasts = [];
    this._unsub = [];
    _injectStyles();
    this._build();
    this._wire();
  }

  /** Build the DOM overlay (appended to document.body). */
  _build() {
    const root = document.createElement('div');
    root.id = 'vw-hud';

    // -- AR corner frame ------------------------------------------------------
    const frame = document.createElement('div');
    frame.className = 'vw-hud-frame';
    for (let i = 0; i < 4; i++) frame.appendChild(document.createElement('span'));

    // == TOP-LEFT: combat cluster (hull/shield bars + numeric readouts) ======
    // The bars alone don't tell you the numbers; big-value + bar communicates
    // both at a glance (user feedback: HUD was 50% functional).
    const combat = document.createElement('div');
    combat.className = 'vw-hud-combat';
    const hullBar = _bar('vw-hud-hull', 'HULL', '#ef4444');
    const shieldBar = _bar('vw-hud-shield', 'SHIELD', '#38bdf8');
    this._hullNum = document.createElement('div');
    this._hullNum.className = 'vw-hud-bar-num';
    this._hullNum.style.color = '#ef4444';
    this._shieldNum = document.createElement('div');
    this._shieldNum.className = 'vw-hud-bar-num';
    this._shieldNum.style.color = '#38bdf8';
    const hullRow = document.createElement('div');
    hullRow.className = 'vw-hud-bar-row';
    hullRow.append(this._hullNum, hullBar);
    const shieldRow = document.createElement('div');
    shieldRow.className = 'vw-hud-bar-row';
    shieldRow.append(this._shieldNum, shieldBar);
    combat.append(hullRow, shieldRow);

    // == BOTTOM-LEFT: navigation cluster (sector, distance, speed, coords) ====
    // Navigation is contextual info, not combat-critical — moved off the
    // top-left so combat numbers sit alone where your eye lands.
    const nav = document.createElement('div');
    nav.className = 'vw-hud-nav';
    this._sectorEl = document.createElement('div');
    this._sectorEl.className = 'vw-hud-sector';
    this._navEl = document.createElement('div');
    this._navEl.className = 'vw-hud-navline';
    nav.append(this._sectorEl, this._navEl);

    // == TOP-RIGHT: economy cluster (wallet + kills) ==========================
    const econ = document.createElement('div');
    econ.className = 'vw-hud-econ';
    this._scrapEl = document.createElement('div');
    this._scrapEl.className = 'vw-hud-wallet';
    this._killsEl = document.createElement('div');
    this._killsEl.className = 'vw-hud-kills';
    econ.append(this._scrapEl, this._killsEl);

    // -- Crosshair (follows the cursor; center only in MMB aim mode) ---------
    const crosshair = document.createElement('div');
    crosshair.className = 'vw-hud-crosshair';
    crosshair.style.display = 'none';
    const dot = document.createElement('div');
    dot.className = 'vw-hud-crosshair-dot';
    const ring = document.createElement('div');
    ring.className = 'vw-hud-crosshair-ring';
    crosshair.append(dot, ring);
    this._crosshair = crosshair;
    crosshair.style.left = '50%';
    crosshair.style.top = '50%';

    // -- Toast area (bottom-center) ------------------------------------------
    const toasts = document.createElement('div');
    toasts.className = 'vw-hud-toasts';

    // -- Discovery popup (center) --------------------------------------------
    this._discoveryEl = document.createElement('div');
    this._discoveryEl.className = 'vw-hud-discovery';
    this._discoveryEl.style.display = 'none';

    // -- Boss HP bar (top center; shown while hud.bossHp is set) -------------
    const boss = document.createElement('div');
    boss.className = 'vw-hud-boss';
    const bossLabel = document.createElement('div');
    bossLabel.className = 'vw-hud-boss-label';
    bossLabel.textContent = 'THE WARDEN';
    const bossTrack = document.createElement('div');
    bossTrack.className = 'vw-hud-boss-track';
    this._bossFill = document.createElement('div');
    this._bossFill.className = 'vw-hud-boss-fill';
    bossTrack.appendChild(this._bossFill);
    boss.append(bossLabel, bossTrack);
    boss.style.display = 'none';

    root.append(frame, combat, nav, econ, crosshair, toasts, this._discoveryEl, boss);
    document.body.appendChild(root);
    this._bossEl = boss;

    // -- Turret-mode indicator (top-center, under boss bar) ------------------
    this._turretEl = document.createElement('div');
    this._turretEl.className = 'vw-hud-turret';
    this._turretEl.textContent = '⟳ TURRET MODE — ship holds course, free aim';
    this._turretEl.style.display = 'none';
    root.appendChild(this._turretEl);

    // -- Attack chips (bottom-right): IEM + MISSILES cooldown -----------------
    const chips = document.createElement('div');
    chips.className = 'vw-hud-chips';
    const mkChip = (key, name) => {
      const chip = document.createElement('div');
      chip.className = 'vw-hud-chip vw-hud-chip-ready';
      const chipName = document.createElement('span');
      chipName.className = 'vw-hud-chip-name';
      chipName.textContent = name;
      const chipKey = document.createElement('span');
      chipKey.className = 'vw-hud-chip-key';
      chipKey.textContent = key;
      const chipState = document.createElement('span');
      chipState.className = 'vw-hud-chip-state';
      chipState.textContent = 'READY';
      const track = document.createElement('div');
      track.className = 'vw-hud-chip-track';
      const fill = document.createElement('div');
      fill.className = 'vw-hud-chip-fill';
      track.appendChild(fill);
      chip.append(chipName, chipKey, chipState, track);
      chip._state = 'r';
      chip._txt = 'READY';
      chips.appendChild(chip);
      return [chip, fill];
    };
    [this._iemChip, this._iemFill] = mkChip('MMB', 'IEM');
    [this._volleyChip, this._volleyFill] = mkChip('F', 'MSL');
    root.appendChild(chips);

    // -- Pause menu (P) — controls + brief game explanation ------------------
    this._buildPause();

    this._root = root;
    this._toastsEl = toasts;
    this._hullFill = hullBar.querySelector('.vw-hud-bar-fill');
    this._shieldFill = shieldBar.querySelector('.vw-hud-bar-fill');
  }

  /** Subscribe to EventBus pickup + discovery events. */
  _wire() {
    this._unsub.push(
      EventBus.on('loot:pickedUp', (payload) => {
        if (payload && payload.itemDef) this.showToast(`+ ${payload.itemDef.name}`);
      }),
      EventBus.on('loot:firstDiscovery', (payload) => {
        if (payload && payload.itemDef) this.showDiscovery(payload.itemDef);
      }),
    );
  }

  /** Build the pause menu overlay (hidden; toggled by togglePause()). */
  _buildPause() {
    const p = document.createElement('div');
    p.id = 'vw-pause';
    p.style.display = 'none';
    const panel = document.createElement('div');
    panel.className = 'vw-pause-panel';

    const title = document.createElement('div');
    title.className = 'vw-pause-title';
    title.textContent = 'PAUSED — VOID WARBAND';
    panel.appendChild(title);

    const blurb = document.createElement('div');
    blurb.className = 'vw-pause-blurb';
    blurb.textContent =
      'Fly the sector ladder, fight escalating enemies and loot their wreckage. ' +
      'Everything you carry is LOST on death — bank it at stations (H nearby one) ' +
      'to convert it into scrap, then spend scrap in the hangar on permanent ship ' +
      'upgrades. Deeper sectors pay better and hit harder; the run ends at THE FORGE.';
    panel.appendChild(blurb);

    const table = document.createElement('table');
    table.className = 'vw-pause-keys';
    const rows = [
      ['Aim / steer', 'move the mouse — the ship noses toward the cursor'],
      ['Fly straight', 'stop steering ~1 s — the nose settles onto your trajectory'],
      ['Throttle', 'scroll up = accelerate, scroll down = brake (full down = retro-burn)'],
      ['Fire', 'Left click (hold) — pulse autocannon at the cursor'],
      ['IEM burst', 'Middle click (tap) — destroys nearby enemies, 5 s shutdown after firing'],
      ['Missiles', 'KeyF — 3×5 autoguided missile salvos, 0.5 s apart (6 s reload)'],
      ['Turret mode (free look)', 'KeyG — ship holds course, aim follows the mouse 360° (shoot backwards!)'],
      ['Roll', 'KeyQ / KeyE'],
      ['Boost', 'Shift — ×2 speed, 4.5 s burn · reactors RED while charging, BLUE when ready (8 s)'],
      ['Station trade', 'KeyH — near a station: bank + trade menu (install ≤3 items / sell)'],
      ['Collection log', 'Tab — discovered items X/22'],
      ['Pause / Help', 'KeyP or F1 (this menu) or Escape'],
      ['Restart', 'KeyR — death screen only'],
    ];
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const key = document.createElement('td');
      key.className = 'vw-pause-key';
      key.textContent = k;
      const val = document.createElement('td');
      val.className = 'vw-pause-val';
      val.textContent = v;
      tr.append(key, val);
      table.appendChild(tr);
    }
    panel.appendChild(table);

    const hint = document.createElement('div');
    hint.className = 'vw-pause-hint';
    hint.textContent = 'Press P, F1 or Escape to resume';
    panel.appendChild(hint);

    p.appendChild(panel);
    document.body.appendChild(p);
    this._pauseEl = p;
  }

  /**
   * Show/hide the pause menu.
   * @param {boolean} on
   */
  setPaused(on) {
    if (this._pauseEl) this._pauseEl.style.display = on ? 'block' : 'none';
  }

  /**
   * Show/hide the turret-mode indicator.
   * @param {boolean} on
   */
  setTurret(on) {
    if (this._turretEl) this._turretEl.style.display = on ? 'block' : 'none';
  }

  /**
   * Place the crosshair at the projected main-weapon aim-point (world →
   * screen). Shots converge there, so this is where the crosshair belongs.
   * @param {THREE.Vector3} aimPoint world convergence point of the shots.
   * @param {THREE.PerspectiveCamera} camera
   */
  setAimPoint(aimPoint, camera) {
    const c = this._crosshair;
    if (!c) return;
    _aimV.copy(aimPoint).project(camera);
    if (_aimV.z > 1) {
      // Behind the camera: hide (only happens in degenerate turret views).
      c.style.display = 'none';
      return;
    }
    c.style.display = 'block';
    const x = (_aimV.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-_aimV.y * 0.5 + 0.5) * window.innerHeight;
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
  }

  /**
   * Place the crosshair at the cursor (normal aim) or at screen centre
   * (MMB camera-aim). Crosshair border turns red while in MMB firing mode.
   * @param {boolean} mmb middle-click aim mode active.
   * @param {number} mx cursor CSS x px.
   * @param {number} my cursor CSS y px.
   */
  setAim(mmb, mx, my) {
    const c = this._crosshair;
    if (!c) return;
    c.style.display = 'block';
    const isCenter = mmb ||
      !isFinite(mx) || !isFinite(my) ||
      mx <= 0 || mx >= window.innerWidth ||
      my <= 0 || my >= window.innerHeight;
    c.style.left = (isCenter ? window.innerWidth / 2 : mx) + 'px';
    c.style.top = (isCenter ? window.innerHeight / 2 : my) + 'px';
    const ring = c.querySelector('.vw-hud-crosshair-ring');
    if (ring) ring.style.borderColor = mmb ? 'rgba(239,68,68,.95)' : 'rgba(226,232,240,.7)';
  }

  /** Attack cooldown chips (IEM / MISSILES), bottom-right. */
  setAttacks({ iemCd, iemMax, volleyCd, volleyMax }) {
    if (!this._iemChip) return;
    this._setChip(this._iemChip, this._iemFill, iemCd, iemMax);
    this._setChip(this._volleyChip, this._volleyFill, volleyCd, volleyMax);
  }

  /**
   * Update one cooldown chip: READY glow when off cooldown, dimmed + %
   * fill while recharging.
   */
  _setChip(chip, fill, cd, max) {
    const ready = cd <= 0.05;
    const txt = ready ? 'READY' : `${cd.toFixed(1)}s`;
    if (chip._state !== (ready ? 'r' : 'c') || chip._txt !== txt) {
      chip._state = ready ? 'r' : 'c';
      chip._txt = txt;
      chip.querySelector('.vw-hud-chip-state').textContent = txt;
      chip.classList.toggle('vw-hud-chip-ready', ready);
      chip.classList.toggle('vw-hud-chip-cd', !ready);
    }
    fill.style.width = `${(Math.max(0, Math.min(1, 1 - cd / max)) * 100).toFixed(0)}%`;
  }

  /**
   * Per-frame: read run + meta, update DOM only on change.
   * @param {object} gameState GameState singleton.
   */
  update(gameState) {
    const run = gameState.run;
    if (!run) return;

    // Boss HP bar (main.js sets this.bossHp = {hp, max} each frame, or null).
    if (this.bossHp && this.bossHp.max > 0) {
      const pct = Math.max(0, Math.min(1, this.bossHp.hp / this.bossHp.max));
      if (this._bossEl.style.display === 'none') this._bossEl.style.display = 'block';
      this._bossFill.style.width = `${(pct * 100).toFixed(1)}%`;
    } else if (this._bossEl.style.display !== 'none') {
      this._bossEl.style.display = 'none';
    }

    // Combat cluster: numeric hull/shield values + bars.
    const hullNow = Math.ceil(run.hull);
    const hullMax = gameState.maxHull();
    const shieldNow = Math.ceil(run.shield);
    const shieldMax = gameState.maxShield();
    const hullTxt = `${hullNow}/${hullMax}`;
    if (this._hullNum.textContent !== hullTxt) this._hullNum.textContent = hullTxt;
    const shieldTxt = `${shieldNow}/${shieldMax}`;
    if (this._shieldNum.textContent !== shieldTxt) this._shieldNum.textContent = shieldTxt;
    this._hullFill.style.width = `${((hullNow / hullMax) * 100).toFixed(1)}%`;
    this._shieldFill.style.width = `${((shieldNow / shieldMax) * 100).toFixed(1)}%`;
    // Low-hull alarm: bar label blinks when below 25%.
    this._hullNum.classList.toggle('vw-hud-low', hullNow / hullMax < 0.25);

    // Wallet (persistent) + kills — top-right economy cluster.
    const scrap = gameState.meta.scrap ?? 0;
    const scrapTxt = `◆ ${scrap}`;
    if (this._scrapEl.textContent !== scrapTxt) this._scrapEl.textContent = scrapTxt;
    const killsTxt = `KILLS ${run.kills}`;
    if (this._killsEl.textContent !== killsTxt) this._killsEl.textContent = killsTxt;

    // Navigation cluster (bottom-left): sector · distance / speed · coords.
    const sector = SECTORS[run.sector - 1] ?? SECTORS[0];
    const sectorName = sector.name;
    const dist = Math.floor(run.distance);
    const sectorTxt = `${sectorName} · ${dist}u FROM SUN`;
    if (this._sectorEl.textContent !== sectorTxt) this._sectorEl.textContent = sectorTxt;
    // Speed: ship velocity magnitude, u/s (+ BOOST tag while boosting).
    const speed = Math.round(Math.hypot(run.velocity.x, run.velocity.y, run.velocity.z));
    const speedTxt = speed > 1
      ? (run.boosting ? `${speed} u/s ▲BOOST` : `${speed} u/s`)
      : '0 u/s';
    // Ship coordinates (world position, rounded).
    const coordsTxt = `XYZ ${Math.round(run.position.x)} / ${Math.round(run.position.y)} / ${Math.round(run.position.z)}`;
    const navTxt = `${speedTxt}  ·  ${coordsTxt}`;
    if (this._navEl.textContent !== navTxt) this._navEl.textContent = navTxt;
  }

  /**
   * Show a pickup toast (auto-fades after TOAST_LIFE).
   * @param {string} text
   */
  showToast(text) {
    const el = document.createElement('div');
    el.className = 'vw-hud-toast';
    el.textContent = text;
    this._toastsEl.appendChild(el);
    this._toasts.push(el);

    const t0 = performance.now();
    const tick = () => {
      const age = (performance.now() - t0) / 1000;
      if (age >= TOAST_LIFE) {
        el.remove();
        const idx = this._toasts.indexOf(el);
        if (idx !== -1) this._toasts.splice(idx, 1);
        return;
      }
      el.style.opacity = `${1 - age / TOAST_LIFE}`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * Discovery popup: item name + flavor line, animated fade in/out.
   * @param {object} itemDef
   */
  showDiscovery(itemDef) {
    const el = this._discoveryEl;
    el.innerHTML = '';
    const name = document.createElement('div');
    name.className = 'vw-hud-discovery-name';
    name.textContent = itemDef.name;
    const flavor = document.createElement('div');
    flavor.className = 'vw-hud-discovery-flavor';
    flavor.textContent = `${itemDef.tier} — added to Collection Log`;
    el.append(name, flavor);
    el.style.display = 'block';
    el.style.opacity = '0';

    const t0 = performance.now();
    const dur = DISCOVERY_LIFE * 1000;
    const tick = () => {
      const age = performance.now() - t0;
      if (age >= dur) {
        el.style.display = 'none';
        el.style.opacity = '0';
        return;
      }
      // Fade in (0–20%), hold, fade out (80–100%).
      const p = age / dur;
      const o = p < 0.2 ? p / 0.2 : p > 0.8 ? (1 - p) / 0.2 : 1;
      el.style.opacity = `${Math.max(0, Math.min(1, o))}`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

/**
 * Build a bar element (label + track + fill).
 * @param {string} id
 * @param {string} label
 * @param {string} color CSS color.
 * @returns {HTMLElement}
 */
function _bar(id, label, color) {
  const el = document.createElement('div');
  el.className = id;
  const track = document.createElement('div');
  track.className = 'vw-hud-bar-track';
  const fill = document.createElement('div');
  fill.className = 'vw-hud-bar-fill';
  fill.style.background = color;
  fill.style.color = color; // bar glow (box-shadow currentColor)
  fill.style.width = '100%';
  const labelEl = document.createElement('div');
  labelEl.className = 'vw-hud-bar-label';
  labelEl.textContent = label;
  track.append(fill, labelEl);
  el.appendChild(track);
  return el;
}

/** HUD overlay CSS (injected once, id-scoped so it never collides). */
function _injectStyles() {
  if (document.getElementById('vw-hud-style')) return;
  const s = document.createElement('style');
  s.id = 'vw-hud-style';
  s.textContent = `
  #vw-hud { position: fixed; inset: 0; pointer-events: none; z-index: 500;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e2e8f0; user-select: none; }
  canvas { cursor: none; }
  /* AR cockpit frame: neon corner brackets around the whole viewport. */
  #vw-hud .vw-hud-frame { position: absolute; inset: 8px; }
  #vw-hud .vw-hud-frame span { position: absolute; width: 30px; height: 30px;
    border: 0 solid rgba(56,189,248,.85); filter: drop-shadow(0 0 5px rgba(56,189,248,.9)); }
  #vw-hud .vw-hud-frame span:nth-child(1) { left: 0; top: 0;
    border-left-width: 2px; border-top-width: 2px; }
  #vw-hud .vw-hud-frame span:nth-child(2) { right: 0; top: 0;
    border-right-width: 2px; border-top-width: 2px; }
  #vw-hud .vw-hud-frame span:nth-child(3) { left: 0; bottom: 0;
    border-left-width: 2px; border-bottom-width: 2px; }
  #vw-hud .vw-hud-frame span:nth-child(4) { right: 0; bottom: 0;
    border-right-width: 2px; border-bottom-width: 2px; }
  /* == Combat cluster (top-left): numeric values + bars ==================== */
  #vw-hud .vw-hud-combat { position: absolute; top: 18px; left: 18px;
    width: 300px; }
  #vw-hud .vw-hud-bar-row { display: flex; align-items: center; gap: 8px;
    margin-bottom: 7px; }
  #vw-hud .vw-hud-bar-num { min-width: 78px; text-align: right;
    font-size: 15px; font-weight: 800; letter-spacing: .04em;
    text-shadow: 0 0 8px currentColor, 0 0 2px #000; }
  #vw-hud .vw-hud-bar-num.vw-hud-low { animation: vwLowPulse .6s infinite; }
  @keyframes vwLowPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  #vw-hud .vw-hud-bar-row .vw-hud-hull,
  #vw-hud .vw-hud-bar-row .vw-hud-shield { flex: 1; }
  /* == Navigation cluster (bottom-left) ==================================== */
  #vw-hud .vw-hud-nav { position: absolute; left: 18px; bottom: 16px;
    font-size: 13px; font-weight: 700; line-height: 1.6;
    text-shadow: 0 0 6px rgba(56,189,248,.8), 0 0 2px #000;
    border-left: 2px solid rgba(56,189,248,.9); padding-left: 10px; }
  #vw-hud .vw-hud-sector { color: #7dd3fc; letter-spacing: .12em;
    font-size: 14px; }
  #vw-hud .vw-hud-navline { color: #cbd5e1; font-size: 12px;
    font-variant-numeric: tabular-nums; }
  /* == Economy cluster (top-right) ========================================= */
  #vw-hud .vw-hud-econ { position: absolute; top: 18px; right: 18px;
    text-align: right; }
  #vw-hud .vw-hud-wallet { font-size: 19px; font-weight: 800; color: #fbbf24;
    text-shadow: 0 0 10px rgba(251,191,36,.8), 0 0 2px #000;
    font-variant-numeric: tabular-nums; }
  #vw-hud .vw-hud-kills { font-size: 12px; letter-spacing: .14em;
    color: #94a3b8; margin-top: 3px; text-shadow: 0 0 4px #000; }
  #vw-hud .vw-hud-hull { position: relative; }
  #vw-hud .vw-hud-shield { position: relative; }
  #vw-hud .vw-hud-bar-track { height: 12px; background: rgba(2,6,23,.8);
    border: 1.5px solid rgba(148,163,184,.55); border-radius: 3px;
    overflow: hidden; margin-bottom: 7px; position: relative;
    box-shadow: 0 0 14px rgba(0,0,0,.7), inset 0 0 8px rgba(0,0,0,.6); }
  #vw-hud .vw-hud-bar-fill { height: 100%; width: 100%; border-radius: 1px;
    box-shadow: 0 0 12px currentColor, 0 0 28px currentColor; transition: width .12s ease-out; }
  #vw-hud .vw-hud-bar-label { position: absolute; left: 6px; top: 0;
    font-size: 9px; font-weight: 700; letter-spacing: .16em; color: #fff;
    line-height: 12px; text-shadow: 0 0 5px #000, 0 0 10px currentColor; z-index: 1; }

  /* Attack chips (bottom-right): neon cooldown gauges. */
  #vw-hud .vw-hud-chips { position: absolute; right: 18px; bottom: 18px;
    display: flex; gap: 10px; }
  #vw-hud .vw-hud-chip { position: relative; width: 118px; padding: 6px 10px 8px;
    background: rgba(2,6,23,.72); border-radius: 6px; overflow: hidden;
    font-size: 11px; letter-spacing: .1em; }
  #vw-hud .vw-hud-chip-ready { border: 1.5px solid rgba(74,222,128,.9);
    box-shadow: 0 0 12px rgba(74,222,128,.55), inset 0 0 10px rgba(74,222,128,.15);
    color: #4ade80; }
  #vw-hud .vw-hud-chip-cd { border: 1.5px solid rgba(148,163,184,.4);
    box-shadow: none; color: rgba(148,163,184,.75); }
  #vw-hud .vw-hud-chip-name { font-weight: 700; }
  #vw-hud .vw-hud-chip-key { float: right; margin-left: 6px; padding: 0 6px;
    border: 1px solid currentColor; border-radius: 3px; font-size: 10px; }
  #vw-hud .vw-hud-chip-state { float: right; opacity: .9; }
  #vw-hud .vw-hud-chip-track { position: absolute; left: 0; bottom: 0;
    height: 3px; width: 100%; background: rgba(148,163,184,.15); }
  #vw-hud .vw-hud-chip-fill { height: 100%; width: 100%;
    background: currentColor; box-shadow: 0 0 8px currentColor; }
  #vw-hud .vw-hud-crosshair { position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, -50%); pointer-events: none; }
  #vw-hud .vw-hud-crosshair-dot { position: absolute; width: 4px; height: 4px;
    background: #7dd3fc; border-radius: 50%; transform: translate(-50%,-50%);
    box-shadow: 0 0 6px rgba(125,211,252,.9); }
  #vw-hud .vw-hud-crosshair-ring { position: absolute; width: 26px; height: 26px;
    border: 1px solid rgba(125,211,252,.7); border-radius: 50%;
    transform: translate(-50%,-50%); }
  /* Elevation ticks (AR sight look). */
  #vw-hud .vw-hud-crosshair::before, #vw-hud .vw-hud-crosshair::after {
    content: ''; position: absolute; background: rgba(125,211,252,.8); }
  #vw-hud .vw-hud-crosshair::before { width: 1.5px; height: 7px;
    left: 50%; top: -13px; transform: translateX(-50%); }
  #vw-hud .vw-hud-crosshair::after { width: 1.5px; height: 7px;
    left: 50%; bottom: -13px; transform: translateX(-50%); }
  #vw-hud .vw-hud-toasts { position: absolute; bottom: 14px; left: 50%;
    transform: translateX(-50%); display: flex; flex-direction: column;
    align-items: center; gap: 4px; }
  #vw-hud .vw-hud-toast { font-size: 14px; text-shadow: 0 0 6px rgba(0,0,0,.9); }
  #vw-hud .vw-hud-discovery { position: absolute; top: 22%; left: 50%;
    transform: translateX(-50%); text-align: center; }
  #vw-hud .vw-hud-discovery-name { font-size: 22px; letter-spacing: .12em;
    text-shadow: 0 0 10px rgba(0,0,0,.9); }
  #vw-hud .vw-hud-discovery-flavor { font-size: 12px; opacity: .85; margin-top: 4px; }
  #vw-hud .vw-hud-boss { position: absolute; top: 14px; left: 50%;
    transform: translateX(-50%); width: 340px; text-align: center; }
  #vw-hud .vw-hud-boss-label { font-size: 11px; letter-spacing: .18em;
    color: #fbbf24; text-shadow: 0 0 6px rgba(0,0,0,.9); margin-bottom: 3px; }
  #vw-hud .vw-hud-boss-track { height: 10px; background: rgba(0,0,0,.6);
    border: 1px solid rgba(251,191,36,.5); border-radius: 3px;
    overflow: hidden; }
  #vw-hud .vw-hud-boss-fill { height: 100%; width: 100%;
    background: linear-gradient(90deg, #7f1d1d, #ef4444, #fbbf24);
    border-radius: 2px; }
  #vw-hud .vw-hud-turret { position: absolute; top: 44px; left: 50%;
    transform: translateX(-50%); font-size: 13px; letter-spacing: .1em;
    color: #4ade80; text-shadow: 0 0 8px rgba(0,0,0,.9);
    border: 1px solid rgba(74,222,128,.5); border-radius: 4px;
    background: rgba(0,0,0,.5); padding: 3px 10px; }
  #vw-pause { position: fixed; inset: 0; z-index: 800; display: none;
    background: rgba(2,6,23,.82); pointer-events: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #e2e8f0; user-select: none; }
  #vw-pause .vw-pause-panel { position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%); width: 640px; max-width: 92vw;
    max-height: 86vh; overflow: auto; background: rgba(10,15,30,.95);
    border: 1px solid rgba(56,189,248,.35); border-radius: 8px;
    padding: 22px 26px; }
  #vw-pause .vw-pause-title { font-size: 18px; letter-spacing: .18em;
    color: #38bdf8; margin-bottom: 10px; }
  #vw-pause .vw-pause-blurb { font-size: 12.5px; line-height: 1.55;
    color: #cbd5e1; margin-bottom: 14px; }
  #vw-pause .vw-pause-keys { width: 100%; border-collapse: collapse;
    font-size: 12.5px; }
  #vw-pause .vw-pause-keys td { padding: 3px 8px 3px 0;
    border-bottom: 1px solid rgba(148,163,184,.12); vertical-align: top; }
  #vw-pause .vw-pause-key { color: #7dd3fc; white-space: nowrap; width: 130px; }
  #vw-pause .vw-pause-val { color: #e2e8f0; }
  #vw-pause .vw-pause-hint { margin-top: 14px; font-size: 11.5px;
    opacity: .7; }
  `;
  document.head.appendChild(s);
}

export { _HUD as HUD };
export default _HUD;

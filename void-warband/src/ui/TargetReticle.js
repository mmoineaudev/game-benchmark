/**
 * TargetReticle.js — AR "pilot cockpit" target boxes (HUD overlay).
 *
 * Each frame the game passes a list of nearby entities:
 *   { name, hint, position:THREE.Vector3, radius, color }
 * The reticle projects each position to screen space and draws a
 * corner-bracket box around it (clamped to a minimum screen size so far
 * targets stay readable). The NEAREST entity also gets a label panel
 * bottom-left (outside the box): name + interaction hint.
 *
 * Pure DOM overlay (position:absolute divs, pooled — no per-frame allocs).
 */
import * as THREE from 'three';

/** Max distance at which brackets are drawn, u. */
const MAX_RANGE = 700;
/** Minimum on-screen bracket size, px (screen-space floor). */
const MIN_BOX = 28;
/** Bracket size padding over the projected radius, px. */
const PAD = 8;

class _TargetReticle {
  constructor() {
    this._pool = [];
    this._used = 0;
    this._v = new THREE.Vector3();
    this._injectStyles();

    const root = document.createElement('div');
    root.id = 'vw-reticle';
    // Bottom-left label panel (outside the bracket boxes).
    this._label = document.createElement('div');
    this._label.className = 'vw-reticle-label';
    this._labelName = document.createElement('div');
    this._labelName.className = 'vw-reticle-label-name';
    this._labelHint = document.createElement('div');
    this._labelHint.className = 'vw-reticle-label-hint';
    this._label.append(this._labelName, this._labelHint);
    root.appendChild(this._label);
    document.body.appendChild(root);
    this._root = root;
  }

  /**
   * Per-frame update.
   * @param {THREE.PerspectiveCamera} camera
   * @param {Array<{name:string, hint:string, position:THREE.Vector3,
   *                radius:number, color:string}>} targets
   */
  update(camera, targets) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._used = 0;
    let nearest = null;
    let nearestDist = Infinity;

    for (const t of targets) {
      const dist = camera.position.distanceTo(t.position);
      if (dist > MAX_RANGE) continue;
      this._v.copy(t.position).project(camera);
      // Behind the camera → skip.
      if (this._v.z < -1 || this._v.z > 1) continue;
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      if (x < -60 || x > w + 60 || y < -60 || y > h + 60) continue;

      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }

      const el = this._next();
      const size = Math.max(MIN_BOX, ((t.radius * 2) / (dist * 2 * Math.tan((camera.fov * Math.PI) / 360))) * h + PAD);
      el.style.display = 'block';
      el.style.left = `${x - size / 2}px`;
      el.style.top = `${y - size / 2}px`;
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderColor = t.color;
      el.style.color = t.color; // distance readout inherits the marker color
      // Distance readout.
      el.dataset.dist = `${Math.round(dist)}u`;
    }

    // Hide unused pool entries.
    for (let i = this._used; i < this._pool.length; i++) {
      this._pool[i].style.display = 'none';
    }

    // Bottom-left label for the nearest target.
    if (nearest) {
      this._label.style.display = 'block';
      this._labelName.textContent = nearest.name.toUpperCase();
      this._labelHint.textContent = nearest.hint || '';
      this._label.style.borderColor = nearest.color;
    } else {
      this._label.style.display = 'none';
    }
  }

  /** Hide everything (non-FLIGHT phases). */
  hide() {
    for (const el of this._pool) el.style.display = 'none';
    if (this._label) this._label.style.display = 'none';
  }

  /** Take (or create) the next pool element. */
  _next() {
    if (this._used < this._pool.length) return this._pool[this._used++];
    const el = document.createElement('div');
    el.className = 'vw-reticle-box';
    // Corner brackets: 4 spans, borders on two sides each.
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('span');
      c.className = 'vw-reticle-corner';
      el.appendChild(c);
    }
    const dist = document.createElement('span');
    dist.className = 'vw-reticle-dist';
    el.appendChild(dist);
    this._root.appendChild(el);
    this._pool.push(el);
    this._used++;
    return el;
  }

  _injectStyles() {
    if (document.getElementById('vw-reticle-style')) return;
    const s = document.createElement('style');
    s.id = 'vw-reticle-style';
    s.textContent = `
  #vw-reticle { position: fixed; inset: 0; pointer-events: none; z-index: 450;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    user-select: none; }
  #vw-reticle .vw-reticle-box { position: absolute; display: none;
    border: none; }
  #vw-reticle .vw-reticle-corner { position: absolute; width: 9px; height: 9px; }
  #vw-reticle .vw-reticle-corner:nth-child(1) { left: 0; top: 0;
    border-left: 1.5px solid; border-top: 1.5px solid; }
  #vw-reticle .vw-reticle-corner:nth-child(2) { right: 0; top: 0;
    border-right: 1.5px solid; border-top: 1.5px solid; }
  #vw-reticle .vw-reticle-corner:nth-child(3) { left: 0; bottom: 0;
    border-left: 1.5px solid; border-bottom: 1.5px solid; }
  #vw-reticle .vw-reticle-corner:nth-child(4) { right: 0; bottom: 0;
    border-right: 1.5px solid; border-bottom: 1.5px solid; }
  #vw-reticle .vw-reticle-dist { position: absolute; left: 50%;
    transform: translateX(-50%); bottom: -16px; font-size: 9.5px;
    letter-spacing: .08em; color: inherit;
    text-shadow: 0 0 4px rgba(0,0,0,.9); }
  #vw-reticle .vw-reticle-label { position: absolute; left: 14px;
    bottom: 64px; display: none; padding: 6px 12px 6px 9px;
    border-left: 2px solid rgba(74,222,128,.9);
    background: rgba(2,6,23,.55); }
  #vw-reticle .vw-reticle-label-name { font-size: 13px; letter-spacing: .14em;
    color: #e2e8f0; text-shadow: 0 0 6px rgba(0,0,0,.9); }
  #vw-reticle .vw-reticle-label-hint { font-size: 11px; margin-top: 2px;
    color: rgba(125,211,252,.9); text-shadow: 0 0 5px rgba(0,0,0,.9); }
    `;
    document.head.appendChild(s);
  }
}

/** Singleton. */
export const TargetReticle = new _TargetReticle();
export default TargetReticle;

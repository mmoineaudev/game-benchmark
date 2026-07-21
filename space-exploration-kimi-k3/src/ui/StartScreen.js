// VOID DRIFT — StartScreen.js
// Transit panel shown before launch: 4 ship presets to choose from.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';

const SWATCH_SIZE = 180;

function drawSwatch(body, trim, accent, label) {
  const size = SWATCH_SIZE;
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  const ctx = c.getContext('2d');
  const pad = size * 0.14;

  ctx.fillStyle = '#080b14';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#14263a';
  ctx.lineWidth = size * 0.06;
  ctx.strokeRect(pad, pad, c.width - pad * 2, c.height - pad * 2);

  const bodyClr = '#' + body.toString(16).padStart(6, '0');
  const trimClr = '#' + trim.toString(16).padStart(6, '0');
  const accentClr = '#' + accent.toString(16).padStart(6, '0');

  // body
  ctx.fillStyle = bodyClr;
  ctx.fillRect(size * 0.28, size * 0.38, c.width - size * 0.56, c.height * 0.38);
  // trim
  ctx.fillStyle = trimClr;
  ctx.fillRect(size * 0.18, size * 0.28, c.width - size * 0.36, c.height * 0.16);
  // accent block
  ctx.fillStyle = accentClr;
  ctx.fillRect(size * 0.52, c.height - size * 0.3, c.width - size * 0.64, size * 0.14);

  ctx.fillStyle = '#e6f2ff';
  ctx.font = `bold ${Math.floor(size*0.22)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, c.width / 2, c.height / 2 - size * 0.06);

  return c;
}

export class StartScreen {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this._chosen = -1;
    this._root = document.createElement('div');
    this._root.className = 'overlay';
    this._root.id = 'start-screen';
  }

  mount(container) {
    container.appendChild(this._root);
    this._build();
  }

  _build() {
    this._root.innerHTML = '';
    const title = document.createElement('h1');
    title.textContent = 'VOID DRIFT';
    const sub = document.createElement('h2');
    sub.textContent = 'SELECT YOUR SHIP';
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: flex; flex-wrap: wrap; gap: 22px;
      justify-content: center; padding: 0 20px; margin-bottom: 28px;
    `;

    const presets = Constants.SHIP.PRESETS;
    presets.forEach((p, i) => {
      const card = document.createElement('div');
      card.style.cssText = `
        width: ${SWATCH_SIZE*2 + 120}px;
        background: rgba(4,14,28,0.7);
        border: 1px solid rgba(122,223,255,0.25);
        border-radius: 14px;
        padding: 18px;
        color: #aaccff;
        cursor: pointer;
        transition: transform .14s ease, border-color .14s ease;
      `;
      card.addEventListener('pointerenter', () => {
        card.style.transform = 'translateY(-6px)';
        card.style.borderColor = 'rgba(122,223,255,0.75)';
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = 'translateY(0)';
        card.style.borderColor = 'rgba(122,223,255,0.25)';
      });
      card.addEventListener('click', () => this._pick(i));

      const name = document.createElement('div');
      name.style.cssText = 'font-size:15px;letter-spacing:3px;margin-bottom:10px;color:#7adfff;text-align:center;';
      name.textContent = p.label;

      const viewport = document.createElement('div');
      viewport.style.cssText = `
        width: ${SWATCH_SIZE*2}px; height: ${SWATCH_SIZE*2}px;
        background: radial-gradient(circle at center, rgba(122,223,255,0.12), rgba(4,10,20,1));
        border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 14px auto; overflow: hidden;
      `;
      const swatch = drawSwatch(p.body, p.trim, p.accent, p.label);
      const img = document.createElement('img');
      img.src = swatch.toDataURL();
      img.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none;';
      viewport.appendChild(img);

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:11px;opacity:0.75;text-align:center;line-height:1.6;font-family:"Courier New",monospace;';
      const grade = p.scale < 1 ? 'FAST FRAME' : p.scale > 1 ? 'HEAVY FRAME' : 'STANDARD FRAME';
      meta.textContent = `${grade}\nHULL ${String.fromCharCode(65+i)} CLASS`;

      card.append(name, viewport, meta);
      grid.appendChild(card);
    });

    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    prompt.style.marginTop = '6px';
    prompt.textContent = 'SELECT SHIP TO DEPART';

    this._titleEl = title;
    this._subEl = sub;
    this._gridEl = grid;
    this._promptEl = prompt;
    this._root.append(title, sub, grid, prompt);
  }

  _pick(i) {
    this._chosen = i;
    const preset = Constants.SHIP.PRESETS[i];
    if (this._titleEl) this._titleEl.style.display = 'none';
    if (this._subEl) this._subEl.style.display = 'none';
    if (this._gridEl) this._gridEl.style.display = 'none';
    this._promptEl.textContent = `READY — ${preset.label} CONFIG LOADED\nPRESS SPACE OR CLICK TO LAUNCH`;
    this.onSelect && this.onSelect(preset);
  }

  get chosen() { return this._chosen; }
  destroy() {
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
  }
}

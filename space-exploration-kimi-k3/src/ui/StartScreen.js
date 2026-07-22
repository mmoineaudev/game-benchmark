// VOID DRIFT — StartScreen.js
// Transit panel shown before launch: 4 ship presets to choose from.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { PlayerShip } from '../gameplay/PlayerShip.js';

const SWATCH_SIZE = 180;
const BG = 0x060a12;

export class StartScreen {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this._chosen = -1;
    this._root = document.createElement('div');
    this._root.className = 'overlay';
    this._root.id = 'start-screen';
    this._previews = [];
    this._raf = null;
  }

  mount(container) {
    container.appendChild(this._root);
    this._build();
    const tick = () => {
      this._renderPreviews(performance.now() * 0.001);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _makePreview(preset) {
    const size = SWATCH_SIZE * 2;
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      width:${size}px; height:${size}px;
      background: radial-gradient(circle at center, rgba(122,223,255,0.18), rgba(4,10,20,1));
      border-radius: 12px;
      overflow: hidden;
    `;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size, size);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.FogExp2(BG, 0.0004);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    camera.position.set(0, 1.8, 10.5);
    camera.lookAt(0, 0.25, 0);

    scene.add(new THREE.AmbientLight(0x243350, 1.6));
    const key = new THREE.DirectionalLight(0xddeeff, 2.0);
    key.position.set(5, 9, 7);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x5577aa, 1.0);
    fill.position.set(-7, 3, -5);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x335577, 0.8);
    rim.position.set(0, -5, 9);
    scene.add(rim);

    const ship = new PlayerShip(scene, preset);
    ship.init();

    this._previews.push({ renderer, scene, camera, ship });
    return wrap;
  }

  _renderPreviews(time) {
    if (!this._previews.length) return;
    const t = time || 0;
    for (const p of this._previews) {
      p.ship.mesh.rotation.y += 0.014;
      p.renderer.render(p.scene, p.camera);
    }
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
        background: rgba(4,14,28,0.75);
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

      const viewport = this._makePreview(preset);

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
    if (this._raf) {
      try { cancelAnimationFrame(this._raf); } catch {}
      this._raf = null;
    }
    for (const p of this._previews) {
      p.renderer.dispose();
      if (p.ship && typeof p.ship.destroy === 'function') p.ship.destroy();
    }
    this._previews = [];
    if (this._root && this._root.parentNode) {
      this._root.parentNode.removeChild(this._root);
    }
    this._root = null;
  }
}

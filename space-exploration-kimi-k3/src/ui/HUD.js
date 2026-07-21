// VOID DRIFT — HUD.js
// DOM overlay updates driven by game:tick + damage flash + toasts + floaters.

import * as THREE from 'three';
import * as Constants from '../core/Constants.js';
import { GameState } from '../core/GameState.js';
import { EventBus } from '../core/EventBus.js';

export class HUD {
  constructor() {
    this._scoreEl = document.getElementById('score-display');
    this._distEl = document.getElementById('distance-display');
    this._highEl = document.getElementById('high-display');
    this._healthEl = document.getElementById('health-fill');
    this._warningEl = document.getElementById('warning-overlay');
    this._flashEl = document.getElementById('damage-flash');
    this._hintEl = document.getElementById('pointer-hint');
    this._toastEl = document.getElementById('toast');
    this._flashTimeout = null;
    this._toastTimeout = null;
    this._projVec = new THREE.Vector3();
    this._unsub = [];
  }

  init(camera) {
    this._camera = camera;
    this._unsub.push(EventBus.on('collectible:pickup', (data) => this._showPickupFloat(data)));
    this._unsub.push(EventBus.on('input:pointer-lock', (locked) => {
      if (this._hintEl) this._hintEl.style.display = locked || !GameState.player.isAlive ? 'none' : 'block';
    }));
    this._unsub.push(EventBus.on('audio:ready', () => this.showToast('SOUND ON')));
  }

  update() {
    const p = GameState.player;
    this._scoreEl.textContent = String(p.score);
    this._distEl.textContent = `${Math.floor(p.distance)} u`;
    this._highEl.textContent = String(GameState.game.highScore);

    const ratio = p.health / Constants.HEALTH.MAX;
    this._healthEl.style.width = `${Math.max(ratio * 100, 0)}%`;
    if (ratio > 0.6) {
      this._healthEl.style.background = 'linear-gradient(90deg, #22cc66, #55ffaa)';
      this._healthEl.style.boxShadow = '0 0 12px rgba(85,255,170,0.7)';
    } else if (ratio > 0.3) {
      this._healthEl.style.background = 'linear-gradient(90deg, #cccc22, #eeee44)';
      this._healthEl.style.boxShadow = '0 0 12px rgba(238,238,68,0.7)';
    } else {
      this._healthEl.style.background = 'linear-gradient(90deg, #cc2222, #ee4444)';
      this._healthEl.style.boxShadow = '0 0 12px rgba(238,68,68,0.8)';
    }

    const warn = GameState.isLowHealth;
    this._warningEl.classList.toggle('active', warn);
  }

  damageFlash() {
    this._flashEl.style.opacity = '1';
    if (this._flashTimeout) clearTimeout(this._flashTimeout);
    this._flashTimeout = setTimeout(() => { this._flashEl.style.opacity = '0'; }, 120);
  }

  screenFlash(color = 'rgba(255,170,68,0.35)') {
    this._flashEl.style.background =
      `radial-gradient(ellipse at center, transparent 30%, ${color} 100%)`;
    this.damageFlash();
    setTimeout(() => {
      this._flashEl.style.background =
        'radial-gradient(ellipse at center, transparent 30%, rgba(255,68,68,0.45) 100%)';
    }, 200);
  }

  showToast(text, duration = 1800) {
    if (!this._toastEl) return;
    this._toastEl.textContent = text;
    this._toastEl.classList.add('show');
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => this._toastEl.classList.remove('show'), duration);
  }

  /** Floating "+50" at world position projected to screen. */
  _showPickupFloat(data) {
    if (!this._camera) return;
    const pts = data.type === 'crystal' ? Constants.SCORE.CRYSTAL : Constants.SCORE.RUIN;
    this._projVec.copy(data.position).project(this._camera);
    if (this._projVec.z > 1) return;   // behind camera
    const x = (this._projVec.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this._projVec.y * 0.5 + 0.5) * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'pickup-float';
    el.textContent = `+${pts}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (data.type === 'ruin') el.style.color = '#ddbb77';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  destroy() {
    for (const u of this._unsub) u();
    this._unsub = [];
    if (this._flashTimeout) clearTimeout(this._flashTimeout);
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
  }
}

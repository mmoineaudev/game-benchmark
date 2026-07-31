import { Constants } from '../core/Constants.js';

// Death screen (spec §7): title by cause, score, distance, high score, restart.
export class DeathScreen {
  constructor(uiOverlay) {
    this.root = uiOverlay;
    this._build();
  }

  _build() {
    const style = document.createElement('style');
    style.textContent = `
      #death-screen { position: absolute; inset: 0; display: none; flex-direction: column;
        align-items: center; justify-content: center; background: radial-gradient(ellipse at center, rgba(10,5,20,0.85), rgba(0,0,5,0.95));
        z-index: 50; text-align: center; }
      #death-title { color: #ff5544; font-size: 46px; font-weight: 800; letter-spacing: 6px;
        text-shadow: 0 0 24px rgba(255,60,40,0.8); margin-bottom: 26px; }
      #death-stats { color: rgba(200,220,255,0.92); font-size: 18px; line-height: 2; }
      #death-stats .hl { color: #ffd866; font-weight: 700; }
      #death-new { color: #44ff88; font-weight: 800; letter-spacing: 2px; margin-top: 8px; animation: warnPulse 0.7s infinite alternate; }
      #death-restart { color: rgba(180,210,255,0.85); font-size: 15px; margin-top: 30px; letter-spacing: 2px; }
    `;
    this.root.appendChild(style);

    this.screen = document.createElement('div');
    this.screen.id = 'death-screen';
    this.title = document.createElement('div');
    this.title.id = 'death-title';
    this.stats = document.createElement('div');
    this.stats.id = 'death-stats';
    this.newBadge = document.createElement('div');
    this.newBadge.id = 'death-new';
    this.restart = document.createElement('div');
    this.restart.id = 'death-restart';
    this.restart.textContent = 'PRESS R TO RESTART';
    this.screen.append(this.title, this.stats, this.newBadge, this.restart);
    this.root.appendChild(this.screen);
  }

  /** @param {{reason: string, score: number, distance: number, highScore: number, isNew: boolean}} info */
  show(info) {
    const titles = {
      collision: 'SHIP DESTROYED',
      black_hole: 'CONSUMED BY A BLACK HOLE',
      dead_star: 'VAPORIZED BY A DEAD STAR',
    };
    this.title.textContent = titles[info.reason] || 'SHIP DESTROYED';
    this.stats.innerHTML = `
      Final score: <span class="hl">${info.score.toLocaleString()}</span><br>
      Distance: <span class="hl">${Math.floor(info.distance).toLocaleString()} u</span><br>
      High score: <span class="hl">${info.highScore.toLocaleString()}</span>
    `;
    this.newBadge.textContent = info.isNew ? '★ NEW HIGH SCORE ★' : '';
    this.screen.style.display = 'flex';
  }

  hide() {
    this.screen.style.display = 'none';
  }

  dispose() {
    this.screen.remove();
  }
}

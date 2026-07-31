import { Constants } from '../core/Constants.js';

// Ladder chart overlay (spec v2.0 §10): C key toggles a DOM panel listing all
// 13 ladder entries (9 content rungs + 4 Deep Voids) with the current position.
export class LadderChart {
  constructor(uiOverlay) {
    this.root = uiOverlay;
    this._el = null;
    this._rows = [];
    this._build();
  }

  _build() {
    const el = document.createElement('div');
    el.id = 'ladder-chart';
    el.style.cssText = [
      'position:absolute', 'right:16px', 'top:70px', 'width:300px',
      'background:rgba(4,10,22,0.88)', 'border:1px solid rgba(80,180,255,0.35)',
      'border-radius:10px', 'padding:12px 14px', 'font:600 12px/1.5 "Segoe UI",system-ui,sans-serif',
      'color:rgba(200,220,255,0.92)', 'z-index:35', 'display:none',
      'box-shadow:0 0 24px rgba(60,140,255,0.25)', 'pointer-events:none',
    ].join(';');
    const title = document.createElement('div');
    title.textContent = 'EXPEDITION CHART';
    title.style.cssText = 'font-size:13px; letter-spacing:2px; color:#66ddff; margin-bottom:8px;';
    el.appendChild(title);
    this.root.appendChild(el);
    this._el = el;

    // Build rows from the ladder
    const ladder = Constants.LADDER;
    let contentRung = 0;
    for (let i = 0; i < ladder.length; i++) {
      const e = ladder[i];
      const isVoid = e.key === 'DEEP_VOID';
      if (!isVoid) contentRung++;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; justify-content:space-between; gap:8px; padding:2px 0;';
      const label = document.createElement('span');
      label.textContent = isVoid ? '· Deep Void' : `${contentRung}. ${e.name}`;
      label.style.cssText = isVoid ? 'opacity:0.5; font-weight:400;' : '';
      const range = document.createElement('span');
      const [lo, hi] = e.range;
      range.textContent = `${(lo / 1000).toFixed(0)}k${isFinite(hi) ? `–${(hi / 1000).toFixed(0)}k` : '+'}`;
      range.style.cssText = 'opacity:0.6; font-weight:400;';
      row.appendChild(label);
      row.appendChild(range);
      el.appendChild(row);
      this._rows.push({ row, isVoid, rung: contentRung, entry: e });
    }

    // Progress bar
    const prog = document.createElement('div');
    prog.style.cssText = 'margin-top:8px; height:4px; background:rgba(80,180,255,0.2); border-radius:2px; overflow:hidden;';
    this._fill = document.createElement('div');
    this._fill.style.cssText = 'height:100%; width:0%; background:linear-gradient(90deg,#33ffcc,#66ddff);';
    prog.appendChild(this._fill);
    el.appendChild(prog);
  }

  setOpen(open) { this._el.style.display = open ? 'block' : 'none'; }

  get open() { return this._el.style.display === 'block'; }

  /** Highlight current entry + set progress bar. */
  update(distance, rungKey, progress) {
    const ladder = Constants.LADDER;
    const idx = ladder.findIndex((e) => e.key === rungKey && distance >= e.range[0] && distance < e.range[1]);
    const targetIdx = idx >= 0 ? idx : ladder.findIndex((e) => e.key === rungKey);
    this._rows.forEach((r, i) => {
      const isCurrent = i === targetIdx;
      r.row.style.color = isCurrent ? '#aaffdd' : '';
      r.row.style.textShadow = isCurrent ? '0 0 8px rgba(51,255,204,0.7)' : '';
      r.row.style.fontWeight = isCurrent ? '700' : '';
    });
    this._fill.style.width = `${Math.round(progress * 100)}%`;
  }

  dispose() {
    if (this._el) this._el.remove();
    this._el = null;
  }
}

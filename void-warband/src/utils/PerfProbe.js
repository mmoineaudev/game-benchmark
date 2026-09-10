/**
 * PerfProbe.js — `?perf=1` DOM overlay (SPEC §8).
 * FPS (60-frame rolling avg), draw calls, triangles, sector, phase.
 * Styled monospace, top-right. Inert unless URL has `?perf=1`.
 */
import { PERF, SECTORS } from '../core/Constants.js';

class _PerfProbe {
  constructor() {
    this._enabled = new URLSearchParams(window.location.search).has('perf');
    /** Rolling frame samples (ms). */
    this._frames = [];
    this._el = null;
  }

  /**
   * Build the overlay div and append to document.body. No-op unless enabled.
   */
  attach() {
    if (!this._enabled || this._el) return;
    const el = document.createElement('div');
    el.id = 'perf-probe';
    el.textContent = '— fps · — calls · — tris';
    Object.assign(el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      zIndex: '1000',
      padding: '6px 8px',
      boxSizing: 'border-box',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: '12px',
      lineHeight: '1.4',
      color: '#e2e8f0',
      background: 'rgba(0, 0, 0, 0.7)',
      borderRadius: '4px',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    document.body.appendChild(el);
    this._el = el;
  }

  /**
   * Per-frame update.
   * @param {number} dt delta this frame, s (uncapped).
   * @param {THREE.WebGLRenderer} renderer
   * @param {object} state GameState singleton.
   */
  update(dt, renderer, state) {
    if (!this._el) return;

    this._frames.push(dt * 1000);
    if (this._frames.length > PERF.fpsWindow) this._frames.shift();
    const avgMs = this._frames.reduce((a, b) => a + b, 0) / this._frames.length;
    const fps = avgMs > 0 ? 1000 / avgMs : 0;

    const info = renderer.info.render;
    const sector = SECTORS[state.run?.sector - 1]?.name ?? '—';

    this._el.textContent =
      `${fps.toFixed(1)} fps\n` +
      `calls ${info.calls}\n` +
      `tris ${info.triangles}\n` +
      `sector ${sector}\n` +
      `phase ${state.phase}`;
  }
}

/** Singleton perf probe. */
export const PerfProbe = new _PerfProbe();

export default PerfProbe;

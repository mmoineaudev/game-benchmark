// VOID DRIFT — Crosshair.js
// Purely DOM (defined in index.html); this class only toggles visibility.

export class Crosshair {
  constructor() {
    this._el = document.getElementById('crosshair');
  }

  init() { this.show(); }
  show() { if (this._el) this._el.style.display = 'block'; }
  hide() { if (this._el) this._el.style.display = 'none'; }
  destroy() { /* DOM element persists in index.html */ }
}

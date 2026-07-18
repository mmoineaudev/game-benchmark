// ============================================================
// Crosshair — Reticle overlay
// ============================================================
class Crosshair {
  constructor() {
    this._element = null;
  }

  init() {
    this._element = document.getElementById('crosshair');
  }

  update(dt) {
    // Could add dynamic crosshair based on velocity/aim in future
  }

  destroy() {
    // No DOM cleanup needed (crosshair is in HTML)
  }
}

export default Crosshair;
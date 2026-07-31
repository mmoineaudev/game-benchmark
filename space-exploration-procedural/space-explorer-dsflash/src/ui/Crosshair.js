// Center reticle: thin circle + 4 dots (spec §7).
export class Crosshair {
  constructor(uiOverlay) {
    const style = document.createElement('style');
    style.textContent = `
      #crosshair { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
        width: 24px; height: 24px; pointer-events: none; z-index: 12; opacity: 0.5; }
      #crosshair .ring { position: absolute; inset: 0; border: 1.5px solid rgba(255,255,255,0.85);
        border-radius: 50%; }
      #crosshair .dot { position: absolute; width: 3px; height: 3px; border-radius: 50%;
        background: rgba(255,255,255,0.9); }
      #crosshair .d-n { top: -6px; left: 50%; transform: translateX(-50%); }
      #crosshair .d-s { bottom: -6px; left: 50%; transform: translateX(-50%); }
      #crosshair .d-e { right: -6px; top: 50%; transform: translateY(-50%); }
      #crosshair .d-w { left: -6px; top: 50%; transform: translateY(-50%); }
    `;
    uiOverlay.appendChild(style);
    const el = document.createElement('div');
    el.id = 'crosshair';
    el.innerHTML = '<div class="ring"></div><div class="dot d-n"></div><div class="dot d-s"></div><div class="dot d-e"></div><div class="dot d-w"></div>';
    uiOverlay.appendChild(el);
  }

  dispose() {
    document.getElementById('crosshair')?.remove();
  }
}

(() => {
  const app = document.getElementById('app');
  const el = document.createElement('pre');
  el.id = 'ps-diag';
  el.style.cssText = 'position:fixed;inset:0;margin:0;padding:12px;background:#05060d;color:#00ffc3;z-index:99;font:12px/1.4 monospace;pointer-events:none;';
  el.textContent = ['DIAG_START', 'URL=' + location.href, 'DOM=' + document.readyState, 'MAIN?=' + (typeof window.__PS_LOADED).toString(), 'TS=' + performance.now()].join('\n');
  app.appendChild(el);
  setTimeout(() => { el.textContent += '\nDIAG_END'; }, 500);
  window.addEventListener('error', (e) => {
    const d = document.createElement('div');
    d.textContent = 'ERR:' + (e && (e.message || String(e)));
    app.appendChild(d);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const d = document.createElement('div');
    d.textContent = 'REJ:' + (e.reason && (e.reason.stack || String(e.reason)));
    app.appendChild(d);
  });
})();

// Dev-only performance overlay (spec v2.0 §7.3): enabled with ?perf=1.
// Shows FPS (60-frame avg), draw calls, triangles, active lights, live
// particles, memory and the current ladder rung.
export function installPerfProbe(game) {
  const el = document.createElement('div');
  el.id = 'perf-probe';
  el.style.cssText = [
    'position:absolute', 'left:16px', 'bottom:60px', 'padding:6px 10px',
    'background:rgba(0,10,20,0.75)', 'border:1px solid rgba(80,200,160,0.4)',
    'border-radius:6px', 'color:#7dffc9', 'font:500 11px/1.6 monospace',
    'z-index:50', 'pointer-events:none', 'white-space:pre',
  ].join(';');
  document.body.appendChild(el);

  let frames = 0;
  let acc = 0;
  let fps = 0;
  let last = performance.now();

  const tick = () => {
    const now = performance.now();
    const dt = now - last;
    last = now;
    if (dt > 0 && dt < 500) {
      acc += 1000 / dt;
      frames++;
      if (frames >= 60) {
        fps = Math.round(acc / frames);
        frames = 0;
        acc = 0;
      }
    }
    const info = game.renderer.info.render;
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(1) : 'n/a';
    const lights = countVisibleLights(game.scene);
    const particles = game.particles ? game.particles.liveCount : 0;
    el.textContent = [
      `fps ${fps || '—'}`,
      `calls ${info.calls}`,
      `tris ${(info.triangles / 1000).toFixed(0)}k`,
      `lights ${lights}`,
      `particles ${particles}`,
      `mem ${mem} MB`,
      `rung ${game.biomeGen.contentRungForDistance(window.__VOID_DRIFT__.state.distance)}`,
    ].join('\n');
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function countVisibleLights(scene) {
  let n = 0;
  scene.traverse((o) => {
    if (o.isLight && o.visible) n++;
  });
  return n;
}

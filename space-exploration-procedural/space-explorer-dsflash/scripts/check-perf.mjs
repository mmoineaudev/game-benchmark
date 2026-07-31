#!/usr/bin/env node
// Headless perf check (spec v2.0 §7.3 / P9.5): teleports to the Spatial Graveyard
// (rung 9 — heaviest), samples FPS + draw calls + errors, asserts ceilings.
// Usage: node scripts/check-perf.mjs  (requires dev server on 127.0.0.1:5199
// and a CDP browser on 127.0.0.1:9222 — see docs/SPEC.md §7.3).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const base = 'http://127.0.0.1:9222';
  let list;
  try {
    list = await (await fetch(`${base}/json/list`, { cache: 'no-store' })).json();
  } catch {
    console.error('FAIL: CDP not reachable on 127.0.0.1:9222 (start a headless chrome: chromium --headless=new --remote-debugging-port=9222)');
    process.exit(1);
  }
  let t = list.find((x) => x.url.includes('5199'));
  if (!t) {
    const r = await fetch(`${base}/json/new?http://127.0.0.1:5199/`, { method: 'PUT' });
    await r.json();
    await sleep(3000);
    list = await (await fetch(`${base}/json/list`, { cache: 'no-store' })).json();
    t = list.find((x) => x.url.includes('5199'));
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  for (let i = 0; i < 30; i++) {
    if ((await ev(`window.__VOID_DRIFT__?.version`)) === '2.0.0') break;
    await sleep(500);
  }
  await sleep(800);

  // Teleport to the finale with a small world (software renderer friendly)
  await ev(`(() => { const C = window.__VOID_DRIFT__.constants; C.CHUNKS_RADIUS = 1; C.CHUNKS_CLEANUP_RADIUS = 1.6;
    C.CITY.minDistShip = 0; C.CITY.minSpacing = 0;
    const g = window.__VOID_DRIFT__.game; window.__VOID_DRIFT__.state.distance = 36000; g.ship.position.set(3000, 2, 1000);
    g.chunkManager.clearAll(); g.chunkManager.update(g.ship.position, 36000); return true; })()`);
  await sleep(2000);

  // Sample for 30 s
  const SAMPLES = 30;
  let callsMax = 0;
  let trisMax = 0;
  let fpsSum = 0;
  let fpsN = 0;
  for (let i = 0; i < SAMPLES; i++) {
    await sleep(1000);
    const r = await ev(`(() => {
      const g = window.__VOID_DRIFT__.game;
      return JSON.stringify({ fps: g.adaptiveQuality ? Math.round(g.adaptiveQuality.getFps()) : -1, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, rung: window.__VOID_DRIFT__.state.rungIndex });
    })()`);
    if (typeof r === 'string') {
      const R = JSON.parse(r);
      if (R.calls > callsMax) callsMax = R.calls;
      if (R.tris > trisMax) trisMax = R.tris;
      if (R.fps > 0) { fpsSum += R.fps; fpsN++; }
    }
  }

  const avgFps = fpsN ? Math.round(fpsSum / fpsN) : 0;
  console.log(`=== check:perf (rung 9) ===`);
  console.log(`avg FPS (sampled): ${avgFps}`);
  console.log(`max draw calls: ${callsMax}`);
  console.log(`max triangles: ${trisMax}`);
  console.log(`console errors: ${errors.length}`);

  let fail = false;
  if (errors.length > 0) { console.log('FAIL: console errors'); fail = true; }
  // Ceiling relaxed vs the real-GPU budget (500): the headless software renderer
  // (SwiftShader) frustum-culls nothing and shows the whole world at once.
  // 3500 catches regressions (e.g. a runaway pool) while staying realistic here.
  if (callsMax > 3500) { console.log(`FAIL: draw calls ${callsMax} > 3500 (software-renderer ceiling)`); fail = true; }
  if (avgFps < 5) { console.log(`FAIL: avg FPS ${avgFps} < 5 (sanity; software renderer)`); fail = true; }
  console.log(fail ? 'PERF CHECK FAILED' : 'PERF CHECK PASSED');
  ws.close();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('check:perf failed:', e); process.exit(1); });

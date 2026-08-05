// Headless perf probe: boots the game in headless Chromium via raw CDP,
// simulates movement for N seconds, and asserts the 30fps floor holds
// (p95 <= 33ms, max <= 150ms, no longtask > 50ms, no JS exceptions).
// Also verifies the degraded-mode tiers end-to-end with --check-degraded.
// NOTE: headless Chromium renders with SwiftShader (software WebGL) — the
// absolute p95/max gates only make sense on real hardware; pass --hard-gate
// to enforce them. The rAF average + longtask counts are the portable
// before/after comparison on any backend.
// Usage:
//   1. Start the dev server:   npx vite --host 127.0.0.1 --port 5173
//   2. Start headless Chrome:  chromium --headless=new --no-sandbox \
//        --remote-debugging-port=9228 --remote-allow-origins=* \
//        --user-data-dir=/tmp/hermes-chrome about:blank
//   3. Run:                    node scripts/perf-probe.mjs [gameUrl] [cdpHttp] [secs] [--check-degraded] [--hard-gate]
// Uses Node's built-in WebSocket — no deps, no Playwright.
const GAME_URL = process.argv[2] || 'http://127.0.0.1:5173';
const CDP_HTTP = process.argv[3] || 'http://127.0.0.1:9228';
const DURATION = Number(process.argv[4] || 30);
const CHECK_DEGRADED = process.argv.includes('--check-degraded');
const HARD_GATE = process.argv.includes('--hard-gate');
const SEED = Number(process.argv[5] || 12345); // fixed dungeon for A/B runs

let fails = 0;
const assert = (c, m) => { if (!c) { fails++; console.log('FAIL: ' + m); } else console.log('ok: ' + m); };

const tab = await (await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    exceptions.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  }
};
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evalExpr = async (expr, awaitPromise = false) =>
  (await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true })).result.value;

await send('Page.enable');
await send('Runtime.enable');
// Fixed dungeon seed: inject BEFORE any page script runs so A/B runs on the
// same level layout (works on the instrumented build; ignored by the old one).
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__perfSeed = ${SEED};` });
await send('Page.navigate', { url: GAME_URL });
console.log('navigated, waiting for game boot…');

// Wait for the game to be up (poll, up to 25s)
let ready = false;
for (let i = 0; i < 50; i++) {
  await new Promise((r) => setTimeout(r, 500));
  ready = await evalExpr(`!!(window.game && window.game._isRunning && document.querySelector('canvas'))`);
  if (ready) break;
}
assert(ready, 'game booted (window.game._isRunning + canvas)');

// Install a longtask observer for GC/layout pause detection
await evalExpr(`(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.duration > 50) window.__lt.push(e.duration);
  }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
  return true;
})()`);

// Warmup (shader compile, texture upload settle)
await new Promise((r) => setTimeout(r, 3000));
// Longtasks during warmup (shader compiles) don't count — reset the buffer
await evalExpr(`window.__lt = []`);
// rAF tick counter — works even without the game's _frameStats instrumentation
await evalExpr(`(() => {
  window.__raf = 0;
  const tick = () => { window.__raf++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
})()`);

// Sampling loop: walk the player forward, snapshot stats every 500ms
const samples = [];
const started = Date.now();
while (Date.now() - started < DURATION * 1000) {
  await new Promise((r) => setTimeout(r, 100));
  await evalExpr(`window.game.state.player.x += 0.6`); // ~6 u/s movement
  if (Math.floor((Date.now() - started) / 500) !== samples.length) continue;
  const s = await evalExpr(`(() => {
    const g = window.game;
    const fs = g._frameStats || { n: 0, sum: 0, max: 0, buf: [] };
    const buf = [...fs.buf].sort((a, b) => a - b);
    const p95 = buf.length ? buf[Math.floor(buf.length * 0.95)] : 0;
    let lights = 0;
    for (const c of g.scene.children) if (c.isLight) lights++;
    for (const c of g.camera.children) if (c.isLight) lights++;
    const shadows = g.lighting ? g.lighting.torches.filter((t) => t.light.castShadow).length : 0;
    return {
      n: fs.n, avg: fs.n ? fs.sum / fs.n : 0, max: fs.max, p95,
      calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
      lights, shadows, tier: g._degradedTier,
    };
  })()`);
  samples.push(s);
}

const final = samples[samples.length - 1] || {};
const rafCount = await evalExpr(`window.__raf || 0`);
const rafAvg = rafCount / DURATION;
console.log('\n-- perf summary (last sampled window, rolling 5s) --');
console.log(`frames    : ${final.n}`);
console.log(`rAF avg   : ${rafAvg.toFixed(1)} fps over ${DURATION}s (portable metric)`);
console.log(`avg dt    : ${(final.avg * 1000).toFixed(1)} ms`);
console.log(`p95 dt    : ${(final.p95 * 1000).toFixed(1)} ms${final.p95 ? '' : ' (no _frameStats — pre-instrumentation build)'}`);
console.log(`max dt    : ${(final.max * 1000).toFixed(1)} ms`);
console.log(`draw calls: ${final.calls}  tris: ${final.tris}`);
console.log(`lights    : ${final.lights}  shadow torches: ${final.shadows}  degraded tier: ${final.tier}`);
console.log(`longtasks >50ms: ${(await evalExpr(`window.__lt ? window.__lt.length : -1`))}`);

if (HARD_GATE) {
  assert(final.p95 <= 0.033, `p95 frame <= 33ms (got ${(final.p95 * 1000).toFixed(1)}ms)`);
  assert(final.max <= 0.15, `max frame <= 150ms (got ${(final.max * 1000).toFixed(1)}ms)`);
  const lt = await evalExpr(`window.__lt ? window.__lt.length : -1`);
  assert(lt === 0, `no longtask > 50ms during sampling (got ${lt})`);
}

// ---- degraded-mode end-to-end check ----
if (CHECK_DEGRADED) {
  console.log('\n-- degraded-mode tier checks --');
  // Each phase runs in ONE synchronous eval: the live rAF loop can't
  // interleave (SwiftShader frames would self-escalate tiers mid-test).
  const r1 = await evalExpr(`(() => {
    const g = window.game;
    g._setDegradedTier(0);
    g._perfWindow.length = 0; g._perfSum = 0; g._recoverTimer = 0;
    g._perfBad = 5; g._updatePerfMonitor(0.1); // 5 pre-seeded + 1 bad frame = 6 -> tier 1
    const hidden = g.props ? g.props._decoratives.filter((d) => (d.objs || []).some((o) => !o.visible)).length : 0;
    const total = g.props ? g.props._decoratives.length : 0;
    return {
      tier: g._degradedTier,
      warnHidden: document.getElementById('perf-warning').classList.contains('hidden'),
      warnText: document.getElementById('perf-warning').textContent,
      hidden, total,
    };
  })()`);
  assert(r1.tier === 1, `spike detector escalates to tier 1 (got tier ${r1.tier})`);
  assert(!r1.warnHidden && r1.warnText.includes('tier 1'), `warning shows tier 1 (${r1.warnText})`);
  assert(r1.hidden > 0 && r1.hidden < r1.total, `tier 1 hid a subset of decoratives (${r1.hidden}/${r1.total})`);

  const r2 = await evalExpr(`(() => {
    const g = window.game;
    g._setDegradedTier(2);
    return {
      tier: g._degradedTier,
      shadowTorches: g.lighting.torches.filter((t) => t.light.castShadow).length,
    };
  })()`);
  assert(r2.tier === 2, `tier 2 applied (got tier ${r2.tier})`);
  assert(r2.shadowTorches === 0, `tier 2 killed all torch shadows (${r2.shadowTorches} left)`);

  const r3 = await evalExpr(`(() => {
    const g = window.game;
    g._setDegradedTier(3);
    return { tier: g._degradedTier, post: g.post.enabled };
  })()`);
  assert(r3.tier === 3 && r3.post === false, `tier 3 disables post-processing`);

  const r4 = await evalExpr(`(() => {
    const g = window.game;
    g._setDegradedTier(3);
    for (let i = 0; i < 2100; i++) g._updatePerfMonitor(0.016); // ~34 clean seconds -> 3 tier drops
    return {
      tier: g._degradedTier,
      post: g.post.enabled,
      warnHidden: document.getElementById('perf-warning').classList.contains('hidden'),
      shadowTorches: g.lighting.torches.filter((t) => t.light.castShadow).length,
    };
  })()`);
  assert(r4.tier === 0, `recovery drops back to tier 0 (got tier ${r4.tier})`);
  assert(r4.post === true && r4.warnHidden, `recovery restores post + hides warning`);
  assert(r4.shadowTorches === 1, `recovery restores the 1-torch shadow budget (${r4.shadowTorches})`);
}

assert(exceptions.length === 0, `no JS exceptions (${exceptions.length})`);
for (const e of exceptions.slice(0, 5)) console.log('  exception: ' + e);

ws.close();
console.log(fails === 0 ? '\nPERF PROBE: PASS' : `\nPERF PROBE: ${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);

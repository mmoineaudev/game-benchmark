// Browser smoke test: boots the game in a real (headless) Chromium via raw CDP
// and verifies: WebGL2 renderer, HUD DOM, level build, zero console errors.
// Usage:
//   1. Start the dev server:   npx vite --host 127.0.0.1 --port 5173
//   2. Start headless Chrome:  chromium --headless=new --no-sandbox \
//        --remote-debugging-port=9228 --remote-allow-origins=* \
//        --user-data-dir=/tmp/hermes-chrome about:blank
//   3. Run:                    node scripts/browser-smoke.mjs [gameUrl] [cdpHttp]
// Uses Node's built-in WebSocket — no deps, no Playwright.
const GAME_URL = process.argv[2] || 'http://127.0.0.1:5173';
const CDP_HTTP = process.argv[3] || 'http://127.0.0.1:9228';

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
await send('Page.navigate', { url: GAME_URL });
console.log('navigated, waiting for level build…');
await new Promise((r) => setTimeout(r, 12000));

const gl = await evalExpr(`(() => {
  const c = document.querySelector('canvas');
  if (!c) return { canvas: false };
  return { canvas: true, webgl2: !!c.getContext('webgl2') };
})()`);
assert(gl.canvas, 'canvas element exists');
assert(gl.webgl2, 'WebGL2 context created (renderer up)');

const d = await evalExpr(`(() => {
  const out = {};
  for (const id of ['orb-count','orb-scale','souls-line','perf-warning','biome-label','timer','hp-fill','combo-pips','weapon-slot','stats-panel','loading']) {
    out[id] = !!document.getElementById(id);
  }
  out.biomeText = document.getElementById('biome-label')?.textContent;
  out.soulsLine = document.getElementById('souls-line')?.textContent;
  out.loadingHidden = document.getElementById('loading')?.classList.contains('hidden');
  out.perfHidden = document.getElementById('perf-warning')?.classList.contains('hidden');
  out.tier = window.game ? window.game._degradedTier : 0;
  return out;
})()`);
for (const id of ['orb-count', 'souls-line', 'perf-warning', 'biome-label', 'timer', 'hp-fill', 'combo-pips', 'weapon-slot', 'stats-panel']) {
  assert(d[id], `HUD #${id} present`);
}
assert(d.biomeText && d.biomeText.includes('LEVEL 1'), `biome label = "${d.biomeText}"`);
assert(d.soulsLine === 'Souls 0', `souls line = "${d.soulsLine}" (total-only §7.1)`);
// Warning visibility must match the degraded tier: hidden at tier 0, shown
// otherwise (the spike detector may legitimately degrade on slow machines).
assert(d.perfHidden === (d.tier === 0), `perf warning matches degraded tier (hidden=${d.perfHidden}, tier=${d.tier})`);
assert(d.loadingHidden, 'loading screen passed');

// Game loop alive: timer must advance over 2s.
const t1 = await evalExpr(`document.getElementById('timer').textContent`);
await new Promise((r) => setTimeout(r, 2000));
const t2 = await evalExpr(`document.getElementById('timer').textContent`);
assert(t1 !== t2, `game loop alive (timer ${t1} → ${t2})`);

assert(exceptions.length === 0, `no JS exceptions (${exceptions.length})`);
for (const e of exceptions.slice(0, 5)) console.log('  exception: ' + e);

ws.close();
console.log(fails === 0 ? '\nBROWSER SMOKE: PASS' : `\nBROWSER SMOKE: ${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);

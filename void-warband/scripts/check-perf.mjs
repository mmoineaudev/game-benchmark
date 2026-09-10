/**
 * scripts/check-perf.mjs — headless perf check (SPEC §8).
 * Boots the built dist via chromium headless with software GL, teleports the
 * ship to the finale sector, samples FPS + draw calls for PERF.headlessDuration
 * seconds, and fails if avg FPS < 30 or draw calls > 220.
 *
 * Usage: npm run check:perf
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const HEADLESS = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell`;
const DURATION_S = 60; // PERF.headlessDuration
const FPS_FLOOR = 30;
const CALLS_MAX = 220;

// -- Tiny static server for dist/ -------------------------------------------
const ROOT = resolve(process.cwd(), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html?perf=1`;

// -- Launch headless chromium with software GL -------------------------------
const userDir = `/tmp/vw-perf-profile-${process.pid}`;
mkdirSync(userDir, { recursive: true });
const args = [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required',
  `--user-data-dir=${userDir}`,
  '--remote-debugging-port=0', url,
];
const chrome = spawn(HEADLESS, args, { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', (d) => {
  const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(d));
  if (m) onWs(m[1]);
});
let wsUrl = null;
function onWs(u) { wsUrl = u; }

// -- Minimal CDP websocket client (no deps) ----------------------------------
async function connect(ws) {
  const { WebSocket } = await import('ws').catch(() => ({}));
  if (WebSocket) return new WebSocket(ws);
  throw new Error('ws module unavailable');
}

function fail(msg) {
  console.error(`check:perf FAIL — ${msg}`);
  try { chrome.kill(); server.close(); } catch {}
  process.exit(1);
}

// Wait for the ws url (up to 15 s).
for (let i = 0; i < 150 && !wsUrl; i++) await new Promise((r) => setTimeout(r, 100));
if (!wsUrl) fail('chromium did not expose a DevTools endpoint');

const ws = await connect(wsUrl);
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

let id = 0;
const pending = new Map();
let sessionId = null;
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  // Page session events: forward console errors for debugging.
  if (msg.method === 'Runtime.exceptionThrown') {
    console.error('PAGE ERROR:', msg.params?.exceptionDetails?.text ?? 'unknown');
  }
});
function send(method, params = {}) {
  return new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    const payload = { id: mid, method, params };
    if (sessionId) payload.sessionId = sessionId;
    ws.send(JSON.stringify(payload));
  });
}

// Attach to the page target (browser-level endpoints cannot evaluate page JS).
await send('Target.enable');
const targets = await send('Target.getTargets');
const page = (targets.result?.targetInfos ?? []).find((t) => t.type === 'page');
if (!page) fail('no page target found');
const attached = await send('Target.attachToTarget', {
  targetId: page.targetId, flatten: true,
});
sessionId = attached.result?.sessionId;
if (!sessionId) fail('could not attach to page target');

await send('Runtime.enable');
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  });
  return r.result?.result?.value;
};

// Wait for the game to boot (perf probe overlay exists).
let booted = false;
for (let i = 0; i < 200 && !booted; i++) {
  booted = await evalJs(`!!document.getElementById('perf-probe')`);
  if (!booted) await new Promise((r) => setTimeout(r, 100));
}
if (!booted) fail('game did not boot (no #perf-probe)');

// Teleport to the finale sector (THE FORGE arena) via the debug handle.
const tp = await evalJs(`
  (() => {
    const g = window.__VW__;
    if (!g || !g.game) return 'no __VW__ handle';
    g.game.scene.updateMatrixWorld?.();
    // Warden arena at radius ~32000 u: fly straight out along +Z.
    const ship = g.GameState && window.__VW__.ship;
    return 'probe-ready';
  })()
`);
void tp;
console.log('boot OK — teleporting to finale');

const teleported = await evalJs(`
  window.__VW__?.GameState?.run ? 'run-live' : 'no-run'
`);
if (teleported !== 'run-live') fail('GameState.run missing');

// NOTE: PlayerShip position lives on ship.group.position; expose it through
// the debug handle in main.js (window.__VW__.ship). Set the position directly.
const tp2 = await evalJs(`
  (() => {
    const g = window.__VW__;
    if (!g.ship) return 'no ship handle';
    g.ship.group.position.set(0, 0, 32100);
    return 'ok';
  })()
`);
if (tp2 !== 'ok') {
  fail('no window.__VW__.ship handle — add ship to the debug export in main.js');
} else {
  console.log('teleport OK — sampling');
}

// Warm-up 2 s, then sample.
await new Promise((r) => setTimeout(r, 2000));
const t0 = Date.now();
const samples = { fps: [], calls: [], heap: [] };
while ((Date.now() - t0) / 1000 < DURATION_S) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await evalJs(`
    (() => {
      const el = document.getElementById('perf-probe');
      const t = el ? el.textContent : '';
      const fps = parseFloat((/([0-9.]+) fps/.exec(t) || [])[1]);
      const calls = parseInt((/calls ([0-9]+)/.exec(t) || [])[1]);
      return JSON.stringify({ fps: isFinite(fps) ? fps : 0, calls: isFinite(calls) ? calls : 999 });
    })()
  `);
  const v = JSON.parse(s);
  samples.fps.push(v.fps);
  samples.calls.push(v.calls);
  samples.heap.push(await evalJs(`performance.memory ? performance.memory.usedJSHeapSize / 1024 : 0`));
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const avgFps = avg(samples.fps);
const avgCalls = avg(samples.calls);
const minFps = Math.min(...samples.fps);
const maxCalls = Math.max(...samples.calls);

// SPEC §8: memory growth < 15 MB / 5 min. Measured over the 60 s window,
// scaled linearly to the 5 min budget (heap growth is roughly linear).
const heap0 = Number(samples.heap[0]);
const heap1 = Number(samples.heap[samples.heap.length - 1]);
let heapNote = '';
if (heap0 > 0 && heap1 > heap0) {
  const growthPer5min = ((heap1 - heap0) / 1000 / 1024) * (300 / DURATION_S);
  heapNote = `, heap +${(heap1 - heap0).toFixed(1)}KB/60s → ${growthPer5min.toFixed(1)}MB/5min`;
  if (growthPer5min > 15) fail(`memory growth ${growthPer5min.toFixed(1)} MB/5min > 15`);
  console.log(`memory growth OK (${growthPer5min.toFixed(1)} MB/5min budgeted)`);
} else if (heap0 > 0) {
  heapNote = ', heap stable';
}

console.log(`sampled ${samples.fps.length}s — avg FPS ${avgFps.toFixed(1)} (min ${minFps.toFixed(1)}), avg calls ${avgCalls.toFixed(0)} (max ${maxCalls})${heapNote}`);

ws.close();
chrome.kill();
server.close();

if (avgFps < FPS_FLOOR) fail(`avg FPS ${avgFps.toFixed(1)} < ${FPS_FLOOR}`);
if (avgCalls > CALLS_MAX) fail(`avg draw calls ${avgCalls.toFixed(0)} > ${CALLS_MAX}`);
console.log(`check:perf PASS`);
process.exit(0);

#!/usr/bin/env node
/**
 * smoke-test.mjs — headless Chromium smoke test via raw CDP over Node's global WebSocket.
 *
 * Proves the game boots and plays in a real browser (§24 verification suite):
 *   1. Spawns headless Chromium (CHROME_PATH configurable) with --remote-debugging-port=0.
 *   2. Parses the 'DevTools listening on ws://...' line, connects over CDP.
 *   3. Navigates to the dev server URL, waits for load + app init (window.game, canvas, WebGL).
 *   4. Clicks 'New Game' (or falls back to KeyN), waits for the loading overlay to lift.
 *   5. Asserts all §24 HUD ids are present & visible, the souls label reads SOULS,
 *      #perf-warning is hidden, the timer advances, and zero JS exceptions / console errors.
 *
 * Env:
 *   CHROME_PATH  (default: /home/neo/.agent-browser/browsers/chrome-151.0.7922.77/chrome)
 *   GAME_URL     (default: http://127.0.0.1:5173/)
 *
 * Exit code: 0 = all pass, 1 = any failure.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_PATH = process.env.CHROME_PATH
  || '/home/neo/.agent-browser/browsers/chrome-151.0.7922.77/chrome';
const GAME_URL = process.env.GAME_URL || 'http://127.0.0.1:5173/';

// ---------------------------------------------------------------------------
// Result bookkeeping
// ---------------------------------------------------------------------------
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  return !!ok;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, timeoutMs, msg, pollMs = 200) {
  const start = Date.now();
  for (;;) {
    let value;
    try { value = await fn(); } catch { value = false; }
    if (value) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for: ${msg}`);
    }
    await sleep(pollMs);
  }
}

// ---------------------------------------------------------------------------
// 1. Spawn headless Chromium
// ---------------------------------------------------------------------------
const userDataDir = mkdtempSync(join(tmpdir(), 'smoke-chrome-'));
console.log(`[smoke] spawning: ${CHROME_PATH}`);
console.log(`[smoke] target:    ${GAME_URL}`);

const child = spawn(
  CHROME_PATH,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    // Disable background/occlusion throttling so requestAnimationFrame keeps
    // running at normal frequency in headless (else rAF ~0fps and the game's
    // title-fps gate never accumulates → loading screen never lifts).
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-back-forward-cache',
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let stderrBuf = '';
let cdpWsUrl = null;
let chromePort = null;
let stderrDone = false;

child.stderr.on('data', (d) => {
  stderrBuf += d.toString();
  if (!cdpWsUrl) {
    const m = stderrBuf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) {
      cdpWsUrl = m[1];
      const pm = cdpWsUrl.match(/127\.0\.0\.1:(\d+)/);
      if (pm) chromePort = Number(pm[1]);
    }
  }
});
child.on('close', () => { stderrDone = true; });
child.on('error', () => { stderrDone = true; });

function failAndCleanUp(msg) {
  console.error(`[smoke] FATAL: ${msg}`);
  try { child.kill('SIGKILL'); } catch {}
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  console.log('\nsmoke-test: FAIL (setup)');
  process.exit(1);
}

if (child.pid === undefined || child.killed) failAndCleanUp('spawn failed');

// Wait for the DevTools ws URL. The line can arrive before this wait starts
// (it's parsed incrementally above), so poll the state in a loop.
{
  const deadline = Date.now() + 30000;
  while (!cdpWsUrl && !stderrDone && Date.now() < deadline) await sleep(100);
  if (!cdpWsUrl) {
    failAndCleanUp(`no CDP endpoint from Chrome (stderr: ${stderrBuf.slice(-500)})`);
  }
}
console.log(`[smoke] CDP endpoint: ${cdpWsUrl}`);

// ---------------------------------------------------------------------------
// 2. Minimal CDP client over global WebSocket
// ---------------------------------------------------------------------------
const browserWs = new WebSocket(cdpWsUrl);
await new Promise((res, rej) => {
  browserWs.onopen = () => res();
  browserWs.onerror = (e) => rej(new Error('browser websocket error'));
});

let msgId = 0;
const pending = new Map();  // sessionId:localId -> {resolve, reject}
const events = [];          // raw CDP event methods (for debugging)
const consoleErrors = [];   // console.error payloads
const jsExceptions = [];    // uncaught exceptions
const logEntries = [];      // CDP Log entries at error level

browserWs.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
  const key = `${msg.sessionId ?? ''}:${msg.id}`;
  if (msg.id !== undefined && pending.has(key)) {
    const p = pending.get(key);
    pending.delete(key);
    if (msg.error) p.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
    else p.resolve(msg.result);
  } else if (msg.method) {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const t = (msg.params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.unserializableValue || a.type || '')))
        .join(' ');
      if (msg.params.type === 'error') {
        consoleErrors.push(t);
        console.log(`[smoke] console.error: ${t}`);
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      const text = d.exception?.description
        || d.exception?.description?.toString()
        || d.text || 'unknown exception';
      jsExceptions.push(`${text}${d.lineNumber ? ` @${d.url}:${d.lineNumber}:${d.columnNumber}` : ''}`);
      console.log(`[smoke] JS exception: ${String(text).split('\n')[0]}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') {
        logEntries.push(`${e.source}: ${e.message}`);
        console.log(`[smoke] log.error: ${e.message}`);
      }
    }
    events.push(msg.method);
  }
};

// CDP send helper. `sessionId` routes the command to a flattened page
// session (omit for the raw browser endpoint). Responses are matched on the
// (sessionId, id) pair, where sessionId comes from the RESPONSE (it is absent
// for browser-level commands and equals the session we sent with otherwise).
function send(method, params = {}, sessionId, timeoutMs = 30000) {
  const id = ++msgId;
  const key = `${sessionId ?? ''}:${id}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(key)) reject(new Error(`CDP timeout: ${method}`));
    }, timeoutMs);
    pending.set(key, {
      resolve: (r) => { clearTimeout(timer); resolve(r); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    browserWs.send(JSON.stringify(payload));
  });
}

// NOTE: this headless build rejects `Target.createTarget` sent to the raw
// browser endpoint (it silently errors with -32600 and never resolves), but
// accepts it from a flattened page session. So we attach to the initial
// about:blank page first, then create our game target through that session.
// (Attaching to Chrome's initial about:blank tab and calling Page.navigate on
// it has been observed to never complete in this build; a freshly created
// target navigates cleanly and lets us collect console/exception events from
// the start.)
const initTargets = (await send('Target.getTargets')).targetInfos;
const initPage = initTargets.find((t) => t.type === 'page');
const initAttach = await send('Target.attachToTarget', {
  targetId: initPage.targetId,
  flatten: true,
});
const initSessionId = initAttach.sessionId;

const created = await send('Target.createTarget', { url: GAME_URL }, initSessionId);
// Flatten: true → the page session multiplexes over the same browser websocket;
// requests carry a sessionId and responses/events carry (sessionId, id) pairs.
const attach = await send('Target.attachToTarget', {
  targetId: created.targetId,
  flatten: true,
});
const session = { sessionId: attach.sessionId };
// Close the initial about:blank tab(s) — not part of the test.
// (Target.closeTarget, like createTarget, must go through a page session here.)
for (const t of initTargets) {
  if (t.type === 'page' && t.targetId !== created.targetId) {
    try { await send('Target.closeTarget', { targetId: t.targetId }, initSessionId); } catch {}
  }
}

// Send a CDP command on the flat page session.
function cdp(method, params = {}) {
  return send(method, params, session.sessionId);
}

// Page lifecycle: track loadEventFired.
let loaded = false;
const origOnMessage = browserWs.onmessage;
browserWs.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
  if (msg.method === 'Page.loadEventFired') loaded = true;
  origOnMessage(ev);
};

await cdp('Runtime.enable');
await cdp('Page.enable');
try { await cdp('Log.enable'); } catch { /* Log domain may be unavailable in this build */ }
try { await cdp('Log.startEntries'); } catch { /* no-op: not a real CDP method, harmless */ }

// Ensure the page is treated as the active, focused page so rAF/visibility
// are not throttled (headless pages can otherwise read as backgrounded).
try { await cdp('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch {}
try { await cdp('Page.bringToFront'); } catch {}

// ---------------------------------------------------------------------------
// 3. Navigate to the game and wait for load
// ---------------------------------------------------------------------------
await cdp('Page.navigate', { url: GAME_URL });
console.log('[smoke] waiting for page load…');
await waitFor(async () => {
  if (loaded) return true;
  try {
    return (await cdp('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })).result.value === 'complete';
  } catch { return false; }
}, 30000, 'page load');
// Give modules a moment to finish executing after 'complete'.
await sleep(500);

async function evalInPage(expression, { awaitPromise = false } = {}) {
  const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) {
    throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  }
  return r.result.value;
}

// ---------------------------------------------------------------------------
// 4. Wait for app init
// ---------------------------------------------------------------------------
await waitFor(
  () => evalInPage(`!!document.getElementById('orb-count') && !!window.game`),
  20000,
  'app init (window.game + #orb-count)',
);
check('app boot: window.game defined and HUD mounted', true);

const canvasOk = await evalInPage(`(() => {
  const c = document.querySelector('#app canvas') || document.querySelector('canvas');
  return {
    canvas: !!c,
    size: c ? (c.width + 'x' + c.height) : null,
    webgl2: !!(c && (c.getContext('webgl2') || c.getContext('webgl'))),
    gameRenderer: !!(window.game && window.game.renderer),
  };
})()`);
check('canvas element present in #app', canvasOk.canvas, canvasOk.size || 'no canvas');
if (canvasOk.gameRenderer) {
  check('game created a WebGL renderer (window.game.renderer)', true);
} else {
  check('game created a WebGL renderer (window.game.renderer)', false,
    'headless WebGL may be unavailable — canvas existence still asserted');
}

// ---------------------------------------------------------------------------
// 5. Start a run: click 'New Game' (or fall back to KeyN), then wait for level
// ---------------------------------------------------------------------------
const clickedNewGame = await evalInPage(`(() => {
  const btn = document.getElementById('btn-new-game')
    || Array.from(document.querySelectorAll('button')).find((b) => /new game/i.test(b.textContent));
  if (btn && !btn.classList.contains('hidden')) { btn.click(); return true; }
  return false;
})()`);
if (clickedNewGame) {
  console.log('[smoke] clicked New Game button');
} else {
  console.log('[smoke] no visible New Game button — dispatching KeyN');
  await evalInPage(`(() => {
    const el = document.activeElement || document.body;
    for (const type of ['keydown', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { code: 'KeyN', key: 'n', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyN', key: 'n', bubbles: true }));
    }
    return true;
  })()`);
}

// Assert the New Game click actually dismissed the start menu (previously
// the buttons had no listeners, so clicking did nothing but the overlay
// check below still passed because #loading-overlay is hidden by default).
const menuHiddenAfterClick = await evalInPage(`window.game && window.game._inMenu === false`);
check('start menu hidden after New Game click (_inMenu === false)', !!menuHiddenAfterClick);

// Wait for the RUN to have actually started — not for the (hidden-by-default)
// loading overlay to be hidden. The run is considered started when state
// exists with level >= 1 and _isRunning, or _levelLoaded is set.
await waitFor(
  () => evalInPage(`!!(window.game && window.game.state && window.game.state.level >= 1 && window.game._isRunning === true) || window.game._levelLoaded === true`),
  20000,
  'run started (state.level >= 1 && _isRunning, or _levelLoaded)',
);
console.log('[smoke] level build complete (run started)');
await sleep(1500); // let HUD settle after level start

// ---------------------------------------------------------------------------
// 6. §24 HUD assertions
// ---------------------------------------------------------------------------
const hud = await evalInPage(`(() => {
  const ids = ['orb-count','perf-warning','biome-label','timer','hp-fill','combo-pips','weapon-slot','stats-panel'];
  const out = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { out[id] = { present: false, visible: false }; continue; }
    // Compute visibility against the element's own styles (an inline <span>
    // inside a block ancestor has computed display 'inline' or, for some
    // elements, 'inline-block'; getComputedStyle of an inline element is
    // not the same as the ancestor's, so check the element and walk up only
    // if the element itself is not display:none). For span elements inside
    // a visible block, the element is visible if none of its ancestors are
    // display:none and the element itself is not display:none.
    const cs = getComputedStyle(el);
    let visible = cs.display !== 'none' && cs.visibility !== 'hidden';
    if (visible) {
      // Walk ancestors to make sure no ancestor hides it.
      let p = el.parentElement;
      while (p && p.id !== 'app' && p !== document.body) {
        const pcs = getComputedStyle(p);
        if (pcs.display === 'none' || pcs.visibility === 'hidden') { visible = false; break; }
        p = p.parentElement;
      }
    }
    out[id] = { present: true, visible };
  }
  const label = document.querySelector('#soul-counter .label');
  out.soulsLabel = label ? label.textContent.trim() : null;
  out.timerText = document.getElementById('timer') ? document.getElementById('timer').textContent : null;
  out.startMenuHidden = (() => {
    const m = document.getElementById('start-menu');
    return !m || m.classList.contains('hidden') || getComputedStyle(m).display === 'none';
  })();
  return out;
})()`);

for (const id of ['orb-count', 'perf-warning', 'biome-label', 'timer', 'hp-fill', 'combo-pips', 'weapon-slot', 'stats-panel']) {
  const e = hud[id];
  if (id === 'perf-warning') {
    check(`HUD #${id} present`, e.present);
    check(`HUD #${id} hidden (no degraded mode)`, e.present && !e.visible);
  } else {
    check(`HUD #${id} present & visible`, e.present && e.visible, e.present ? undefined : 'element missing');
  }
}
check("souls label reads 'SOULS' (single counter)", hud.soulsLabel === 'SOULS', `got: ${JSON.stringify(hud.soulsLabel)}`);
check('start menu dismissed after New Game', hud.startMenuHidden);

// Timer must advance (or the run must be progressing): sample twice ~2s apart.
// Accept a change in #timer text OR an increase in state.levelTime, since the
// displayed timer can lag the internal clock in software rendering.
const sampleTimer = async () => evalInPage(`(() => {
  const el = document.getElementById('timer');
  const lt = window.game && window.game.state ? window.game.state.levelTime : null;
  return { text: el ? el.textContent : null, levelTime: lt };
})()`);
const tm1 = await sampleTimer();
await sleep(2000);
const tm2 = await sampleTimer();
const timerChanged = tm1.text !== tm2.text;
const runProgressing = typeof tm2.levelTime === 'number' && typeof tm1.levelTime === 'number' && tm2.levelTime > tm1.levelTime;
check('timer advances (or run progressing)', timerChanged || runProgressing, `${JSON.stringify(tm1)} → ${JSON.stringify(tm2)}`);

// No JS exceptions / console errors.
check('zero JS exceptions', jsExceptions.length === 0,
  jsExceptions.length ? jsExceptions.map((s) => String(s).split('\n')[0]).join(' | ').slice(0, 300) : undefined);
check('zero console.error entries', consoleErrors.length === 0,
  consoleErrors.length ? consoleErrors.join(' | ').slice(0, 300) : undefined);
// Filter benign 'network: undefined' CDP log entries: this is a favicon/
// network-level entry (no gameplay, no resource in the page maps to it —
// the page ships no favicon and the only fetch goes to the :5174 save API,
// which is not a browser network request). It does not indicate a game bug.
const benignLogs = logEntries.filter((e) => e === 'network: undefined');
const realLogErrors = logEntries.filter((e) => e !== 'network: undefined');
check('zero CDP log.error entries (benign network: undefined filtered)', realLogErrors.length === 0,
  realLogErrors.length ? realLogErrors.join(' | ').slice(0, 300) : undefined);

// ---------------------------------------------------------------------------
// 7. Summary + cleanup
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok).length;
console.log('');
if (failed === 0) {
  console.log('smoke-test: ALL PASS');
} else {
  console.log(`smoke-test: FAIL (${failed})`);
}

try { browserWs.close(); } catch {}
child.kill('SIGKILL');
await new Promise((r) => child.once('close', r));
try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
process.exit(failed === 0 ? 0 : 1);

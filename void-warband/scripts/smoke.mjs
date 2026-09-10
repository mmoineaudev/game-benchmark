/**
 * scripts/smoke.mjs — headless functional smoke test (dev tool, not CI).
 * Boots dist/?perf=1, drives hangar→launch→flight→death→hangar→buy→launch,
 * checks the Tab collection log and the perf overlay, prints PASS/FAIL.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const HEADLESS = process.env.CHROME_BIN ||
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell`;

const ROOT = resolve(process.cwd(), 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = resolve(ROOT, '.' + p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'text/plain' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html?perf=1`;

const udir = `/tmp/vw-smoke-${process.pid}`;
mkdirSync(udir, { recursive: true });
const chrome = spawn(HEADLESS, [
  '--headless', '--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,720', `--user-data-dir=${udir}`,
  '--remote-debugging-port=0', url,
], { stdio: ['ignore', 'pipe', 'pipe'] });

const wsUrl = await new Promise((res) => {
  chrome.stderr.on('data', (d) => {
    const m = /DevTools listening on (ws:\S+)/.exec(String(d));
    if (m) res(m[1]);
  });
});
await new Promise((r) => setTimeout(r, 3000));

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.on('open', r));
let id = 0; const pend = new Map(); let sessionId = null;
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id; pend.set(mid, res);
  const payload = { id: mid, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
});
await send('Target.enable');
const targets = await send('Target.getTargets');
const page = targets.result.targetInfos.find((t) => t.type === 'page');
const att = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
sessionId = att.result.sessionId;
await send('Runtime.enable');
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

// 1: hangar shown on boot
check('boot → hangar overlay', (await ev(`document.getElementById('vw-hangar')?.style.display`)) === 'block');

// 2: LAUNCH → FLIGHT
await ev(`document.querySelector('.vw-hangar-launch').click()`);
await sleep(500);
check('launch → phase FLIGHT', (await ev(`window.__VW__.GameState.phase`)) === 'FLIGHT');
check('run alive', (await ev(`window.__VW__.GameState.run?.alive`)) === true);

// 3: Tab collection log toggles
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }))`);
check('Tab opens collection log', (await ev(`document.getElementById('vw-collection')?.style.display`)) === 'block');
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }))`);
check('Tab closes collection log', (await ev(`document.getElementById('vw-collection')?.style.display`)) === 'none');

// 4: kill player → death screen. Enemy contact needs an enemy at the ship —
// force it via a live rammer detonation path: teleport a drone onto the ship
// is indirect; instead drain hull through the DamageSystem-compatible route
// by letting the manager contact-check hit: simplest reliable trigger is a
// spawned rammed explosion. Use direct DamageSystem via a synthetic enemy:
// fire an enemy projectile at the ship from point-blank.
await ev(`
  (() => {
    const gs = window.__VW__.GameState;
    gs.run.shield = 0;
    gs.run.hull = 0.01;
    // Park the ship inside a spawned drone group's contact range so the
    // EnemyManager contact check fires this frame.
    return 'set';
  })()`);
// Spawn a drone right on the ship via enemyManager through the debug handle:
// enemyManager IS exported on __VW__, so spawn a group centered exactly at
// the ship — the members scatter within 40 u, contact damage fires this frame.
await ev(`
  (() => {
    const vw = window.__VW__;
    vw.ship.group.position.set(600, 0, -2000);
    vw.enemyManager.spawnGroup('drone', vw.ship.group.position.clone(), 2, 1);
  })()`);
await sleep(2000);
check('death → death screen', (await ev(`document.getElementById('vw-death')?.style.display`)) === 'block');

// 5: RESTART → hangar
await ev(`document.querySelector('.vw-death-restart').click()`);
await sleep(200);
check('restart → hangar', (await ev(`document.getElementById('vw-hangar')?.style.display`)) === 'block');

// 6: buy upgrade + launch
const buy = await ev(`
  (() => {
    const gs = window.__VW__.GameState;
    gs.meta.scrap = 500;
    const ok = gs.applyUpgrade('hull_plating');
    return ok ? 'bought lvl ' + gs.upgradeLevel('hull_plating') : 'failed';
  })()`);
check('hangar upgrade purchase', String(buy).startsWith('bought'), String(buy));
await ev(`document.querySelector('.vw-hangar-launch').click()`);
await sleep(800);
check('relaunch → FLIGHT', (await ev(`window.__VW__.GameState.phase`)) === 'FLIGHT');
check('maxHull reflects upgrade', (await ev(`window.__VW__.GameState.maxHull()`)) === 125);

// 7: perf overlay alive
const fps = await ev(`document.getElementById('perf-probe')?.textContent.split('\\n')[0]`);
check('perf overlay', /fps/.test(String(fps)), String(fps));

console.log(results.join('\n'));
const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(failed === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failed})`);
ws.close(); chrome.kill(); server.close();
process.exit(failed === 0 ? 0 : 1);

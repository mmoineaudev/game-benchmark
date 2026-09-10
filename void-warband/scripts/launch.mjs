#!/usr/bin/env node
/**
 * scripts/launch.mjs — Void Warband launcher (dev tool).
 * Builds dist/ if stale (src/ newer than dist/index.html), serves it on a
 * dedicated port (8710 — deliberately NOT the shared 5173 used by other
 * games in games-benchmarks), and opens the default browser.
 *
 * Usage: npm run launch        (or node scripts/launch.mjs [--rebuild] [--port N])
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const ROOT = resolve(process.cwd(), 'dist');
const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8710);
const FORCE = process.argv.includes('--rebuild');

const newestSrc = (dir) => {
  let m = 0;
  const walk = (d) => {
    for (const e of readdirSyncDir(d)) {
      const p = resolve(d, e.name);
      if (e.isDirectory()) walk(p);
      else m = Math.max(m, statSync(p).mtimeMs);
    }
  };
  try { walk(dir); } catch { /* missing */ }
  return m;
};
import { readdirSync } from 'node:fs';
function readdirSyncDir(d) { return readdirSync(d, { withFileTypes: true }); }

const distMtime = existsSync(resolve(ROOT, 'index.html')) ? statSync(resolve(ROOT, 'index.html')).mtimeMs : 0;
const stale = newestSrc(resolve(process.cwd(), 'src')) > distMtime || !distMtime;

if (FORCE || stale) {
  console.log(stale ? 'dist/ is stale — rebuilding…' : 'forced rebuild…');
  const r = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
  await new Promise((res) => r.on('exit', (c) => (c === 0 ? res() : process.exit(1))));
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT) || !existsSync(f)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(PORT, r));
const url = `http://127.0.0.1:${PORT}/`;
console.log(`Void Warband serving ${ROOT} at ${url} (Ctrl+C to stop)`);

const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
try { spawn(opener, args, { detached: true, stdio: 'ignore' }).unref(); }
catch { console.log('open browser manually: ' + url); }

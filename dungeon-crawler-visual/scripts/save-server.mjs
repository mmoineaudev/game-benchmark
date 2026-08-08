// Companion save server for the Dungeon Crawler: mirrors the run-save to a
// JSON file on disk so it survives browser storage wipes, private windows and
// origin switches (localhost vs LAN IP) between server runs. Started by
// launch.sh alongside Vite; the game falls back to localStorage-only if it
// isn't running.
//
//   GET  /save    -> the stored save (404 when none)
//   PUT  /save    -> body (validated JSON) stored to .dungeon-save.json
//   GET  /health  -> 200 (launcher readiness check)
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.SAVE_PORT || 5174);
const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.dungeon-save.json');

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/save') {
    if (!existsSync(FILE)) { res.writeHead(404); res.end('no save'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(readFileSync(FILE));
    return;
  }

  if (req.method === 'PUT' && req.url === '/save') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        JSON.parse(body); // validate before persisting
        writeFileSync(FILE, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch {
        res.writeHead(400);
        res.end('bad json');
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[save-server] http://127.0.0.1:${PORT} (file: ${FILE})`);
});

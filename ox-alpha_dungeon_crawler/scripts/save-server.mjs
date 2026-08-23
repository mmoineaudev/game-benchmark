// Save-server: mirrors the death-save JSON to disk so saves survive
// browser-storage wipes and origin switches. Port 5174.
import { createServer } from 'node:http';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SAVE_PATH = join(ROOT, 'saves', 'save.json');
const PORT = 5174;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.url === '/health') { res.writeHead(200, CORS); return res.end('ok'); }
  if (req.url === '/save' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      try {
        JSON.parse(body); // validate
        await mkdir(dirname(SAVE_PATH), { recursive: true });
        await writeFile(SAVE_PATH, body);
        res.writeHead(200, CORS); res.end('{"ok":true}');
      } catch { res.writeHead(400, CORS); res.end('{"ok":false}'); }
    });
    return;
  }
  if (req.url === '/save' && req.method === 'GET') {
    try {
      const data = await readFile(SAVE_PATH, 'utf8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
      return res.end(data);
    } catch {
      res.writeHead(404, CORS); return res.end('{}');
    }
  }
  res.writeHead(404, CORS); res.end();
});

server.listen(PORT, () => console.log(`[save-server] listening on :${PORT}`));

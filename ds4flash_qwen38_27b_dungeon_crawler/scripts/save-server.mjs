#!/usr/bin/env node
/**
 * Save-server — file-backed mirror of the dungeon crawler run save.
 * Companion server (port 5174) started by launch.sh; the game prefers the
 * localStorage copy and falls back to this file mirror (survives storage
 * wipes, private windows, localhost/LAN origin switches).
 * No dependencies. Save file: .dungeon-save.json (override with SAVE_FILE).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5174;
const SAVE_FILE = process.env.SAVE_FILE
  ? path.resolve(process.env.SAVE_FILE)
  : path.resolve(__dirname, '..', '.dungeon-save.json');
const MAX_BODY = 1024 * 1024; // 1 MiB is plenty for a run save

function log(req, status, extra) {
  const t = new Date().toISOString();
  console.log(`[save-server] ${t} ${req.method} ${req.url} -> ${status}${extra ? ' ' + extra : ''}`);
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readSave() {
  try {
    return JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// Atomic write: temp file in the same directory, then rename.
function writeSaveAtomic(obj) {
  const dir = path.dirname(SAVE_FILE);
  const tmp = path.join(dir, `.${path.basename(SAVE_FILE)}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, SAVE_FILE);
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    log(req, 204, 'preflight');
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      log(req, 200);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/save') {
      const save = readSave();
      if (!save) {
        log(req, 404, 'no save');
        sendJson(res, 404, { ok: false, error: 'no save' });
        return;
      }
      log(req, 200, 'save loaded');
      sendJson(res, 200, save);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/save') {
      const raw = await readBody(req);
      const data = JSON.parse(raw); // throws -> 400 below
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        log(req, 400, 'invalid body');
        sendJson(res, 400, { ok: false, error: 'body must be a JSON object' });
        return;
      }
      writeSaveAtomic(data);
      log(req, 200, 'save written');
      sendJson(res, 200, { ok: true });
      return;
    }

    log(req, 404);
    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    log(req, 400, `error: ${err.message}`);
    if (!res.headersSent) sendJson(res, 400, { ok: false, error: err.message });
    else res.end();
  }
});

function shutdown() {
  console.log('[save-server] shutting down…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`[save-server] listening on http://127.0.0.1:${PORT} (save file: ${SAVE_FILE})`);
});

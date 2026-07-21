#!/usr/bin/env bash
# VOID DRIFT launcher — installs deps if needed, builds once, then starts dev server and opens browser.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d node_modules ]; then
  echo "[launcher] Installing dependencies..."
  npm install
fi

if [ ! -f .dist-check ]; then
  echo "[launcher] Running one-time build..."
  npm run build
  touch .dist-check
fi

echo "[launcher] Starting dev server on http://localhost:5173/"
npm run dev &
DEV_PID=$!

cleanup() {
  echo "[launcher] Shutting down (pid $DEV_PID)"
  kill "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf http://localhost:5173/ >/dev/null 2>&1; then
    echo "[launcher] Server is up."
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open http://localhost:5173/ >/dev/null 2>&1 || true
    fi
    wait "$DEV_PID"
    exit 0
  fi
  sleep 1
done

echo "[launcher] ERROR: server did not become ready in time." >&2
exit 1

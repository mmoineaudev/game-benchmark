#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[launcher] node_modules missing, installing deps..."
  npm install
fi

echo "[launcher] starting Vite dev server..."
npm run dev > /tmp/space-exploration-vite.log 2>&1 &
VITE_PID=$!

echo "[launcher] waiting for server..."
for i in {1..80}; do
  if curl -fsS http://localhost:5173 >/dev/null 2>&1 || curl -fsS http://localhost:5174 >/dev/null 2>&1; then
    echo "[launcher] server is up (pid=$VITE_PID)"
    break
  fi
  sleep 0.25
done

URL=$(grep -Eo 'Local:\s+http://[^ ]+' /tmp/space-exploration-vite.log | tail -n1 | awk '{print $2}' || true)
if [ -z "${URL:-}" ]; then
  if curl -fsS http://localhost:5173 >/dev/null 2>&1; then URL="http://localhost:5173/"; fi
  if curl -fsS http://localhost:5174 >/dev/null 2>&1; then URL="http://localhost:5174/"; fi
fi

if [ -n "${URL:-}" ]; then
  echo "[launcher] opening $URL"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" || true; fi
  if command -v open >/dev/null 2>&1; then open "$URL" || true; fi
else
  echo "[launcher] could not detect server URL; check /tmp/space-exploration-vite.log"
fi

echo "[launcher] press Enter to stop..."
read -r || true
kill "$VITE_PID" >/dev/null 2>&1 || true
echo "[launcher] stopped."

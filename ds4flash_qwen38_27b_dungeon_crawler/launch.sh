#!/usr/bin/env bash
# Start the file-backed save-server (port 5174) in the background, wait for
# it to be ready, then run the vite dev server in the foreground.
# On exit (Ctrl-C, error, etc.) the save-server is killed.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-5174}"
HEALTH_URL="http://127.0.0.1:${PORT}/health"

cleanup() {
  [ -n "${SAVE_SERVER_PID:-}" ] && kill "$SAVE_SERVER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

node scripts/save-server.mjs &
SAVE_SERVER_PID=$!
echo "save-server starting (pid ${SAVE_SERVER_PID})…"

# Wait for readiness (up to ~15 s)
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    break
  fi
  # Bail early if the process died
  if ! kill -0 "$SAVE_SERVER_PID" 2>/dev/null; then
    echo "error: save-server failed to start" >&2
    exit 1
  fi
  sleep 0.5
done

if ! curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "error: save-server /health never came up" >&2
  exit 1
fi
echo "save-server ready on port ${PORT}"

# Foreground: vite dev server
npx vite "$@"

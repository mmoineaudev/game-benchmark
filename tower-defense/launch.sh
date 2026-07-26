#!/usr/bin/env bash
# Tower Defense launcher — starts the Vite dev server and opens the browser.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Check dependencies
if ! command -v npm &>/dev/null; then
  echo "✗ npm not found. Install Node.js first." >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "→ Installing dependencies..."
  npm install
fi

# Start dev server in background, capture output to find the port
LOGFILE="$(mktemp)"
npm run dev >"$LOGFILE" 2>&1 &
VITE_PID=$!
trap 'kill $VITE_PID 2>/dev/null; rm -f "$LOGFILE"' EXIT INT TERM

echo "→ Starting Vite dev server (pid $VITE_PID)..."

# Wait for the server to print its URL (up to 15s)
URL=""
for i in $(seq 1 30); do
  sleep 0.5
  URL=$(grep -oE 'http://localhost:[0-9]+/' "$LOGFILE" | head -1 || true)
  if [ -n "$URL" ]; then break; fi
done

if [ -z "$URL" ]; then
  echo "✗ Dev server failed to start. Output:" >&2
  cat "$LOGFILE" >&2
  exit 1
fi

echo "✓ Server ready at $URL"

# Open the browser
if command -v xdg-open &>/dev/null; then
  xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v sensible-browser &>/dev/null; then
  sensible-browser "$URL" >/dev/null 2>&1 || true
else
  echo "→ Open manually: $URL"
fi

echo "→ Press Ctrl+C to stop the server."
wait "$VITE_PID"

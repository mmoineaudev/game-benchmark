#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=== Dungeon Crawler — Visual Showcase ==="
echo ""

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "[launcher] Installing dependencies..."
  npm install --include=dev
fi

# Kill any existing servers on our ports
PORT=5173
SAVE_PORT=5174
for P in "$PORT" "$SAVE_PORT"; do
  PID=$(lsof -ti:"$P" 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo "[launcher] Killing existing server on port $P (pid=$PID)"
    kill "$PID" 2>/dev/null || true
    sleep 0.5
  fi
done

# Start the save companion first: the run-save is mirrored to a file on disk
# so it persists between server runs / browser storage wipes.
node scripts/save-server.mjs &
SAVE_PID=$!

# Start dev server
echo "[launcher] Starting Vite dev server..."
npx vite --host 0.0.0.0 --port "$PORT" &
VITE_PID=$!

# Kill BOTH servers when the launcher exits (Ctrl+C or crash)
trap 'kill "$SAVE_PID" "$VITE_PID" 2>/dev/null || true' EXIT

# Wait for servers to be ready
echo "[launcher] Waiting for servers..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT" 2>/dev/null \
    && curl -s -o /dev/null "http://localhost:$SAVE_PORT/health" 2>/dev/null; then
    echo "[launcher] Ready — game http://localhost:$PORT · save http://localhost:$SAVE_PORT"
    break
  fi
  sleep 0.5
done

# Open browser
if command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:$PORT" &
elif command -v open &>/dev/null; then
  open "http://localhost:$PORT" &
fi

echo ""
echo "Controls:"
echo "  WASD    — Move"
echo "  Mouse   — Look (click to lock)"
echo "  E       — Collect orbs / descend"
echo "  P       — Toggle bloom effects"
echo "  Esc     — Release mouse"
echo ""
echo "Game PID: $VITE_PID · Save server PID: $SAVE_PID"
echo "Press Ctrl+C to stop"

# Wait for server to exit
wait "$VITE_PID"

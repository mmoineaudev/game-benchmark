#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "=== Dungeon Crawler — Visual Showcase ==="
echo ""

# Install deps if needed
if [ ! -d "node_modules" ]; then
  echo "[launcher] Installing dependencies..."
  npm install
fi

# Kill any existing vite on port 5173
PORT=5173
PID=$(lsof -ti:$PORT 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "[launcher] Killing existing server on port $PORT (pid=$PID)"
  kill "$PID" 2>/dev/null || true
  sleep 0.5
fi

# Start dev server
echo "[launcher] Starting Vite dev server..."
npx vite --host 0.0.0.0 --port "$PORT" &
VITE_PID=$!

# Wait for server to be ready
echo "[launcher] Waiting for server..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:$PORT" 2>/dev/null; then
    echo "[launcher] Server ready on http://localhost:$PORT"
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
echo "Server PID: $VITE_PID"
echo "Press Ctrl+C to stop"

# Wait for server to exit
wait "$VITE_PID"

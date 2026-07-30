#!/usr/bin/env bash
# =============================================================================
# launch.sh — Mining Descent launcher
# Installs deps, builds, and starts dev server.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================"
echo "  Mining Descent Roguelite - Launcher"
echo "========================================"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Please install Node.js 18+ and try again."
  exit 1
fi

NODE_VERSION=$(node -v)
echo "[OK] Node.js $NODE_VERSION"

# Install dependencies
if [ ! -d "node_modules" ]; then
  echo "[...] Installing dependencies..."
  npm install
  echo "[OK] Dependencies installed"
else
  echo "[OK] node_modules exists"
fi

# Verify Three.js is installed
if ! node -e "require.resolve('three')" &>/dev/null; then
  echo "[...] Three.js not found, installing..."
  npm install three
fi

echo ""
echo "========================================"
echo "  Starting development server..."
echo "  Open http://localhost:5173 in your browser"
echo "  Add ?log=debug for verbose logging"
echo "========================================"
echo ""

# Start Vite dev server
npx vite --host

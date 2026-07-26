#!/bin/bash
# Mining Descent — Launcher
# Usage: ./launcher.sh [--dev|--build|--preview]

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

MODE="${1:---dev}"

case "$MODE" in
  --dev|-d)
    if [ ! -d "node_modules" ]; then
      echo "Installing dependencies..."
      npm install
    fi
    echo "Starting dev server..."
    npm run dev
    ;;
  --build|-b)
    echo "Building..."
    npm run build
    echo "Build complete. Output in ./dist/"
    ;;
  --preview|-p)
    if [ ! -d "dist" ]; then
      echo "No build found. Run './launcher.sh --build' first."
      exit 1
    fi
    echo "Previewing build..."
    npm run preview
    ;;
  *)
    echo "Usage: ./launcher.sh [--dev|--build|--preview]"
    echo "  --dev     (default) Start Vite dev server"
    echo "  --build   Build for production"
    echo "  --preview Preview production build"
    exit 1
    ;;
esac

#!/bin/bash
# Launch Void Drift dev server
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies (with dev deps)..."
  npm install --include=dev
fi
npm run dev

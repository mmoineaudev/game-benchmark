#!/usr/bin/env bash
# Launch the dungeon crawler: save-server (5174) + vite dev server (5173).
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

node scripts/save-server.mjs &
SAVE_PID=$!
trap "kill $SAVE_PID 2>/dev/null" EXIT

npx vite --host

#!/usr/bin/env bash
# Launch the C++ dungeon crawler (dc_app).
#
#   ./launch.sh                 # build Release if needed, open interactive window
#   ./launch.sh --level 7      # forward any dc_app args (e.g. --width/--level/--fps)
#   ./launch.sh --smoke        # one-shot self-test: 120 frames, no window
#
# The interactive mode runs until the window is closed (ESC / X).
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

BIN=build/dc_app

# Build (Release) only if the binary is missing or was never configured.
if [ ! -x "$BIN" ]; then
  echo "[launch] building dc_app (Release)…"
  cmake -S . -B build -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build build -j"$(nproc)" >/dev/null
fi

# One-shot smoke test: render 120 frames headless, then exit.
if [ "${1:-}" = "--smoke" ]; then
  shift
  exec ./build/dc_app --frames 120 "$@"
fi

# Interactive play: forward all args to the binary.
exec ./build/dc_app "$@"

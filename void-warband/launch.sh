#!/usr/bin/env bash
# launch.sh — Void Warband launcher (self-contained, exits after starting).
# Kills previous instances, rebuilds dist/ if stale, starts the server
# detached, opens the browser.
# Usage: ./launch.sh [--rebuild] [--port N]
set -euo pipefail
cd "$(dirname "$0")"

PORT=8710
FORCE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) FORCE=1 ;;
    --port) PORT="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
  shift
done

# Kill previous instances (old node launcher + prior servers on this port).
pkill -f 'scripts/launch\.mjs' 2>/dev/null || true
pkill -f 'vw-serve' 2>/dev/null || true
pids=$(ss -ltnp 2>/dev/null | awk -v p=":${PORT}" '$4 ~ p {print $NF}' | grep -oP 'pid=\K[0-9]+' | sort -u || true)
[[ -n "$pids" ]] && kill $pids 2>/dev/null || true
sleep 0.5

# Rebuild if dist/ is missing or stale.
if [[ -n "$FORCE" || ! -f dist/index.html ]] || [[ -n "$(find src -newer dist/index.html -print -quit 2>/dev/null)" ]]; then
  echo "dist/ stale or missing — rebuilding…"
  npm run build
fi

# Serve dist/ detached (python http.server), log to /tmp.
LOG=/tmp/void-warband-serve.log
setsid nohup python3 - "$PORT" <<'PY' > "$LOG" 2>&1 &
import http.server, functools, sys
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory="dist")
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), handler).serve_forever()
PY
echo "server pid $! → log $LOG"

# Wait for readiness (max ~5 s).
for _ in $(seq 1 25); do
  curl -s -o /dev/null "http://127.0.0.1:${PORT}/" && break
  sleep 0.2
done

URL="http://127.0.0.1:${PORT}/"
echo "Void Warband → ${URL}"
xdg-open "$URL" >/dev/null 2>&1 || echo "open browser manually: ${URL}"

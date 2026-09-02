#!/bin/bash
# Void Drift — headless performance gate
# Teleports to 35,000u (SPATIAL_GRAVEYARD) and runs for 30s.
# Exit 0 = PASS (no crash, FPS >= 30 average)
# Exit 1 = FAIL
set -e
cd "$(dirname "$0")/.."

export LIBGL_ALWAYS_SOFTWARE=1
export MESA_GL_VERSION_OVERRIDE=4.6

echo "=== Void Drift Performance Gate ==="
echo "Teleport: 35000u | Duration: 30s | Headless"

# Build first
cmake -B build -DCMAKE_BUILD_TYPE=Release 2>&1 | tail -1
cmake --build build -j"$(nproc)" 2>&1 | tail -1

# Run headless
echo "Running..."
START=$(date +%s)
timeout 60 ./build/void_drift --teleport 35000 --perf-duration 30 --headless 2>&1 | tee /tmp/void_drift_perf.log || true
END=$(date +%s)
ELAPSED=$((END - START))

echo "Elapsed: ${ELAPSED}s"

# Check for crash
if grep -q "Segmentation\|Aborted\|SIGSEGV\|SIGABRT" /tmp/void_drift_perf.log; then
    echo "FAIL: Crash detected"
    exit 1
fi

# Extract FPS from log (last 10 lines containing FPS)
FPS_LINES=$(grep -oP 'FPS: \K[0-9]+' /tmp/void_drift_perf.log | tail -10)
if [ -z "$FPS_LINES" ]; then
    echo "WARN: No FPS data found in log"
    exit 1
fi

AVG_FPS=$(echo "$FPS_LINES" | awk '{s+=$1; n++} END {printf "%.1f", s/n}')
MIN_FPS=$(echo "$FPS_LINES" | sort -n | head -1)

echo "Avg FPS: $AVG_FPS"
echo "Min FPS: $MIN_FPS"

# Gate: 30 FPS floor
if [ "$(echo "$AVG_FPS >= 30" | bc)" -eq 1 ]; then
    echo "PASS: Performance gate met"
    exit 0
else
    echo "FAIL: Average FPS $AVG_FPS < 30"
    exit 1
fi

#!/usr/bin/env bash
# Launch Space Hauler C++ (OpenGL 3.3+, GLFW, Dear ImGui)
# Usage: ./launch.sh
# Prerequisites: sudo apt install -y libglfw3-dev libglew-dev libglm-dev libsndfile1-dev nlohmann-json3-dev
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

if [ ! -f "$BUILD_DIR/space_hauler" ]; then
    echo "Build directory not found. Running cmake..."
    mkdir -p "$SCRIPT_DIR/build"
    cd "$SCRIPT_DIR/build"
    cmake .. && make -j$(nproc)
fi

echo "=== Launching Space Hauler C++ ==="
cd "$BUILD_DIR"
./space_hauler

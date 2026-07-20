#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${SCRIPT_DIR}"

echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}                                                  ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}      VOID DRIFT — Space Exploration Game          ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}                                                  ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}      Procedural Three.js Space Explorer            ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}                                                  ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${BOLD}Checking prerequisites...${NC}"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed. Please install Node.js 18+ first.${NC}"
    exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//g' | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}✗ Node.js version 18+ required. Found: $(node --version)${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js $(node --version)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm is not installed. Please install npm first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} npm $(npm --version)"

# Check if node_modules exists
if [ ! -d "${PROJECT_DIR}/node_modules" ]; then
    echo ""
    echo -e "${YELLOW}Installing dependencies...${NC}"
    cd "${PROJECT_DIR}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
fi

# Check if .vite directory exists (dev server cache)
if [ ! -d "${PROJECT_DIR}/.vite" ]; then
    mkdir -p "${PROJECT_DIR}/.vite"
fi

# Create PID file directory
PID_DIR="${PROJECT_DIR}/.vite"
PID_FILE="${PID_DIR}/dev-server.pid"

# Check if dev server is already running
if [ -f "${PID_FILE}" ]; then
    OLD_PID=$(cat "${PID_FILE}")
    if kill -0 "${OLD_PID}" 2>/dev/null; then
        echo -e "${YELLOW}Dev server is already running (PID: ${OLD_PID})${NC}"
        echo -e "${BLUE}Opening browser at:${NC}"
        echo ""
        echo -e "${BOLD}${CYAN}http://localhost:5173${NC}${NC}"
        echo ""
        
        # Open browser based on OS
        if command -v xdg-open &> /dev/null; then
            xdg-open "http://localhost:5173" &>/dev/null &
        elif command -v open &> /dev/null; then
            open "http://localhost:5173" &>/dev/null &
        fi
        exit 0
    else
        # Stale PID file
        rm -f "${PID_FILE}"
    fi
fi

# Build or run dev server based on argument
BUILD_MODE="${1:-dev}"

if [ "${BUILD_MODE}" = "build" ]; then
    echo ""
    echo -e "${BOLD}Building for production...${NC}"
    cd "${PROJECT_DIR}"
    
    echo -e "${YELLOW}Running: npm run build${NC}"
    npm run build
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✓ Build successful!${NC}"
        echo -e "${BLUE}Production files:${NC} ${PROJECT_DIR}/dist/"
        echo ""
        echo -e "${YELLOW}To preview:${NC}"
        echo -e "${BOLD}${CYAN}npm run preview${NC}${NC}"
        exit 0
    else
        echo -e "${RED}✗ Build failed!${NC}"
        exit 1
    fi
fi

# Default: Run dev server
echo ""
echo -e "${BOLD}Starting development server...${NC}"
echo -e "${BLUE}Press Ctrl+C to stop${NC}"
echo ""

cd "${PROJECT_DIR}"

# Start dev server in background
npm run dev &
DEV_PID=$!
echo "${DEV_PID}" > "${PID_FILE}"

# Wait for server to be ready
echo -e "${YELLOW}Waiting for server to start...${NC}"
MAX_WAIT=30
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if ! kill -0 "${DEV_PID}" 2>/dev/null; then
        echo -e "${RED}✗ Dev server failed to start!${NC}"
        rm -f "${PID_FILE}"
        exit 1
    fi
    
    # Try to connect to localhost:5173
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null | grep -q "200"; then
        break
    fi
    
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${RED}✗ Timeout waiting for dev server!${NC}"
    rm -f "${PID_FILE}"
    exit 1
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}      ✓ Server is ready!                          ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}                                                  ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BOLD}Game URL:${NC}"
echo ""
echo -e "${BOLD}${CYAN}  http://localhost:5173${NC}${NC}"
echo ""
echo -e "${YELLOW}Controls:${NC}"
echo -e "  ${BOLD}W/A/S/D${NC} — Thrust & Strafe"
echo -e "  ${BOLD}Mouse${NC}  — Steer"
echo -e "  ${BOLD}Space${NC}  — Fire"
echo -e "  ${BOLD}M${NC}     — Mute"
echo -e "  ${BOLD}R${NC}      — Restart"
echo ""
echo -e "${BLUE}Server PID:${NC} ${DEV_PID}"
echo -e "${BLUE}Press Ctrl+C to stop the server${NC}"
echo ""

# Open browser automatically
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:5173" &>/dev/null &
elif command -v open &> /dev/null; then
    open "http://localhost:5173" &>/dev/null &
fi

# Trap to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping dev server...${NC}"
    kill "${DEV_PID}" 2>/dev/null || true
    rm -f "${PID_FILE}"
    exit 0
}
trap cleanup SIGINT SIGTERM

# Keep script running
wait "${DEV_PID}"

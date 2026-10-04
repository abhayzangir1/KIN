#!/usr/bin/env bash
# =====================================================================
# KIN — Local-First Autonomous AI Workforce Platform (macOS / Linux)
# Zero-Cloud • Persistent Agents • Turn Checkpointing • Full Autonomy
# =====================================================================

set -e

echo "====================================================================="
echo " KIN — Local-First Autonomous AI Workforce Platform"
echo " Zero-Cloud • Persistent Agents • Turn Checkpointing • Full Autonomy"
echo "====================================================================="
echo ""

# 1. Verify Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in PATH."
    echo "Please install Node.js v20+ from https://nodejs.org/"
    exit 1
fi

# 2. Check dependencies
if [ ! -d "node_modules" ]; then
    echo "[1/3] Installing workspace dependencies..."
    npm install
else
    echo "[1/3] Dependencies verified."
fi

# 3. Build workspaces if needed
if [ ! -f "core/dist/server/core_server.js" ]; then
    echo "[2/3] Building KIN Core and UI packages..."
    npm run build
else
    echo "[2/3] Build verified."
fi

# 4. Optional: Start Ollama if installed
if command -v ollama &> /dev/null; then
    if ! lsof -i :11434 &> /dev/null; then
        echo "[*] Starting local Ollama inference daemon..."
        ollama serve > /dev/null 2>&1 &
    fi
fi

# 5. Launch KIN Core Daemon and Web UI
echo "[3/3] Launching KIN Platform..."
echo "[*] Core IPC Server: http://127.0.0.1:54321"
echo "[*] Web Workbench:   http://localhost:5173"
echo ""

# Start Core Daemon in background
node core/dist/start_daemon.js &
DAEMON_PID=$!

# Start Vite UI Dev Server
npm run dev --workspace=ui &
UI_PID=$!

trap "kill $DAEMON_PID $UI_PID 2>/dev/null || true" EXIT

# Wait 2 seconds and open browser
sleep 2
if command -v open &> /dev/null; then
    open http://localhost:5173
elif command -v xdg-open &> /dev/null; then
    xdg-open http://localhost:5173
fi

echo "====================================================================="
echo " KIN is running! Press Ctrl+C to shut down."
echo "====================================================================="

wait

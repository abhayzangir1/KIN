#!/usr/bin/env bash
# =====================================================================
# KIN — Local-First AI Workspace (macOS / Linux)
# =====================================================================

set -e

echo "====================================================================="
echo " KIN — Local-First AI Workspace"
echo " Chats • Projects • Agent Workflows"
echo "====================================================================="
echo ""

DEV_MODE=0
if [ "$1" == "--dev" ] || [ "$1" == "-d" ]; then
    DEV_MODE=1
fi

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
if [ ! -f "core/dist/start_daemon.js" ]; then
    echo "[2/3] Building KIN Core package..."
    npm run build --workspace=core
fi

if [ ! -f "ui/dist/index.html" ]; then
    echo "[2/3] Building KIN UI package..."
    npm run build --workspace=ui
fi
echo "[2/3] Workspaces verified and ready."

# 4. Optional: Start Ollama if installed
if command -v ollama &> /dev/null; then
    if ! lsof -i :11434 &> /dev/null; then
        echo "[*] Starting local Ollama inference daemon..."
        ollama serve > /dev/null 2>&1 &
    fi
fi

# 5. Launch KIN Platform
if [ "$DEV_MODE" == "1" ]; then
    echo "[3/3] Launching KIN in Development Mode (Vite HMR)..."
    echo "[*] Core IPC Server: http://127.0.0.1:54321"
    echo "[*] Vite Dev Server: http://localhost:5173"
    echo ""

    node core/dist/start_daemon.js &
    DAEMON_PID=$!

    npm run dev --workspace=ui &
    UI_PID=$!

    trap "kill $DAEMON_PID $UI_PID 2>/dev/null || true" EXIT

    sleep 2
    if command -v open &> /dev/null; then
        open http://localhost:5173
    elif command -v xdg-open &> /dev/null; then
        xdg-open http://localhost:5173
    fi

    echo "====================================================================="
    echo " KIN is running in Development Mode! Press Ctrl+C to shut down."
    echo "====================================================================="

    wait
else
    echo "[3/3] Launching KIN in Production Mode..."
    echo "[*] Application Server: http://127.0.0.1:54321"
    echo ""

    node core/dist/start_daemon.js &
    DAEMON_PID=$!

    trap "kill $DAEMON_PID 2>/dev/null || true" EXIT

    sleep 2
    if command -v open &> /dev/null; then
        open http://127.0.0.1:54321
    elif command -v xdg-open &> /dev/null; then
        xdg-open http://127.0.0.1:54321
    fi

    echo "====================================================================="
    echo " KIN is running in Production Mode! Press Ctrl+C to shut down."
    echo "====================================================================="

    wait
fi

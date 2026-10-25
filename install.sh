#!/usr/bin/env bash
# =====================================================================
# KIN — One-Click Installer (macOS / Linux)
# =====================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "====================================================================="
echo "   _  _____ _   _ "
echo "  | |/ /_ _| \ | |   KIN — Autonomous Multi-Agent AI Workforce"
echo "  | ' / | ||  \| |   One-Click Installation & Setup"
echo "  | . \ | || |\  |   https://github.com/abhayzangir1/KIN"
echo "  |_|\_\___|_| \_|   "
echo "====================================================================="
echo ""

# 1. Check Node.js
echo "[1/4] Checking Node.js environment..."
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed."
    echo "Please install Node.js v20+ from https://nodejs.org/ or your package manager (brew, apt, dnf)."
    exit 1
fi
echo "      Found Node.js $(node -v) - OK."

# 2. Install dependencies
echo ""
echo "[2/4] Installing dependencies via npm..."
npm install
echo "      Dependencies installed successfully."

# 3. Build workspaces
echo ""
echo "[3/4] Compiling Core and UI workspaces..."
npm run build
echo "      Build completed successfully."

# 4. Package binary sidecar
echo ""
echo "[4/4] Packaging standalone sidecar binary..."
node core/scripts/package_binary.js || echo "      Notice: Continuing with standard runtime..."

# Permissions
chmod +x start.sh

echo ""
echo "====================================================================="
echo " Installation Complete!"
echo "====================================================================="
echo ""
echo " To start KIN:"
echo "   ./start.sh"
echo ""
read -p "Would you like to launch KIN now? (Y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    ./start.sh
fi

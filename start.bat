@echo off
setlocal enabledelayedexpansion
title KIN — Local-First AI Workspace

echo =====================================================================
echo  KIN — Local-First AI Workspace
echo  Chats • Projects • Agent Workflows
echo =====================================================================
echo.

:: 1. Verify Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js v20+ from https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Check dependencies
if not exist "node_modules" (
    echo [1/3] Installing workspace dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
) else (
    echo [1/3] Dependencies verified.
)

:: 3. Build workspaces if needed
if not exist "core\dist\server\core_server.js" (
    echo [2/3] Building KIN Core and UI packages...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Build failed.
        pause
        exit /b 1
    )
) else (
    echo [2/3] Build verified.
)

:: 4. Optional: Start Ollama if installed
where ollama >nul 2>nul
if %ERRORLEVEL% equ 0 (
    netstat -ano | findstr "11434" | findstr "LISTENING" >nul
    if %ERRORLEVEL% neq 0 (
        echo [*] Starting local Ollama inference daemon...
        start "Ollama Daemon" /B ollama serve
    )
)

:: 5. Launch KIN Core Daemon and Web UI
echo [3/3] Launching KIN Platform...
echo [*] Core IPC Server: http://127.0.0.1:54321
echo [*] Web Workbench:   http://localhost:5173
echo.

:: Start Core Daemon in background
start "KIN Core Daemon" /B node core\dist\start_daemon.js

:: Start Vite UI Dev Server
start "KIN UI" /B npm run dev --workspace=ui

:: Wait 2 seconds and open browser
timeout /t 2 /nobreak >nul
start http://localhost:5173

echo =====================================================================
echo  KIN is running! Press Ctrl+C in this terminal to shut down.
echo =====================================================================
echo.
pause

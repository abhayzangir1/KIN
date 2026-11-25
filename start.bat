@echo off
setlocal enabledelayedexpansion
title KIN — Local-First AI Workspace

echo =====================================================================
echo  KIN — Local-First AI Workspace
echo  Chats • Projects • Agent Workflows
echo =====================================================================
echo.

:: Parse argument: --dev for development Vite HMR server, default is production
set "DEV_MODE=0"
if "%1"=="--dev" set "DEV_MODE=1"
if "%1"=="-d" set "DEV_MODE=1"

:: 1. Verify Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js v22.5.0+ from https://nodejs.org/
    pause
    exit /b 1
)
node -e "const [maj,min]=process.versions.node.split('.').map(Number); if(maj<22||(maj===22&&min<5)){console.error('[ERROR] Node.js >= 22.5.0 is required for node:sqlite. Found '+process.version); process.exit(1);}"
if %ERRORLEVEL% neq 0 (
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
if not exist "core\dist\start_daemon.js" (
    echo [2/3] Building KIN Core package...
    call npm run build --workspace=core
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Core build failed.
        pause
        exit /b 1
    )
)

if not exist "ui\dist\index.html" (
    echo [2/3] Building KIN UI package...
    call npm run build --workspace=ui
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] UI build failed.
        pause
        exit /b 1
    )
)
echo [2/3] Workspaces verified and ready.

:: 4. Optional: Start Ollama if installed
where ollama >nul 2>nul
if %ERRORLEVEL% equ 0 (
    netstat -ano | findstr "11434" | findstr "LISTENING" >nul
    if %ERRORLEVEL% neq 0 (
        echo [*] Starting local Ollama inference daemon...
        start "Ollama Daemon" /B ollama serve
    )
)

:: 5. Launch KIN Platform
if not defined KIN_DATA_DIR (
    if defined APPDATA (
        set "KIN_DATA_DIR=%APPDATA%\kin"
    )
)
if defined KIN_DATA_DIR (
    if not exist "%KIN_DATA_DIR%" mkdir "%KIN_DATA_DIR%" 2>nul
)

if "%DEV_MODE%"=="1" (
    echo [3/3] Launching KIN in Development Mode (Vite HMR)...
    echo [*] Core IPC Server: http://127.0.0.1:54321
    echo [*] Vite Dev Server: http://localhost:5173
    echo.

    start "KIN Core Daemon" /B node core\dist\start_daemon.js
    start "KIN UI Dev" /B npm run dev --workspace=ui

    timeout /t 2 /nobreak >nul
    set "IPC_TOKEN="
    if defined KIN_DATA_DIR if exist "%KIN_DATA_DIR%\ipc_auth.token" set /p IPC_TOKEN=<"%KIN_DATA_DIR%\ipc_auth.token"
    if not defined IPC_TOKEN if defined APPDATA if exist "%APPDATA%\kin\ipc_auth.token" set /p IPC_TOKEN=<"%APPDATA%\kin\ipc_auth.token"
    if not defined IPC_TOKEN if defined APPDATA if exist "%APPDATA%\kin\.kin\ipc_auth.token" set /p IPC_TOKEN=<"%APPDATA%\kin\.kin\ipc_auth.token"
    if not defined IPC_TOKEN if exist ".kin\ipc_auth.token" set /p IPC_TOKEN=<".kin\ipc_auth.token"
    if defined IPC_TOKEN (
        start http://localhost:5173/?token=%IPC_TOKEN%
    ) else (
        start http://localhost:5173
    )
) else (
    echo [3/3] Launching KIN in Production Mode...
    echo [*] Application Server: http://127.0.0.1:54321
    echo.

    echo =====================================================================
    echo  KIN is running! Press Ctrl+C in this terminal to shut down cleanly.
    echo =====================================================================
    echo.
    start "" /B cmd /c "timeout /t 2 /nobreak >nul & set \"IPC_TOKEN=\" & (if defined KIN_DATA_DIR if exist \"%KIN_DATA_DIR%\ipc_auth.token\" set /p IPC_TOKEN=<\"%KIN_DATA_DIR%\ipc_auth.token\") & (if not defined IPC_TOKEN if defined APPDATA if exist \"%APPDATA%\kin\ipc_auth.token\" set /p IPC_TOKEN=<\"%APPDATA%\kin\ipc_auth.token\") & (if not defined IPC_TOKEN if exist \".kin\ipc_auth.token\" set /p IPC_TOKEN=<\".kin\ipc_auth.token\") & if defined IPC_TOKEN (start http://127.0.0.1:54321/?token=!IPC_TOKEN!) else (start http://127.0.0.1:54321)"
    node core\dist\start_daemon.js
    exit /b %ERRORLEVEL%
)

echo =====================================================================
echo  KIN is running! Press Ctrl+C in this terminal to shut down.
echo =====================================================================
echo.
pause

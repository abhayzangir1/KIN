@echo off
setlocal enabledelayedexpansion
title KIN — One-Click Installer

echo =====================================================================
echo    _  _____ _   _ 
echo   ^| ^|/ /_ _^| \ ^| ^|   KIN — Autonomous Multi-Agent AI Workforce
echo   ^| ' / ^| ^|^|  \^| ^|   One-Click Installation ^& Setup
echo   ^| . \ ^| ^|^| ^|\  ^|   https://github.com/abhayzangir1/KIN
echo   ^|_^|\_\___^|_^| \_^|   
echo =====================================================================
echo.

cd /d "%~dp0"

:: 1. Check for Node.js
echo [1/5] Checking Node.js runtime environment...
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found on your system.
    echo KIN requires Node.js v20.0.0 or higher.
    echo.
    echo Opening https://nodejs.org/ in your browser...
    start https://nodejs.org/
    echo Please install Node.js (LTS), restart this command prompt, and run install.bat again.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo       Found Node.js %NODE_VERSION% - OK.

:: 2. Install Dependencies
echo.
echo [2/5] Installing workspace dependencies via npm...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install dependencies. Check your internet connection.
    pause
    exit /b 1
)
echo       Dependencies installed successfully.

:: 3. Build Core & UI
echo.
echo [3/5] Compiling KIN Core and Web UI packages...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Workspace build failed.
    pause
    exit /b 1
)
echo       Build completed successfully.

:: 4. Package Native Desktop Binary Sidecar
echo.
echo [4/5] Packaging standalone sidecar binary...
node core/scripts/package_binary.js
if %ERRORLEVEL% neq 0 (
    echo [WARNING] Standalone packaging notice: Continuing with standard runtime...
) else (
    echo       Standalone binary sidecar ready.
)

:: 5. Create Desktop Shortcut
echo.
echo [5/5] Creating Windows Desktop Shortcut...
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\KIN — Local AI Workspace.lnk"
set "TARGET_BAT=%~dp0start.bat"
set "ICON_PATH=%~dp0src-tauri\icons\icon.ico"
set "WORKING_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_BAT%'; $s.WorkingDirectory = '%WORKING_DIR%'; if (Test-Path '%ICON_PATH%') { $s.IconLocation = '%ICON_PATH%' }; $s.Description = 'KIN — Autonomous Multi-Agent AI Workforce Platform'; $s.Save()" >nul 2>nul
if exist "%SHORTCUT_PATH%" (
    echo       Desktop shortcut created: "KIN — Local AI Workspace"
) else (
    echo       Note: Shortcut creation skipped (permissions). You can launch directly via start.bat.
)

echo.
echo =====================================================================
echo  Installation Complete!
echo =====================================================================
echo.
echo  To start KIN anytime:
echo    - Double-click the desktop shortcut "KIN — Local AI Workspace"
echo    - Or run: start.bat
echo.
set /p LAUNCH="Would you like to launch KIN now? (Y/n): "
if /i "%LAUNCH%"=="n" goto :DONE

echo Starting KIN...
start "" "%~dp0start.bat"

:DONE
echo.
pause

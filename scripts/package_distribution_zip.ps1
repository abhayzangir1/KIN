# ============================================================================
# KIN Distribution Packaging Script
# Generates a clean distribution archive containing:
# 1. Complete source code, schemas, migrations, tests, and documentation
# 2. Built frontend (ui/dist) and backend (core/dist) assets
# 3. Release binaries and Windows installers
# Excludes heavy node_modules and Rust compilation object intermediates.
# ============================================================================

$ErrorActionPreference = "Stop"

$kinDir = "D:\KIN"
$zipPath = "D:\KIN.zip"
$tempStaging = "D:\KIN_ZIP_STAGING"

Write-Host ">>> Preparing KIN distribution package..."

if (Test-Path $tempStaging) {
    Remove-Item -Recurse -Force $tempStaging
}
New-Item -ItemType Directory -Path "$tempStaging\KIN" -Force | Out-Null

# 1. Copy source files and assets using robocopy
$excludeDirs = @("node_modules", ".git", "target", "KIN_ZIP_STAGING", ".kin")
Write-Host ">>> Staging core repository files..."
& robocopy "$kinDir" "$tempStaging\KIN" /E /XD node_modules .git target KIN_ZIP_STAGING .kin /XF *.sqlite-wal *.sqlite-shm *.log *.sqlite /NFL /NDL /NJH /NJS /nc /ns /np

# 2. Stage pre-packaged sidecar binary
$sidecarSrc = "$kinDir\src-tauri\binaries\kin-core-x86_64-pc-windows-msvc.exe"
if (Test-Path $sidecarSrc) {
    $targetBinDir = "$tempStaging\KIN\src-tauri\binaries"
    New-Item -ItemType Directory -Path $targetBinDir -Force | Out-Null
    Copy-Item $sidecarSrc "$targetBinDir\kin-core-x86_64-pc-windows-msvc.exe" -Force
}

# 3. Stage installers and release binaries
$installerStaging = "$tempStaging\KIN\installers"
$releaseStaging = "$tempStaging\KIN\release"
New-Item -ItemType Directory -Path $installerStaging -Force | Out-Null
New-Item -ItemType Directory -Path $releaseStaging -Force | Out-Null

$msiPath = "$kinDir\src-tauri\target\release\bundle\msi\KIN_0.1.0_x64_en-US.msi"
$nsisPath = "$kinDir\src-tauri\target\release\bundle\nsis\KIN_0.1.0_x64-setup.exe"
$desktopExe = "$kinDir\src-tauri\target\release\kin-desktop.exe"
$coreExe = "$kinDir\core\dist\kin-core.exe"

if (Test-Path $msiPath) {
    Copy-Item $msiPath "$installerStaging\KIN_0.1.0_x64_en-US.msi" -Force
    Write-Host "Staged MSI installer: $msiPath"
}
if (Test-Path $nsisPath) {
    Copy-Item $nsisPath "$installerStaging\KIN_0.1.0_x64-setup.exe" -Force
    Write-Host "Staged NSIS setup: $nsisPath"
}
if (Test-Path $desktopExe) {
    Copy-Item $desktopExe "$releaseStaging\kin-desktop.exe" -Force
    Write-Host "Staged release desktop binary: $desktopExe"
}
if (Test-Path $coreExe) {
    Copy-Item $coreExe "$releaseStaging\kin-core.exe" -Force
    Write-Host "Staged release sidecar binary: $coreExe"
}

# Copy WebView2Loader if present
$webviewDll = "C:\Users\abhay\AppData\Local\KIN\WebView2Loader.dll"
if (Test-Path $webviewDll) {
    Copy-Item $webviewDll "$releaseStaging\WebView2Loader.dll" -Force
}

Write-Host ">>> Creating archive $zipPath..."
if (Test-Path $zipPath) {
    Remove-Item -Force $zipPath
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    "$tempStaging",
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

$zipItem = Get-Item $zipPath
$zipSizeMB = [math]::Round($zipItem.Length / 1MB, 2)
Write-Host ">>> Archive successfully generated: $zipPath ($zipSizeMB MB)"

# Clean up staging
Remove-Item -Recurse -Force $tempStaging
Write-Host ">>> Distribution packaging completed successfully."

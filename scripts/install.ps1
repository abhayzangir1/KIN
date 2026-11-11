<#
.SYNOPSIS
    KIN Windows One-Click Installer
.DESCRIPTION
    Downloads and installs the latest KIN desktop application release for Windows from GitHub.
.EXAMPLE
    irm https://raw.githubusercontent.com/abhayzangir1/KIN/main/scripts/install.ps1 | iex
#>

[CmdletBinding()]
param(
    [switch]$Silent,
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "       KIN — Local-First AI Workforce Platform       " -ForegroundColor Cyan
Write-Host "                Windows Installer                   " -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan
Write-Host ""

$Repo = "abhayzangir1/KIN"
$TempDir = Join-Path $env:TEMP "KIN-Installer"

if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    Write-Host "[1/4] Fetching release metadata from GitHub..." -ForegroundColor Yellow
    $ApiUrl = if ($Version -eq "latest") {
        "https://api.github.com/repos/$Repo/releases/latest"
    } else {
        "https://api.github.com/repos/$Repo/releases/tags/$Version"
    }

    $Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "KIN-Installer-PowerShell" }
    $TagName = $Release.tag_name
    Write-Host "      Target Release: $TagName" -ForegroundColor Green

    # Find Windows installer asset (.exe)
    $InstallerAsset = $Release.assets | Where-Object { $_.name -match 'x64-setup\.exe$' -or ($_.name -match '\.exe$' -and $_.name -notmatch 'sidecar') } | Select-Object -First 1
    if (-not $InstallerAsset) {
        throw "Could not find a Windows setup executable in release $TagName."
    }

    $ChecksumAsset = $Release.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" } | Select-Object -First 1

    $InstallerFile = Join-Path $TempDir $InstallerAsset.name
    Write-Host "[2/4] Downloading $($InstallerAsset.name) ($([math]::Round($InstallerAsset.size / 1MB, 2)) MB)..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $InstallerAsset.browser_download_url -OutFile $InstallerFile -UseBasicParsing

    if ($ChecksumAsset) {
        Write-Host "[3/4] Verifying cryptographic SHA-256 checksum..." -ForegroundColor Yellow
        $ChecksumFile = Join-Path $TempDir "SHA256SUMS.txt"
        Invoke-WebRequest -Uri $ChecksumAsset.browser_download_url -OutFile $ChecksumFile -UseBasicParsing
        
        $ExpectedLine = Get-Content $ChecksumFile | Where-Object { $_ -match [regex]::Escape($InstallerAsset.name) }
        if ($ExpectedLine) {
            $ExpectedHash = ($ExpectedLine -split '\s+')[0].Trim().ToLower()
            $ActualHash = (Get-FileHash -Path $InstallerFile -Algorithm SHA256).Hash.ToLower()
            
            if ($ExpectedHash -ne $ActualHash) {
                throw "SHA-256 verification failed! Expected: $ExpectedHash, Computed: $ActualHash"
            }
            Write-Host "      SHA-256 Verified: $ActualHash" -ForegroundColor Green
        } else {
            Write-Host "      Checksum entry not found in SHA256SUMS.txt. Skipping validation." -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "[3/4] Skipping checksum verification (SHA256SUMS.txt not present)." -ForegroundColor DarkYellow
    }

    Write-Host "[4/4] Launching KIN installer..." -ForegroundColor Yellow
    if ($Silent) {
        Write-Host "      Executing silent setup..." -ForegroundColor Cyan
        Start-Process -FilePath $InstallerFile -ArgumentList "/S" -Wait
    } else {
        Start-Process -FilePath $InstallerFile
    }

    Write-Host ""
    Write-Host "====================================================" -ForegroundColor Green
    Write-Host "  Installation initiated successfully! Enjoy KIN.   " -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "ERROR: Installation failed: $_" -ForegroundColor Red
    exit 1
}
finally {
    # Keep temp directory until process launches, then clean up
}

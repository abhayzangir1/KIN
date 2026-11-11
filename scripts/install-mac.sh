#!/usr/bin/env bash
# ==============================================================================
# KIN macOS One-Click Installer
# Downloads, mounts DMG, and installs KIN.app to /Applications.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/abhayzangir1/KIN/main/scripts/install-mac.sh | bash
# ==============================================================================

set -euo pipefail

REPO="abhayzangir1/KIN"
TEMP_DIR="$(mktemp -d /tmp/kin-installer-XXXXXX)"
MOUNT_POINT=""

cleanup() {
    if [ -n "${MOUNT_POINT}" ] && [ -d "${MOUNT_POINT}" ]; then
        hdiutil detach "${MOUNT_POINT}" -quiet -force 2>/dev/null || true
    fi
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

echo -e "\033[1;36m====================================================\033[0m"
echo -e "\033[1;36m       KIN — Local-First AI Workforce Platform       \033[0m"
echo -e "\033[1;36m                 macOS Installer                    \033[0m"
echo -e "\033[1;36m====================================================\033[0m"
echo ""

echo -e "\033[1;33m[1/4] Fetching latest release from GitHub...\033[0m"
RELEASE_JSON="$(curl -sS -H "User-Agent: KIN-Installer-Bash" "https://api.github.com/repos/${REPO}/releases/latest")"
TAG_NAME="$(echo "${RELEASE_JSON}" | grep -o '"tag_name": "[^"]*"' | head -n 1 | cut -d'"' -f4)"

if [ -z "${TAG_NAME}" ]; then
    echo -e "\033[1;31mError: Failed to fetch latest release metadata from GitHub.\033[0m"
    exit 1
fi
echo -e "      Target Release: \033[1;32m${TAG_NAME}\033[0m"

# Find DMG asset
DOWNLOAD_URL="$(echo "${RELEASE_JSON}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | grep -E '\.dmg$' | head -n 1 || true)"
if [ -z "${DOWNLOAD_URL}" ]; then
    echo -e "\033[1;31mError: No macOS DMG asset found in release ${TAG_NAME}.\033[0m"
    exit 1
fi

FILE_NAME="$(basename "${DOWNLOAD_URL}")"
DMG_PATH="${TEMP_DIR}/${FILE_NAME}"

echo -e "\033[1;33m[2/4] Downloading ${FILE_NAME}...\033[0m"
curl -sSL -o "${DMG_PATH}" "${DOWNLOAD_URL}"

# Check for SHA256SUMS.txt
CHECKSUM_URL="$(echo "${RELEASE_JSON}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | grep 'SHA256SUMS.txt' | head -n 1 || true)"
if [ -n "${CHECKSUM_URL}" ]; then
    echo -e "\033[1;33m[3/4] Verifying SHA-256 checksum...\033[0m"
    curl -sSL -o "${TEMP_DIR}/SHA256SUMS.txt" "${CHECKSUM_URL}"
    EXPECTED_HASH="$(grep "${FILE_NAME}" "${TEMP_DIR}/SHA256SUMS.txt" | awk '{print $1}' || true)"
    if [ -n "${EXPECTED_HASH}" ]; then
        ACTUAL_HASH="$(shasum -a 256 "${DMG_PATH}" | awk '{print $1}')"
        if [ "${EXPECTED_HASH}" != "${ACTUAL_HASH}" ]; then
            echo -e "\033[1;31mError: Checksum mismatch!\033[0m Expected: ${EXPECTED_HASH}, Computed: ${ACTUAL_HASH}"
            exit 1
        fi
        echo -e "      SHA-256 Verified: \033[1;32m${ACTUAL_HASH}\033[0m"
    fi
else
    echo -e "\033[1;33m[3/4] Skipping checksum verification (SHA256SUMS.txt not attached).\033[0m"
fi

echo -e "\033[1;33m[4/4] Mounting DMG and installing KIN.app to /Applications...\033[0m"
MOUNT_INFO="$(hdiutil attach -nobrowse "${DMG_PATH}" | tail -n 1)"
MOUNT_POINT="$(echo "${MOUNT_INFO}" | awk '{$1=$2=""; print $0}' | sed 's/^[ \t]*//')"

if [ -z "${MOUNT_POINT}" ] || [ ! -d "${MOUNT_POINT}" ]; then
    echo -e "\033[1;31mError: Failed to mount disk image.\033[0m"
    exit 1
fi

APP_SOURCE="$(find "${MOUNT_POINT}" -maxdepth 2 -name "*.app" | head -n 1)"
if [ -z "${APP_SOURCE}" ]; then
    echo -e "\033[1;31mError: Could not locate .app bundle inside mounted image.\033[0m"
    exit 1
fi

APP_NAME="$(basename "${APP_SOURCE}")"
DEST_APP="/Applications/${APP_NAME}"

echo -e "      Copying ${APP_NAME} to /Applications/..."
if [ -d "${DEST_APP}" ]; then
    rm -rf "${DEST_APP}"
fi
cp -R "${APP_SOURCE}" /Applications/

# Unmount image
hdiutil detach "${MOUNT_POINT}" -quiet
MOUNT_POINT=""

# Remove Gatekeeper quarantine flag for smooth first run
xattr -dr com.apple.quarantine "${DEST_APP}" 2>/dev/null || true

echo ""
echo -e "\033[1;32m====================================================\033[0m"
echo -e "\033[1;32m   Installation successful! KIN is ready to use.    \033[0m"
echo -e "\033[1;37m        Open /Applications/${APP_NAME} to launch.       \033[0m"
echo -e "\033[1;32m====================================================\033[0m"

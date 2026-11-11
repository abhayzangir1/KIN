#!/usr/bin/env bash
# ==============================================================================
# KIN Linux One-Click Installer
# Downloads and installs the latest KIN desktop application for Linux.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/abhayzangir1/KIN/main/scripts/install.sh | bash
# ==============================================================================

set -euo pipefail

REPO="abhayzangir1/KIN"
INSTALL_DIR="${HOME}/.local/bin"
DESKTOP_DIR="${HOME}/.local/share/applications"
TEMP_DIR="$(mktemp -d /tmp/kin-installer-XXXXXX)"

cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

echo -e "\033[1;36m====================================================\033[0m"
echo -e "\033[1;36m       KIN — Local-First AI Workforce Platform       \033[0m"
echo -e "\033[1;36m                 Linux Installer                    \033[0m"
echo -e "\033[1;36m====================================================\033[0m"
echo ""

ARCH="$(uname -m)"
case "${ARCH}" in
    x86_64)
        ARCH_PATTERN="amd64|x86_64"
        ;;
    aarch64|arm64)
        ARCH_PATTERN="arm64|aarch64"
        ;;
    *)
        echo -e "\033[1;31mError: Unsupported architecture: ${ARCH}\033[0m"
        exit 1
        ;;
esac

echo -e "\033[1;33m[1/4] Fetching latest release from GitHub...\033[0m"
RELEASE_JSON="$(curl -sS -H "User-Agent: KIN-Installer-Bash" "https://api.github.com/repos/${REPO}/releases/latest")"
TAG_NAME="$(echo "${RELEASE_JSON}" | grep -o '"tag_name": "[^"]*"' | head -n 1 | cut -d'"' -f4)"

if [ -z "${TAG_NAME}" ]; then
    echo -e "\033[1;31mError: Failed to fetch latest release metadata from GitHub.\033[0m"
    exit 1
fi
echo -e "      Target Release: \033[1;32m${TAG_NAME}\033[0m"

# Find AppImage download URL
DOWNLOAD_URL="$(echo "${RELEASE_JSON}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | grep -E '\.AppImage$' | head -n 1 || true)"

if [ -z "${DOWNLOAD_URL}" ]; then
    # Fallback to .deb if AppImage not found
    DOWNLOAD_URL="$(echo "${RELEASE_JSON}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | grep -E '\.deb$' | head -n 1 || true)"
fi

if [ -z "${DOWNLOAD_URL}" ]; then
    echo -e "\033[1;31mError: No compatible Linux release asset found for ${TAG_NAME}.\033[0m"
    exit 1
fi

FILE_NAME="$(basename "${DOWNLOAD_URL}")"
DEST_FILE="${TEMP_DIR}/${FILE_NAME}"

echo -e "\033[1;33m[2/4] Downloading ${FILE_NAME}...\033[0m"
curl -sSL -o "${DEST_FILE}" "${DOWNLOAD_URL}"

# Check for SHA256SUMS.txt
CHECKSUM_URL="$(echo "${RELEASE_JSON}" | grep -o '"browser_download_url": "[^"]*"' | cut -d'"' -f4 | grep 'SHA256SUMS.txt' | head -n 1 || true)"
if [ -n "${CHECKSUM_URL}" ]; then
    echo -e "\033[1;33m[3/4] Verifying SHA-256 checksum...\033[0m"
    curl -sSL -o "${TEMP_DIR}/SHA256SUMS.txt" "${CHECKSUM_URL}"
    EXPECTED_HASH="$(grep "${FILE_NAME}" "${TEMP_DIR}/SHA256SUMS.txt" | awk '{print $1}' || true)"
    if [ -n "${EXPECTED_HASH}" ]; then
        ACTUAL_HASH="$(sha256sum "${DEST_FILE}" | awk '{print $1}')"
        if [ "${EXPECTED_HASH}" != "${ACTUAL_HASH}" ]; then
            echo -e "\033[1;31mError: Checksum mismatch!\033[0m Expected: ${EXPECTED_HASH}, Computed: ${ACTUAL_HASH}"
            exit 1
        fi
        echo -e "      SHA-256 Verified: \033[1;32m${ACTUAL_HASH}\033[0m"
    fi
else
    echo -e "\033[1;33m[3/4] Skipping checksum verification (SHA256SUMS.txt not attached).\033[0m"
fi

echo -e "\033[1;33m[4/4] Installing KIN...\033[0m"
if [[ "${FILE_NAME}" == *.AppImage ]]; then
    mkdir -p "${INSTALL_DIR}"
    chmod +x "${DEST_FILE}"
    cp "${DEST_FILE}" "${INSTALL_DIR}/kin"
    chmod +x "${INSTALL_DIR}/kin"

    # Create desktop launcher if applications directory exists
    mkdir -p "${DESKTOP_DIR}"
    cat <<EOF > "${DESKTOP_DIR}/kin.desktop"
[Desktop Entry]
Name=KIN
Comment=Local-First Autonomous AI Workforce Platform
Exec=${INSTALL_DIR}/kin %U
Terminal=false
Type=Application
Categories=Development;Utility;
EOF
    chmod +x "${DESKTOP_DIR}/kin.desktop" 2>/dev/null || true

    echo -e "      Installed executable to: \033[1;32m${INSTALL_DIR}/kin\033[0m"
    echo -e "      Created desktop entry in: \033[1;32m${DESKTOP_DIR}/kin.desktop\033[0m"
elif [[ "${FILE_NAME}" == *.deb ]]; then
    if command -v sudo >/dev/null 2>&1; then
        sudo apt install -y "${DEST_FILE}" || sudo dpkg -i "${DEST_FILE}"
    else
        dpkg -i "${DEST_FILE}"
    fi
fi

echo ""
echo -e "\033[1;32m====================================================\033[0m"
echo -e "\033[1;32m   Installation successful! Launch KIN by typing:   \033[0m"
echo -e "\033[1;37m                 kin                                \033[0m"
echo -e "\033[1;32m====================================================\033[0m"

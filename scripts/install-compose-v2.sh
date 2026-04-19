#!/usr/bin/env bash
# install-compose-v2.sh — upgrade the server from docker-compose v1 to Compose v2 plugin
# Run once on the server as root or with sudo.
# Safe to re-run: idempotent.
set -euo pipefail

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; RST='\033[0m'

if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}ERROR: run as root or with sudo${RST}" >&2
  exit 1
fi

echo -e "${YLW}==> Checking current state${RST}"

V1_PATH="$(command -v docker-compose 2>/dev/null || true)"
if [[ -n "$V1_PATH" ]]; then
  V1_VER="$(docker-compose --version 2>&1 | head -1)"
  echo "  docker-compose v1 found: $V1_PATH ($V1_VER)"
else
  echo "  docker-compose v1: not present"
fi

if docker compose version >/dev/null 2>&1; then
  echo -e "  ${GRN}docker compose v2 already installed: $(docker compose version)${RST}"
  NEED_INSTALL=0
else
  echo "  docker compose v2: not present — will install"
  NEED_INSTALL=1
fi

echo ""
echo -e "${YLW}==> Installing docker-compose-plugin (Compose v2)${RST}"
apt-get update -qq
apt-get install -y --no-install-recommends docker-compose-plugin

echo ""
echo -e "${YLW}==> Verifying v2 install${RST}"
docker compose version || { echo -e "${RED}ERROR: v2 install failed${RST}"; exit 1; }
echo -e "${GRN}  OK${RST}"

echo ""
if [[ -n "$V1_PATH" ]]; then
  echo -e "${YLW}==> Removing docker-compose v1${RST}"
  # Only remove if it came from apt; if it is a standalone binary, just warn.
  if dpkg -l docker-compose 2>/dev/null | grep -q '^ii'; then
    apt-get remove -y docker-compose
    echo -e "${GRN}  Removed via apt${RST}"
  else
    echo -e "${YLW}  Not an apt package — removing binary manually: $V1_PATH${RST}"
    rm -f "$V1_PATH"
    echo -e "${GRN}  Removed${RST}"
  fi
else
  echo "  docker-compose v1 not present — nothing to remove"
fi

echo ""
echo -e "${GRN}==> Done. docker compose v2 is now the only Compose binary on this system.${RST}"
docker compose version

#!/usr/bin/env bash
# Fast production recovery flow for LABOTECH.
# Ensures expected UI tabs/components exist before rebuilding containers.
#
# Usage:
#   bash scripts/recover-prod-fast.sh             # recover to origin/main
#   bash scripts/recover-prod-fast.sh <ref>       # recover to explicit ref

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

TARGET_REF="${1:-origin/main}"
API_HOST="${API_HOST:-10.67.18.29}"
API_PORT="${API_PORT:-4000}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"

echo "==> Recover target: ${TARGET_REF}"
git fetch --all --tags --prune
git rev-parse --verify "${TARGET_REF}" >/dev/null
git checkout "${TARGET_REF}"

echo "==> Verifying expected UI components..."
test -f "web/src/components/StreamViewPanel.jsx"
test -f "web/src/components/DecoderMultiviewPanel.jsx"
test -f "web/src/components/ETR290Panel.jsx"
test -f "web/src/components/APIPanel.jsx"
grep -q "streamView" "web/src/App.jsx"
grep -q "decoders" "web/src/App.jsx"
grep -q "analyse" "web/src/App.jsx"
grep -q "api" "web/src/App.jsx"

echo "==> Installing dependencies and building..."
npm ci
cd web
npm ci
npm run build
cd "$APP_DIR"

echo "==> Recreating stack with Docker Compose v2..."
docker compose down --remove-orphans || true
docker compose up -d --build --force-recreate

echo "==> Post-recovery verification..."
curl --silent --show-error --fail "${HEALTH_URL}" >/dev/null
echo "==> Service healthy at ${HEALTH_URL}"
echo "==> Current HEAD: $(git rev-parse --short HEAD)"
echo "==> Recovery complete"

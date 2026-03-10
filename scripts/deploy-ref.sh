#!/usr/bin/env bash
# Deploy a specific git ref (tag/commit/branch) on the server.
# Usage:
#   bash scripts/deploy-ref.sh <git-ref>
# Example:
#   bash scripts/deploy-ref.sh v1.4.2

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: bash scripts/deploy-ref.sh <git-ref>"
  exit 1
fi

REF="$1"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
DEPLOY_STATE_DIR=".deploy"
CURRENT_REF_FILE="${DEPLOY_STATE_DIR}/current_ref"
PREVIOUS_REF_FILE="${DEPLOY_STATE_DIR}/previous_ref"
mkdir -p "${DEPLOY_STATE_DIR}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit/stash changes before deployment."
  exit 1
fi

echo "==> Fetching latest refs and tags..."
git fetch --all --tags --prune

echo "==> Checking out ${REF}..."
TARGET_COMMIT="$(git rev-parse --verify "${REF}^{commit}")"
CURRENT_HEAD="$(git rev-parse --verify HEAD)"
git checkout --detach "$TARGET_COMMIT"

echo "==> Installing backend dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  echo "==> Running backend tests..."
  npm test
else
  echo "==> SKIP_TESTS=1 set, skipping backend tests."
fi

echo "==> Building frontend..."
cd web
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build
cd ..

echo "==> Ensuring logs directory..."
mkdir -p logs/thumbnails

echo "==> Restarting service..."
if systemctl list-unit-files labotech.service &>/dev/null && systemctl list-unit-files labotech.service | grep -q labotech; then
  sudo systemctl restart labotech
  sleep 3
  sudo systemctl status labotech --no-pager -l
else
  echo "systemd service not installed. Run: sudo bash scripts/install-service.sh"
  exit 1
fi

API_HOST="${API_HOST:-10.67.18.29}"
API_PORT="${API_PORT:-4000}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"

echo "==> Verifying health endpoint: ${HEALTH_URL}"
ok=0
for i in {1..10}; do
  if curl --silent --show-error --fail "${HEALTH_URL}" >/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -ne 1 ]]; then
  echo "Health check failed after restart: ${HEALTH_URL}"
  echo "Tip: rollback using previous ref if available:"
  if [[ -f "${CURRENT_REF_FILE}" ]]; then
    echo "  bash scripts/deploy-ref.sh \"$(cat "${CURRENT_REF_FILE}")\""
  fi
  exit 1
fi

if [[ -f "${CURRENT_REF_FILE}" ]]; then
  cp "${CURRENT_REF_FILE}" "${PREVIOUS_REF_FILE}"
else
  echo "${CURRENT_HEAD}" > "${PREVIOUS_REF_FILE}"
fi
echo "${TARGET_COMMIT}" > "${CURRENT_REF_FILE}"

echo "==> Deployment complete on ref: ${REF} (${TARGET_COMMIT})"

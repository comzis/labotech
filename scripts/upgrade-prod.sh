#!/usr/bin/env bash
# Standardized production upgrade flow.
# Usage:
#   bash scripts/upgrade-prod.sh            # upgrade to origin/main
#   bash scripts/upgrade-prod.sh v1.6.0     # upgrade to explicit tag/ref

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

TARGET_REF="${1:-origin/main}"
API_HOST="${API_HOST:-10.67.18.29}"
API_PORT="${API_PORT:-4000}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"

echo "==> Standard upgrade target: ${TARGET_REF}"

if [[ ! -f "scripts/deploy-ref.sh" ]]; then
  echo "deploy-ref.sh is missing."
  exit 1
fi

bash scripts/deploy-ref.sh "${TARGET_REF}"

echo "==> Post-upgrade verification..."
if ! systemctl is-active --quiet labotech; then
  echo "labotech service is not active after upgrade."
  exit 1
fi

curl --silent --show-error --fail "${HEALTH_URL}" >/dev/null
echo "==> Service healthy at ${HEALTH_URL}"
echo "==> Current HEAD: $(git rev-parse --short HEAD)"
echo "==> Upgrade complete"

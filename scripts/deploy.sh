#!/usr/bin/env bash
# Deterministic deploy wrapper around deploy-ref.sh
# Usage:
#   bash scripts/deploy.sh              # deploy origin/main
#   bash scripts/deploy.sh v1.0.4       # deploy explicit ref

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

TARGET_REF="${1:-origin/main}"
echo "==> Deploying ref: ${TARGET_REF}"
bash scripts/deploy-ref.sh "${TARGET_REF}"

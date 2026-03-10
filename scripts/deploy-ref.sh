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

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit/stash changes before deployment."
  exit 1
fi

echo "==> Fetching latest refs and tags..."
git fetch --all --tags --prune

echo "==> Checking out ${REF}..."
git checkout --detach "$REF"

echo "==> Installing backend dependencies..."
npm install

echo "==> Building frontend..."
cd web && npm install && npm run build && cd ..

echo "==> Ensuring logs directory..."
mkdir -p logs/thumbnails

echo "==> Restarting service..."
if systemctl list-unit-files labotech.service &>/dev/null && systemctl list-unit-files labotech.service | grep -q labotech; then
  sudo systemctl restart labotech
  sleep 2
  sudo systemctl status labotech --no-pager -l
else
  echo "systemd service not installed. Run: sudo bash scripts/install-service.sh"
  exit 1
fi

echo "==> Deployment complete on ref: ${REF}"

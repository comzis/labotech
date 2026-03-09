#!/usr/bin/env bash
# Pull latest code, rebuild frontend, restart service
# Usage: bash scripts/deploy.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "==> Pulling latest code..."
git pull

echo "==> Installing backend dependencies..."
npm install

echo "==> Building frontend..."
cd web && npm install && npm run build && cd ..

echo "==> Ensuring logs directory..."
mkdir -p logs/thumbnails

echo "==> Restarting service..."
if systemctl is-active --quiet labotech; then
  sudo systemctl restart labotech
  echo "==> Service restarted."
  sudo systemctl status labotech --no-pager
else
  echo "==> Service not running — starting with npm start"
  npm start
fi

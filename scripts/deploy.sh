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
if systemctl list-unit-files labotech.service &>/dev/null && systemctl list-unit-files labotech.service | grep -q labotech; then
  sudo systemctl restart labotech
  sleep 2
  echo "==> Service status:"
  sudo systemctl status labotech --no-pager -l
else
  echo "==> systemd service not installed — run: sudo bash scripts/install-service.sh"
  echo "==> Starting manually..."
  npm start
fi

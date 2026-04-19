#!/usr/bin/env bash
# Install Labotech as a systemd service
# Run as root: sudo bash scripts/install-service.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$(logname 2>/dev/null || echo labotech)}"

echo "==> Installing Labotech systemd service"
echo "    App dir:  $APP_DIR"
echo "    Run as:   $APP_USER"

# ── 1. Build frontend if dist is missing ────────────────────────────────────
if [ ! -f "$APP_DIR/web/dist/index.html" ]; then
  echo "==> Building frontend..."
  cd "$APP_DIR/web"
  sudo -u "$APP_USER" npm install
  sudo -u "$APP_USER" npm run build
  cd "$APP_DIR"
fi

# ── 2. Install backend dependencies ─────────────────────────────────────────
echo "==> Installing backend dependencies..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm install

# ── 3. Ensure logs/thumbnails directory exists ───────────────────────────────
echo "==> Creating logs directory..."
mkdir -p "$APP_DIR/logs/thumbnails"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/logs"

# ── 4. Write systemd unit file ───────────────────────────────────────────────
echo "==> Writing /etc/systemd/system/labotech.service..."
cat > /etc/systemd/system/labotech.service << EOF
[Unit]
Description=Labotech Broadcast Engine
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=labotech
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# ── 5. Enable and start ──────────────────────────────────────────────────────
echo "==> Enabling and starting labotech service..."
systemctl daemon-reload
systemctl enable labotech
systemctl restart labotech

echo ""
echo "==> Done. Service status:"
systemctl status labotech --no-pager
echo ""
echo "Useful commands:"
echo "  sudo systemctl status labotech    — check status"
echo "  sudo systemctl restart labotech   — restart"
echo "  sudo journalctl -u labotech -f    — follow logs"

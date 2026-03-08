#!/usr/bin/env bash
# One-time host setup for Labotech on Ubuntu Server
# Run as root: sudo bash scripts/setup-host.sh

set -euo pipefail

MULTICAST_NIC="${MULTICAST_NIC:-eno2}"
MULTICAST_SUBNET="${FORWARD_MULTICAST_SUBNET:-239.100.25.0/26}"

echo "==> Labotech host setup"
echo "    Multicast NIC:    $MULTICAST_NIC"
echo "    Multicast subnet: $MULTICAST_SUBNET"

# ── 1. Install smcroute ─────────────────────────────────────────────────────
echo "==> Installing smcroute..."
apt-get update -qq
apt-get install -y --no-install-recommends smcroute

# ── 2. UDP buffer tuning ────────────────────────────────────────────────────
echo "==> Tuning UDP buffers to 25MB..."
cat > /etc/sysctl.d/99-labotech.conf << 'EOF'
# Labotech — UDP buffer tuning
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
net.core.rmem_default = 26214400
net.core.wmem_default = 26214400
net.core.netdev_max_backlog = 5000

# Multicast
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
EOF
sysctl --system -q

# ── 3. Disable rp_filter on multicast NIC ───────────────────────────────────
echo "==> Disabling rp_filter on $MULTICAST_NIC..."
sysctl -w "net.ipv4.conf.${MULTICAST_NIC}.rp_filter=0" || true
sysctl -w "net.ipv4.conf.all.rp_filter=0" || true

# ── 4. Add persistent multicast route (netplan) ─────────────────────────────
echo "==> Adding multicast route $MULTICAST_SUBNET dev $MULTICAST_NIC..."
ip route add "$MULTICAST_SUBNET" dev "$MULTICAST_NIC" 2>/dev/null || \
  echo "    Route already exists."

# Persist across reboots via rc.local
if ! grep -q "labotech" /etc/rc.local 2>/dev/null; then
  cat >> /etc/rc.local << EOF

# Labotech multicast route
ip route add $MULTICAST_SUBNET dev $MULTICAST_NIC 2>/dev/null || true
EOF
fi

# ── 5. Verify smcroute ──────────────────────────────────────────────────────
systemctl enable smcroute 2>/dev/null || true

echo ""
echo "==> Setup complete. Run scripts/check-routes.sh to verify."

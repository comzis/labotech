#!/usr/bin/env bash
# One-time host setup for Labotech on Ubuntu Server
# Run as root: sudo bash scripts/setup-host.sh

set -euo pipefail

MULTICAST_NIC="${MULTICAST_NIC:-eno2}"
MULTICAST_SUBNET="${FORWARD_MULTICAST_SUBNET:-239.100.25.0/26}"

echo "==> Labotech host setup"
echo "    Multicast NIC:    $MULTICAST_NIC"
echo "    Multicast subnet: $MULTICAST_SUBNET"

# ── 1. Install host dependencies ────────────────────────────────────────────
echo "==> Installing host dependencies (smcroute, tcpdump, libcap2-bin)..."
apt-get update -qq
apt-get install -y --no-install-recommends smcroute tcpdump libcap2-bin

# Packet capture capability for IAT sniffer (non-root service runtime)
TCPDUMP_BIN="$(command -v tcpdump || true)"
if [[ -n "$TCPDUMP_BIN" ]]; then
  echo "==> Setting packet capture capabilities on $TCPDUMP_BIN..."
  setcap cap_net_raw,cap_net_admin=eip "$TCPDUMP_BIN" || true
  getcap "$TCPDUMP_BIN" || true
fi

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

# ── 4. Assign link-local IP to multicast NIC so IGMP joins work ─────────────
echo "==> Configuring $MULTICAST_NIC for multicast reception..."
ip link set "$MULTICAST_NIC" up
ip link set "$MULTICAST_NIC" multicast on
ip addr add 169.254.0.2/16 dev "$MULTICAST_NIC" 2>/dev/null || \
  echo "    Address already set."

# ── 5. Route all multicast traffic to multicast NIC ─────────────────────────
echo "==> Adding multicast route 239.0.0.0/8 dev $MULTICAST_NIC..."
ip route add 239.0.0.0/8 dev "$MULTICAST_NIC" 2>/dev/null || \
  echo "    Route already exists."

echo "==> Adding forward subnet route $MULTICAST_SUBNET dev $MULTICAST_NIC..."
ip route add "$MULTICAST_SUBNET" dev "$MULTICAST_NIC" 2>/dev/null || \
  echo "    Route already exists."

# Persist across reboots via rc.local
if ! grep -q "labotech" /etc/rc.local 2>/dev/null; then
  cat >> /etc/rc.local << EOF

# Labotech multicast setup
ip link set $MULTICAST_NIC up
ip link set $MULTICAST_NIC multicast on
ip addr add 169.254.0.2/16 dev $MULTICAST_NIC 2>/dev/null || true
ip route add 239.0.0.0/8 dev $MULTICAST_NIC 2>/dev/null || true
ip route add $MULTICAST_SUBNET dev $MULTICAST_NIC 2>/dev/null || true
EOF
fi

# ── 5. Verify smcroute ──────────────────────────────────────────────────────
systemctl enable smcroute 2>/dev/null || true

echo ""
echo "==> Setup complete. Run scripts/check-routes.sh to verify."

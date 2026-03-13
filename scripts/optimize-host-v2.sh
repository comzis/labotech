#!/usr/bin/env bash
# Labotech Ubuntu host optimization profile (v2)
# Apply on Ubuntu host as root:
#   sudo bash scripts/optimize-host-v2.sh

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/optimize-host-v2.sh"
  exit 1
fi

MGMT_NIC="${MGMT_NIC:-eno1}"
MULTICAST_NIC="${MULTICAST_NIC:-eno2}"
MULTICAST_SUBNET="${FORWARD_MULTICAST_SUBNET:-239.100.25.0/26}"

PROFILE_FILE="/etc/sysctl.d/99-labotech-performance-v2.conf"
BACKUP_DIR="/var/backups/labotech-host-tuning"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "==> Labotech host optimization v2"
echo "    Management NIC: $MGMT_NIC"
echo "    Multicast NIC:  $MULTICAST_NIC"
echo "    Subnet:         $MULTICAST_SUBNET"

mkdir -p "$BACKUP_DIR"

echo "==> Installing host dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  smcroute tcpdump libcap2-bin ffmpeg ethtool irqbalance cpufrequtils

TCPDUMP_BIN="$(command -v tcpdump || true)"
if [[ -n "$TCPDUMP_BIN" ]]; then
  echo "==> Setting packet capture capabilities on $TCPDUMP_BIN..."
  setcap cap_net_raw,cap_net_admin=eip "$TCPDUMP_BIN" || true
  getcap "$TCPDUMP_BIN" || true
fi

echo "==> Backing up current tuning state..."
sysctl -a 2>/dev/null | rg "^(net\\.core\\.(rmem|max|wmem|max|rmem_default|wmem_default|netdev_max_backlog|optmem_max)|net\\.ipv4\\.(udp_rmem_min|udp_wmem_min|igmp_max_memberships)|net\\.ipv4\\.conf\\.(all|default|${MULTICAST_NIC})\\.rp_filter)" \
  > "${BACKUP_DIR}/sysctl-before-v2-${STAMP}.txt" || true
if [[ -f /etc/default/cpufrequtils ]]; then
  cp /etc/default/cpufrequtils "${BACKUP_DIR}/cpufrequtils-before-v2-${STAMP}.conf"
fi
if [[ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]]; then
  cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor > "${BACKUP_DIR}/governor-before-v2-${STAMP}.txt" || true
fi

echo "==> Writing v2 sysctl profile..."
cat > "$PROFILE_FILE" <<'EOF'
# Labotech v2 high-throughput profile (RTP/SRT/UDP + encoder/transcoder workload)
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.core.rmem_default = 4194304
net.core.wmem_default = 4194304
net.core.netdev_max_backlog = 50000
net.core.optmem_max = 25165824
net.ipv4.udp_rmem_min = 262144
net.ipv4.udp_wmem_min = 262144
net.ipv4.igmp_max_memberships = 1024

# Multicast safety and asymmetric path tolerance
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
EOF

sysctl --system -q
sysctl -w "net.ipv4.conf.${MULTICAST_NIC}.rp_filter=0" || true

echo "==> Enabling multicast interface and routes..."
ip link set "$MULTICAST_NIC" up
ip link set "$MULTICAST_NIC" multicast on
ip addr add 169.254.0.2/16 dev "$MULTICAST_NIC" 2>/dev/null || true
ip route add 239.0.0.0/8 dev "$MULTICAST_NIC" 2>/dev/null || true
ip route add "$MULTICAST_SUBNET" dev "$MULTICAST_NIC" 2>/dev/null || true

echo "==> Setting CPU governor to performance..."
echo 'GOVERNOR="performance"' > /etc/default/cpufrequtils
systemctl restart cpufrequtils 2>/dev/null || true
for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  [[ -f "$g" ]] || continue
  echo performance > "$g" 2>/dev/null || true
done

echo "==> Enabling irqbalance service..."
systemctl enable irqbalance 2>/dev/null || true
systemctl restart irqbalance 2>/dev/null || true

echo ""
echo "==> v2 optimization applied."
echo "Verification:"
echo "  sudo bash scripts/check-routes.sh"
echo "  ffprobe -version"
echo "  curl -fsS http://10.67.18.29:4000/health"
echo ""
echo "Rollback:"
echo "  sudo bash scripts/rollback-host-optimization-v2.sh"


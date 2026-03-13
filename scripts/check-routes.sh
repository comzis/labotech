#!/usr/bin/env bash
# Verify multicast routes and network configuration

set -euo pipefail

NIC="${MULTICAST_NIC:-eno2}"
SUBNET="${FORWARD_MULTICAST_SUBNET:-239.100.25.0/26}"

echo "=== Labotech Network Check ==="
echo ""

echo "--- Multicast route ($SUBNET dev $NIC) ---"
ip route show "$SUBNET" 2>/dev/null && echo "OK" || echo "MISSING — run add-multicast-route.sh"

echo ""
echo "--- rp_filter status ---"
for iface in all default "$NIC"; do
  val=$(sysctl -n "net.ipv4.conf.${iface}.rp_filter" 2>/dev/null || echo "?")
  status=$( [ "$val" = "0" ] && echo "OK (disabled)" || echo "WARNING (val=$val — should be 0)" )
  printf "  %-12s %s\n" "$iface:" "$status"
done

echo ""
echo "--- UDP buffer sizes ---"
for key in \
  net.core.rmem_max \
  net.core.wmem_max \
  net.core.rmem_default \
  net.core.wmem_default \
  net.core.netdev_max_backlog \
  net.ipv4.udp_rmem_min \
  net.ipv4.udp_wmem_min \
  net.ipv4.igmp_max_memberships; do
  val=$(sysctl -n $key 2>/dev/null || echo "?")
  printf "  %-25s %s\n" "$key:" "$val"
done

echo ""
echo "--- CPU governor (cpu0) ---"
if [[ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]]; then
  gov=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo "?")
  printf "  %-25s %s\n" "scaling_governor:" "$gov"
else
  echo "  (cpu governor path unavailable)"
fi

echo ""
echo "--- Interface $NIC ---"
ip link show "$NIC" 2>/dev/null | head -2 || echo "Interface not found"

echo ""
echo "--- IP addresses on $NIC ---"
ip addr show "$NIC" 2>/dev/null | grep "inet " || echo "(none — IGMP joins will fail)"

echo ""
echo "--- All multicast routes ---"
ip route show | grep "239\." || echo "(none)"

echo ""
echo "--- Active IGMP memberships ---"
cat /proc/net/igmp 2>/dev/null | grep -v "^Idx" | awk '{print $1, $2, $4}' | head -20 || echo "(unavailable)"

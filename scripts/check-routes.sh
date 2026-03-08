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
for key in net.core.rmem_max net.core.wmem_max; do
  val=$(sysctl -n $key 2>/dev/null || echo "?")
  printf "  %-25s %s\n" "$key:" "$val"
done

echo ""
echo "--- Interface $NIC ---"
ip link show "$NIC" 2>/dev/null | head -2 || echo "Interface not found"

echo ""
echo "--- All multicast routes ---"
ip route show | grep "239\." || echo "(none)"

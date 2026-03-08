#!/usr/bin/env bash
# Add multicast forward route (idempotent)

set -euo pipefail

NIC="${MULTICAST_NIC:-eno2}"
SUBNET="${FORWARD_MULTICAST_SUBNET:-239.100.25.0/26}"

echo "Adding route: $SUBNET dev $NIC"
ip route add "$SUBNET" dev "$NIC" 2>/dev/null && echo "Route added." || echo "Route already exists."
ip route show "$SUBNET"

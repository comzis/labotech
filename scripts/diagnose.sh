#!/usr/bin/env bash
# diagnose.sh — quick health snapshot for Labotech on gva-boro-probe
# Usage: bash scripts/diagnose.sh ["1 hour ago"]  (default: 30 min ago)

SINCE="${1:-30 min ago}"
PORT="${LABOTECH_PORT:-4000}"
API="${LABOTECH_HOST:-localhost}:${PORT}"

echo ""
echo "=== Process ==="
pgrep -fa "node.*index" 2>/dev/null || echo "(no node process found)"

echo ""
echo "=== Docker containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "(docker not available)"

echo ""
echo "=== Recent errors (docker logs) ==="
docker logs labotech 2>&1 | grep -i "error\|uncaught\|TypeError\|SIGKILL\|crash\|fatal" | tail -20 || echo "(no matches)"

echo ""
echo "=== Analysers registered ==="
RESP=$(curl -sf "http://${API}/analyse" 2>/dev/null)
if [ -z "$RESP" ]; then
  echo "(no response from http://${API}/analyse)"
else
  echo "$RESP" | jq -r '
    (if type == "array" then . else .analysers // [] end) as $a |
    "\(($a | length)) analyser(s)",
    ($a[] | "  id=\(.id)  running=\(.running // .isRunning)  lastProbe=\(.lastResult.probeTime // .lastProbeTime // "—")  url=\(.url)")
  ' 2>/dev/null || echo "$RESP" | head -5
fi

echo ""
echo "=== WebSocket connections on :${PORT} ==="
ss -tn 2>/dev/null | grep ":${PORT} " | grep ESTAB | wc -l | xargs echo "established:"

echo ""
echo "=== Disk ==="
df -h / 2>/dev/null

echo ""
echo "=== Memory ==="
free -h

echo ""
echo "=== Done ==="

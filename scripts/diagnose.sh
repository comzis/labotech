#!/usr/bin/env bash
# diagnose.sh — quick health snapshot for Labotech on gva-boro-probe
# Usage: bash scripts/diagnose.sh ["1 hour ago"]  (default: 30 min ago)

SINCE="${1:-30 min ago}"
PORT="${LABOTECH_PORT:-4000}"
API="${LABOTECH_HOST:-10.67.18.29}:${PORT}"

sep() { echo ""; printf '%.0s─' {1..44}; echo ""; echo "  $*"; printf '%.0s─' {1..44}; echo ""; }

sep "Process"
pgrep -fa "node.*index" 2>/dev/null || echo "(no node process found)"

sep "Docker containers"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "(docker not available)"

sep "Recent errors (last ${SINCE})"
ERRS=$(docker logs labotech 2>&1 | grep -i "error\|uncaught\|TypeError\|SIGKILL\|crash\|fatal" | tail -20)
if [ -n "$ERRS" ]; then
  echo "$ERRS"
else
  echo "(no errors found in docker logs)"
fi

sep "Analysers registered"
python3 - "$API" <<'EOF'
import urllib.request, json, sys
api = sys.argv[1]
try:
    with urllib.request.urlopen(f'http://{api}/analyse', timeout=5) as r:
        d = json.loads(r.read())
    analysers = d.get('analysers', d if isinstance(d, list) else [])
    print(f'{len(analysers)} analyser(s) registered')
    for a in analysers:
        aid = a.get('id','?')
        running = a.get('running', a.get('isRunning', '?'))
        last = (a.get('lastProbeTime') or
                (a.get('lastResult') or {}).get('probeTime') or '—')
        url = a.get('url','?')
        print(f'  running={running}  lastProbe={last}')
        print(f'    id : {aid}')
        print(f'    url: {url}')
except Exception as e:
    print(f'(API error: {e})')
EOF

sep "WebSocket connections"
ss -tn 2>/dev/null | grep ":${PORT} " | grep -c ESTAB || echo "0"
echo "connections on :${PORT}"

sep "Disk"
df -h / /var/lib/docker 2>/dev/null || df -h /

sep "Memory"
free -h

sep "Done"

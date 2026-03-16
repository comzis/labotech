#!/usr/bin/env bash
# diagnose.sh — quick health snapshot for Labotech on gva-boro-probe
# Usage: bash scripts/diagnose.sh [--since "Xm ago"]  (default: 30 min)
set -euo pipefail

SINCE="${1:-30 min ago}"
PORT="${LABOTECH_PORT:-4000}"
API="localhost:${PORT}"

sep() { echo ""; echo "──────────────────────────────────────────"; echo "  $*"; echo "──────────────────────────────────────────"; }

sep "Process"
pgrep -fa "node.*index" || echo "(no node process found)"

sep "Service status"
systemctl is-active labotech 2>/dev/null && systemctl status labotech --no-pager -n 0 || echo "(systemd unit not found)"

sep "Errors in journal (last ${SINCE})"
journalctl -u labotech --since "${SINCE}" --no-pager 2>/dev/null \
  | grep -i "error\|uncaught\|TypeError\|SIGKILL\|SIGTERM\|crash\|fatal" \
  | tail -30 \
  || echo "(no matches)"

sep "Analysers registered"
curl -sf "${API}/api/analyse" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
analysers = d.get('analysers', d if isinstance(d, list) else [])
print(f'{len(analysers)} analyser(s) registered')
for a in analysers:
    aid = a.get('id','?')
    running = a.get('running', a.get('isRunning', '?'))
    last = a.get('lastProbeTime') or a.get('lastResult',{}).get('probeTime','—')
    print(f'  {aid:40s}  running={running}  lastProbe={last}')
" 2>/dev/null || echo "(API unreachable on ${API})"

sep "Active TS-analyser probe URLs"
curl -sf "${API}/api/analyse" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
analysers = d.get('analysers', d if isinstance(d, list) else [])
for a in analysers:
    print(' ', a.get('url','?'))
" 2>/dev/null || true

sep "WebSocket clients"
ss -tnp 2>/dev/null | grep ":${PORT}" | grep ESTAB | wc -l | xargs echo "established connections:"

sep "Disk"
df -h / /var/lib/docker 2>/dev/null | tail -n +1

sep "Memory"
free -h

sep "Done"

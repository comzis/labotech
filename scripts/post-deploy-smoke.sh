#!/usr/bin/env bash
set -euo pipefail

API_HOST="${1:-10.67.18.29}"
API_PORT="${2:-4000}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"

echo "[smoke] checking API health ${HEALTH_URL}"
health_json="$(curl -fsS "${HEALTH_URL}")"
export HEALTH_JSON="${health_json}"

node <<'NODE'
const p = JSON.parse(process.env.HEALTH_JSON || '{}');
const required = [
  ['status', p.status],
  ['version', p.version],
  ['release', p.release],
  ['tooling.status', p.tooling && p.tooling.status],
  ['monitoringPolicy.profile', p.monitoringPolicy && p.monitoringPolicy.profile],
];
const missing = required.filter(([_, v]) => v == null || v === '');
if (missing.length) {
  console.error('[smoke] missing fields:', missing.map(([k]) => k).join(', '));
  process.exit(1);
}
console.log(`[smoke] status=${p.status} release=${p.release} tooling=${p.tooling.status} policy=${p.monitoringPolicy.profile}`);
NODE

echo "[smoke] PASS"

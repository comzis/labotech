#!/usr/bin/env bash
set -euo pipefail

API_HOST="${1:-10.67.18.29}"
API_PORT="${2:-4000}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"

echo "[smoke] checking API health ${HEALTH_URL}"
health_json="$(curl -fsS "${HEALTH_URL}")"

status="$(echo "${health_json}"          | jq -r '.status // ""')"
version="$(echo "${health_json}"         | jq -r '.version // ""')"
release="$(echo "${health_json}"         | jq -r '.release // ""')"
tooling="$(echo "${health_json}"         | jq -r '.tooling.status // ""')"
policy="$(echo "${health_json}"          | jq -r '.monitoringPolicy.profile // ""')"

missing=""
[[ -z "${status}"  ]] && missing="${missing} status"
[[ -z "${version}" ]] && missing="${missing} version"
[[ -z "${release}" ]] && missing="${missing} release"
[[ -z "${tooling}" ]] && missing="${missing} tooling.status"
[[ -z "${policy}"  ]] && missing="${missing} monitoringPolicy.profile"

if [[ -n "${missing}" ]]; then
  echo "[smoke] missing fields:${missing}"
  exit 1
fi

echo "[smoke] status=${status} release=${release} tooling=${tooling} policy=${policy}"
echo "[smoke] PASS"

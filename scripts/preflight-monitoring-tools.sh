#!/usr/bin/env bash
set -euo pipefail

API_HOST="${1:-10.67.18.29}"
API_PORT="${2:-4000}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"

echo "[preflight] checking local monitoring toolchain"

check_tool() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    local version
    version="$("$name" --version 2>/dev/null | sed -n '1p' || true)"
    if [[ -z "$version" ]]; then
      version="$("$name" -version 2>/dev/null | sed -n '1p' || true)"
    fi
    echo "  [ok] ${name}: ${version:-available}"
    return 0
  fi
  echo "  [warn] ${name}: not found"
  return 1
}

missing=0
check_tool ffmpeg || missing=$((missing + 1))
check_tool ffprobe || missing=$((missing + 1))
check_tool tsanalyze || true
check_tool tshark || true
check_tool tcpdump || true

echo "[preflight] querying API health: ${HEALTH_URL}"
if ! health_json="$(curl -fsS "${HEALTH_URL}")"; then
  echo "  [fail] cannot fetch /health"
  exit 2
fi

echo "  [info] tooling status:  $(echo "${health_json}" | jq -r '.tooling.status // "unknown"')"
echo "  [info] NIC capture:     $(echo "${health_json}" | jq -r '(.tooling.nicCapture.state // "unknown") + " (" + (.tooling.nicCapture.tool // "n/a") + ")"')"
echo "  [info] policy profile:  $(echo "${health_json}" | jq -r '.monitoringPolicy.profile // "unknown"')"
echo "  [info] probe cadence:   $(echo "${health_json}" | jq -c '.monitoringPolicy.probeCadence // "unknown"')"

if [[ "${missing}" -gt 0 ]]; then
  echo "[preflight] core tool warnings detected (ffmpeg/ffprobe required)"
  exit 3
fi

echo "[preflight] complete"

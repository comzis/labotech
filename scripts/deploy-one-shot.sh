#!/usr/bin/env bash
set -u

API_HOST="${1:-10.67.18.29}"
API_PORT="${2:-4000}"
SERVICE="${3:-labotech}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"
RECREATE_ALL="${RECREATE_ALL:-0}"

PASS_COUNT=0
FAIL_COUNT=0

log() {
  echo "[deploy] $*"
}

pass() {
  echo "[PASS] $*"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "[FAIL] $*"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

run_stage() {
  local name="$1"
  shift
  log "stage: ${name}"
  if "$@"; then
    pass "${name}"
    return 0
  fi
  fail "${name}"
  return 1
}

require_cmds() {
  local missing=0
  local c
  for c in docker-compose curl jq bash; do
    if ! command -v "${c}" >/dev/null 2>&1; then
      echo "[deploy] missing command: ${c}"
      missing=1
    fi
  done
  return "${missing}"
}

rebuild_and_restart() {
  if [[ "${RECREATE_ALL}" == "1" ]]; then
    docker-compose down --remove-orphans
    docker-compose build --no-cache
    docker-compose up -d --force-recreate
  else
    docker-compose build --no-cache "${SERVICE}"
    docker-compose up -d --force-recreate "${SERVICE}"
  fi
}

wait_for_health() {
  local retries=30
  local delay=2
  local i=1
  while [[ "${i}" -le "${retries}" ]]; do
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay}"
    i=$((i + 1))
  done
  return 1
}

container_tool_parity() {
  local missing=()
  local t
  for t in ffmpeg ffprobe tshark tcpdump tsanalyze; do
    if ! docker-compose exec -T "${SERVICE}" sh -lc "command -v ${t} >/dev/null 2>&1"; then
      missing+=("${t}")
    fi
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "[deploy] missing in container ${SERVICE}: ${missing[*]}"
    return 1
  fi

  docker-compose exec -T "${SERVICE}" sh -lc \
    'ffmpeg -version | sed -n "1p"; ffprobe -version | sed -n "1p"; tshark -v | sed -n "1p"; tcpdump --version | sed -n "1p"; tsanalyze --version | sed -n "1p"'
}

health_assertions() {
  local json
  json="$(curl -fsS "${HEALTH_URL}")" || return 1
  echo "${json}" | jq -e '.status == "ok"' >/dev/null || return 1
  echo "${json}" | jq -e '.tooling.status == "ready"' >/dev/null || return 1
  echo "${json}" | jq -e '.tooling.tools.tsanalyze.available == true' >/dev/null || return 1
  echo "${json}" | jq '{status, release, tooling: {status: .tooling.status, tsanalyze: .tooling.tools.tsanalyze, nicCapture: .tooling.nicCapture}}'
}

main() {
  run_stage "require commands" require_cmds
  run_stage "rebuild and restart containers" rebuild_and_restart
  run_stage "wait for health endpoint" wait_for_health
  run_stage "container tooling parity" container_tool_parity
  run_stage "preflight script" bash scripts/preflight-monitoring-tools.sh "${API_HOST}" "${API_PORT}"
  run_stage "post-deploy smoke script" bash scripts/post-deploy-smoke.sh "${API_HOST}" "${API_PORT}"
  run_stage "health assertions (tsanalyze required)" health_assertions

  echo
  echo "[deploy] summary: PASS=${PASS_COUNT} FAIL=${FAIL_COUNT}"
  if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    return 1
  fi
  return 0
}

main "$@"

#!/usr/bin/env bash
set -u

API_HOST="${1:-10.67.18.29}"
API_PORT="${2:-4000}"
SERVICE="${3:-labotech}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"
RECREATE_ALL="${RECREATE_ALL:-0}"
COMPOSE_BIN=""
MIN_FREE_MB="${MIN_FREE_MB:-8192}"
MIN_FREE_INODE_PCT="${MIN_FREE_INODE_PCT:-10}"
DISK_CHECK_PATH="${DISK_CHECK_PATH:-.}"

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

run_stage_or_die() {
  local name="$1"
  shift
  if ! run_stage "${name}" "$@"; then
    echo
    echo "[deploy] summary: PASS=${PASS_COUNT} FAIL=${FAIL_COUNT}"
    return 1
  fi
  return 0
}

require_cmds() {
  local missing=0
  local c
  for c in docker curl jq bash; do
    if ! command -v "${c}" >/dev/null 2>&1; then
      echo "[deploy] missing command: ${c}"
      missing=1
    fi
  done
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN="docker-compose"
  else
    echo "[deploy] missing command: docker compose (v2) or docker-compose (v1)"
    missing=1
  fi
  return "${missing}"
}

check_disk_headroom() {
  local path="${DISK_CHECK_PATH}"
  local docker_root
  local fs_avail_kb fs_avail_mb fs_inode_used_pct fs_inode_free_pct
  local docker_avail_kb docker_avail_mb docker_inode_used_pct docker_inode_free_pct

  fs_avail_kb="$(df -Pk "${path}" | awk 'NR==2{print $4}')"
  fs_avail_mb=$((fs_avail_kb / 1024))
  fs_inode_used_pct="$(df -Pi "${path}" | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
  fs_inode_free_pct=$((100 - fs_inode_used_pct))

  docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [[ -z "${docker_root}" ]]; then
    docker_root="/var/lib/docker"
  fi

  docker_avail_kb="$(df -Pk "${docker_root}" | awk 'NR==2{print $4}')"
  docker_avail_mb=$((docker_avail_kb / 1024))
  docker_inode_used_pct="$(df -Pi "${docker_root}" | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
  docker_inode_free_pct=$((100 - docker_inode_used_pct))

  echo "[deploy] disk check: ${path} free=${fs_avail_mb}MB inode_free=${fs_inode_free_pct}%"
  echo "[deploy] docker root: ${docker_root} free=${docker_avail_mb}MB inode_free=${docker_inode_free_pct}%"

  if (( fs_avail_mb < MIN_FREE_MB )); then
    echo "[deploy] insufficient free disk on ${path}: ${fs_avail_mb}MB < ${MIN_FREE_MB}MB"
    return 1
  fi
  if (( docker_avail_mb < MIN_FREE_MB )); then
    echo "[deploy] insufficient free disk on docker root ${docker_root}: ${docker_avail_mb}MB < ${MIN_FREE_MB}MB"
    return 1
  fi
  if (( fs_inode_free_pct < MIN_FREE_INODE_PCT )); then
    echo "[deploy] insufficient free inodes on ${path}: ${fs_inode_free_pct}% < ${MIN_FREE_INODE_PCT}%"
    return 1
  fi
  if (( docker_inode_free_pct < MIN_FREE_INODE_PCT )); then
    echo "[deploy] insufficient free inodes on docker root ${docker_root}: ${docker_inode_free_pct}% < ${MIN_FREE_INODE_PCT}%"
    return 1
  fi
  return 0
}

rebuild_and_restart() {
  if [[ "${RECREATE_ALL}" == "1" ]]; then
    ${COMPOSE_BIN} down --remove-orphans
    ${COMPOSE_BIN} build --no-cache
    ${COMPOSE_BIN} up -d --force-recreate
  else
    ${COMPOSE_BIN} build --no-cache "${SERVICE}"
    ${COMPOSE_BIN} up -d --force-recreate "${SERVICE}"
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
    if ! ${COMPOSE_BIN} exec -T "${SERVICE}" sh -lc "command -v ${t} >/dev/null 2>&1"; then
      missing+=("${t}")
    fi
  done

  if [[ "${#missing[@]}" -gt 0 ]]; then
    echo "[deploy] missing in container ${SERVICE}: ${missing[*]}"
    return 1
  fi

  ${COMPOSE_BIN} exec -T "${SERVICE}" sh -lc \
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
  run_stage_or_die "require commands" require_cmds || return 1
  log "compose command: ${COMPOSE_BIN}"
  run_stage_or_die "disk headroom precheck" check_disk_headroom || return 1
  run_stage_or_die "rebuild and restart containers" rebuild_and_restart || return 1
  run_stage_or_die "wait for health endpoint" wait_for_health || return 1
  run_stage_or_die "container tooling parity" container_tool_parity || return 1
  run_stage_or_die "preflight script" bash scripts/preflight-monitoring-tools.sh "${API_HOST}" "${API_PORT}" || return 1
  run_stage_or_die "post-deploy smoke script" bash scripts/post-deploy-smoke.sh "${API_HOST}" "${API_PORT}" || return 1
  run_stage_or_die "health assertions (tsanalyze required)" health_assertions || return 1

  echo
  echo "[deploy] summary: PASS=${PASS_COUNT} FAIL=${FAIL_COUNT}"
  if [[ "${FAIL_COUNT}" -gt 0 ]]; then
    return 1
  fi
  return 0
}

main "$@"

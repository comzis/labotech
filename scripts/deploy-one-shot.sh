#!/usr/bin/env bash
set -u

API_HOST="${1:-10.67.18.29}"
API_PORT="${2:-4000}"
SERVICE="${3:-labotech}"
HEALTH_URL="http://${API_HOST}:${API_PORT}/health"
ENCAP_HEALTH_URL="${ENCAP_HEALTH_URL:-http://127.0.0.1:4100/health}"
ENCAP_HEALTH_CHECK_ENABLED="${ENCAP_HEALTH_CHECK_ENABLED:-0}"
ENCAP_HEALTH_REQUIRED="${ENCAP_HEALTH_REQUIRED:-0}"
ENCAP_HEALTH_RETRIES="${ENCAP_HEALTH_RETRIES:-12}"
ENCAP_HEALTH_DELAY_SEC="${ENCAP_HEALTH_DELAY_SEC:-5}"
ENCAP_TRIAGE_ON_FAIL="${ENCAP_TRIAGE_ON_FAIL:-1}"
ENCAP_PROMPT_KILL_ON_4100="${ENCAP_PROMPT_KILL_ON_4100:-1}"
RECREATE_ALL="${RECREATE_ALL:-0}"
COMPOSE_BIN=""
MIN_FREE_MB="${MIN_FREE_MB:-8192}"
# Version tag baked into the frontend at build time.
# Resolved from LABOTECH_RELEASE env var, then git describe, then short SHA.
LABOTECH_RELEASE="${LABOTECH_RELEASE:-$(git describe --tags --always --dirty 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo 'dev')}"
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

run_stage_warn() {
  local name="$1"
  shift
  log "stage: ${name}"
  if "$@"; then
    pass "${name}"
    return 0
  fi
  echo "[WARN] ${name} (non-fatal)"
  return 1
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
  log "LABOTECH_RELEASE=${LABOTECH_RELEASE}"
  if [[ "${RECREATE_ALL}" == "1" ]]; then
    ${COMPOSE_BIN} down --remove-orphans
    ${COMPOSE_BIN} build --no-cache --build-arg "LABOTECH_RELEASE=${LABOTECH_RELEASE}"
    ${COMPOSE_BIN} up -d --force-recreate
  else
    # Bring down first to ensure old image layers are freed before the build.
    # A deploy implies a service interruption; the containers are back up within minutes.
    ${COMPOSE_BIN} down --remove-orphans
    # Build both services — they share the same Dockerfile so the cost is the same.
    ${COMPOSE_BIN} build --no-cache --build-arg "LABOTECH_RELEASE=${LABOTECH_RELEASE}" "${SERVICE}" labotech-encapsulator
    ${COMPOSE_BIN} up -d
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

wait_for_encapsulator_health() {
  # Optional readiness check (warning-only by default).
  # Set ENCAP_HEALTH_REQUIRED=1 to make this stage fail-fast.
  local retries="${ENCAP_HEALTH_RETRIES}"
  local delay="${ENCAP_HEALTH_DELAY_SEC}"
  local i=1
  log "waiting for encapsulator at ${ENCAP_HEALTH_URL}"
  while [[ "${i}" -le "${retries}" ]]; do
    if curl -fsS "${ENCAP_HEALTH_URL}" >/dev/null 2>&1; then
      log "encapsulator healthy (attempt ${i})"
      return 0
    fi
    log "encapsulator not ready yet (${i}/${retries})…"
    sleep "${delay}"
    i=$((i + 1))
  done
  log "encapsulator did not respond within $((retries * delay))s"
  return 1
}

prompt_kill_4100_offender() {
  # Interactive helper: when 4100 is occupied, ask operator if offending PID(s)
  # should be terminated. Disabled automatically in non-interactive runs.
  if [[ "${ENCAP_PROMPT_KILL_ON_4100}" != "1" ]]; then
    echo "[triage] interactive kill prompt disabled (ENCAP_PROMPT_KILL_ON_4100=${ENCAP_PROMPT_KILL_ON_4100})"
    return 0
  fi
  if [[ ! -t 0 ]]; then
    echo "[triage] non-interactive shell detected; skipping kill prompt"
    return 0
  fi
  if ! command -v ss >/dev/null 2>&1; then
    echo "[triage] ss not available; cannot auto-detect listener PID(s)"
    return 0
  fi

  local ss_lines pids pid line ans
  ss_lines="$(ss -ltnp 2>/dev/null | awk '/:4100/ {print $0}' || true)"
  if [[ -z "${ss_lines}" ]]; then
    echo "[triage] no :4100 listener detected at prompt stage"
    return 0
  fi

  pids="$(printf '%s\n' "${ss_lines}" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | awk '!seen[$0]++')"
  if [[ -z "${pids}" ]]; then
    echo "[triage] :4100 is occupied but PID extraction failed; skipping kill prompt"
    return 0
  fi

  echo "[triage] :4100 listener(s) detected:"
  printf '%s\n' "${ss_lines}"
  echo "[triage] For safety, only confirm kill for processes you recognize as conflicting."
  for pid in ${pids}; do
    line="$(ps -p "${pid}" -o pid=,ppid=,user=,comm=,args= 2>/dev/null || true)"
    echo "[triage] PID ${pid}: ${line:-<process details unavailable>}"
    printf "Kill PID %s now? [y/N]: " "${pid}"
    read -r ans
    if [[ "${ans}" =~ ^[Yy]$ ]]; then
      if kill -TERM "${pid}" 2>/dev/null; then
        echo "[triage] sent SIGTERM to PID ${pid}"
      else
        echo "[triage] unable to kill PID ${pid} (permissions or process exited)"
      fi
    else
      echo "[triage] kept PID ${pid}"
    fi
  done
  return 0
}

triage_encapsulator_failure() {
  echo "[triage] encapsulator readiness diagnostics"
  echo "[triage] compose command: ${COMPOSE_BIN}"
  echo "[triage] service status:"
  ${COMPOSE_BIN} ps || true

  echo "[triage] host listener check (:4100):"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp | awk 'NR==1 || /:4100/' || true
  else
    echo "[triage] ss not available"
  fi

  echo "[triage] host health probe ${ENCAP_HEALTH_URL}:"
  curl -fsS --max-time 5 "${ENCAP_HEALTH_URL}" || echo "[triage] host health probe failed"

  echo "[triage] encapsulator logs (tail 120):"
  ${COMPOSE_BIN} logs --tail=120 labotech-encapsulator || true

  echo "[triage] ${SERVICE} logs (tail 80):"
  ${COMPOSE_BIN} logs --tail=80 "${SERVICE}" || true

  prompt_kill_4100_offender
}

run_encap_triage_if_enabled() {
  if [[ "${ENCAP_TRIAGE_ON_FAIL}" == "1" ]]; then
    triage_encapsulator_failure
  else
    echo "[triage] skipped (ENCAP_TRIAGE_ON_FAIL=${ENCAP_TRIAGE_ON_FAIL})"
  fi
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
  if [[ "${ENCAP_HEALTH_CHECK_ENABLED}" != "1" ]]; then
    log "stage: wait for encapsulator health"
    echo "[WARN] encapsulator readiness check skipped (ENCAP_HEALTH_CHECK_ENABLED=${ENCAP_HEALTH_CHECK_ENABLED})"
  else
    if [[ "${ENCAP_HEALTH_REQUIRED}" == "1" ]]; then
      if ! run_stage_or_die "wait for encapsulator health (required)" wait_for_encapsulator_health; then
        run_encap_triage_if_enabled
        return 1
      fi
    else
      if ! run_stage_warn "wait for encapsulator health (optional)" wait_for_encapsulator_health; then
        run_encap_triage_if_enabled
      fi
    fi
  fi
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

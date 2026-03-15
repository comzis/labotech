#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-4100}"
AUTO_NO="${AUTO_NO:-0}"

log() {
  echo "[triage-port] $*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    log "missing command: ${cmd}"
    exit 1
  fi
}

prompt_kill() {
  local pid="$1"
  local details="$2"
  local ans

  if [[ "${AUTO_NO}" == "1" ]]; then
    log "AUTO_NO=1, keeping PID ${pid}"
    return 0
  fi
  if [[ ! -t 0 ]]; then
    log "non-interactive shell, keeping PID ${pid}"
    return 0
  fi

  echo "[triage-port] PID ${pid}: ${details}"
  printf "Kill PID %s on port %s? [y/N]: " "${pid}" "${PORT}"
  read -r ans
  if [[ "${ans}" =~ ^[Yy]$ ]]; then
    if kill -TERM "${pid}" 2>/dev/null; then
      log "sent SIGTERM to PID ${pid}"
      sleep 1
      return 0
    fi
    log "failed to terminate PID ${pid} (permission denied or exited)"
    return 1
  fi
  log "kept PID ${pid}"
  return 0
}

main() {
  require_cmd ss
  require_cmd awk
  require_cmd sed
  require_cmd ps

  local lines pids pid details
  lines="$(ss -ltnp 2>/dev/null | awk -v p=":${PORT}" 'index($0, p) > 0 {print $0}' || true)"
  if [[ -z "${lines}" ]]; then
    log "no listeners found on :${PORT}"
    exit 0
  fi

  log "listener(s) found on :${PORT}:"
  printf '%s\n' "${lines}"

  pids="$(printf '%s\n' "${lines}" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | awk '!seen[$0]++')"
  if [[ -z "${pids}" ]]; then
    log "unable to extract PID(s) from listener output"
    exit 1
  fi

  for pid in ${pids}; do
    details="$(ps -p "${pid}" -o pid=,ppid=,user=,comm=,args= 2>/dev/null || true)"
    prompt_kill "${pid}" "${details:-<details unavailable>}" || true
  done

  log "post-action listener check:"
  ss -ltnp 2>/dev/null | awk -v p=":${PORT}" 'NR==1 || index($0, p) > 0 {print $0}' || true
}

main "$@"

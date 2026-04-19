#!/usr/bin/env bash
# Disk housekeeping for Labotech (broadcast appliance).
# Safe to run from cron — all operations are non-destructive to running streams.
#
# Install as cron job (run once as your service user):
#   bash scripts/disk-housekeeping.sh --install-cron
#
# Manual run:
#   bash scripts/disk-housekeeping.sh
#
# The --install-cron flag adds a 03:00 daily entry to the current user's crontab.
# Remove it with:  crontab -e  (delete the disk-housekeeping line)

set -euo pipefail

SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
LOG_FILE="${DISK_HOUSEKEEPING_LOG:-/tmp/disk-housekeeping.log}"
# Warn if free space drops below this after cleanup (informational only).
WARN_FREE_MB="${WARN_FREE_MB:-3072}"

log() { echo "[housekeeping] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" | tee -a "${LOG_FILE}"; }

free_mb() {
  df -Pk "${1:-.}" 2>/dev/null | awk 'NR==2{printf "%.0f", $4/1024}'
}

# ── 1. Docker container JSON logs ────────────────────────────────────────────
# These are NOT removed by docker system prune and are the #1 cause of silent
# disk exhaustion on this server.  Each container accumulates stdout/stderr
# here without bound unless log rotation is in /etc/docker/daemon.json.
truncate_docker_json_logs() {
  if [[ ! -d /var/lib/docker/containers ]]; then return; fi
  local before_kb after_kb
  before_kb=$(du -sk /var/lib/docker/containers 2>/dev/null | awk '{print $1}' || echo 0)
  find /var/lib/docker/containers -maxdepth 2 -name '*-json.log' \
    -exec truncate -s 0 {} \; 2>/dev/null || true
  after_kb=$(du -sk /var/lib/docker/containers 2>/dev/null | awk '{print $1}' || echo 0)
  local reclaimed=$(( (before_kb - after_kb) / 1024 ))
  log "docker json logs: reclaimed ${reclaimed} MB"
}

# ── 2. App logs inside containers ────────────────────────────────────────────
# Rotate *.log and *.jsonl files in /app/logs inside running containers.
# Files older than 7 days are removed; others are kept but not truncated so
# operators retain recent history for diagnostics.
rotate_app_logs() {
  local compose_bin
  if docker compose version >/dev/null 2>&1; then
    compose_bin="docker compose"
  else
    log "docker compose v2 plugin not found — skipping app log rotation"
    return
  fi

  for svc in labotech labotech-encapsulator; do
    ${compose_bin} exec -T "${svc}" sh -lc '
      if [ -d /app/logs ]; then
        # Remove log files older than 7 days
        find /app/logs -type f \( -name "*.log" -o -name "*.jsonl" \) -mtime +7 -delete 2>/dev/null || true
        # Truncate very large files (>50 MB) that are still recent
        find /app/logs -type f \( -name "*.log" -o -name "*.jsonl" \) -size +50M \
          -exec truncate -s 0 {} \; 2>/dev/null || true
      fi
    ' 2>/dev/null || true
  done
  log "app logs: rotation complete"
}

# ── 3. Stale Docker images and build cache ────────────────────────────────────
prune_docker() {
  local before after reclaimed
  before=$(free_mb .)
  docker image prune -af 2>/dev/null || true
  docker builder prune -af 2>/dev/null || true
  docker container prune -f 2>/dev/null || true
  after=$(free_mb .)
  log "docker prune: disk was ${before} MB free, now ${after} MB free"
}

# ── 4. systemd journal ────────────────────────────────────────────────────────
vacuum_journal() {
  if command -v journalctl >/dev/null 2>&1; then
    journalctl --vacuum-size=200M 2>/dev/null || true
    journalctl --vacuum-time=14d 2>/dev/null || true
    log "journal: vacuum complete"
  fi
}

# ── 5. apt cache ─────────────────────────────────────────────────────────────
clean_apt() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get clean 2>/dev/null || true
    log "apt: cache cleaned"
  fi
}

# ── 6. Temp files ─────────────────────────────────────────────────────────────
clean_tmp() {
  # Remove files in /tmp older than 3 days (safe on this dedicated appliance)
  find /tmp -maxdepth 1 -type f -mtime +3 -delete 2>/dev/null || true
  log "tmp: old files removed"
}

# ── 7. Install cron ──────────────────────────────────────────────────────────
install_cron() {
  local entry="0 3 * * * bash ${SCRIPT_PATH} >> ${LOG_FILE} 2>&1"
  # Idempotent: only add if not already present
  if crontab -l 2>/dev/null | grep -qF "${SCRIPT_PATH}"; then
    echo "[housekeeping] cron entry already present — no change"
  else
    ( crontab -l 2>/dev/null; echo "${entry}" ) | crontab -
    echo "[housekeeping] cron installed: ${entry}"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--install-cron" ]]; then
  install_cron
  exit 0
fi

log "=== disk housekeeping start === free=$(free_mb .) MB"

truncate_docker_json_logs
rotate_app_logs
prune_docker
vacuum_journal
clean_apt
clean_tmp

final_free=$(free_mb .)
log "=== done === free=${final_free} MB"

if (( final_free < WARN_FREE_MB )); then
  log "WARNING: free space ${final_free} MB still below ${WARN_FREE_MB} MB after cleanup"
  log "         run: du -sh /* 2>/dev/null | sort -rh | head -20"
  log "         to identify the largest directories"
fi

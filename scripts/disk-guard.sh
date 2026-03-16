#!/usr/bin/env bash
# disk-guard.sh — scheduled disk housekeeping for Labotech server.
#
# Designed to run from cron while the service is LIVE. It does NOT stop or
# restart containers. It cleans the categories of disk waste that accumulate
# silently between deploys:
#   1. Docker container JSON logs (/var/lib/docker/containers/*/*-json.log)
#   2. Unused Docker images / build cache (docker system prune)
#   3. apt package cache and orphaned packages
#   4. systemd journal (capped at 200 MB / 7 days)
#   5. /tmp files older than 1 day
#   6. Stale thumbnail JPEGs older than 1 hour
#
# Cron entry (3am daily, run as service user 'boro'):
#   0 3 * * * boro bash /home/boro/LaboTech/labotech/scripts/disk-guard.sh >> /var/log/labotech-disk-guard.log 2>&1
#
# The log file accumulates indefinitely — rotate with logrotate or cap it:
#   /etc/logrotate.d/labotech-disk-guard
#   /var/log/labotech-disk-guard.log { weekly rotate 4 compress missingok notifempty }
#
# Environment overrides:
#   WARN_FREE_MB   — log a warning when free space is below this (default 2048)
#   REPO_ROOT      — override repo root detection (default: parent of scripts/)
set -euo pipefail

WARN_FREE_MB="${WARN_FREE_MB:-2048}"

log() {
  echo "[disk-guard] $(date '+%Y-%m-%dT%H:%M:%S') $*"
}

disk_free_mb() {
  local path="$1"
  df -Pk "${path}" | awk 'NR==2{printf "%d", $4/1024}'
}

main() {
  local script_dir repo_root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="${REPO_ROOT:-$(cd "${script_dir}/.." && pwd)}"

  log "=== disk-guard start ==="

  # --- Snapshot free space before ---
  local docker_root before_fs_mb before_docker_mb
  docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo '/var/lib/docker')"
  before_fs_mb="$(disk_free_mb /)"
  before_docker_mb="$(disk_free_mb "${docker_root}")"
  log "before: root free=${before_fs_mb}MB  docker free=${before_docker_mb}MB"

  # --- 1. Docker container JSON logs ---
  # These are NOT removed by docker system prune and grow without bound unless
  # log rotation is configured in /etc/docker/daemon.json.
  if [[ -d /var/lib/docker/containers ]]; then
    local before_kb after_kb reclaimed_mb
    before_kb=$(du -sk /var/lib/docker/containers 2>/dev/null | awk '{print $1}')
    find /var/lib/docker/containers -maxdepth 2 -name '*-json.log' \
      -exec truncate -s 0 {} \; 2>/dev/null || true
    after_kb=$(du -sk /var/lib/docker/containers 2>/dev/null | awk '{print $1}')
    reclaimed_mb=$(( (before_kb - after_kb) / 1024 ))
    log "docker json logs truncated: reclaimed ~${reclaimed_mb} MB"
  fi

  # --- 2. Docker unused images / build cache ---
  # Safe while containers are running — only removes images not referenced by
  # any running or stopped container.
  docker system prune -af 2>/dev/null || true
  log "docker system prune complete"

  # --- 3. Host volume: apt, journal, /tmp ---
  if command -v sudo >/dev/null 2>&1; then
    sudo -n apt-get clean >/dev/null 2>&1 && log "apt cache cleared" || true
    sudo -n apt-get autoremove -y >/dev/null 2>&1 && log "apt autoremove complete" || true
    sudo -n journalctl --vacuum-size=200M >/dev/null 2>&1 || true
    sudo -n journalctl --vacuum-time=7d  >/dev/null 2>&1 && log "journal vacuumed (200MB/7d cap)" || true
    sudo -n find /tmp -type f -atime +1 -delete 2>/dev/null && log "/tmp stale files removed" || true
  else
    log "sudo not available — skipping apt/journal/tmp cleanup"
  fi

  # --- 4. Stale thumbnail JPEGs (older than 1 hour) ---
  local thumb_dir="${repo_root}/logs/thumbnails"
  if [[ -d "${thumb_dir}" ]]; then
    local thumb_count
    thumb_count=$(find "${thumb_dir}" -maxdepth 1 -name '*.jpg' -mmin +60 2>/dev/null | wc -l)
    find "${thumb_dir}" -maxdepth 1 -name '*.jpg' -mmin +60 -delete 2>/dev/null || true
    log "stale thumbnails removed: ${thumb_count} file(s)"
  fi

  # --- Snapshot free space after ---
  local after_fs_mb after_docker_mb
  after_fs_mb="$(disk_free_mb /)"
  after_docker_mb="$(disk_free_mb "${docker_root}")"
  log "after:  root free=${after_fs_mb}MB  docker free=${after_docker_mb}MB"
  log "gained: root +$(( after_fs_mb - before_fs_mb ))MB  docker +$(( after_docker_mb - before_docker_mb ))MB"

  if (( after_fs_mb < WARN_FREE_MB )); then
    log "WARNING: root still below ${WARN_FREE_MB}MB after cleanup — manual intervention may be needed"
  fi

  log "=== disk-guard complete ==="
}

main "$@"

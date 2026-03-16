#!/usr/bin/env bash
set -euo pipefail

API_HOST="${1:-10.67.18.29}"
API_PORT="${2:-4000}"
SERVICE="${3:-labotech}"

GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-main}"

# 4 GB is sufficient for a Docker build + image layers on this server.
# The previous 8 GB default blocked deploys on a disk that legitimately
# never has 8 GB free (broadcast appliance, ~40 GB disk, always busy).
MIN_FREE_MB="${MIN_FREE_MB:-4096}"
MIN_FREE_INODE_PCT="${MIN_FREE_INODE_PCT:-10}"
DISK_CHECK_PATH="${DISK_CHECK_PATH:-.}"

# If 1, auto-run cleanup when disk check fails.
AUTO_CLEAN_ON_LOW_DISK="${AUTO_CLEAN_ON_LOW_DISK:-1}"
# If 1, include "down + system prune --volumes" when low disk persists.
AUTO_CLEAN_AGGRESSIVE="${AUTO_CLEAN_AGGRESSIVE:-0}"

COMPOSE_BIN=""

log() {
  echo "[update-deploy] $*"
}

require_cmds() {
  local missing=0
  local c
  for c in git docker df awk sed bash; do
    if ! command -v "${c}" >/dev/null 2>&1; then
      echo "[update-deploy] missing command: ${c}"
      missing=1
    fi
  done
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN="docker-compose"
  else
    echo "[update-deploy] missing command: docker compose (v2) or docker-compose (v1)"
    missing=1
  fi
  return "${missing}"
}

disk_metrics() {
  local path="$1"
  local docker_root="$2"

  local fs_avail_kb fs_avail_mb fs_inode_used_pct fs_inode_free_pct
  local docker_avail_kb docker_avail_mb docker_inode_used_pct docker_inode_free_pct

  fs_avail_kb="$(df -Pk "${path}" | awk 'NR==2{print $4}')"
  fs_avail_mb=$((fs_avail_kb / 1024))
  fs_inode_used_pct="$(df -Pi "${path}" | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
  fs_inode_free_pct=$((100 - fs_inode_used_pct))

  docker_avail_kb="$(df -Pk "${docker_root}" | awk 'NR==2{print $4}')"
  docker_avail_mb=$((docker_avail_kb / 1024))
  docker_inode_used_pct="$(df -Pi "${docker_root}" | awk 'NR==2{gsub(/%/,"",$5); print $5}')"
  docker_inode_free_pct=$((100 - docker_inode_used_pct))

  echo "${fs_avail_mb},${fs_inode_free_pct},${docker_avail_mb},${docker_inode_free_pct}"
}

check_disk_headroom() {
  local path="${DISK_CHECK_PATH}"
  local docker_root
  docker_root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [[ -z "${docker_root}" ]]; then
    docker_root="/var/lib/docker"
  fi

  local metrics
  metrics="$(disk_metrics "${path}" "${docker_root}")"
  local fs_avail_mb fs_inode_free_pct docker_avail_mb docker_inode_free_pct
  IFS=',' read -r fs_avail_mb fs_inode_free_pct docker_avail_mb docker_inode_free_pct <<< "${metrics}"

  log "disk check: ${path} free=${fs_avail_mb}MB inode_free=${fs_inode_free_pct}%"
  log "docker root: ${docker_root} free=${docker_avail_mb}MB inode_free=${docker_inode_free_pct}%"

  if (( fs_avail_mb < MIN_FREE_MB )); then
    log "insufficient free disk on ${path}: ${fs_avail_mb}MB < ${MIN_FREE_MB}MB"
    return 1
  fi
  if (( docker_avail_mb < MIN_FREE_MB )); then
    log "insufficient free disk on docker root ${docker_root}: ${docker_avail_mb}MB < ${MIN_FREE_MB}MB"
    return 1
  fi
  if (( fs_inode_free_pct < MIN_FREE_INODE_PCT )); then
    log "insufficient free inodes on ${path}: ${fs_inode_free_pct}% < ${MIN_FREE_INODE_PCT}%"
    return 1
  fi
  if (( docker_inode_free_pct < MIN_FREE_INODE_PCT )); then
    log "insufficient free inodes on docker root ${docker_root}: ${docker_inode_free_pct}% < ${MIN_FREE_INODE_PCT}%"
    return 1
  fi
  return 0
}

container_log_cleanup() {
  local svc
  for svc in "${SERVICE}" "labotech-encapsulator"; do
    ${COMPOSE_BIN} ps --services 2>/dev/null | awk '{print $1}' | while read -r existing; do
      if [[ "${existing}" == "${svc}" ]]; then
        ${COMPOSE_BIN} exec -T "${svc}" sh -lc '
          if [ -d /app/logs ]; then
            find /app/logs -type f \( -name "*.log" -o -name "*.jsonl" \) -exec truncate -s 0 {} \; || true
          fi
        ' || true
      fi
    done
  done
}

auto_cleanup() {
  log "auto cleanup: stopping containers and pruning docker artifacts"

  # Bring containers down first so their image layers can be freed by docker prune.
  # Without this, the running container holds the image in use and prune reclaims nothing.
  # This is safe — deploy-one-shot.sh will rebuild and restart them immediately after.
  ${COMPOSE_BIN} down --remove-orphans 2>/dev/null || true

  container_log_cleanup

  # Truncate Docker container JSON logs — these are NOT removed by docker system
  # prune and are the most common cause of silent disk exhaustion on this server.
  # Each running container accumulates stdout/stderr here without bound unless
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

  docker system prune -af || true

  if [[ "${AUTO_CLEAN_AGGRESSIVE}" == "1" ]]; then
    log "auto cleanup aggressive mode enabled"
    docker system prune -af --volumes || true
  fi

  # Host root volume (ubuntu--vg-ubuntu--lv) cleanup — apt cache, journal, /tmp
  if command -v sudo >/dev/null 2>&1; then
    sudo -n apt-get clean >/dev/null 2>&1 || true
    sudo -n apt-get autoremove -y >/dev/null 2>&1 || true
    sudo -n journalctl --vacuum-size=200M >/dev/null 2>&1 || true
    sudo -n journalctl --vacuum-time=7d >/dev/null 2>&1 || true
    sudo -n find /tmp -type f -atime +1 -delete 2>/dev/null || true
    local lv_free_mb
    lv_free_mb=$(df -Pk /dev/mapper/ubuntu--vg-ubuntu--lv 2>/dev/null | awk 'NR==2{printf "%d", $4/1024}' || echo '?')
    log "root LV free after host cleanup: ${lv_free_mb}MB"
  fi
}

safe_git_update() {
  log "git update: ${GIT_REMOTE}/${GIT_BRANCH}"
  rm -f .git/index.lock
  git fetch --prune "${GIT_REMOTE}"
  git checkout "${GIT_BRANCH}"
  git pull --ff-only "${GIT_REMOTE}" "${GIT_BRANCH}"
  log "git head: $(git rev-parse --short HEAD)"
}

main() {
  local script_dir repo_root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_root="$(cd "${script_dir}/.." && pwd)"
  cd "${repo_root}"

  require_cmds

  if ! check_disk_headroom; then
    if [[ "${AUTO_CLEAN_ON_LOW_DISK}" != "1" ]]; then
      log "low disk and AUTO_CLEAN_ON_LOW_DISK=0; aborting"
      exit 1
    fi
    auto_cleanup
    if ! check_disk_headroom; then
      log "disk still below threshold after cleanup; aborting before git fetch"
      exit 1
    fi
  fi

  safe_git_update

  # Clear stale thumbnail JPEGs before every deploy.
  # Thumbnails from a previous run (especially after a disk-full crash) can be
  # 0-byte or corrupt — they render as black frames in the multiview until the
  # next probe overwrites them. Wiping here guarantees a clean capture on startup.
  local thumb_dir="${repo_root}/logs/thumbnails"
  if [[ -d "${thumb_dir}" ]]; then
    local thumb_count
    thumb_count=$(find "${thumb_dir}" -maxdepth 1 -name '*.jpg' 2>/dev/null | wc -l)
    rm -f "${thumb_dir}"/*.jpg 2>/dev/null || true
    log "thumbnail cache cleared: ${thumb_count} file(s) removed"
  fi

  bash scripts/deploy-one-shot.sh "${API_HOST}" "${API_PORT}" "${SERVICE}"
}

main "$@"

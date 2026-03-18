#!/usr/bin/env bash
set -euo pipefail

# Fast disk recovery for deploy incidents.
# This intentionally removes Docker images/cache and may interrupt running services.
#
# Usage:
#   bash scripts/reclaim-disk-fast.sh --yes
# Optional:
#   --skip-down   Do not stop compose services first (less reclaim potential)

YES=0
SKIP_DOWN=0

for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    --skip-down) SKIP_DOWN=1 ;;
    *)
      echo "[reclaim-disk-fast] unknown argument: $arg"
      echo "Usage: bash scripts/reclaim-disk-fast.sh --yes [--skip-down]"
      exit 2
      ;;
  esac
done

if [[ "$YES" != "1" ]]; then
  echo "[reclaim-disk-fast] refusing to run without --yes"
  echo "[reclaim-disk-fast] this script destroys Docker images/cache and prunes volumes"
  exit 1
fi

log() {
  echo "[reclaim-disk-fast] $*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

need_cmd docker
need_cmd df
need_cmd awk
need_cmd du

COMPOSE_BIN=""
if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN="docker compose"
fi

show_space() {
  log "filesystem:"
  df -h
  log "docker usage:"
  docker system df || true
}

truncate_docker_json_logs() {
  local root="/var/lib/docker/containers"
  if [[ ! -d "$root" ]]; then
    log "docker containers path not found ($root), skipping log truncate"
    return 0
  fi

  local before_kb after_kb reclaimed_mb
  before_kb="$(du -sk "$root" 2>/dev/null | awk '{print $1}')"
  if command -v sudo >/dev/null 2>&1; then
    sudo find "$root" -maxdepth 2 -name '*-json.log' -exec truncate -s 0 {} \; 2>/dev/null || true
  else
    find "$root" -maxdepth 2 -name '*-json.log' -exec truncate -s 0 {} \; 2>/dev/null || true
  fi
  after_kb="$(du -sk "$root" 2>/dev/null | awk '{print $1}')"
  reclaimed_mb=$(( (before_kb - after_kb) / 1024 ))
  log "docker json logs truncated: reclaimed ~${reclaimed_mb} MB"
}

log "starting fast reclaim"
show_space

if [[ "$SKIP_DOWN" != "1" && -n "$COMPOSE_BIN" ]]; then
  log "stopping compose services before prune"
  ${COMPOSE_BIN} down --remove-orphans || true
else
  log "skip compose down (SKIP_DOWN=$SKIP_DOWN, compose='${COMPOSE_BIN:-none}')"
fi

truncate_docker_json_logs

log "pruning docker images/cache/containers/networks/volumes"
docker system prune -af --volumes || true
docker builder prune -af || true

log "host cache cleanup (best effort)"
if command -v sudo >/dev/null 2>&1; then
  sudo journalctl --vacuum-time=7d >/dev/null 2>&1 || true
  sudo apt-get clean >/dev/null 2>&1 || true
fi

show_space
log "done"

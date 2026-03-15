#!/usr/bin/env bash
set -euo pipefail

# Emergency disk/inode cleanup for production hosts.
# Safe mode is default. Aggressive mode is opt-in and can disrupt services.
#
# Usage:
#   bash scripts/emergency-clean.sh
#   bash scripts/emergency-clean.sh --aggressive --yes

MODE="safe"
YES=0

for arg in "$@"; do
  case "$arg" in
    --aggressive) MODE="aggressive" ;;
    --yes) YES=1 ;;
    *)
      echo "[emergency-clean] unknown argument: $arg"
      echo "Usage: bash scripts/emergency-clean.sh [--aggressive] [--yes]"
      exit 2
      ;;
  esac
done

log() {
  echo "[emergency-clean] $*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

for c in docker df awk find truncate du journalctl; do
  need_cmd "$c"
done

COMPOSE_BIN=""
if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN="docker-compose"
fi

show_space() {
  log "filesystem space:"
  df -h
  log "inode usage:"
  df -i
  log "docker space:"
  docker system df || true
}

truncate_docker_json_logs() {
  local root="/var/lib/docker/containers"
  if [[ ! -d "$root" ]]; then
    log "docker containers path not found: $root"
    return 0
  fi
  local before_kb after_kb reclaimed_mb
  before_kb="$(du -sk "$root" 2>/dev/null | awk '{print $1}')"
  # Needs elevated permissions on most hosts.
  sudo find "$root" -maxdepth 2 -name '*-json.log' -exec truncate -s 0 {} \; 2>/dev/null || true
  after_kb="$(du -sk "$root" 2>/dev/null | awk '{print $1}')"
  reclaimed_mb=$(( (before_kb - after_kb) / 1024 ))
  log "docker json logs truncated: reclaimed ~${reclaimed_mb} MB"
}

safe_cleanup() {
  log "starting safe cleanup"
  truncate_docker_json_logs
  docker builder prune -af || true
  docker image prune -af || true
  docker container prune -f || true
  docker system prune -af || true
  sudo apt-get clean >/dev/null 2>&1 || true
  sudo journalctl --vacuum-size=200M >/dev/null 2>&1 || true
  sudo journalctl --vacuum-time=14d >/dev/null 2>&1 || true
  log "safe cleanup complete"
}

aggressive_cleanup() {
  if [[ "$YES" != "1" ]]; then
    log "aggressive mode requires --yes (this may interrupt services)"
    exit 1
  fi
  if [[ -z "$COMPOSE_BIN" ]]; then
    log "compose command not found; cannot run aggressive mode"
    exit 1
  fi
  log "starting aggressive cleanup"
  ${COMPOSE_BIN} down --remove-orphans || true
  docker system prune -af --volumes || true
  ${COMPOSE_BIN} up -d || true
  log "aggressive cleanup complete"
}

show_space
safe_cleanup
if [[ "$MODE" == "aggressive" ]]; then
  aggressive_cleanup
fi
show_space
log "done"

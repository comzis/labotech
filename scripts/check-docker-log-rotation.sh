#!/usr/bin/env bash
set -euo pipefail

# Check Docker log rotation configuration and current JSON log footprint.
# Run with or without sudo:
#   bash scripts/check-docker-log-rotation.sh

DOCKER_DAEMON_JSON="${DOCKER_DAEMON_JSON:-/etc/docker/daemon.json}"

log() {
  echo "[docker-log-rotation-check] $*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

need_cmd docker
need_cmd python3
need_cmd awk
need_cmd df

log "docker logging driver: $(docker info --format '{{.LoggingDriver}}' 2>/dev/null || echo unknown)"

if [[ -f "${DOCKER_DAEMON_JSON}" ]]; then
  python3 - "${DOCKER_DAEMON_JSON}" <<'PY'
import json
import sys

cfg = sys.argv[1]
with open(cfg, "r", encoding="utf-8") as f:
    data = json.load(f)
driver = data.get("log-driver", "unset")
opts = data.get("log-opts", {}) if isinstance(data.get("log-opts"), dict) else {}
max_size = opts.get("max-size", "unset")
max_file = opts.get("max-file", "unset")
print(f"[docker-log-rotation-check] daemon.json path: {cfg}")
print(f"[docker-log-rotation-check] daemon.json log-driver: {driver}")
print(f"[docker-log-rotation-check] daemon.json log-opts.max-size: {max_size}")
print(f"[docker-log-rotation-check] daemon.json log-opts.max-file: {max_file}")
PY
else
  log "daemon.json not found at ${DOCKER_DAEMON_JSON}"
fi

if [[ -d /var/lib/docker/containers ]]; then
  log "largest docker json logs:"
  if command -v sudo >/dev/null 2>&1; then
    sudo du -ah /var/lib/docker/containers 2>/dev/null | awk '/-json\.log$/ {print}' | sort -rh | head -n 10
  else
    du -ah /var/lib/docker/containers 2>/dev/null | awk '/-json\.log$/ {print}' | sort -rh | head -n 10
  fi
fi

log "filesystem usage:"
df -h /

#!/usr/bin/env bash
set -euo pipefail

# Install persistent Docker JSON log rotation to prevent disk exhaustion.
# Run as root:
#   sudo bash scripts/install-docker-log-rotation.sh
#
# Optional overrides:
#   MAX_SIZE=50m MAX_FILES=3 sudo bash scripts/install-docker-log-rotation.sh

MAX_SIZE="${MAX_SIZE:-50m}"
MAX_FILES="${MAX_FILES:-3}"
DOCKER_DAEMON_JSON="${DOCKER_DAEMON_JSON:-/etc/docker/daemon.json}"

log() {
  echo "[docker-log-rotation] $*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "missing command: $1"
    exit 1
  }
}

need_cmd python3
need_cmd systemctl
need_cmd docker

if [[ "${EUID}" -ne 0 ]]; then
  log "run as root (use sudo)"
  exit 1
fi

mkdir -p "$(dirname "${DOCKER_DAEMON_JSON}")"

if [[ -f "${DOCKER_DAEMON_JSON}" ]]; then
  backup="${DOCKER_DAEMON_JSON}.bak.$(date +%Y%m%d%H%M%S)"
  cp "${DOCKER_DAEMON_JSON}" "${backup}"
  log "backup created: ${backup}"
fi

tmp="$(mktemp)"
python3 - "${DOCKER_DAEMON_JSON}" "${MAX_SIZE}" "${MAX_FILES}" "${tmp}" <<'PY'
import json
import os
import sys

cfg_path, max_size, max_files, out_path = sys.argv[1:5]
data = {}
if os.path.exists(cfg_path):
    with open(cfg_path, "r", encoding="utf-8") as f:
        txt = f.read().strip()
        if txt:
            data = json.loads(txt)
if not isinstance(data, dict):
    raise SystemExit("daemon.json must contain a JSON object")

log_opts = data.get("log-opts")
if not isinstance(log_opts, dict):
    log_opts = {}

log_opts["max-size"] = str(max_size)
log_opts["max-file"] = str(max_files)
data["log-opts"] = log_opts
data["log-driver"] = "json-file"

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, sort_keys=True)
    f.write("\n")
PY

mv "${tmp}" "${DOCKER_DAEMON_JSON}"
chmod 0644 "${DOCKER_DAEMON_JSON}"
log "written: ${DOCKER_DAEMON_JSON}"

systemctl restart docker
log "docker restarted"

docker info --format '{{.LoggingDriver}}' | sed 's/^/[docker-log-rotation] logging_driver=/' || true
docker info --format '{{json .}}' >/dev/null 2>&1 || true
log "done"

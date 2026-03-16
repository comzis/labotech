#!/usr/bin/env bash
# setup-docker-log-rotation.sh — configure Docker daemon global log rotation.
# Run once on the server as a user with sudo access:
#   bash scripts/setup-docker-log-rotation.sh
#
# WARNING: restarts the Docker daemon — all containers will stop and restart.
#          Run during a quiet period.
set -euo pipefail

DAEMON_JSON="/etc/docker/daemon.json"
MAX_SIZE="${MAX_SIZE:-50m}"
MAX_FILE="${MAX_FILE:-5}"

echo "[setup-docker-logs] configuring Docker log rotation"
echo "[setup-docker-logs] max-size : ${MAX_SIZE}"
echo "[setup-docker-logs] max-file : ${MAX_FILE}"

if [[ -f "${DAEMON_JSON}" ]]; then
  echo "[setup-docker-logs] existing ${DAEMON_JSON}:"
  cat "${DAEMON_JSON}"
  echo ""
  echo "[setup-docker-logs] WARNING: this will overwrite ${DAEMON_JSON}"
  read -r -p "Continue? [y/N] " confirm
  if [[ "${confirm,,}" != "y" ]]; then
    echo "[setup-docker-logs] aborted"
    exit 0
  fi
fi

sudo tee "${DAEMON_JSON}" > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "${MAX_SIZE}",
    "max-file": "${MAX_FILE}"
  }
}
EOF

echo "[setup-docker-logs] written: ${DAEMON_JSON}"
cat "${DAEMON_JSON}"

echo "[setup-docker-logs] restarting Docker daemon..."
sudo systemctl restart docker
echo "[setup-docker-logs] done — log rotation active for all new containers"
echo "[setup-docker-logs] note: existing containers need to be recreated to pick up the new limits"

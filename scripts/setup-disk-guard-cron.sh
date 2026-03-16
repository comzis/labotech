#!/usr/bin/env bash
# setup-disk-guard-cron.sh — install the nightly disk-guard cron entry.
# Run once on the server as a user with sudo access:
#   bash scripts/setup-disk-guard-cron.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD_SCRIPT="${SCRIPT_DIR}/disk-guard.sh"
CRON_FILE="/etc/cron.d/labotech-disk-guard"
LOG_FILE="/var/log/labotech-disk-guard.log"
RUN_AS="${1:-boro}"

echo "[setup-cron] installing disk-guard cron entry"
echo "[setup-cron] script : ${GUARD_SCRIPT}"
echo "[setup-cron] run as : ${RUN_AS}"
echo "[setup-cron] log    : ${LOG_FILE}"

if [[ ! -f "${GUARD_SCRIPT}" ]]; then
  echo "[setup-cron] ERROR: ${GUARD_SCRIPT} not found"
  exit 1
fi

chmod +x "${GUARD_SCRIPT}"

CRON_LINE="0 3 * * * ${RUN_AS} bash ${GUARD_SCRIPT} >> ${LOG_FILE} 2>&1"

echo "${CRON_LINE}" | sudo tee "${CRON_FILE}" > /dev/null
sudo chmod 644 "${CRON_FILE}"

echo "[setup-cron] written: ${CRON_FILE}"
cat "${CRON_FILE}"
echo "[setup-cron] done — disk-guard will run nightly at 03:00"

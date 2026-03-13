#!/usr/bin/env bash
# Roll back Labotech Ubuntu host optimization profile (v2)
# Run as root:
#   sudo bash scripts/rollback-host-optimization-v2.sh

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/rollback-host-optimization-v2.sh"
  exit 1
fi

PROFILE_FILE="/etc/sysctl.d/99-labotech-performance-v2.conf"
BACKUP_DIR="/var/backups/labotech-host-tuning"

echo "==> Rolling back Labotech host optimization v2"

if [[ -f "$PROFILE_FILE" ]]; then
  rm -f "$PROFILE_FILE"
  echo "Removed $PROFILE_FILE"
else
  echo "No v2 profile file found (already removed)."
fi

echo "==> Restoring CPU governor defaults..."
LATEST_CPUFREQ_BACKUP="$(ls -1t "${BACKUP_DIR}"/cpufrequtils-before-v2-*.conf 2>/dev/null | head -n 1 || true)"
if [[ -n "$LATEST_CPUFREQ_BACKUP" && -f "$LATEST_CPUFREQ_BACKUP" ]]; then
  cp "$LATEST_CPUFREQ_BACKUP" /etc/default/cpufrequtils
else
  echo 'GOVERNOR="schedutil"' > /etc/default/cpufrequtils
fi
systemctl restart cpufrequtils 2>/dev/null || true

LATEST_GOV_BACKUP="$(ls -1t "${BACKUP_DIR}"/governor-before-v2-*.txt 2>/dev/null | head -n 1 || true)"
TARGET_GOV="schedutil"
if [[ -n "$LATEST_GOV_BACKUP" && -f "$LATEST_GOV_BACKUP" ]]; then
  TARGET_GOV="$(tr -d '\r\n' < "$LATEST_GOV_BACKUP")"
  [[ -n "$TARGET_GOV" ]] || TARGET_GOV="schedutil"
fi
for g in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
  [[ -f "$g" ]] || continue
  echo "$TARGET_GOV" > "$g" 2>/dev/null || true
done

echo "==> Reloading sysctl..."
sysctl --system -q

echo ""
echo "==> Rollback complete."
echo "Recommended verification:"
echo "  sudo bash scripts/check-routes.sh"
echo "  cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || true"


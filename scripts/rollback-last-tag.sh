#!/usr/bin/env bash
# Roll back server deployment to the previous semantic tag.
# Usage:
#   bash scripts/rollback-last-tag.sh
#   bash scripts/rollback-last-tag.sh v1.4.1

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
DEPLOY_STATE_DIR=".deploy"
PREVIOUS_REF_FILE="${DEPLOY_STATE_DIR}/previous_ref"

if [[ $# -ge 1 ]]; then
  TARGET_TAG="$1"
elif [[ -f "${PREVIOUS_REF_FILE}" ]]; then
  TARGET_TAG="$(cat "${PREVIOUS_REF_FILE}")"
else
  TARGET_TAG="$(git tag --sort=-version:refname | sed -n '2p')"
fi

if [[ -z "${TARGET_TAG:-}" ]]; then
  echo "No rollback ref found. Provide one explicitly:"
  echo "  bash scripts/rollback-last-tag.sh <tag>"
  exit 1
fi

echo "==> Rolling back to ref: ${TARGET_TAG}"
bash scripts/deploy-ref.sh "$TARGET_TAG"

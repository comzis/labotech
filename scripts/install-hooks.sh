#!/usr/bin/env bash
# Labotech pre-commit hook
# 1. Blocks commits containing known AI telemetry injection patterns in source files.
# 2. Enforces that web/package.json version is bumped vs origin/main on every commit
#    that touches source files (src/, web/src/, routes/).
# Documentation (.md) and shell scripts are excluded from telemetry scanning.

set -euo pipefail

# ── 1. AI telemetry pattern check ────────────────────────────────────────────

PATTERNS=(
  '127\.0\.0\.1:7265'
  '#region agent log'
  'antigravity\.inject'
)

# Only scan source files — skip markdown docs, the hook, and shell scripts in scripts/
STAGED=$(git diff --cached --name-only | grep -Ev '\.(md|sh)$|\.git/hooks/' || true)

FOUND=0
if [[ -n "${STAGED}" ]]; then
  for pattern in "${PATTERNS[@]}"; do
    MATCHES=$(git diff --cached -- ${STAGED} 2>/dev/null | grep -E "^\+" | grep -E "${pattern}" || true)
    if [[ -n "${MATCHES}" ]]; then
      echo ""
      echo "  PRE-COMMIT BLOCKED: AI telemetry pattern detected in staged source files"
      echo "  Pattern: ${pattern}"
      echo "  Matches:"
      echo "${MATCHES}" | sed 's/^/    /'
      echo ""
      echo "  Remove the offending lines and re-stage before committing."
      echo "  Do NOT use --no-verify to bypass this check."
      echo ""
      FOUND=1
    fi
  done
fi

# ── 2. Version bump enforcement ───────────────────────────────────────────────
# If any source file is staged, require that web/package.json version differs
# from the version currently on origin/main (or main if remote not available).

SOURCE_STAGED=$(git diff --cached --name-only | grep -E '^(src/|web/src/|routes/|web/package\.json)' || true)

if [[ -n "${SOURCE_STAGED}" ]]; then
  # Local version from staged tree (use index version if package.json is staged,
  # otherwise fall back to the working-tree file).
  if git diff --cached --name-only | grep -q '^web/package\.json$'; then
    LOCAL_VERSION=$(git show :web/package.json | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
  else
    LOCAL_VERSION=$(grep '"version"' web/package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
  fi

  # Version on main (try origin/main first, then local main).
  MAIN_VERSION=""
  if git rev-parse --verify origin/main >/dev/null 2>&1; then
    MAIN_VERSION=$(git show origin/main:web/package.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || true)
  elif git rev-parse --verify main >/dev/null 2>&1; then
    MAIN_VERSION=$(git show main:web/package.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || true)
  fi

  if [[ -n "${MAIN_VERSION}" && "${LOCAL_VERSION}" == "${MAIN_VERSION}" ]]; then
    echo ""
    echo "  PRE-COMMIT BLOCKED: web/package.json version has not been bumped."
    echo ""
    echo "  Current version : ${LOCAL_VERSION}  (same as origin/main)"
    echo "  Source files are staged — a version bump is required before committing."
    echo ""
    echo "  Bump the version in web/package.json (semver: patch/minor/major)"
    echo "  then re-stage the file and retry:"
    echo ""
    echo "    npm version patch --prefix web --no-git-tag-version"
    echo "    git add web/package.json"
    echo ""
    echo "  Do NOT use --no-verify to bypass this check."
    echo ""
    FOUND=1
  fi
fi

exit "${FOUND}"

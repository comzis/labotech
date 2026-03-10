---
name: release-readiness-labotech
description: Runs a pre-release readiness workflow for Labotech services and web UI. Use before deployments or when validating whether a branch is safe to ship.
---

# Release Readiness Labotech

## Checklist

1. Run backend tests from repo root (`npm test`).
2. Run frontend build from `web/` (`npm run build`).
3. Check for host/port and bind-address consistency across code and docs.
4. Check for streaming path mismatches (SRT, UDP, RTP expectations).
5. Confirm no known high-severity security issues in process invocation.

## Report

- Status: `ready` or `not ready`.
- Blocking issues: bullet list with path and reason.
- Non-blocking risks: bullet list.
- Recommended next action.

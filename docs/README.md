# Labotech documentation

Operator and developer documentation for the open-source Labotech project (MIT license).

## Version numbers

| Artifact | Source |
|----------|--------|
| Backend API semver | Root `package.json` → `version`; `GET /health` returns `version` and `release` |
| Release string in UI/API | `LABOTECH_RELEASE` in `.env` (maps to frontend build via `VITE_RELEASE_VERSION` when set) |
| Web UI semver | `web/package.json` → `version` (independent from backend; both may appear in the UI) |

Re-run `npm test` / check `/health` after upgrades; do not rely on this file’s revision date for semver.

## Release notes

| File | Notes |
|------|--------|
| `release-notes-v3.1.md` | Primary detailed changelog (recent) |
| `release-notes-v3.2.md` | Parallel track / tagged releases |
| `release-notes-v3.0.0.md`, `release-notes-v2.0.0.md`, `release-notes-2026-03-13.md` | Historical snapshots |

## Primary references

| Document | Purpose |
|----------|---------|
| [api-reference.md](./api-reference.md) | REST and WebSocket API |
| [etr290-triage-guide.md](./etr290-triage-guide.md) | ETR 290 alarm triage |
| [engineering-support-manual.md](./engineering-support-manual.md) | Deployment and deep troubleshooting |
| [server-optimisation-ubuntu.md](./server-optimisation-ubuntu.md) | Ubuntu host tuning |
| [ops-scripts-reference.md](./ops-scripts-reference.md) | Scripts catalog |
| [production-forward-probe-runbook.md](./production-forward-probe-runbook.md) | Forward/probe operations |
| [agent-status.md](./agent-status.md) | Multi-agent collaboration log |

## Public documentation hygiene

Use placeholders from `.env.example` (`API_HOST`, `<management-nic>`, multicast settings). Do not commit real management IPs, hostnames, or credentials. Examples in guides may show illustrative interface names (e.g. `eno1`/`eno2` on some Ubuntu installs); replace with your actual NIC names from `ip link` / site design.

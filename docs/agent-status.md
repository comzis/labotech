# Agent Status Logbook

This file tracks active AI-agent work, branch ownership, and merge coordination.

## Phase Gates

| Gate | Status | Notes |
|---|---|---|
| Public MIT release baseline | ✅ OPEN | `v3.2.25` published and tagged |
| Branch protection on `main` | ✅ OPEN | PR required, 1 approval required |
| OSS hygiene baseline | ✅ OPEN | Local-only settings untracked, license complete |

## Agent A Status

- Current task: idle — all PRs from this session merged
- Active branch: none
- Last known focus: ETR290 lifecycle (auto-start/stop/restore), fullscreen thumbnail prefetch, compliance API
- Notes: session closed cleanly at backend 3.2.32 / web 3.1.141

## Agent B Status

- Current task: post-release doc consistency cleanup
- Active branch: `cursor/post-release-docs-cleanup`
- Files modified this session:
  - `docs/agent-status.md`
  - `docs/api-reference.md`
  - `docs/production-forward-probe-runbook.md`
- Open questions: none

## Merge Log

- PR #84 merged: release metadata alignment for `v3.2.25`
- PR #85 merged: docs test-count + Node version accuracy
- PR #88 merged: fix ETR stop grey lane on Live View
- PR #89 merged: catalog import/export (POST /api/multiview/catalog + UI buttons)
- PR #90 merged: use .env directly in docker-compose — remove docker-env.txt
- PR #91 merged: raise express.json limit to 2mb for catalog import
- PR #92 merged: remove key prop from confidence monitor thumbnail (no flash)
- PR #93 merged: near-live thumbnails — THUMBNAIL_FPS env var, select=key removed
- PR #94 merged: document THUMBNAIL_FPS in .env.example
- PR #95 merged: fullscreen tiles load thumbnails immediately (src={thumbUrl} direct)
- PR #96 merged: fullscreen audio meters — audioSnapshot latch + pairCountLatch
- PR #97 merged: fullscreen instant load — explicit grid row sizing, 8-col breakpoints
- PR #98 merged: SRT relay thumbnail near-live — fps filter + poll rate match THUMBNAIL_FPS
- PR #99 merged: I-frame-only thumbnail capture (THUMBNAIL_KEYFRAME_ONLY toggle)
- PR #100 merged: fullscreen multiview thumbnail prefetch layer (instant first-entry)
- PR #101 closed: superseded by PR #102
- PR #102 merged: ETR290 auto-start/stop/restore + compliance API + event log filtering + 24 new tests (267/267)

## Notes

- Keep this file updated at the end of each multi-step agent session.
- If two agents must touch the same file, record intent here before editing.
- Deploy sequence: `git pull` → `docker compose -f docker-compose.dev.yml build labotech` → `docker compose -f docker-compose.dev.yml up -d`
- Server `.env` needs: `THUMBNAIL_FPS=5`, `THUMBNAIL_KEYFRAME_ONLY=true`

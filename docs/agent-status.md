# Agent Status Logbook

This file tracks active AI-agent work, branch ownership, and merge coordination.

## Phase Gates

| Gate | Status | Notes |
|---|---|---|
| Public MIT release baseline | ✅ OPEN | `v3.2.25` published and tagged |
| Branch protection on `main` | ✅ OPEN | PR required, 1 approval required |
| OSS hygiene baseline | ✅ OPEN | Local-only settings untracked, license complete |

## Agent A Status

- Current task: thumbnail near-live + fullscreen multiview fixes — PR #99 open, awaiting merge
- Active branch: `feat/iframe-thumbnail-capture`
- Last known focus: thumbnail pipeline (monitoring.js, srt-relay.js, ts-analyser.js, DecoderMultiviewPanel.jsx, DecoderPanelRevamp.jsx)
- Notes: large batch of PRs merged today (#88–#99). See merge log below. PR #99 pending Cursor review before merge.

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
- PR #99 open: I-frame-only thumbnail capture (select=key,fps=THUMBNAIL_FPS) — awaiting Cursor review

## Notes

- Keep this file updated at the end of each multi-step agent session.
- If two agents must touch the same file, record intent here before editing.

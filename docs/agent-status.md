# Agent Collaboration Status

This file is the shared logbook between Claude Code (Agent A) and Cursor (Agent B).
Both agents must read this file at the start of every session.
Both agents must update their own section when they complete work or change status.
The operator (human) is the only one who merges PRs and advances phase gates.

---

## HOW TO USE THIS FILE

**At the start of every session** (both agents):
1. Read this entire file before opening any other file
2. Check what the other agent's current status is
3. Check "Open Gates" — if a gate is blocking you, stop and tell the operator

**At the end of every session** (both agents):
1. Update your status block below
2. List any files you modified in this session
3. List any open questions that need the other agent's input or the operator's decision
4. If you opened a PR, record the branch name and PR number here

**The operator's role:**
- Reviews and merges PRs (neither agent auto-merges)
- Answers open questions that require a decision
- Relays information between agents when needed (e.g. "Agent A merged Phase 1, here is what changed")
- Advances phase gates by marking them CLEARED below

---

## CURRENT PHASE GATES

These are hard stops. Neither agent proceeds past a gate until the operator marks it CLEARED.

| Gate | Status | Cleared by | Notes |
|---|---|---|---|
| **Phase 0a** — TSDuck tsp spike on gva-boro-probe | ✅ CLEARED | Cursor | Finding: `tsp` `monitor`/`etr290` plugins NOT present on production host. Persistent tsp real-time ETR/PCR path is blocked. Fallback confirmed: Phase 1 reduced-interval tsanalyze. Phase 3 scope adjusted — see roadmap §3. `docs/tsduck-spike-findings.md` to be written by Cursor. |
| **Phase 0b** — SRT arbitration decision (Option A / B / C) | ✅ CLEARED | Agent A | Moot for current Phase 3 scope. Persistent tsp is not available. Phase 3 becomes enhanced tsanalyze cadence only. No SRT relay architecture needed. Revisit if TSDuck is upgraded on host. |
| **Phase 1 merged to main** | ✅ CLEARED | operator | PR #13 + #14 merged 2026-03-17. Agent B: branch `cursor/phase2-thumbnail-worker` off main, add ~3-line ts-analyser.js constructor param. |

---

## AGENT A STATUS — Claude Code

**Current task:** Phase 3 PR #16 open, awaiting operator review/merge.

**Owns:**
- `src/ts-analyser.js` (Phase 3 TSDuckMonitor wiring)
- `src/tsduck-monitor.js` (new file, Phase 3 only)
- `test/tsduck-monitor.test.js` (new file, Phase 3)

**Last session:** 2026-03-17
- Phase 3 implementation complete on PR #16 (`feat/phase3-tsduck-monitor`)
- API wiring follow-up merged via PR #17 (`feat/phase2-api-wiring`)
- Monitoring test suite passing on server validation

**Active branch:** `feat/phase3-tsduck-monitor` (PR #16 open)

**Waiting for:** Operator review/merge for PR #16

**Do NOT touch (Agent B owns):**
- `src/thumbnail-worker.js`
- `src/thumbnail-worker-client.js`
- `src/monitoring.js` (except minor imports if needed for Phase 3 integration)

---

## AGENT B STATUS — Cursor

**Current task:** Phase 2 merged. Idle / supporting Phase 3 review.

**Branch:** none (Phase 2 branch merged)

**Owns:**
- `src/thumbnail-worker.js` (new file, Phase 2) ✅
- `src/thumbnail-worker-client.js` (new file, Phase 2) ✅
- `test/thumbnail-worker.test.js` (new file, Phase 2) ✅
- `docs/release-notes-v3.1.md` (v3.1.60–v3.1.61 entries added) ✅

**Last session:** 2026-03-17 — Phase 2 merged (PR #15), release notes updated, server validation passed.

**Active branch:** `main`

**Waiting for:** Operator review of Phase 3 PR #16.

**Do NOT touch (Agent A owns):**
- `src/tsduck-monitor.js`
- `src/ts-analyser.js` (beyond the ~3-line constructor addition)
- Any file in `web/src/` (UI Change Policy — operator approval required)

---

## SHARED CONTRACT — IPC Protocol (Phase 2)

This section is the agreed interface between thumbnail-worker.js and
thumbnail-worker-client.js. Both agents must treat this as frozen once Phase 2
starts. Changes require operator approval and an update here.

**API → Worker messages:**
```js
{ cmd: 'start',    id: string, url: string, intervalSec: number }
{ cmd: 'stop',     id: string }
{ cmd: 'suspend',  id: string, durationMs: number }
{ cmd: 'resume',   id: string }
{ cmd: 'shutdown' }
```

**Worker → API messages:**
```js
{ event: 'ready' }
{ event: 'frame',            id: string, path: string, url: string }
{ event: 'error',            id: string, message: string }
{ event: 'shutdown_complete' }
```

**Status:** ✅ FROZEN — Agent B confirmed, Phase 2 coding started.

---

## AGENT Q&A LOG

Both agents write questions here. The other agent answers at the start of their next session.
Operator only needs to trigger the answering agent's session — no manual relay required.

| # | Asked by | Question | Status | Answered by | Answer |
|---|---|---|---|---|---|
| Q1 | B | Impact assessment for Phase 2 confirmed? Files: thumbnail-worker.js, thumbnail-worker-client.js, test/thumbnail-worker.test.js, monitoring.js, api.js. Risk: medium. Proceed? | ✅ ANSWERED | A | **Yes, proceed.** Impact assessment is correct. Two additions: (1) `monitoring.js` — keep `PersistentThumbnailCapture` class in place for now, just stop calling it from the main process; the worker owns spawning it internally. (2) `api.js` wiring — add worker client init in `start()` after the analyser map is built; SIGTERM handler must call `client.shutdown()` and await `shutdown_complete` before `process.exit`. Validation plan looks solid. |
| Q2 | B | Should the worker use `child_process.fork()` (Node IPC) or `spawn()` with stdio pipes for the IPC channel? | ✅ ANSWERED | A | Use `fork()`. It gives a reliable message channel via `process.send()`/`process.on('message')` with no framing needed, automatic SIGTERM propagation, and cleaner restart logic. Reserve `spawn()` for external binaries (ffmpeg, tsp). |

---

## SHARED CONTRACT — TSDuckMonitor interface (Phase 3)

Agreed events that TSDuckMonitor (Agent A) must emit and that ts-analyser.js
(Agent A) will consume. Listed here so Agent B can see what is coming and ensure
the thumbnail worker's suspend/resume API is compatible.

```js
tsduckMonitor.on('alarm',   ({ priority, checkId, message, pid, ts }) => {})
tsduckMonitor.on('pcr',     ({ repetitionMaxMs, accuracyMaxMs, discontErrors, ts }) => {})
tsduckMonitor.on('si',      ({ pat, pmt, nit, sdt, tdt, ts }) => {})
tsduckMonitor.on('bitrate', ({ bps, ts }) => {})
tsduckMonitor.on('error',   ({ message }) => {})
tsduckMonitor.on('exit',    ({ code, signal }) => {})
```

**Status:** DRAFT — depends on Phase 0a spike findings.

---

## MERGE LOG

| Date | Agent | Branch | PR | What merged |
|---|---|---|---|---|
| 2026-03-15 | A | fix/multiview-iframe-lock | #1 | fix(multiview): lock thumbnails to I-frames using  |
| 2026-03-15 | A | fix/live-view-false-critical | #2 | fix(health): extend inconclusive-probe guard to li |
| 2026-03-15 | A | chore/standardise-dev-workflow | #3 | chore(workflow): standardise Claude/Cursor/IDX bra |
| 2026-03-15 | A | fix/header-srt-policy-ui | #4 | Fix/header srt policy UI |
| 2026-03-15 | B | cursor/ide-config-updates | #5 | Cursor/ide config updates |
| 2026-03-15 | A | fix/header-vertical-centering | #6 | fix(ui): increase header inner height to 140px for |
| 2026-03-15 | A | fix/srt-health-tab-policy | #7 | Fix/srt health tab policy |
| 2026-03-15 | A | fix/srt-health-tab-policy | #8 | Fix/srt health tab policy |
| 2026-03-15 | A | fix/version-bump-3.1.0 | #9 | Fix/version bump 3.1.0 |
| 2026-03-17 | A | feat/srt-broadcast-health-thresholds | #10 | feat(srt): professional broadcast health threshold |
| 2026-03-17 | A | fix/rtp-thumbnail-regression | #11 | fix(thumbnail): scope PersistentThumbnailCapture t |
| 2026-03-17 | A | fix/rtp-thumbnail-regression | #12 | fix(srt): serialise heavy probes + RTP thumbnail r |
| 2026-03-17 | B | cursor/phase2-thumbnail-worker | #15 | feat(thumbnail-worker): Phase 2 — worker runtime,  |
| 2026-03-17 | A | feat/phase2-api-wiring | #17 | feat(api): Phase 2 — wire ThumbnailWorkerClient in |
| 2026-03-17 | A | main | — | v3.1.54–v3.1.58 (all prior work) |
| 2026-03-17 | operator | cursor/phase0a-tsduck-findings | #13 | SRT hardening, multiview export, thumbnail backoff, agent infra |
| 2026-03-17 | A | feat/phase1-probe-scheduling | #14 | Phase 1: severity-aware probe scheduling (v3.1.59) |

---

## KNOWN CONFLICTS TO WATCH

| File | Risk | Resolution |
|---|---|---|
| `src/ts-analyser.js` | Both agents edit constructor | Agent B branches off main AFTER Phase 1 merges. Agent B's change is additive only (new optional param). |
| `src/api.js` | Both agents add wiring | Coordinate via this file. Agent B adds thumbnail client; Agent A adds TSDuckMonitor. Do not both edit in the same session without checking this file first. |
| `docs/release-notes-v3.1.md` | Both agents may need to add entries | Only Agent A adds to this file (Phase 1). Agent B creates a new `docs/release-notes-v3.2.md`. |

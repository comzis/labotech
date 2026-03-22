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

**Current task:** Session complete — all operator-reported issues resolved. Awaiting server deploy.

**Owns:**
- `src/ts-analyser.js`
- `src/srt-relay.js`
- `src/tsduck-monitor.js`
- `src/etr290-analyser.js`
- `src/monitoring.js`
- `src/api.js` (shared with B — coordinate before editing)
- `test/tsduck-monitor.test.js`
- `web/src/components/DecoderMultiviewPanel.jsx`
- `web/src/components/DecoderPanelRevamp.jsx`

**Last session:** 2026-03-22

**Completed this session (all on branch `cursor/phase2-complete-thumb-migration`):**
- `fix(srt)`: SRT relay thumbnail — H.264 mid-GOP failure root cause fixed; integrated thumbnail capture into relay ffmpeg as second output branch (`thumbnail=100,scale=480:-2`); replaced `doCapture` with `pollRelayThumb` 2 s mtime poller. (v3.2.9–v3.2.10)
- `fix(srt)`: Thumbnail persistence across tab switches — `pollRelayThumb` now always seeds `lastResult`; `toJSON()` disk fallback via `_resolveCachedThumbnailUrl()`. (v3.2.11–v3.2.12)
- `fix(dev)`: nodemon restarts on every `saveState()` write — added `nodemon.json` + inline `--ignore` flags in `docker-compose.dev.yml`. OFFLINE flash on decoder stop eliminated after `docker compose up -d`. (v3.2.13)
- `feat(multiview)`: "+" tile on Multiview grid to provision decoder without leaving the tab. Mini modal with Host/IP, Port, optional Decoder ID. (web v3.1.119)
- `fix(multiview)`: Existing tiles disappear when adding new decoder — replaced full-reseed effect with prune-then-seed; ghost IDs removed on every `activeIds` update. Catalog search dropdown + RTP/SRT/UDP mode buttons + SRT latency/passphrase added to "+" modal. (web v3.1.120)
- `fix(decoder-tab)`: Active Decoders list does not show decoders started from Multiview tab — added 5 s polling interval to `DecoderPanel`. (web v3.1.121)
- `fix(srt-stats)`: SRT Transport panel showed only RATE — removed `|| this._relay` guard from `_probeSrtLinkStats()`; added `pktNak`/`pktAck` parsing from `srt-live-transmit` JSON; added `retransRatio`. (v3.2.14)
- `fix(api)`: Agent B review blocker — `thumbnail_frame` handler only wrote `_lastThumbnailUrl`, not `lastResult`; thumbnails lost on tab switch for worker-managed streams (direct SRT, RTP/UDP). Fixed to mirror `pollRelayThumb` pattern. (v3.2.15)
- `docs(claude)`: CLAUDE.md updated with Docker rebuild requirement for all frontend changes.

**Active branch:** `cursor/phase2-complete-thumb-migration` (shared with Agent B — all A work committed)

**Current versions:** backend `3.2.15` / web `3.1.121` — 240 tests passing.

**Waiting for:** Operator to run `git pull && docker compose -f docker-compose.dev.yml build labotech && docker compose -f docker-compose.dev.yml up -d` on server to deploy all fixes.

**For Agent B — items identified in peer review (not blockers, backlog):**
- `ThumbnailWorkerClient`: no hung-process watchdog (crash → respawn works; hung process stays hung)
- `ThumbnailWorkerClient.shutdown()`: 5 s force-kill timeout is silent — add `console.warn`
- `test/thumbnail-worker.test.js`: missing test for `start()` called during backoff window → appears in replay after respawn
- PR #71 (`cursor/docs-agent-status-pr70-sync`) not in MERGE LOG table — add for completeness

**Outstanding (deferred):**
- SMPTE 337M pair identification is heuristic-based; exact pair requires Dolby E adapter
- SCTE-35 frontend panel (deferred by operator)

**Do NOT touch (Agent B owns):**
- `src/thumbnail-worker.js`
- `src/thumbnail-worker-client.js`

---

## AGENT B STATUS — Cursor

**Current task:** Phase 2 migration complete — PR pending operator review.

**Branch:** `cursor/phase2-complete-thumb-migration`

**Owns:**
- `src/thumbnail-worker.js` (new file, Phase 2) ✅
- `src/thumbnail-worker-client.js` (Phase 2 + backoff reset fix) ✅
- `test/thumbnail-worker.test.js` (Phase 2 + backoff reset test) ✅
- `docs/release-notes-v3.2.md` (entries to add before PR) ✅

**Last session:** 2026-03-21 — Phase 2 migration completed. TSAnalyser now delegates thumbnails to ThumbnailWorkerClient. All 221 tests passing. PR opened for operator review.

**Active branch:** `cursor/phase2-complete-thumb-migration`

**Files touched this session:**
- `src/ts-analyser.js` — constructor injection, startContinuous() 3-branch thumb logic, probe() suspend/resume, getEtrStartDelay(), stop()
- `src/thumbnail-worker-client.js` — backoff reset on ready event
- `routes/analyse.js` — pass thumbnailClient to TSAnalyser constructor
- `src/api.js` — restoreState() passes thumbnailClient; SIGTERM stops analysers before shutdown
- `test/thumbnail-worker.test.js` — backoff reset test added

**Design decisions:**
- Relay-backed SRT (loopback unicast) keeps in-process one-shot timer — persistent worker connection would hold the UDP port and block ffprobe probes
- Direct SRT and RTP/UDP multicast → worker (PersistentThumbnailCapture out-of-process)
- In-process PersistentThumbnailCapture kept as fallback (no thumbnailClient injected)

**Do NOT touch (Agent A owns):**
- `src/tsduck-monitor.js`
- `src/ts-analyser.js` (scoped edits this session now done — treat as A's again)
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
| 2026-03-18 | A | feat/audio-vu-bars | #32 | feat(ui): audio VU bars in Decoder Confidence Monitor |
| 2026-03-18 | A | fix/audio-probe-and-ghost-filter | #36 | fix: ghost null-PID filter + audio probe all tracks |
| 2026-03-18 | A | feat/srt-live-transmit-engine | #35 | feat(encap): srt-live-transmit preferred engine (v3.1.75) |
| 2026-03-18 | A | fix/srt-binary-volume-mount | #37/#38 | fix(docker): build srt-live-transmit from source in Bookworm stage |
| 2026-03-18 | A | fix/srt-analyser-eno1-binding | #39 | fix(analyser): bind SRT ffprobe to eno1 (v3.1.76) |
| 2026-03-18 | A | fix/srt-thumbnail-eno1-binding | #40 | fix(monitoring): bind SRT thumbnail ffmpeg to eno1 (v3.1.77) |
| 2026-03-18 | A | feat/landing-bebas-srt-paste | #41 | feat(ui): Bebas Neue landing + SRT URI smart-paste (web 3.1.89) |
| 2026-03-17 | B | cursor/fix-claude-worktree-gitlinks | #70 | fix: remove broken gitlink worktrees; .gitignore .claude/worktrees/ |
| 2026-03-17 | B | cursor/docs-agent-status-pr70-sync | #71 | docs: agent-status sync after PR #70 |
| 2026-03-22 | A | cursor/phase2-complete-thumb-migration | — | SRT relay thumbnail, OFFLINE flash fix, Multiview + tile, SRT stats, tab sync, Agent B review blocker (backend v3.2.9–v3.2.15 / web v3.1.119–v3.1.121) — PR pending |

---

## KNOWN CONFLICTS TO WATCH

| File | Risk | Resolution |
|---|---|---|
| `src/ts-analyser.js` | Both agents have edited on `cursor/phase2-complete-thumb-migration`. A owns this file going forward. B's Phase 2 injection (`_thumbnailClient`) is already in place — do not revert. | Low — on shared branch, changes committed. |
| `src/api.js` | Both agents edited this session. A fixed `thumbnail_frame` handler (v3.2.15). B owns worker IPC wiring. Coordinate before any further edits. | Low — changes committed, no pending conflicts. |
| `package.json` | Currently at `3.2.15` (backend) / `3.1.121` (web). Both agents must pull before bumping version. | Pull main after this branch merges. |
| `docs/release-notes-v3.1.md` | Agent A only. Agent B uses `docs/release-notes-v3.2.md`. | No conflict. |
| `web/src/components/DecoderMultiviewPanel.jsx` | Agent A made extensive changes this session. UI Change Policy applies — operator approval required for further changes. | Committed on shared branch. |

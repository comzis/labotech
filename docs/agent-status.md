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
| **Phase 1 merged to main** | 🔴 PENDING | operator | Agent B (Cursor) must branch off main AFTER Phase 1 merges. Do not start Phase 2 ts-analyser.js edits until this gate is cleared. |

---

## AGENT A STATUS — Claude Code

**Current task:** Idle — awaiting Phase 0a gate clearance to begin Phase 1

**Owns:**
- `src/ts-analyser.js` (Phase 1 scheduling changes; Phase 3 TSDuckMonitor wiring)
- `src/tsduck-monitor.js` (new file, Phase 3 only — do not create until Phase 0a cleared)
- `test/tsduck-monitor.test.js` (new file, Phase 3)
- `docs/release-notes-v3.1.md` (Phase 1 entry)
- `docs/release-notes-v3.3.md` (new file, Phase 3)

**Last session:** 2026-03-17
- Delivered v3.1.58: PCR metrics wired to analyser panel, multiview persistence fix, gray text legibility improvement
- Created `docs/architecture-roadmap-continuous-monitoring.md`
- Created `docs/agent-status.md` (this file)
- Updated CLAUDE.md and package.json to correct product description (encapsulator not encoder)

**Active branch:** none (all merged to main at v3.1.58)

**Open questions for operator:**
- Phase 0a: when can gva-boro-probe be accessed to run the tsp spike?
- Phase 0b: which SRT arbitration option do you want? Option A (safest, RTP/UDP only for persistent tsp) is recommended as the starting point.

**Do NOT touch (Agent B owns):**
- `src/thumbnail-worker.js`
- `src/thumbnail-worker-client.js`
- `src/monitoring.js` (except minor imports if needed for Phase 3 integration)

---

## AGENT B STATUS — Cursor

**Current task:** Phase 1 checklist ready, awaiting Phase 1 gate clearance from operator.

**Owns:**
- `src/thumbnail-worker.js` (new file, Phase 2)
- `src/thumbnail-worker-client.js` (new file, Phase 2)
- `test/thumbnail-worker.test.js` (new file, Phase 2)
- `src/monitoring.js` (migrate module-level state to worker)
- `docs/release-notes-v3.2.md` (new file, Phase 2 release)

**Last session:** 2026-03-17 — recorded Phase 0a spike findings (`docs/tsduck-spike-findings.md`) and prepared Phase 1 commit-sized checklist.

**Active branch:** `cursor/phase0a-tsduck-findings`

**Files modified (this session):**
- `docs/tsduck-spike-findings.md`

**Waiting for:**
- Operator review of Phase 1 checklist
- Phase 1 merged to main before editing `src/ts-analyser.js` in Phase 2 work

**Gate verification:**
- Phase 0a: ✅ CLEARED
- Phase 0b: ✅ CLEARED

**Incidental findings — Agent A positions:**
- `_probeTSDuck()` proc.on('exit'): leave as-is in Phase 1; stdout data events buffer before exit fires in practice. Phase 3 may revisit.
- `src/api.js` SIGTERM gap: confirmed, Phase 2 adds it.
- CLAUDE.md port 3000 vs 4000: known doc inconsistency, not blocking.

**Do NOT touch (Agent A owns):**
- `src/tsduck-monitor.js` (does not exist yet — leave for Agent A)
- `src/ts-analyser.js` beyond the constructor option addition (~3 lines)
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

**Status:** DRAFT — not yet frozen. Agent B to confirm before Phase 2 coding starts.

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
| 2026-03-17 | A | main | — | v3.1.54–v3.1.58 (all prior work) |

---

## KNOWN CONFLICTS TO WATCH

| File | Risk | Resolution |
|---|---|---|
| `src/ts-analyser.js` | Both agents edit constructor | Agent B branches off main AFTER Phase 1 merges. Agent B's change is additive only (new optional param). |
| `src/api.js` | Both agents add wiring | Coordinate via this file. Agent B adds thumbnail client; Agent A adds TSDuckMonitor. Do not both edit in the same session without checking this file first. |
| `docs/release-notes-v3.1.md` | Both agents may need to add entries | Only Agent A adds to this file (Phase 1). Agent B creates a new `docs/release-notes-v3.2.md`. |

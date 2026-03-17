# Architecture Roadmap — Continuous Monitoring & Thumbnail Worker

**Status:** Planned — not yet started
**Created:** 2026-03-17
**Target versions:** v3.1.59 (quick win) → v3.2.0 (thumbnail worker) → v3.3.0 (persistent TSDuck)
**For:** Claude Code, Cursor, and any contributor working on this codebase

---

## 1. Why This Document Exists

Two architectural improvements were identified after comparing LaboTech v3.1.57 against
professional reference implementations (Elecard Boro, Tektronix TNS546):

1. **Persistent TSDuck per stream** — current `tsanalyze` is spawned once per heavy probe
   cycle (~30–60 s window, killed after 9 s). PCR alarm latency is therefore up to 60 s.
   Professional analysers provide real-time PCR / CC / SI alarms within 1–2 s.

2. **Isolated thumbnail worker process** — current `PersistentThumbnailCapture` runs inside
   the main API process. All streams share one event loop and a module-level semaphore.
   Crash-isolation, independent restartability, and clean separation from the probe loop
   are not currently possible without restructuring.

Both changes require significant architectural work (estimated 3–4 weeks combined).
This document defines the exact scope, phasing, interfaces, risk mitigations, and
per-phase acceptance criteria so that work can proceed safely in parallel by multiple agents
and/or contributors.

---

## 2. Current Architecture — Precise State (v3.1.58)

### 2.1 Probe pipeline (`src/ts-analyser.js`)

```
TSAnalyser.probe(continuous)
  ├─ runFfprobeJson()                  ← light probe: PIDs, programs, bitrate
  ├─ _probeStreamPidsFromFfmpeg()      ← PID backfill from ffmpeg banner
  └─ if runHeavyProbe (every N light):
       await _acquireHeavyProbeSlot()  ← module semaphore, max 3 concurrent
       │
       ├─ SRT stream: sequential (single-connection constraint)
       │    _probeTSDuck()             ← tsanalyze --json <url>, 9 s window
       │    _probeTransportBitrateBps()
       │    _probeAudioLevels()
       │    _probeTimestampDiscontinuities()
       │    _probeContinuityCounterErrors()
       │    _probeDolbyE()
       │
       └─ RTP/UDP stream: Promise.all (parallel)
            same 6 probes concurrently
```

**`_probeTSDuck()` call pattern (line 982):**

```js
spawn('tsanalyze', ['--json', this.url])
// Hard kill timer: 9 s SIGTERM
// Parse stdout JSON on 'exit' — regardless of exit code
// Returns: { bitrateBps, services, pids, siIntervalsSec,
//            arrivalMetrics, pcrMetrics, unreferencedPids }
```

Heavy probe cadence is governed by `_shouldRunHeavyProbe()` and the module-level
`_acquireHeavyProbeSlot` / `_releaseHeavyProbeSlot` semaphore (`_HEAVY_PROBE_MAX = 3`).

### 2.2 Thumbnail pipeline (`src/monitoring.js`)

```
PersistentThumbnailCapture (per stream, lives inside TSAnalyser)
  _spawn() → ffmpeg -re -i <url> -frames:v 1 ... <id>.jpg.ptmp.jpg → fs.rename
  ├─ on frame written: this._epoch bump + scheduleRestart
  ├─ on error: exponential backoff (_restartDelay: 5 s → 30 s cap)
  ├─ suspend(durationMs): SIGTERM + set fallback restart timer
  └─ resume(): cancel fallback, spawn immediately

Module-level:
  THUMB_CONCURRENCY (env or CPU-auto, default ~4)
  _thumbRunning counter
  _thumbQueue for overflow
  _thumbPendingById dedup map
```

`PersistentThumbnailCapture` is instantiated at `TSAnalyser.startContinuous()` (line ~2568)
and stored as `this._persistentThumb`. SRT probes call `this._persistentThumb.suspend()` /
`this._persistentThumb.resume()` to serialise SRT connection use.

### 2.3 SRT single-connection constraint (critical invariant)

Many contribution SRT encoders accept **exactly one simultaneous caller**.
If two processes attempt to connect simultaneously, the second is rejected.

Current serialisation strategy (line 222–259):
- Detect SRT URL + heavy probe scheduled + `_persistentThumb` exists → `isSrtHeavy = true`
- `_persistentThumb.suspend(latencyMs + 70000)` — kills thumbnail ffmpeg, sets fallback timer
- 600 ms settle (`setTimeout(r, 600)`) — source accepts new caller
- Sequential probes: tsanalyze → transport → audio → tsDisc → cc → dolby
- `_persistentThumb.resume()` in `finally` — restarts thumbnail immediately

**This invariant must be preserved by all future work. Any new process that opens an SRT
connection must participate in the same serialisation scheme.**

### 2.4 Module-level semaphore

```js
// src/ts-analyser.js lines 15–44
const _HEAVY_PROBE_MAX = 3;         // env: TS_HEAVY_PROBE_MAX_CONCURRENT
let _heavyProbeActive = 0;
const _heavyProbeQueue = [];
```

All heavy probes across ALL active TSAnalyser instances share this one semaphore.
Do not bypass it. Do not introduce a second semaphore for the same resource class.

---

## 3. Roadmap Phases

### Phase 0 — Prerequisites (spike + design) · Est. 1–2 days · No code to merge

**Must be done before any Phase 1–3 coding starts.**

#### 0a. TSDuck capability spike on `gva-boro-probe`

SSH to production server and run:

```bash
tsp --version
tsp --list-processors | grep -i 'etr\|pcr\|monitor\|tables\|sections'
# Also try:
tsp -I srt --srt-... -O drop --processor tables --json 2>&1 | head -100
```

Goals:
- Confirm `tsp` binary exists and version
- Confirm `tables` plugin is available and produces parseable JSON
- Confirm `monitor` or `etr290` plugin is available for real-time PCR alarms
- Document exact JSON output schema for downstream parsing code

If `tsp` plugin support is absent or output schema cannot be reliably parsed:
→ Fall back to **reduced-interval tsanalyze** only (Phase 1 still applies; Phase 3 scope changes).

**Document findings in `docs/tsduck-spike-findings.md`.**

#### 0b. SRT connection arbitration design decision

With a persistent `tsp` process holding the SRT connection, the current
suspend/resume pattern for PersistentThumbnailCapture becomes invalid — there is
no longer a free connection slot to hand to the thumbnail process.

**Choose one resolution strategy before starting Phase 3:**

| Option | Description | Cost | Risk |
|---|---|---|---|
| **A. RTP/UDP-only Phase 3** | Persistent tsp for RTP/UDP streams only; SRT keeps current sampled approach | Low | Low |
| **B. Local relay** | tsp re-publishes via `--plugin drop` or SRT-to-UDP relay; thumbnail subscribes to local UDP | Medium | Medium |
| **C. Shared-connection IPC** | tsp owns the SRT socket; thumbnail and ffprobe connect to a local tsp-managed pipe | High | High |

**Decision must be recorded in this document (Section 3, Phase 0b) before Phase 3 starts.**

---

### Phase 1 — Reduced-interval `tsanalyze` (quick win) · v3.1.59 · Est. 3–4 days

**Goal:** Cut PCR alarm latency from ~60 s to ~12–15 s without architectural change.

**Owner:** Claude Code or Cursor (independent of Phase 2/3)

#### Changes required

**`src/ts-analyser.js`**

1. Add env var `TS_TSDUCK_INTERVAL_MS` (default `60000`). When set to e.g. `12000`, the
   heavy probe scheduler runs `_probeTSDuck()` on its own cadence independent of the full
   heavy probe cycle.

   Alternatively: split heavy probe into "full heavy" (all 6 sub-probes, every 60 s) and
   "PCR-only heavy" (tsanalyze only, every 12 s).

2. `_shouldRunTsduckProbe(now)` — separate from `_shouldRunHeavyProbe()`. Uses its own
   `this._nextTsduckProbeAt` timestamp.

3. PCR-only probes do NOT acquire the heavy semaphore by default (light weight).
   They DO participate in SRT connection serialisation.

4. PCR-only probe result merges into `this.lastResult.dvb.pcrMetrics` via
   `_applyTSDuckData()` (already exists) — same data path, just more frequent.

#### Acceptance criteria

- `npm test -- --runInBand` passes (no new failures)
- `npm run build --prefix web` clean
- With `TS_TSDUCK_INTERVAL_MS=12000`, journalctl shows tsanalyze spawned ~every 12 s per stream
- PCR interval field in Analyser panel refreshes within 15 s of a PCR fault appearing
- No CPU regression: baseline `top` before/after on `gva-boro-probe` with 4 active streams

#### Release note

- Bump `package.json` to v3.1.59
- Add section to `docs/release-notes-v3.1.md`

---

### Phase 2 — Thumbnail Worker Process · v3.2.0 · Est. 8–10 days

**Goal:** Move all `PersistentThumbnailCapture` instances to a dedicated child process.
The main API process communicates via structured IPC (Node.js `child_process.fork` message passing).

**Owner:** Cursor (or Agent B in parallel worktree)

**Dependency:** No dependency on Phase 1 or Phase 3. Can start immediately.

#### 2.1 New file: `src/thumbnail-worker.js`

This file is the entry point for the forked worker process.

```
thumbnail-worker.js
├─ Imports monitoring.js (PersistentThumbnailCapture, captureThumbnail, THUMBNAIL_DIR)
├─ Listens on process.on('message', handler)
├─ Maintains a Map<streamId, PersistentThumbnailCapture> of active captures
├─ On 'frame' event from PersistentThumbnailCapture:
│    process.send({ event: 'frame', id, path, url })
├─ On 'error' event:
│    process.send({ event: 'error', id, message })
└─ Graceful shutdown on SIGTERM:
     stop all captures → drain → process.exit(0)
```

**IPC protocol (from API → worker):**

```js
// Start a new persistent capture
{ cmd: 'start', id: string, url: string, intervalSec: number }

// Stop and remove a capture
{ cmd: 'stop', id: string }

// Yield connection slot for probe (SRT only)
{ cmd: 'suspend', id: string, durationMs: number }

// Cancel suspend, restart immediately
{ cmd: 'resume', id: string }

// Graceful shutdown
{ cmd: 'shutdown' }
```

**IPC protocol (from worker → API):**

```js
// A new thumbnail frame was written to disk
{ event: 'frame', id: string, path: string, url: string }

// Capture encountered an error
{ event: 'error', id: string, message: string }

// Worker ready after fork
{ event: 'ready' }

// Worker completed graceful shutdown
{ event: 'shutdown_complete' }
```

#### 2.2 New file: `src/thumbnail-worker-client.js`

Thin client living in the main process. Wraps `child_process.fork` and exposes the same
interface as `PersistentThumbnailCapture` so that `TSAnalyser` requires minimal changes.

```js
class ThumbnailWorkerClient extends EventEmitter {
  constructor()               // forks worker, attaches message listener
  start(id, url, intervalSec) // sends { cmd: 'start', ... }
  stop(id)                    // sends { cmd: 'stop', ... }
  suspend(id, durationMs)     // sends { cmd: 'suspend', ... }
  resume(id)                  // sends { cmd: 'resume', ... }
  shutdown()                  // sends { cmd: 'shutdown' }, waits for shutdown_complete
}
// Emits: 'frame' (id, url), 'error' (id, message)
```

There should be **one shared `ThumbnailWorkerClient` instance** for the entire API process,
not one per stream. The worker manages all stream captures internally.

#### 2.3 Modify `src/ts-analyser.js`

- Remove direct import/use of `PersistentThumbnailCapture`
- Accept `thumbnailClient` option in `TSAnalyser` constructor:
  ```js
  this._thumbnailClient = options.thumbnailClient || null;
  ```
- `startContinuous()`: call `this._thumbnailClient.start(this.id, this.url, intervalSec)` instead of `new PersistentThumbnailCapture(...).start()`
- `stop()`: call `this._thumbnailClient.stop(this.id)`
- SRT probe suspend: call `this._thumbnailClient.suspend(this.id, suspendMs)` / `.resume(this.id)`
- Listen on `thumbnailClient.on('frame', (id, url) => { if (id === this.id) ... })`

**Backward-compatible fallback:** if `thumbnailClient` is null (test environments, legacy
callers), instantiate `PersistentThumbnailCapture` directly as before.

#### 2.4 Modify `src/api.js`

```js
const { ThumbnailWorkerClient } = require('./thumbnail-worker-client');
const thumbnailClient = new ThumbnailWorkerClient();

// Pass to each TSAnalyser:
const analyser = new TSAnalyser({ ..., thumbnailClient });

// Graceful shutdown:
process.on('SIGTERM', async () => {
  await thumbnailClient.shutdown();
  process.exit(0);
});
```

#### 2.5 Test requirements

- Unit tests for `ThumbnailWorkerClient` IPC protocol (mock child_process.fork)
- Unit tests for worker message handler (mock PersistentThumbnailCapture)
- Integration: start worker, start a capture, verify frame event arrives, stop, verify cleanup
- SRT suspend/resume round-trip: suspend → assert no 'frame' events during window → resume → assert 'frame' resumes
- Worker crash recovery: kill worker process → verify client detects, respawns, re-registers active captures
- All existing `npm test -- --runInBand` passing

#### 2.6 Worker crash recovery (required)

`ThumbnailWorkerClient` must handle unexpected worker process death:

```
worker.on('exit', (code, signal) => {
  // Exponential backoff: 2 s, 4 s, 8 s (max 30 s)
  // After respawn: re-send { cmd: 'start' } for all currently-active stream IDs
  // Emit 'worker_restarted' event so TSAnalyser instances can log it
})
```

Active stream IDs are tracked in `ThumbnailWorkerClient._active: Map<id, {url, intervalSec}>`.

#### Acceptance criteria

- `npm test -- --runInBand` passes
- `npm run build --prefix web` clean
- `ps aux | grep thumbnail-worker` shows single worker process while API is running
- Main API process memory does not grow over time when worker handles 10 active captures
- Killing worker PID manually → API respawns it within 5 s → thumbnails resume
- SRT stream: suspend/resume tested with real SRT source (no thumbnail during probe window)

#### Release note

- Bump `package.json` (backend change) and `web/package.json` to v3.2.0
- Add section to a new `docs/release-notes-v3.2.md`

---

### Phase 3 — Enhanced tsanalyze Cadence · v3.3.0 · Est. 4–6 days

**⚠ Scope revised after Phase 0a spike (2026-03-17):**
`tsp` `monitor` and `etr290` plugins are NOT present on the production host (gva-boro-probe).
Persistent real-time tsp ETR/PCR monitoring is blocked until TSDuck is upgraded.
Phase 3 scope is now: multi-tier tsanalyze cadence (PCR-focused short cycle + SI-focused
long cycle) built on the Phase 1 foundation. Revisit persistent tsp when host TSDuck
version is upgraded — see `docs/tsduck-spike-findings.md` for exact version and missing plugins.

**Dependency:** Phase 1 merged. Phase 0b SRT arbitration decision is no longer required
(no persistent tsp process, no SRT connection conflict).

**Owner:** Claude Code (Agent A)

#### 3.1 New class: `src/tsduck-monitor.js`

```
TSDuckMonitor extends EventEmitter
  constructor({ id, url, nicName })
  start()    → spawns tsp with appropriate plugins
  stop()     → SIGTERM + cleanup
  suspend()  → SIGTERM (SRT slot release)
  resume()   → respawn

  Events emitted:
    'alarm'   { priority: 'p1'|'p2'|'p3', checkId, message, pid, ts }
    'pcr'     { repetitionMaxMs, accuracyMaxMs, discontErrors, ts }
    'si'      { pat, pmt, nit, sdt, tdt, ts }
    'bitrate' { bps, ts }
    'error'   { message }
    'exit'    { code, signal }
```

**`tsp` command template (to be finalised after Phase 0a spike):**

```bash
tsp \
  --input <protocol_plugin> <url_args> \
  --processor tables --json-line ... \   # SI tables → stdout JSON events
  --processor monitor --pcr-alarm ... \ # PCR repetition + accuracy alarms
  --output drop
```

The exact plugin names and flags must come from the Phase 0a spike document.

#### 3.2 Output parsing

`tsp` with `--json-line` emits one JSON object per stdout line. Parser must:

- Buffer incomplete lines (stdout data events may split across chunks)
- Route by object type: `{ type: 'table', ... }` vs `{ type: 'alarm', ... }` etc.
- Be resilient to unknown object types (log and discard, do not throw)
- Use the same flexible-walk approach as `_extractTSDuckPcrMetrics()` to avoid coupling
  to a specific TSDuck version's exact key names

#### 3.3 Integration with `TSAnalyser`

`TSDuckMonitor` runs alongside the existing light/heavy probe loop, not replacing it.
The probe loop continues to provide: ffprobe PID list, audio levels, transport bitrate,
timestamp discontinuities, continuity counter errors.

`TSDuckMonitor` supplements with: real-time PCR metrics, real-time SI interval checks,
real-time P1/P2/P3 alarms.

Changes to `TSAnalyser`:

```js
this._tsduckMonitor = null;  // lazily created in startContinuous()

// In startContinuous():
this._tsduckMonitor = new TSDuckMonitor({ id: this.id, url: this.url });
this._tsduckMonitor.on('alarm', (alarm) => this._onTsduckAlarm(alarm));
this._tsduckMonitor.on('pcr',   (pcr)   => this._onTsduckPcr(pcr));
this._tsduckMonitor.on('si',    (si)    => this._onTsduckSi(si));
this._tsduckMonitor.start();

// In stop():
if (this._tsduckMonitor) { this._tsduckMonitor.stop(); this._tsduckMonitor = null; }

// In probe() SRT suspend:
if (this._tsduckMonitor) this._tsduckMonitor.suspend();
// ... probes ...
if (this._tsduckMonitor) this._tsduckMonitor.resume();
```

`_onTsduckAlarm()` feeds into the existing ETR 290 alarm infrastructure:
- Maps to existing `status.status`, `status.counts`, `status.recentAlarms` schema
- Uses existing hysteresis (`_healthHysteresis`) for alarm state transitions

`_onTsduckPcr()` updates `this.lastResult.dvb.pcrMetrics` in-place between probe cycles
so that the PCR / Timing panel in the frontend reflects near-real-time data.

#### 3.4 Heavy probe changes

When `TSDuckMonitor` is running:
- `_probeTSDuck()` can be reduced in frequency (e.g., every 5 minutes) for SI table snapshot
- PCR scoring in `_buildHealthAssessment()` uses the stream from `TSDuckMonitor` instead of
  the snapshot from `_probeTSDuck()`

#### 3.5 SRT arbitration (conditional on Phase 0b decision)

**If Option A was chosen (RTP/UDP only):**
- `TSDuckMonitor` is only instantiated for `rtp://` and `udp://` URLs
- SRT streams continue with sampled tsanalyze (Phase 1 reduced interval)
- No SRT connection conflict exists

**If Option B was chosen (local relay):**
- `TSDuckMonitor` for SRT streams uses a relay URL (e.g., `udp://127.0.0.1:PORT`)
- A relay ffmpeg process publishes the SRT stream to local UDP
- Thumbnail and ffprobe connect to the same local UDP relay
- SRT suspend/resume is no longer needed

**If Option C was chosen:**
- Document separately; do not start implementation without a dedicated design review

#### Acceptance criteria

- `npm test -- --runInBand` passes
- Real-time alarm: introduce a PCR fault on a test stream → alarm appears in ETR panel
  within 5 s (vs 60 s previously)
- SI interval alarm: block NIT for >10 s → P3 NIT Error appears within 15 s
- No `tsp` zombie processes after `stop()` or server shutdown
- Memory: `tsp` + `thumbnail-worker` + API combined memory stable over 30 min under load
- `gva-boro-probe` production validation: 4 streams running for 10 min → no false alarms

#### Release note

- Bump `package.json` and `web/package.json` to v3.3.0
- New `docs/release-notes-v3.3.md`

---

## 4. Risk Matrix

| Risk | Likelihood | Impact | Score | Mitigation |
|---|---|---|---|---|
| `tsp` ETR 290 plugin absent on prod TSDuck | **High** | **High** | 🔴 Critical | Phase 0a spike is mandatory gate. If absent: Phase 3 scope = higher-frequency tsanalyze only |
| SRT single-connection conflict with persistent tsp | **High** | **High** | 🔴 Critical | Phase 0b decision gates Phase 3 coding. Option A (RTP/UDP only) eliminates this risk entirely |
| `tsp` JSON output schema diverges from tsanalyze | **High** | **High** | 🔴 Critical | Phase 0a documents exact schema before any parser is written |
| Worker IPC message ordering / lost messages | **Medium** | **High** | 🟠 High | Unidirectional IPC only; no synchronous RPC; bounded in-memory queues; test with high throughput |
| Memory growth with N persistent tsp processes | **Medium** | **High** | 🟠 High | cgroup in docker-compose; env `TSP_MAX_INSTANCES`; warn if > threshold |
| Test/prod divergence: mock output misses real quirks | **High** | **Medium** | 🟠 High | Integration tests on a live stream against gva-boro-probe are mandatory before PR merge |
| Phase 2 + Phase 3 both redesign SRT lifecycle | **Medium** | **Medium** | 🟡 Medium | Share the arbitration layer design; review interface contract before both start coding |
| New process count (20 streams × 3 processes each) | **Low** | **Medium** | 🟡 Medium | Baseline-measure on server before starting; set `ulimit -n` in docker-compose |
| TSDuck stdout line buffering fills pipe on idle stream | **Low** | **Low** | 🟢 Low | Drain stdout even when not parsing; set pipe high-water mark |

---

## 5. Coding Invariants — Must Not Be Broken

These rules apply to all phases. They are enforced by tests and pre-commit hooks.

### 5.1 All new classes must extend EventEmitter

```js
const { EventEmitter } = require('events');
class TSDuckMonitor extends EventEmitter { ... }
class ThumbnailWorkerClient extends EventEmitter { ... }
```

Emit at minimum: `started`, `stopped`, `error`. Do not use `emit('error')` for
permission/config faults — use `emit('unavailable')` for those.

### 5.2 FFmpeg and TSDuck always via `child_process.spawn`

Never `exec`. Never shell strings with user-provided data (command injection).

### 5.3 `proc.on('close')` not `proc.on('exit')` when reading stderr after process ends

`exit` fires before stdio streams are flushed. `close` fires after. Always:

```js
proc.on('close', (code) => { /* stderr/stdout fully flushed here */ });
```

### 5.4 SRT serialisation invariant

Any code path that opens an SRT URL must:
1. Check if another SRT connection is active for the same stream
2. If yes: wait for it to release (suspend existing, or queue)
3. Never attempt two simultaneous SRT callers to the same source

### 5.5 Heavy probe semaphore

`_acquireHeavyProbeSlot()` / `_releaseHeavyProbeSlot()` must be called in
matched pairs. Every acquisition path must have a `finally { _releaseHeavyProbeSlot() }`.
TSDuck-only lightweight probes (Phase 1) may bypass this semaphore if they do not
concurrently spawn the full heavy probe burst.

### 5.6 `Number(null) === 0` guard

Before coercing any nullable numeric field:
```js
// WRONG:
Number.isFinite(Number(pid))
// CORRECT:
pid != null && Number.isFinite(Number(pid))
```

### 5.7 `matchAll` requires global regex

```js
// WRONG — throws TypeError:
str.matchAll(/pcr.*max/i)
// CORRECT:
const rx = /pcr.*max/i;
str.matchAll(new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g'))
```

### 5.8 API server binding

`src/api.js` must always bind to `10.67.18.29`, never `0.0.0.0`.
This applies to any new HTTP or WebSocket endpoints added during these phases.

### 5.9 Multicast address validation

All multicast addresses used in `multicast-forward.js` and any new code must be validated
against `239.100.25.0/26` before use.

---

## 6. File Ownership Map

| File | Phase | Owner agent | Notes |
|---|---|---|---|
| `src/ts-analyser.js` | 1, 3 | Claude Code / Agent A | Core probe loop; touch carefully |
| `src/monitoring.js` | 2 | Cursor / Agent B | PersistentThumbnailCapture stays here; worker imports it |
| `src/thumbnail-worker.js` | 2 | Cursor / Agent B | **New file** |
| `src/thumbnail-worker-client.js` | 2 | Cursor / Agent B | **New file** |
| `src/tsduck-monitor.js` | 3 | Claude Code / Agent A | **New file** |
| `src/api.js` | 2, 3 | Both (coordinate) | Wire up worker client + tsduck monitor |
| `test/thumbnail-worker.test.js` | 2 | Cursor / Agent B | **New file** |
| `test/tsduck-monitor.test.js` | 3 | Claude Code / Agent A | **New file** |
| `docs/tsduck-spike-findings.md` | 0 | Whoever runs Phase 0 | **New file** |
| `docs/release-notes-v3.2.md` | 2 | Cursor / Agent B | **New file** |
| `docs/release-notes-v3.3.md` | 3 | Claude Code / Agent A | **New file** |

**Do not modify files outside your assigned phase without cross-checking the other agent's
branch. Conflicts in `ts-analyser.js` and `api.js` are the highest-probability merge issue.**

---

## 7. Multi-Agent Execution Plan

```
Week 1
──────
Day 1–2  Phase 0 (main context / any agent)
         └─ SSH gva-boro-probe, run tsp spike, document findings
         └─ Record Phase 0b SRT decision in this doc (Section 3, Phase 0b)

Day 2–5  Phase 1 (Claude Code, main branch feat/tsduck-interval)
         └─ Reduced-interval tsanalyze
         └─ PR, tests, merge to main

Days 3–7 Phase 2 in parallel worktree (Cursor, branch feat/thumbnail-worker)
         └─ IPC design + thumbnail-worker.js + client + tests
         └─ Independent of Phase 1 — no shared changed files

Week 2
──────
Day 8    Phase 1 merged. Phase 2 PR review + merge.

Day 9–13 Phase 3 (Claude Code, branch feat/tsduck-persistent)
         └─ Requires Phase 0a findings + Phase 0b decision
         └─ TSDuckMonitor + integration + tests

Week 3
──────
Day 14–15  Integration: Phase 2 + Phase 3 combined in staging
Day 16–17  Production validation on gva-boro-probe
Day 18     Release v3.3.0
```

**Parallel safety:** Phase 1 and Phase 2 touch different files:
- Phase 1: only `src/ts-analyser.js`
- Phase 2: new files + minor `src/ts-analyser.js` (constructor option + suspend/resume calls)
- Merge Phase 1 first to avoid conflict in `ts-analyser.js`

---

## 8. Definition of Done (per phase)

A phase is complete when ALL of the following are true:

- [ ] `npm test -- --runInBand` passes with no new failures (149+ tests for Phase 1, new
      tests added for Phases 2 and 3)
- [ ] `npm run build --prefix web` produces 0 warnings
- [ ] Pre-commit hook passes (no telemetry patterns, version bump present)
- [ ] `docs/release-notes-vX.Y.md` updated with operator-visible change description
- [ ] `package.json` (backend) and/or `web/package.json` version bumped
- [ ] PR opened against `main`, not force-pushed
- [ ] Production validation run on `gva-boro-probe` (minimum: start 2 streams, run 5 min,
      check journalctl for errors)

---

## 9. Out of Scope for These Phases

The following were considered and explicitly excluded:

- **Frontend alarm dashboard redesign** — ETR 290 panel already has the correct structure;
  data will flow automatically once backend emits real-time alarms
- **SNMP trap forwarding for ETR alarms** — existing `sendSnmpTrap()` in `monitoring.js`
  can be wired to `TSDuckMonitor` 'alarm' events in a later patch
- **Dolby E / SCTE-35 continuous monitoring** — same pattern as TSDuck; defer until
  Phase 3 architecture is proven stable
- **Multi-stream tsp multiplexing** — one `tsp` instance per stream is simpler and
  matches the existing per-stream TSAnalyser model; do not optimise prematurely
- **Kubernetes / container-per-stream** — out of scope for this HPE DL360 deployment

---

*Last updated: 2026-03-17 — Claude Code v3.1.58*

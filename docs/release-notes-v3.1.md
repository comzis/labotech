# Labotech v3.1 Release Notes

Date: 2026-03-18 (latest: v3.1.71 / web 3.1.71)

## web v3.1.71 — 2026-03-18

### Fullscreen multiview: professional MCR redesign

**`web/src/components/DecoderMultiviewPanel.jsx`:**

- **Tile status indicator moved to top border** (3px, status color) — Evertz VMX style replaces the left-edge accent strip. Uniform 1px dark dividers between tiles; tile background changed from transparent to `#040507` for cleaner contrast against rack SVG.
- **Tile label bar**: coloured status dot (4px, matching tile border) + service name in slightly brighter text; bitrate readout right-aligned; label bar background tied to status color at 14% alpha for subtle context.
- **Header redesigned** (40px): LaboTech mark · PANEL callsign · live-stream count indicator (green LED + `N/M` ratio) · centered LABOTECH wordmark · UTC timecode (14px monospace, tabular nums, 1 Hz update) · EXIT button. Eurovision Services logo removed.
- **Bottom status bus** (26px): `LABOTECH MVW · PANEL-NAME` left, `YYYY-MM-DD HH:MM:SS UTC` centre, `N LIVE / M STREAMS` right — all in very dark blue text, visible only at close range (not distracting at MCR distance).
- **Tile grid**: 2px gap + 2px padding on a `#020304` background so rack SVG frames the grid as a bezel.
- **UTC clock**: `fsNowMs` state with 1 Hz interval only active when fullscreen is open — no timer overhead in normal view.
- **`+ Decoder` button**: text label corrected to `Decoder` (was `+ Decoder`, which combined with the `<Plus>` icon rendered as `+ + DECODER`).

**Operator impact:** Fullscreen multiview now has the tight dark chrome and UTC timecode expected on a professional MCR monitor wall. Double `+` on the Add Decoder button is fixed.

## web v3.1.70 — 2026-03-18

### Fullscreen multiview: vertical audio meters + rack background

**`web/src/components/DecoderMultiviewPanel.jsx`:**

- **Vertical audio meters** embedded in each fullscreen tile. Per-channel `audioLevels.channels` data is paired into L/R pairs and rendered as vertical VU bars filling bottom-to-top (−60→0 dBFS). Zone tick marks at −18 and −9 dBFS. Peak-hold marker per bar. Color: green (nominal) / amber (−18 to −9) / red (> −9). Panel width is `clamp(44px, 20%, 110px)` — scales proportionally with tile size. Falls back to aggregate mean bar when only `meanDb` is available; hides the panel entirely when no audio data is present.
- **Rack background** applied to the fullscreen overlay container — same `broadcast-rack-bays.svg` + blue radial gradient as the main app background. The 1px tile separator lines let it show through, matching the engineering console aesthetic of the other tabs.

**Operator impact:** Active audio pairs visible at MCR distance inside each fullscreen tile. Fullscreen view now matches the platform's rack aesthetic.

## v3.1.71 — 2026-03-18

### Fix: TSDuckMonitor — 4 correctness issues (Phase 3 pre-merge)

**`src/tsduck-monitor.js`:**

- **SRT caller mode** (`_inputPluginArgs`): replaced `--listener --local-port` with `--caller --remote-host HOST --remote-port PORT`. `--listener` made tsp open a local port waiting for an inbound connection — wrong direction for monitoring a remote encoder/mux. tsp must connect TO the source.
- **Remove `--all-sections`** from `tables` plugin args: incompatible with `--json-line` on TSDuck 3.44-4581 (the version on gva-boro-probe). Absence detection still works — without `--all-sections`, tables are emitted on version change; complete table absence within a sample window is still detectable.
- **SI stale detection fix** (`_checkSiIntervals`): `_siTableTimes` persisted across sample runs, so `lastSeen == null` was only ever true on the very first sample. After that, tables were never flagged absent even if they stopped appearing. Fix: `_parseOutput` now passes `windowStartMs` (the `startMs` of the current `tsp` run) through to `_checkSiIntervals`. A table is absent from the current window if `lastSeen < windowStartMs`.

**`src/ts-analyser.js`:**

- **health_alarm hysteresis** (`_onTsduckAlarm`): previously emitted `health_alarm` directly on every alarm event, bypassing the probe-level hysteresis. A single `pcrverify` error during stream join was immediately generating a P1/P2 alarm in the event log. Fix: `_tsduckAlarmState` map tracks consecutive alarm count per `checkId`; `health_alarm` is held until the same check fires on 2 consecutive sample windows. Counter resets when the alarm is absent for >2 sample intervals.

**`test/tsduck-monitor.test.js`:**

- Updated SRT test to assert `--caller`, `--remote-host`, `--remote-port` present and `--listener` absent.
- Updated `_buildTspArgs` test to assert `--all-sections` is absent.
- Added SI stale detection test: table seen in a previous window triggers alarm in the next window where it is absent.

**Operator impact:** ETR 290 PCR/SI alarms from TSDuckMonitor are now: (1) directionally correct for SRT streams, (2) working correctly for repeated absent-table detection, (3) gated behind a 2-consecutive-window threshold so stream-join transients do not generate false alarms.

## web v3.1.68 — 2026-03-18

### Feature: Fullscreen multiview — Evertz-style thumbnail wall

**`web/src/components/DecoderMultiviewPanel.jsx`:**

- Added **FULL SCREEN** button (amber, visible when tiles are active). Invokes the browser Fullscreen API on the overlay container; ESC exits natively.
- Fullscreen overlay renders `FullscreenThumbTile` components in a responsive grid (2/3/4/5 columns by tile count) with no UI chrome.
- Each tile: 16:9 thumbnail fills the cell, thin left-edge status accent (green/amber/red), LED dot in corner, decoder-ID badge (top-right, dimmed), service name + bitrate label bar at the bottom.
- Header bar (44px): LaboTech mark (left) · panel name · centre wordmark `LABOTECH MULTIVIEW MONITOR` · Eurovision Services logo (right) · EXIT button.
- Background is pure black (#000) with 1px dark separators — Evertz VMX-style monitor wall look.

**Operator impact:** One click converts any multiview panel into a full-screen confidence monitor suitable for MCR wall display.

## v3.1.70 — 2026-03-18

### Fix: Log thumbnail capture failures to docker logs

**`src/ts-analyser.js`:**

- The `doCapture` catch block in `startContinuous()` was silently swallowing errors. Added `console.error` so failures appear in `docker compose logs labotech` as `[thumb:<id>] capture failed: <message>`.

**Why:** With thumbnails still not appearing at expected latency after v3.1.69, the silent catch made it impossible to diagnose whether the issue was ffmpeg errors, network/multicast access, filesystem permissions, or something else.

**Operator impact:** Thumbnail capture failures are now visible in server logs for diagnosis.

## web v3.1.67 — 2026-03-18

### Multiview tile: PID breakdown and service name latch

**`web/src/components/DecoderMultiviewPanel.jsx`:**

- **PIDs stat** now shows `NV NA ND` (e.g. `1V 2A 3D`) using `result.dvb.streamBreakdown` instead of a raw count — gives immediate clarity on stream composition at MCR distance. Falls back to raw count if breakdown is absent (older probe result).
- **Service name latch**: last known-good `serviceName` and `serviceProvider` are persisted in component state so the tile never flickers back to "Unknown" between probe cycles or during the initial fast-probe window.

**Operator impact:** PID cell shows video/audio/data counts; service name no longer briefly shows "Unknown" when a new result arrives without DVB-SI tags.

## v3.1.69 — 2026-03-18

### Fix: Replace 4-attempt I-frame ladder with 2-attempt thumbnail=pick (long-GOP streams)

**`src/monitoring.js`, `test/monitoring.test.js`:**

- Removed `-skip_frame nokey` and the 4-attempt fallback ladder from `_doCaptureThumbnail`.
- Now uses 2 attempts: (1) `thumbnail=pick + pp=de/de + scale`, (2) `thumbnail=pick + scale` (handles builds without the `pp` filter).
- `thumbnail=N` buffers N frames and picks the least-blurry one — no keyframe wait required.

**Why:** Broadcast contribution links (Eurovision, GNVE) commonly use GOPs of 10–25 s. `-skip_frame nokey -frames:v 1` waited up to one full GOP for a keyframe — reliably hitting the 8 s timeout on all three I-frame attempts every cycle. The fallback (attempt 4) also failed intermittently, causing the 5 s reschedule to fire before any frame was written. First thumbnail was appearing at 40–45 s. `thumbnail=pick` needs only a small frame window (160 ms at 25 fps) — no keyframe alignment required.

**Operator impact:** First thumbnail expected within 4–6 s of decoder start regardless of GOP length.

## v3.1.68 — 2026-03-18

### Fix: Remove select=eq(pict_type\,I) from one-shot capture — incompatible with -skip_frame nokey

**`src/monitoring.js`, `test/monitoring.test.js`:**

- Removed `select=eq(pict_type\,I)` from the I-frame vf chain in `_doCaptureThumbnail` attempts 1–3.
- `-skip_frame nokey` already guarantees only keyframes are decoded but does **not** set `pict_type` metadata on the output frames. The `select` filter therefore matched nothing, causing ffmpeg to exit code=0 with no output file on every I-frame attempt — even after the fallback-chain short-circuit fix in v3.1.67.
- Now relies on `-skip_frame nokey` + `-frames:v 1` alone, matching the approach already in `PersistentThumbnailCapture`.

**Operator impact:** Attempt 1 now captures the first keyframe reliably (~2–4 s). First thumbnail should appear within 5–8 s of decoder start.

## v3.1.67 — 2026-03-18

### Fix: captureThumbnail fallback chain short-circuit and fallback analyzeduration

**`src/monitoring.js`:**

- `runAttempt` now checks `fs.existsSync(tmpPath)` after `code === 0`. If ffmpeg exits cleanly but wrote no frame (e.g. `select=eq(pict_type\,I)` found no I-frame in the capture window), the attempt is **rejected** so the fallback chain continues to the next attempt. Previously `code === 0` unconditionally resolved, which then threw ENOENT in `fs.rename`, bypassing all remaining attempts and failing the entire capture in one shot.
- Fallback attempt (`iFrameOnly=false`, `thumbnail=pick`) now uses the same `analyzeduration`/`probesize` as the I-frame path (`2000000 µs` / `3 MB` for RTP, SRT-latency-derived for SRT). The previous `7000000 µs` fallback value left only ~1 s for `thumbnail=pick` buffering within the 8 s RTP timeout, causing reliable timeouts on every fallback attempt.

**Why:** For live RTP streams that are mid-GOP at connect time, `select=eq(pict_type\,I)` exits code=0 with no file. This silently short-circuited the 4-attempt ladder on the very first attempt, causing the capture to fail immediately and reschedule for 5 s later — repeated until ffmpeg happened to join near a keyframe. Combined with the fallback analyzeduration being too long to fit in the timeout budget, thumbnails were appearing after 35–50 s instead of 5–10 s.

**Operator impact:** First thumbnail frame should now appear within 5–10 s of decoder start under normal live-stream conditions.

## v3.1.66 — 2026-03-18

### Fix: RTP/UDP first thumbnail fires after jitter only, not jitter + interval

**`src/ts-analyser.js`:**

- Extracted capture logic into `doCapture()` in the RTP/UDP thumbnail loop.
- First call schedules `doCapture` after `thumbStartJitterMs` (0–1.5 s hash-based).
- Subsequent calls continue on the normal `thumbIntervalMs` cadence via `scheduleThumb()`.

**Why:** First capture previously waited `thumbStartJitterMs + thumbIntervalMs` (5–6.5 s of dead time) before even starting. The interval wait serves its purpose between captures but not before the first one — there is no previous capture to space from. Thundering-herd jitter is preserved (hash-based per stream ID).

**Operator impact:** First thumbnail frame appears within ~3–5 s of decoder start instead of ~10–15 s. Subsequent refresh cadence is unchanged.

## v3.1.65 — 2026-03-18

### Fix: Remove duplicate thumbnail capture in analyser streams (>1 min first-frame delay)

**`routes/analyse.js`, `src/api.js`:**

- Removed `thumbnailClient.start()` calls from `POST /analyse/start` and `restoreState()`.
- Removed `thumbnailClient.stop()` call from `DELETE /analyse/:id`.
- Removed now-unused `THUMBNAIL_INTERVAL_SEC` constant from both files.

**Why:** `TSAnalyser.startContinuous()` already manages thumbnail capture internally — a `captureThumbnailTimer` loop for RTP/UDP and a `PersistentThumbnailCapture` for SRT. The v3.1.62 wiring introduced a second concurrent `PersistentThumbnailCapture` via the worker subprocess for every stream, creating two simultaneous ffmpeg processes per decoder. Under load this doubled CPU usage for thumbnail capture and caused resource contention that delayed the first frame from ~10 s to >1 minute.

**Operator impact:** First thumbnail frame appears within 10–15 s of decoder start (jitter + first capture cycle). The `ThumbnailWorkerClient` infrastructure remains for future use with streams that do not have their own capture logic.

## v3.1.64 — 2026-03-18

### Fix: Thumbnails not displaying after thumbnail worker wiring (regression v3.1.62)

**`src/api.js`:**

- In the `thumbnail_frame` handler, when the worker emits a new frame, the corresponding `TSAnalyser` instance's `_lastThumbnailUrl` is now updated immediately.

**Why:** The v3.1.62 wiring moved thumbnail capture out of `ts-analyser.js` into the worker process. However, `TSAnalyser._lastThumbnailUrl` was never updated by the worker — it was only set when `runThumbnailCapture` (one-shot probe mode) ran. In continuous mode (`runThumbnailCapture = false`), the `analyse_result` events propagated `thumbnailUrl: undefined`, causing the Confidence Monitor and multiview tiles to show "AWAITING FRAME" indefinitely.

**Operator impact:** Confidence Monitor and multiview thumbnails display correctly again.

## v3.1.63 — 2026-03-18

### Fix: ETR290Analyser 5s startup grace — suppress multicast join noise

**`src/etr290-analyser.js`:**
- Added `STARTUP_GRACE_MS = 5000` (overridable via `ETR290_STARTUP_GRACE_MS` env var).
- `start()` sets `_startedAt = Date.now()`.
- `_parseLine()` suppresses incident creation (but still increments `_counts`) for the first 5 seconds after start.

**Why:** ffmpeg joining a multicast stream mid-stream emits `RTP: missed N packets` and similar lines within the first 1–3 seconds. With `transport_error` threshold set to 1, this fired a spurious alarm in the event log on every decoder start, with no corresponding count growth in the TS Analyser (which has its own 20s probe-cycle grace). The ETR290 and TS Analyser alarm logs were therefore inconsistent at startup.

**Operator impact:** Transport Error and PCR Discontinuity alarms will no longer fire in the first 5 seconds after a decoder starts. Genuine persistent errors that begin immediately after the grace window still fire normally. The count totals in the UI still increment during the grace period.

## v3.1.62 — 2026-03-17

### Feat: Phase 2 thumbnail worker — api.js wiring and analyser lifecycle integration

**`src/api.js`:**

- Creates `ThumbnailWorkerClient` on startup, before route mounting.
- Wires `frame` events to WebSocket broadcast as `{ type: 'thumbnail_frame', id, url, path }`.
- Passes client to the analyse route so analyser start/stop automatically manages thumbnail captures.
- `restoreState()` now calls `thumbnailClient.start()` for each restored analyser on boot.
- SIGTERM handler: awaits `thumbnailClient.shutdown()` for clean worker teardown before `process.exit(0)`.

**`routes/analyse.js`:**

- `POST /analyse/start` calls `thumbnailClient.start(id, url, THUMBNAIL_INTERVAL_SEC)` after analyser starts.
- `DELETE /analyse/:id` calls `thumbnailClient.stop(id)` when analyser is removed.
- `thumbnailClient` is optional (null-safe) — test and standalone usage unaffected.

**Operator impact:** Confidence Monitor thumbnails are now driven by the isolated worker process. Thumbnail capture failures no longer affect the main API process; the worker restarts automatically with exponential backoff. No UI change required — the frontend already consumes `thumbnail_frame` events.

## v3.1.61 — 2026-03-17

### Chore: Phase 2 thumbnail worker scaffolding (worker + client + tests)

**Included in this PR:**

- Added `src/thumbnail-worker.js` worker runtime using `child_process.fork()` IPC command handling.
- Added `src/thumbnail-worker-client.js` with restart/backoff and active capture replay logic.
- Added `test/thumbnail-worker.test.js` for command routing, shutdown handshake, and restart replay behavior.

**Scope clarification:**

- `src/api.js` wiring is intentionally deferred to a follow-up change after this Phase 2 scaffolding PR merges.
- No frontend behavior changes in this entry.

**Operator impact:** No immediate operator-facing behavior change from this scaffolding-only patch. Runtime integration (API wiring and activation path) lands in follow-up work.

## v3.1.59 — 2026-03-17

### Feat: severity-aware probe scheduling — alarm streams poll up to 4× faster

**`src/ts-analyser.js` — `_effectiveProbeIntervalMs()`:**

- Streams in `warning` severity now probe at 50% of `baseIntervalMs` (default: 2.5 s instead of 5 s)
- Streams in `critical` severity probe at 25% of `baseIntervalMs` (default: 1.25 s)
- `ok` severity (or no result yet) retains the full base interval — no change to normal operation
- Floor of 1 s enforced regardless of `baseIntervalMs` setting to prevent probe storms
- Effective interval exposed in `probeDiagnostics.scheduler.effectiveIntervalMs` and `priorityBoost` fields
- Global heavy-probe semaphore (max 3 concurrent) still caps parallel load across all streams

**Operator impact:** Alarm conditions detected and recovered faster. A stream that goes critical will
re-probe within ~1–2 s rather than waiting up to 5 s for the next cycle. No configuration change needed.

## v3.1.58 — 2026-03-17

### Fix: PCR metrics wired to analyser panel, multiview persistence across tab switches, improved muted-text legibility

**TSAnalyser.jsx — PCR / Timing panel now shows live data:**

- PCR Interval now reads from `dvb.pcrMetrics.repetitionMaxMs` (populated by TSDuck heavy probe). Previously read from `dvb.pcr.intervalMs` which was never populated. ETR 290 P2.1 limit is 40ms — value shown amber if exceeded.
- PCR Jitter now reads from `dvb.pcrMetrics.accuracyMaxMs`. ETR 290 P2.2 practical threshold 0.5ms — value shown amber if exceeded.
- PCR Discontinuity Indicator row appears when `discontIndicatorErrors > 0`.
- CRC Errors row appears when `crcErrors > 0`.
- Both fields fall back gracefully to the legacy `dvb.pcr` path if available (forward-compat for any future direct PCR extraction).

**DecoderMultiviewPanel.jsx — multiview layout survives tab navigation:**

- `decoderIds[]` per panel is now persisted to and restored from localStorage on mount. Previously blanked on every restore, causing the operator to lose all tile assignments on every tab switch.
- The existing auto-seed logic (line 661: `anyActive` check) still handles server-restart staleness: if restored IDs are all stale (none match current active analysers), the panel re-seeds from the current active set automatically.

**tailwind.config.js — muted text legibility improvement:**

- `gray-500` lifted from `#6b7280` → `#8b95a8` (contrast ratio on `#070b14` improved from ~3.5:1 to ~5.0:1, crossing WCAG AA threshold for small text).
- `gray-600` lifted from `#4b5563` → `#6b7587`.
- Affects all panels uniformly. Active/accent/alarm colours are unchanged (neon/led palette).

**Operator impact:** PCR interval and jitter now show real values in the Analyser panel whenever TSDuck has run a heavy probe. Multiview tile layout is no longer lost when switching tabs. All label and metadata text is easier to read on dark displays.

---

## Overview

v3.1 is a broadcast-operator readiness release focused on four areas:

1. **Timeline Confidence Monitor** — MCR-grade lane visualisation with per-protocol alarm accuracy, stable live-lane rendering, operator status labels, and smooth 60fps now-line.
2. **UI Hardening** — rAF-throttled crosshair cursor, Stop All control, larger lanes/thumbnails, soft monitoring colour palette, short-window zoom (30s/1m/2m).
3. **Health / Alarm Accuracy** — per-protocol CC/discontinuity thresholds; probe timeouts separated from genuine signal loss.
4. **False Positive Elimination** — ffprobe capture-window misses no longer drive lane red; noSignal recovery in one probe cycle.

---

## v3.1.57 — 2026-03-17

### Professional-grade backend improvements: PCR/ETR 290, alarm hold-down, CC accumulator, thumbnail backoff

**monitoring.js — PersistentThumbnailCapture improvements:**

- **Reduced high-profile thumbnail resolution** from 640px to 320px, quality from qv=2 to qv=4, and removed hqdn3d denoise filter. Reduces CPU load per capture without operator-visible quality loss at MCR distance.
- **Exponential backoff on restart:** `_scheduleRestart()` now doubles `_restartDelay` (capped at 30s) on each consecutive failure. Resets to 5s on successful frame write, on `resume()`, and on `suspend()` so transient failures do not permanently stall thumbnails.
- **stderr logging:** ffmpeg stderr is now forwarded to console.error with stream ID prefix (first 200 chars) for diagnosing capture failures in journalctl.
- **SRT post-probe settle delay:** `analyzeduration` for SRT increased by 1s (`latencyMs + 3000ms`) to give sources with a 1–2s reconnect cooldown time to accept the new connection.

**ts-analyser.js — ETR 290 / alarm accuracy improvements:**

- **Lifetime CC accumulator:** `_ccTotal` and `_ccHeavyCount` now accumulate CC errors across all probe cycles (never reset). Health assessment deducts 8pts if the lifetime average per cycle reaches the warn threshold after ≥5 cycles, catching persistent low-rate errors that individually never breach the per-cycle floor.
- **Alarm hold-down on recovery:** Added `OK_HYSTERESIS_N = 2` — after an alarm, requires 2 consecutive clean probes before reporting 'ok'. Prevents single-probe flicker from causing false clear alarms in the event log.
- **PCR metrics extraction (`_extractTSDuckPcrMetrics`):** Walks TSDuck JSON output to extract PCR repetition max/mean, PCR accuracy max, PCR discontinuity indicator errors, and PSI CRC errors. ETR 290 Priority 2 scoring: repetition >40ms (10pts, >100ms 20pts), accuracy >10ms (8pts, >50ms 16pts), discontinuity indicators (12pts), CRC errors (10pts, ≥3 errors 20pts).
- **Unreferenced PIDs extraction (`_extractUnreferencedPids`):** Detects PIDs in the TS stream not referenced by any PMT (ETR 290 P3.5). Applies a 6pt penalty when found.
- **SRT thumbnail post-probe settle delay:** `this._persistentThumb.resume()` is now called after a 1500ms settle delay to avoid immediate connection rejection from SRT sources with a reconnect cooldown.

**Operator impact:** More accurate health scores (fewer false positives from PCR/CC/unreferenced PID faults), more resilient thumbnail capture with diagnostic logging, and reduced false alarm flicker on stream recovery.

---

## v3.1.56 — 2026-03-17

### Feat: Multiview config export / import for workstation migration

Operators can now save the complete multiview configuration — all decoders, panel names, stream catalogs, and panel→decoder assignments — to a single JSON file, and restore it on any other workstation.

**Export** (`↓ Config` button in the Decoder Multiview header):
- Calls `GET /api/multiview/export` (server provides running decoder URLs + panel stream registry)
- Merges client-side panel→decoder assignments from browser state
- Downloads `labotech-multiview-YYYY-MM-DD.json`
- SRT passphrases, latency, and pbkeylen are included in the bundle

**Import** (`↑ Config` button):
- Reads the exported JSON, shows a confirmation prompt
- Calls `POST /api/multiview/import`: starts all decoders, writes `multiview-panels.json`
- Restores the panel→decoder layout in the browser without a full page reload
- Already-running decoders with the same ID are skipped; any skipped IDs are reported

**Export format** (`exportVersion: 1`):
- `panels[]` — panel id, name, stream catalog, decoderIds assignment
- `decoders[]` — id, url, interval, nicName, plus `parsed{}` with human-readable host/port/protocol/latency/passphrase for reference
- `_clientPanelIds[]` — full client-side panel state for round-trip fidelity

**Operator impact:** Commissioning a second monitoring workstation now takes seconds: export from the primary, import on the secondary. No manual re-entry of decoder URLs or passphrases.

**Backend route changes:** `routes/multiview.js` factory now accepts `(analysers, saveState, broadcast)` so it can start decoders on import. `src/api.js` updated accordingly.

---

## v3.1.55 — 2026-03-17

### Fix: Monitoring Policy dropdown clipped by Stream Profile panel

The Policy chip in the Stream Profile panel opens an absolute-positioned dropdown. `PanelBox` has `overflow: hidden` (required for border-radius clipping on most panels), which clipped the dropdown against the panel's lower edge — making profile options unreachable.

Fix: added `overflow: visible` to the specific Stream Profile `PanelBox` instance only. All other `PanelBox` components are unchanged. The dropdown now renders above the panel boundary and is fully interactive.

---

## v3.1.54 — 2026-03-17

### Fix: Audio meter bars showing reversed colours — silence appeared full/red

**Root cause:** `_probeAudioLevels()` in `ts-analyser.js` parsed `RMS level dB` and `Peak level dB` from ffmpeg astats output using `Number.isFinite()` to validate the parsed value. For truly silent channels, ffmpeg reports `RMS level dB: -inf` and `Peak level dB: -inf`. `parseFloat('-inf')` returns `-Infinity`, and `Number.isFinite(-Infinity)` is `false` — so silent channels were silently dropped. The fallback behaviour left those channels unset, causing them to be excluded entirely or coerced to 0 dBFS downstream. `dbToPercent(0)` maps to 100% bar width; `meterColor(0)` maps to red.

**Fix:** Explicitly handle `-inf`/`inf` string literals before calling `parseFloat`. Silent channels (`-inf`) are stored as −90 dBFS — a floor value that renders as an empty (green) bar at MCR distance. Clipping channels (`inf`) are stored as 0 dBFS. `Number.isFinite()` validation still guards numeric parse results.

**Operator impact:** Silence no longer shows as a full red bar. Silent channels render with an empty green meter, consistent with broadcast convention (silence = no signal, green = no alarm).

---

### Fix: CC errors not flagging on RTP/UDP feeds — carry-forward and 3-probe rolling average

Two compounding issues prevented CC errors from registering on RTP/UDP multicast feeds:

1. **Light probe carry-forward**: On light probe cycles (`runHeavyProbe = false`), `continuityCounterErrors` was unconditionally reset to `{count: 0}`. Health assessment scored CC as clean every light cycle (which is ~2 of every 3 probe cycles). Fix: light cycles now carry forward the last known heavy-probe CC result.

2. **Per-probe ffprobe join artefacts**: Each `_probeContinuityCounterErrors()` call spawns a new ffprobe that reconnects to the multicast group and always produces 1–10 CC errors while syncing to the first keyframe. The broadcast-balanced-v1 floor (`ccWarnCount ≥ 3`) was designed to absorb these, but it also suppressed genuine single-digit CC error rates. Fix: the per-cycle count is now replaced with a 3-probe rolling average for RTP/UDP CC scoring. Join artefacts from a clean stream average out to ~1–2 per cycle; a genuinely degraded feed sustains an average ≥ 3 and crosses the threshold.

**Operator impact:** Persistent CC errors on RTP/UDP contribution feeds now register as warnings/critical within 3 heavy probe cycles (~3–6 minutes depending on profile). Previously they were permanently suppressed.

---

## v3.1.53 — 2026-03-17

### Fix: SRT probe serialisation — 0 PIDs/services despite full bitrate

**Root cause:** `Promise.all` launched all heavy probes simultaneously (TSDuck, ffmpeg bitrate, ffprobe audio, tsDisc, CC). For SRT sources that accept only one caller, only the first process to connect received TS data — typically the transport bitrate probe. All others were rejected, returning empty results. Result: correct bitrate, 0 PIDs, 0 services, 0 CC errors.

**Fix:** SRT heavy probes now run sequentially — one SRT connection at a time. RTP/UDP multicast keeps `Promise.all` (unlimited simultaneous receivers). The thumbnail suspend budget is extended to `latencyMs + 70s` to cover the full sequential probe window; `resume()` in the `finally` block still cancels it early as soon as all probes finish.

Trade-off: SRT probe cycles are longer (sum of probe durations vs max), but all probes now succeed and populate the full dashboard.

---

## v3.1.52 — 2026-03-17

### Fix: RTP/UDP thumbnails broken — PersistentThumbnailCapture scoped to SRT only

`PersistentThumbnailCapture` (introduced v3.1.45) was applied to all protocols including RTP/UDP multicast. For SRT it is necessary — reconnecting every frame costs a full latency window. For RTP/UDP multicast, multicast join is near-instant and the proven one-shot `captureThumbnail()` path was already working before v3.1.45.

The persistent process on multicast failed silently (`-loglevel error` suppresses stderr) and produced no frames, leaving all RTP/UDP decoders at "AWAITING FRAME" after deploy.

Fix: `PersistentThumbnailCapture` is now SRT-only. RTP/UDP streams revert to the original interval timer loop calling `captureThumbnail()` — the approach that worked reliably before this session's changes.

---

## v3.1.51 — 2026-03-17

### Fix: SRT thumbnail race condition + analyzeduration too aggressive

Two bugs introduced in v3.1.49–v3.1.50 causing "AWAITING FRAME" and complete thumbnail loss:

**Race condition (monitoring.js):** `suspend()` killed the ffmpeg process but the stale `close` event fired after `resume()` had already spawned a new one — setting `this._proc = null` on the live process and scheduling a spurious 5s restart. Fixed with an epoch counter (`this._epoch`) incremented on every `_spawn()`. Close and error handlers capture epoch at spawn time and bail out if it no longer matches, making them immune to stale events from processes killed by `suspend()`.

**`analyzeduration` too short (monitoring.js):** Reduced from `latencyMs+3000ms` to `latencyMs+500ms` in v3.1.50 — too aggressive. ffmpeg needs to detect H.264/HEVC codec info by seeing at least one IDR frame. Broadcast streams with a 2s GOP at 25fps require up to 2000ms of media data after the SRT latency window fills. With only 500ms headroom, the format detection phase timed out before an IDR arrived → ffmpeg exited → "AWAITING FRAME". Restored to `latencyMs+2000ms` (a practical improvement over the original 3000ms while guaranteeing reliable GOP detection).

---

## v3.1.50 — 2026-03-17

### Fix: SRT thumbnail first-frame latency — redundant I-frame filter and oversized analyze window

Two compounding delays before the first thumbnail appeared after each spawn/resume:

1. **`analyzeduration = latencyMs + 3000ms`** — the 3s headroom was added for the transport bitrate probe (which needs a full measurement window) but was also applied to the thumbnail process, which only needs the SRT latency window to fill. Reduced to `latencyMs + 500ms`.

2. **`select=eq(pict_type\,I)` in the vf chain was redundant and harmful** — `-skip_frame nokey` already instructs the decoder to skip all non-keyframes, so every frame reaching the filter graph is already an I-frame. The `select` filter only passed frames that fell on the `fps=1/N` time grid, which could skip the very first keyframe and delay the first thumbnail by up to one full interval (e.g. 30s). Removed.

Result: first thumbnail after spawn/resume now appears at `latencyMs + ~500ms + time-to-first-keyframe` instead of `latencyMs + 3000ms + interval`.

---

## v3.1.49 — 2026-03-17

### Fix: SRT thumbnail frozen for full 35s probe budget

`suspend()` set a 35s fallback restart timer but had no way to cancel it early. When the probe completed in ~10s the thumbnail stayed dead for the remaining 25s. Added `resume()` to `PersistentThumbnailCapture`: cancels the fallback timer and calls `_spawn()` immediately. Called from the `finally` block in the heavy probe path — thumbnail now restarts as soon as all probe processes exit, not after the worst-case budget.

Operator impact: thumbnail freeze on SRT streams reduced from ~35s to the actual probe duration (~latency + 10s, typically 12–15s for 2s latency SRT).

---

## v3.1.48 — 2026-03-17

### Fix: SRT probe failure — PersistentThumbnailCapture holding single connection slot

**Problem:** `PersistentThumbnailCapture` (added v3.1.45) holds a long-lived SRT caller connection indefinitely. Many SRT encoders and contribution servers accept only one caller at a time. When the heavy probe cycle runs, `_probeTransportBitrateBps()` tries to open a second SRT connection — the source rejects it, the probe fails with 0 TS packets and 0 bitrate while the SRT Transport tab shows no counters.

**Fix (`monitoring.js`):**
Added `suspend(durationMs)` to `PersistentThumbnailCapture`:
- Kills the current ffmpeg process (freeing the SRT caller slot)
- Sets a restart timer for `durationMs` before killing, so the close handler's own `_scheduleRestart(5000)` sees `_restartTimer` already set and exits early — preventing the thumbnail from reclaiming the slot mid-probe
- Does not set `_running = false`, so the class resumes cleanly after the budget expires

**Fix (`ts-analyser.js`):**
Before each heavy probe burst on SRT URLs: calls `this._persistentThumb.suspend(latencyMs + 30000)` then waits 600 ms for the SRT connection to close. After the burst completes, the thumbnail auto-restarts via its internal timer.

Operator impact: SRT heavy probes now get the connection slot they need — TS packet counts, bitrate, and libsrt stats all populate correctly. Thumbnail freezes for ~35 s per probe cycle (every 15–60 s depending on policy) then resumes.

---

## v3.1.47 — 2026-03-17

### Fix: SRT stats showing false zeros ("STATS OK" but all 0.0)

**Root cause:** `_extractSrtStatsFromLog()` searched the entire ffmpeg stderr string with overly-broad patterns. The `rate` alias matched `bitrate=0.0kbits/s` from `ffmpeg -progress pipe:2`, `total` matched `total_size=N`, and `bw` / `rtt` hit other unrelated fields — all returning 0. This made `srtStats` truthy (showing "STATS OK") but with all-zero values.

**Fix (ts-analyser.js):**
- Pre-filter stderr to only lines containing a genuine libsrt marker (`msRTT=`, `mbpsRecvRate=`, `mbpsBandwidth=`) before parsing — lines from `-progress pipe:2` are excluded entirely
- Removed all short-word fallback aliases (`rate`, `bw`, `total`, `rtt`, `retrans`, `loss`, `lost`, `nak`, `ack`) — replaced with exact libsrt field names using `\b` word boundary anchors
- Returns `null` (not a falsy empty object) when no libsrt stat lines are present — UI correctly shows "AWAITING" instead of "STATS OK" with zeros

**Fix (TSAnalyser.jsx):** SRT Transport tab reorganised with four sections:
- **Link Quality** — RTT, Recv Rate, Bandwidth, Loss %
- **ARQ Counters** — NAK, ACK, Retransmitted, Lost, Total, Retrans %
- **Latency Health** — RcvDrop, SndDrop, Belated (with inline drop/belated banners)
- **Buffer & Flow** — Rcv Buf (ms), Flow Window, Max BW

Operator impact: SRT Transport tab now correctly shows "AWAITING" until the first transport probe completes, then populates with real libsrt counters. Drops/belated events surface with colour coding and diagnostic messages in-panel.

---

## v3.1.46 — 2026-03-17

### Feat: SRT professional broadcast health thresholds (Haivision spec + Eurovision dashboard)

SRT link quality assessment aligned to Haivision SRT specification and Eurovision contribution link data (RTT ~19ms, 22–24 Mbps, all drops at 0).

**Backend (`ts-analyser.js`):**

*New stats parsed from libsrt verbose output:*
- `pktRcvDrop` / `pktSndDrop` — drops due to latency window too short (per Haivision spec: non-zero = critical)
- `pktRcvBelated` / `pktRcvAvgBelatedTime` — packets arriving after deadline (warning: raise latency)
- `byteAvailRcvBuf` / `msRcvBuf` — receiver buffer fill level
- `pktFlowWindow` — available flow window slots
- `mbpsMaxBW` — sender max bandwidth limit
- `retransRatio` — `pktRetrans / pktTotal × 100%` (>5% = warning, >25% = critical per Haivision spec)

*New health penalties in `_buildHealthAssessment()`:*
- `pktRcvDrop > 0` → −30pts critical: receiver drops, latency window too short for link RTT
- `pktSndDrop > 0` → −30pts critical: sender could not retransmit within latency window
- `pktRcvBelated > 0` → −12pts warning: packets arriving after deadline, consider raising latency
- `RTT ≥ SRTO_LATENCY` → −25pts critical: ARQ cannot recover (mathematically impossible)
- `RTT > SRTO_LATENCY/2` → −10pts warning: retransmits may miss receiver deadline
- `retransRatio > 25%` → −20pts critical; `> 5%` → −8pts warning

**Frontend (`MetricsTile.jsx`):**

SRT Link panel gains a third row: **RcvDrop / Belated / Retrans%** with broadcast traffic-light colouring (green=0, yellow=warning, red=critical). RTT value now shows one decimal place. Retrans count colour-coded to retransRatio threshold.

Operator impact: SRT drops and belated arrivals are now visible in the MCR tile immediately, with the health score and alarm system picking them up within one probe cycle.

---

## v3.1.45 — 2026-03-17

### Fix: SRT bitrate measurement, persistent thumbnails, dynamic latency window

Three related SRT improvements:

**1. 786 kbps bitrate measurement bug fixed**
`_probeTransportBitrateBps` used a fixed `-t 3.0 s` capture window and `analyzeduration=1s`. For SRT with `latency=2000ms`, the first 2s were consumed by the SRT handshake + latency window fill — leaving only 1s of data in a 3s window, producing ~⅓ of true bitrate. Now uses `parseSrtLatency()` to derive the capture window dynamically: `latency + 5s` capture, `latency + 2s` analyze, `latency + 20s` kill timer.

**2. Persistent thumbnail process — near real-time refresh**
Replaced the timer-based `captureThumbnail()` loop (which spawned a new ffmpeg every 5s, incurring a full SRT latency window reconnect on every cycle) with a long-lived `PersistentThumbnailCapture` per decoder. The ffmpeg process runs indefinitely, emitting JPEG frames to `pipe:1`; a `JpegFrameExtractor` detects complete frame boundaries (FF D8 … FF D9) and writes them atomically. After the first SRT latency window, subsequent frames are delivered in real time at the configured interval — no reconnect overhead.

**3. SRT latency is now read from the URL parameter**
`parseSrtLatency(url)` extracts `?latency=N` from the SRT URL. All analyze windows, capture durations, and attempt timeouts are derived from this value. Set your SRT latency in the decoder form — the probe and thumbnail pipeline adapts automatically. Higher-latency SRT links (e.g. `latency=5000`) now work without manual tuning.

---

## v3.1.44 — 2026-03-17

### Fix: SRT caller thumbnail "Awaiting Frame" — latency window starving analyze

Two bugs caused SRT caller streams to show "Awaiting Frame" indefinitely:

1. **analyzeduration too short**: I-frame attempts used `analyzeduration=2s`. SRT caller's latency window (typically 2–5s) must fill before any data flows — the analyze window expired before a single packet arrived.
2. **No connection timeout set**: SRT URLs got no `timeout` parameter, so ffmpeg hung on connection failures until the 8s kill timer fired — consuming all available thumbnail attempt slots.

**Fix (`monitoring.js`):**
- SRT URLs: automatically appends `mode=caller` (if absent) and `timeout=8000000` (8s connection timeout)
- SRT I-frame `analyzeduration` raised from 2s → **6s**
- SRT attempt timeout raised from 8s → **14s** per attempt (covers up to 5s latency window + decode)

Operator impact: SRT caller confidence thumbnails now appear on first or second attempt instead of exhausting all retries.

---

## v3.1.43 — 2026-03-17

### Ops: Full NUMA-aligned CPU/memory allocation for Xeon Gold 5120 dual-socket

Previously using 16 of 56 available logical CPUs. Now NUMA-pinned:

| Container | cpuset | cpus | mem |
|---|---|---|---|
| labotech | `0-13,28-41` (NUMA 0) | 24.0 | 24 GB |
| labotech-encapsulator | `14-27,42-55` (NUMA 1) | 16.0 | 8 GB |

- Node.js heap: 6 GB → **16 GB** (conservative ceiling; leaves 8 GB for concurrent child processes)
- `TS_HEAVY_PROBE_MAX_CONCURRENT`: 3 → **8** (8 simultaneous ffprobe+tsanalyze spawns; I/O-bound, safe on 28 threads)
- `THUMBNAIL_MAX_CONCURRENT`: 2 → **4**
- `shm_size` labotech: 512 MB → 1 GB

Operator impact: significantly reduced cross-socket memory latency, more headroom for concurrent probe cycles, faster thumbnail refresh. Pending soak validation under full lane load before further heap increase.

---

## v3.1.42 — 2026-03-17

### Fix: TS analyser state persisted across container restarts

Active decoders/analysers were not saved to `config/state.json`, so every container restart wiped the TS timeline and required manual re-adding of all decoders.

- `state-persistence.js`: adds `analysers` to `save()`/`load()` (fields: `id`, `url`, `interval`, `nicName`)
- `api.js`: `saveState()` now includes the analysers map; `restoreState()` always restores analysers on boot (no env var gate — decoders must survive restarts)
- `routes/analyse.js`: calls `saveState()` on every `POST /analyse/start` and `DELETE /analyse/:id`

Operator impact: start your decoders once — they auto-resume after every deploy.

---

## v3.1.41 — 2026-03-17

### Ops: `scripts/diagnose.sh` — one-command health snapshot

`bash scripts/diagnose.sh` prints: process status, systemd service state, journal errors (last 30 min), all registered analysers with running flag and last probe time, active probe URLs, WebSocket connection count, disk, and memory. Optional arg: `bash scripts/diagnose.sh "1 hour ago"`.

---

## v3.1.40 — 2026-03-17

### UX: Catalog stream picker promoted to first-class control; mode buttons compact

The decoder form now opens with a full-width **"Select stream from catalog…"** search input (with loupe icon) that filters all 914 streams by name or IP in real time. Selecting a stream auto-fills Host/IP, Port, Mode, and Decoder ID.

The RTP / SRT / UDP mode buttons are now compact and sit to the right of the picker on the same row instead of spanning the full width. The Host/IP field below is a plain editable field (catalog picker no longer duplicated there).

---

## v3.1.39 — 2026-03-16

### Fix: Decoder ID auto-fill uses stream name directly

When selecting a stream from the catalog dropdown, the Decoder ID field is now populated with the stream name as-is (e.g. `GV RX096`) instead of a slugified compound string (`mv-gv-rx-096-239-100-20-196-6501`). Easier to read at MCR distance and matches the operator naming convention.

---

## v3.1.38 — 2026-03-16

### Fix: Remove loaded stream tiles from multiview panel

Multiview was accidentally flooding with 914 loaded (inactive) stream tiles from the catalog. The panel grid now shows **only active (running) decoder tiles** — no loaded tiles concept exists.

- Removed `LoadedStreamCard` component entirely
- Removed `startingStreamIds`, `collapsedCategories`, category-grouping for tile display
- Bumped localStorage key from `v2` → `v3` to clear stale browser cache (browsers with old data will auto-reset on next load)
- The 914-stream catalog remains available as a **dropdown picker on the Host/IP field only**

Operator impact: multiview is clean again — only live decoders appear as tiles.

---

## v3.1.37 — 2026-03-16

### Feature: Stream catalog picker on Host/IP field in decoder form

Click the **Host/IP** field when adding a decoder — a categorised dropdown appears showing all 914 streams from the catalog, grouped by type (GV Receivers, LK Receivers, GV/LK Encoders, IP Decoders, Blue/Red Multicast). Type to filter by name or IP. Selecting a stream auto-fills IP, port, mode and decoder ID.

Catalog served from `config/multiview-stream-catalog.json` via `GET /api/multiview/catalog`. Separate from the panel registry — does not load streams as multiview tiles.

Reverts the accidental pre-population of `config/multiview-panels.json` — panels config is back to empty default.

---

### Revert: Remove pre-populated streams from multiview panels config

`config/multiview-panels.json` reset to empty. The 914-stream catalog will be used as a source picker dropdown on the Host/IP field in the decoder form — not loaded as multiview tiles.

---

## v3.1.36 — 2026-03-16

### Fix: Replace `node` with `jq` in post-deploy smoke script

`post-deploy-smoke.sh` used a `node` heredoc to parse the health JSON — same issue as the preflight script (v3.1.25). Node.js is not installed on the host, causing a permanent FAIL=1 on every deploy. Replaced with `jq` one-liners, same fix pattern as preflight. Deploy summary will now show PASS=7 FAIL=0.

---

## v3.1.35 — 2026-03-16

### Ops: Pre-populate stream registry with 914 multicast streams

`config/multiview-panels.json` seeded with all 914 clean multicast streams across 10 categories on the default BES panel. No manual import needed after deploy — streams are available immediately on first load.

---

## v3.1.34 — 2026-03-16

### Fix: Add GV/LK Blue and Red Multicast categories; filter invalid IPs from import

New source JSON introduced four additional prefixes not present in the original files. Added to `deriveCategory()` and category order:
- `GV_BMCAST_*` → GV Blue Multicast (199 streams)
- `GV_RMCAST_*` → GV Red Multicast (199 streams)
- `LK_BMCAST_*` → LK Blue Multicast (64 streams)
- `LK_RMCAST_*` → LK Red Multicast (64 streams)

Extraction script updated to filter non-multicast IPs (e.g. `0.0.0.0`) and `_old` legacy entries. Clean extracted file: **914 unique valid streams**.

---

## v3.1.33 — 2026-03-16

### Feature: Auto-categorised collapsible groups for loaded stream tiles

With large stream registries (e.g. 389 streams), a flat tile grid is unworkable. Loaded (inactive) tiles are now grouped into collapsible category sections, derived automatically from the stream name prefix — no extra column in the CSV/JSON needed.

**Category mapping (auto-derived, ordered):**
| Prefix | Category |
|---|---|
| `GV_IPDEC_*` | GV IP Decoders |
| `LK_IPDEC_*` | LK IP Decoders |
| `GV_TS_ENC_*` | GV Encoders |
| `LK_TS_ENC_*` | LK Encoders |
| `GV_RX_*` | GV Receivers |
| `LK_RX_*` | LK Receivers |
| `*_old` | Legacy |
| anything else | Other |

Each category shows a header with name and stream count. Click to collapse/expand. Active (live) tiles remain ungrouped at the top. Legacy streams extracted from source JSON were excluded from the clean import file.

---

## v3.1.32 — 2026-03-16

### Fix: Move Import/Export buttons to header toolbar alongside Decoder button

Import and Export buttons relocated from the stream registry section into the main header toolbar, styled consistently with the existing Decoder and Panel buttons. Export button only appears when the active panel has streams configured. Removes the separate registry toolbar row.

---

## v3.1.31 — 2026-03-16

### Ops: One-command setup scripts for cron and Docker log rotation

Replaces manual copy-paste commands with two runnable scripts:

**`scripts/setup-disk-guard-cron.sh`** — installs the nightly 3am disk-guard cron entry:
```bash
bash scripts/setup-disk-guard-cron.sh
```
Writes `/etc/cron.d/labotech-disk-guard` automatically. Accepts optional username arg (default: `boro`).

**`scripts/setup-docker-log-rotation.sh`** — configures Docker daemon global log rotation:
```bash
bash scripts/setup-docker-log-rotation.sh
```
Writes `/etc/docker/daemon.json` and restarts the Docker daemon. Prompts for confirmation if the file already exists. **Causes brief container downtime — run during a quiet period.**

---

## v3.1.30 — 2026-03-16

### Ops: Scheduled disk housekeeping script (`scripts/disk-guard.sh`)

**Problem:** Disk fills up silently between deploys. The `update-and-deploy-safe.sh` cleanup only runs when a deploy is triggered and disk is already low — by then it may be too late.

**Solution:** `scripts/disk-guard.sh` — a standalone cleanup script safe to run from cron while Labotech is live (no container stop or restart). Cleans five categories:
1. Docker container JSON logs (`/var/lib/docker/containers/*/*-json.log`) — truncated in-place, the primary silent killer
2. Unused Docker images and build cache (`docker system prune -af`)
3. apt package cache + orphaned packages
4. systemd journal vacuumed to 200 MB / 7 days
5. Thumbnail JPEGs older than 1 hour from `logs/thumbnails/`

Logs before/after free space for root and Docker volumes, with a warning if free space is still below `WARN_FREE_MB` (default 2 GB) after cleanup.

**Cron entry (run once on server as root):**
```bash
echo '0 3 * * * boro bash /home/boro/LaboTech/labotech/scripts/disk-guard.sh >> /var/log/labotech-disk-guard.log 2>&1' \
  | sudo tee /etc/cron.d/labotech-disk-guard
```

**Docker daemon log rotation (run once on server as root):**
```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
sudo systemctl restart docker
```
This caps logs at the daemon level for all containers as a belt-and-braces measure alongside the per-service limits already in `docker-compose.yml`.

**Operator impact:** Disk no longer fills up silently. Daily 3am run reclaims build cache, logs, and thumbnails. Operators see reclaimed MB in `/var/log/labotech-disk-guard.log`.

---

## v3.1.29 — 2026-03-16

### Fix: Remove duplicate `background` key in StreamViewPanel severity badge

`StreamViewPanel.jsx` had two `background` entries in the same style object for the severity badge (lines 1806/1810). The first (`cfg.bg`) was silently overwritten by the second (`#070b14ee`). Removed the dead `cfg.bg` entry; no visual change — the dark overlay was already winning.

---

## v3.1.28 — 2026-03-16

### Feature: Stream registry import/export + visual tile distinction for Multiview

**Stream registry per panel (server-persisted):**
Each Multiview panel now has an independent stream registry — a named list of `{ name, ip, port, mode }` entries that survive browser refreshes, server restarts, and cross-workstation sessions. Registry data is stored in `config/multiview-panels.json` via two new API endpoints: `GET /api/multiview/panels` (load) and `PUT /api/multiview/panels` (save, debounced 800ms). localStorage acts as an offline fallback and is kept in sync.

**Import CSV or JSON:**
Click the **Import** button in the Stream Registry toolbar to load streams from a `.csv` or `.json` file.
- CSV format: `name,ip,port,mode` (header row optional). Mode defaults to `rtp` if omitted.
- JSON format: `[{ "name": "...", "ip": "...", "port": "..." }]` or `{ "streams": [...] }`.
- Duplicate IP:port pairs are silently skipped on import.

**Export CSV:**
Click **Export CSV** to download all streams for the active panel as `multiview-<panel>-streams.csv`. Import the same file on any workstation running Labotech to instantly replicate the panel layout.

**Visual tile distinction — Loaded vs Active:**
Two distinct tile states are now rendered in the grid:
- **Active (LIVE) tiles** — existing cyan-border treatment with thumbnail, audio meters, and stats. These are streams currently being probed.
- **Loaded tiles** — dark navy (`#090e18`) background, dim blue left accent border (`rgba(40,90,200,0.5)`), "Loaded" badge in blue/grey. Show IP:port but no thumbnail. Operators can distinguish at-a-glance which feeds are configured vs actively monitored.

**Start from loaded tile:**
Each Loaded tile has a green **▶ Start** button. Clicking it launches a continuous TSAnalyser probe for that stream and immediately promotes the tile to Active in the same panel. The stream ID is derived deterministically from `name+ip+port`, so the same stream started twice lands on the same decoder slot.

**Remove from registry:**
Each Loaded tile has a × dismiss button to remove the entry from the panel registry.

**OPS access:** Import/Export is available to all roles. It is an operational task (pre-show setup, roster changes), not engineering config.

**Operator impact:** MCR operators can now pre-configure an entire show's multicast roster (import CSV), monitor a subset live, and share the configuration across workstations without manual re-entry.

---

## v3.1.27 — 2026-03-16

### Fix: Panel names now survive server restarts and browser re-logins

**Two root causes identified:**

**1. React mount race condition (persist overwrites load):**
The persist effect ran on mount with the initial default state (single empty "BES" panel) *before* the load effect's `setState` calls were applied. In the brief window between those two effects, localStorage was overwritten with default state. Fixed with a `hydratedRef` — the persist effect is blocked until the load effect has finished restoring state.

**2. Stale decoder IDs across sessions:**
Panel `decoderIds` were persisted across sessions, but decoder IDs are timestamp-based (`decoder-17773668150861`) and change on every server restart or decoder stop/start. After a redeploy, stored IDs matched nothing in `activeIds` → auto-seed triggered → first panel routing reset → custom panel routing lost. Fixed by not restoring `decoderIds` from storage. Panel names and structure are preserved; decoder routing is always seeded fresh from `activeIds` each session by the existing auto-seed logic.

**Result:** Panel names ("MCR-A", "BES", etc.) survive indefinitely across logins, server restarts, and redeployments. Decoder routing auto-populates correctly on each session start.

---

## v3.1.26 — 2026-03-16

### Fix: Auto-clear thumbnail cache + LVM root volume prune on every deploy

**Thumbnail cache wipe (always, not just on low disk):**
Stale or 0-byte JPEG files left from a previous crashed/disk-full run were served to the multiview and rendered as black frames until the next probe cycle overwrote them. `update-and-deploy-safe.sh` now removes all `logs/thumbnails/*.jpg` before calling `deploy-one-shot.sh`. The count of removed files is logged. Thumbnails regenerate automatically within the first probe cycle (≤5s) after startup.

**LVM root volume cleanup added to `auto_cleanup`:**
`/dev/mapper/ubuntu--vg-ubuntu--lv` was not explicitly targeted by the existing cleanup. Added to `auto_cleanup` (runs automatically when disk is below threshold):
- `apt-get autoremove -y` (was missing, reclaims orphaned packages)
- `journalctl --vacuum-time=7d` (tightened from 14d)
- `find /tmp -atime +1 -delete` (clears stale temp files)
- Logs free MB on the root LV after cleanup for visibility

---

## v3.1.25 — 2026-03-16

### Fix: preflight script — replace `node` with `jq` for health JSON parsing

**Problem:** `scripts/preflight-monitoring-tools.sh` used an inline `node` heredoc to parse the `/health` response. Node.js is not installed on the host — it runs only inside the Docker container. Every deploy failed at the preflight stage with `node: command not found`.

**Fix:** Replaced the `node` block with four `jq` one-liners. `jq` is already a hard requirement of `deploy-one-shot.sh` (checked in `require_cmds`) so it is guaranteed to be present.

---

## v3.1.24 — 2026-03-16

### Revert: Restore thumbnail analyzeduration and attempt timeouts to v3.1.22 values

**Problem:** v3.1.23 reduced `analyzeduration` (2s→1s), `probesize` (3MB→1.5MB), and attempt timeouts (8s→5s) to speed up first thumbnail. This caused regressions on production streams:
- 1s `analyzeduration` insufficient to find the first I-frame on some streams — attempts timed out and fell through to attempt 4 (any-frame fallback), producing macroblocked thumbnails.
- Increased probe timeout error rate as more thumbnail attempts failed within the shorter window.

**Fix:** Restored `monitoring.js` exactly to v3.1.22 state:
- `analyzeduration`: I-frame path `2000000` (2s), fallback `7000000` (7s)
- `probesize`: I-frame path `3000000` (3MB), fallback `7000000` (7MB)
- All attempt timeouts: `8000ms`

No other files changed. v3.1.21 (localStorage), v3.1.22 (storage key v2) changes are preserved and unaffected.

---

## v3.1.23 — 2026-03-16

### Perf: Faster multiview thumbnail — reduce analyze latency and fallback timeouts

**Problem:** First thumbnail on a fresh decoder was slow to appear ("Awaiting Frame" for 10–32 seconds) due to three compounding issues:
- `analyzeduration: 2s` — ffmpeg spent 2 seconds analysing the stream format before decoding a single frame. For a live broadcast stream the codec is known within the first few packets; 2s was pure wasted wait.
- Fallback ladder attempt timeouts were all 8s — if attempt 1 failed (e.g. `pp=de/de` filter unavailable on this ffmpeg build), attempt 2 did not start until 8s elapsed. Worst case: 32s before any thumbnail appeared.
- `probesize: 3MB` — read up to 3MB of stream data for format detection, adding further latency on attempt start.

**Fix:**
- `analyzeduration` on I-frame path: `2000000` → `1000000` (1s)
- `probesize` on I-frame path: `3000000` → `1500000` (1.5MB)
- Attempt 1, 2, 3 timeouts: `8000ms` → `5000ms` (fail fast to reach bare-scale attempt sooner)
- Attempt 4 (last resort / any frame) retains 8s timeout for very long GOP streams

**Result:** First thumbnail appears in 2–4s on a typical broadcast stream. Worst-case (all 4 attempts exhaust): 23s instead of 32s.

---

## v3.1.22 — 2026-03-16

### Fix: Multiview storage key bumped to v2 — clears stale localStorage data

**Problem:** v3.1.21 switched multiview state from `sessionStorage` to `localStorage`. Any pre-existing entry under the old key `labotech:decoder-multiview:state:v1` in `localStorage` (from a prior dev or test session) was now being loaded, producing corrupt panel state and breaking the multiview on first load after the upgrade.

**Fix:** Storage key bumped to `labotech:decoder-multiview:state:v2`. The old key is simply ignored; the component starts clean. Panels created from this version onward will persist correctly across refreshes and restarts.

---

## v3.1.21 — 2026-03-16

### Fix: MCR panels now persist across page refresh and tab close

**Root cause:** `DecoderMultiviewPanel` stored all state (panel names, panel count, decoder routing per panel, engineer mode label) in `sessionStorage`. Session storage is scoped to the browser tab — it is wiped the moment the tab is closed or the page is refreshed. Any MCR panel created during a shift was silently lost.

**Fix:** Changed both `sessionStorage.getItem` and `sessionStorage.setItem` calls to `localStorage`. The storage key (`labotech:decoder-multiview:state:v1`) is unchanged — existing sessions will migrate transparently on first load because the same key is now read from `localStorage`.

**Result:** Panel names, decoder routing, engineer mode label, and active panel selection all survive page refresh, browser restart, and shift handover.

---

## v3.1.20 — 2026-03-16

### Fix: Docker log rotation + post-deploy image prune

**Problem:** Disk filled up progressively between deploys from two sources:
- Docker container logs had no size cap. The TS analyser runs ffprobe every 30 s per stream; stderr from each probe cycle is captured by the JSON log driver, which grew unbounded in `/var/lib/docker/containers/`.
- `deploy-one-shot.sh` builds with `--no-cache` every deploy, leaving orphaned image layers in `/var/lib/docker/overlay2` that were never pruned.

**Fix:**
- `docker-compose.yml` — added `logging: driver: json-file, max-size: 50m, max-file: 5` to `labotech`; `max-size: 20m, max-file: 3` to `labotech-encapsulator`. Capped at ~310 MB total log retention across both containers.
- `deploy-one-shot.sh` — added `docker image prune -f` as a `run_stage_warn` step after health assertions pass. Runs automatically on every successful deploy; non-fatal if it fails.

**Steady-state disk budget (Docker):** ≤ 310 MB logs + current image layers only.

---

## v3.1.19 — 2026-03-16

### Perf: Smooth 60fps now-line; reduce live tick to 250ms

**Problem:** The cyan current-time line moved in 2-second jumps because `LIVE_TICK_MS=2000` caused `nowMs` state (and thus the entire timeline content) to update every 2 seconds.

**Fix:**
- `LIVE_TICK_MS` reduced 2000 → **250ms**: content jump is now 0.08% (~1px) at 5m window — imperceptible.
- Now-line driven by `requestAnimationFrame` loop via `nowLineRef` DOM ref — updates at 60fps with zero React re-renders. Same pattern as the crosshair cursor.
- `timeStartRef` / `effectiveWindowMsRef` hold latest values without restarting the rAF loop on every 250ms tick.
- Works correctly in both live and custom range modes: hides when current time is outside the visible window.

---

## v3.1.18 — 2026-03-15

### Fix: Probe timeouts show as narrow amber ticks, not red blocks

**Root cause:** `ffprobe returned empty probe payload (no input packets observed during probe window)` is a ffprobe capture-window miss — ffprobe joined the multicast group but the capture window closed before any packets arrived. The service was delivering video fine. These were classified as `noSignal=true` → 15s critical red blocks, and with multiple occurrences every 12–28 seconds, created a solid false-positive red band.

**Changes:**
- `isProbeTimeoutError()` — new function, identifies capture-window timeouts as a distinct class from genuine signal loss.
- `isExpectedNoSignalError()` — probe-timeout strings removed; returns false if `isProbeTimeoutError` matches.
- `toEvent()` for `'error'` — uses `msg.details` as fallback for API-hydrated events; probe timeouts get `category: 'runtime_probe_timeout'`, `severity: 'warning'`, `title: 'Probe timeout'`.
- `decEvtSev()` — `runtime_probe_timeout` returns null (never affects gradient); `runtime_error` also checks `description` for probe-timeout text to suppress old localStorage events.
- `EVENT_BLOCK_DURATION_MS['runtime_probe_timeout'] = 2000ms` — narrow tick.
- `EVENT_STYLE_BY_CATEGORY['runtime_probe_timeout']` — semi-transparent amber.

**Result:** Lanes stay green throughout probe capture failures. Probe timeouts appear as thin amber tick marks at their exact timestamp. Only genuine LOS (`connection refused`, `input disappeared`, etc.) still drives the gradient red.

---

## v3.1.17 — 2026-03-15

### Feature: Short timeframe windows + remove Scale toggle

**New window options:** `30s`, `1m`, `2m` added at the start of the timeline window selector. Useful for watching brief signal glitches at close zoom — combined with the v3.1.16 noSignal fix, a 1-second glitch is now clearly visible as a narrow red segment at 30s/1m scale.

**Scale Normalised/Absolute toggle removed:** The toggle controlled shared Y-axis min/max on IAT/jitter sparklines in the forensics popup. Since the popup is per-lane, a global cross-lane scale added no diagnostic value — per-lane auto-scaling is more readable. Removed: `scaleMode` state, `globalRanges` useMemo, `sparkScale()` helper, and persistence.

---

## v3.1.16 — 2026-03-15

### Fix: Brief noSignal events clear on first ok probe

Signal-loss events (`runtime_error noSignal`) were holding the lane RED for 2× probe interval (~30–60s) because `OKS_TO_CLEAR=2` required two consecutive ok results before recovery. A 1-second glitch appeared as a large red block.

Signal presence is binary — once the first ok probe confirms the signal is back, the red segment ends. Added `noSignalRecovery` flag: after a `noSignal` event, the next single ok probe clears the critical state. If a subsequent `analyse_result critical` confirms sustained degradation, `noSignalRecovery` resets and normal 2-probe hysteresis resumes.

Result: a brief signal glitch now shows as ~one probe interval of red (~5–15s on `broadcast-balanced-v1`) instead of 60–120s.

---

## v3.1.15 — 2026-03-15

### Fix: Status label visibility (timeline)

- Lane canvas container shortened to `right: 46px` so it no longer paints over the right-edge status chip.
- Status label background set to opaque (`#070b14ee`) — readable regardless of lane colour beneath.

---

## v3.1.14 — 2026-03-15

### Fix: Lane start position reflects actual decoder start time

- Lane bar now begins at `Math.max(timeStart, lastExplicitStartTs)` — decoders started mid-window show a partial bar from their real start, not from the left window edge.
- Bootstrap-only lanes (no explicit `runtime_started` event) correctly fill from window start.

---

## v3.1.13 — 2026-03-15

### Feature: Visual polish for MCR readability

- Lane height increased (LANE_STEP_PX 34 → 44 px, bar thickness 8 → 12 px).
- Thumbnail size increased (14×10 → 26×18 px).
- Green colour changed from neon `#00dd55` to soft monitoring green `#3db86a` — reduced eye strain on low-light MCR displays.

---

## v3.1.12 — 2026-03-15

### Feature: Right-edge status labels per timeline lane

- Each lane now shows a chip at the right edge: **OK** / **WARN** / **CRIT** / **LOS**.
- LOS (Loss of Signal) shown when no heartbeat within the stale threshold.
- Derived from `laneStatusById` useMemo over fullLaneMap — no extra API calls.
- Consistent with Elecard Boro / Telestream PRISM operator conventions.

---

## v3.1.11 — 2026-03-15

### Fix: Tombstone race condition (isLive false after fast restart)

- `stopAfterActive` anchor changed from `firstActiveTs` → `lastExplicitStartTs`.
- Eliminates false LOS when `seedFromActiveAnalysers` fires a synthetic `runtime_stopped` tombstone between stop and restart events.

---

## v3.1.10 — 2026-03-14

### Docs: CLAUDE.md corrections (Cursor review)

- API port corrected 3000 → 4000 throughout guidance.
- Inheritance model corrected: `TSAnalyser` and `MulticastForwarder` extend `EventEmitter` directly, not `SRTEncoder`.

---

## v3.1.9 — 2026-03-14

### Fix: isLive — heartbeat-in-window as primary live condition

- Added `lastHeartbeatTs >= timeStart` as a third OR condition for `isLive`.
- Eliminates lanes going grey: previous condition `staleStopTs >= timeEnd` was always false for live windows (now+30s < now+5min).

---

## v3.1.8 — 2026-03-14

### Docs: CLAUDE.md — timeline colour contract and protocol threshold rules

- Documented green/amber/red/grey lane semantics.
- Documented per-protocol CC threshold override rule.
- Documented heartbeat-must-use-`Date.now()` invariant.
- Documented live-lane fill-from-left-edge convention.

---

## v3.1.7 — 2026-03-14

### Fix: Solid colour lanes on page load

- Bootstrap heartbeat seed changed from `probeTime` → `Date.now()`.
- `probeTime` from server could be minutes stale, causing heartbeat to expire immediately on load and all lanes to render grey.

---

## v3.1.6 — 2026-03-14

### Fix: Grey gaps between events eliminated

- `lastActivityTs` now computed as `Math.max(lastSevEvtTs, lastHeartbeatTs)`.
- Previous logic used only `lastSevEvtTs`; probe cycle (30–60 s) exceeded LANE_ACTIVITY_STALE_MS (30 s) causing periodic grey flashes between probes.

---

## v3.1.5 — 2026-03-14

### Feature: Stop All button in Active Decoders

- Added STOP ALL button to the Active Decoders section header in DecoderPanelRevamp.
- Visible only when one or more decoders are active.
- Iterates active IDs, calls `stop()` per decoder, then refreshes the active list.

---

## v3.1.4 — 2026-03-14

### Fix: Per-protocol CC thresholds + rAF crosshair cursor

**Per-protocol health thresholds:**
- `_healthThresholds()` in `ts-analyser.js` now auto-selects `broadcast-balanced-v1` floor values (ccWarnCount ≥ 3, ccCriticalCount ≥ 8, tsDiscWarnCount ≥ 3, tsDiscCriticalCount ≥ 8) for RTP and UDP multicast sources.
- Eliminates false CC/discontinuity alarms caused by ffprobe joining mid-stream — a normal 1–10 packet window at join time was triggering `srt-contribution` policy alarms (ccWarnCount = 1).
- SRT streams retain the configured policy thresholds unchanged.

**rAF-throttled crosshair cursor:**
- Crosshair line position updated via direct DOM ref (`crosshairLineRef`) — zero React re-renders at 120 Hz mousemove.
- React state (mouseX/Y/laneId for popup) throttled to `requestAnimationFrame` (≤ 60 fps).
- `onMouseLeave` cancels pending rAF and hides line immediately.

---

## v3.1.3 — 2026-03-14

### Fix: False-positive health penalties removed

- SMPTE 2022-7 `insufficient_data` no longer penalises the health score — probe windows shorter than `minSamples` are ambiguous, not degraded.
- Bitrate drift within normal transient bounds no longer penalises on first probe.

---

## v3.1.2 — 2026-03-14

### Feature: Canvas-rendered timeline lane bars

- Replaced CSS gradient `div` with `LaneCanvas` (`HTMLCanvasElement`) per lane.
- Eliminates CSS repaint overhead on dense timelines; gradient rendered via `fillRect` in a `useEffect`.

---

## v3.1.1 — 2026-03-14 (tag)

### Feature: Confidence Monitor layout and live thumbnail restore

- Confidence Monitor panel moved below Decoder Provisioning section.
- ETR 290 panel moved below Confidence Monitor.
- Live frame thumbnail restored to Decoder Quality Dashboard.

---

## Upgrade Notes

- No schema migrations or config file changes required.
- `config/monitoring-policy.json` profile selection unchanged — RTP/UDP threshold floor is applied automatically in code.
- Run `bash scripts/deploy-one-shot.sh` on the server to apply.

## Verification

- Backend tests: 107 passing.
- Frontend production build: 0 warnings.
- Health endpoint: `status=ok`, `tsanalyze.available=true`.


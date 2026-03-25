# Release Notes — v3.2.x

Agent B (Cursor) release notes. Agent A release notes are in `docs/release-notes-v3.1.md`.

---

## v3.2.1 — 2026-03-25

### fix(live-view): show stopped markers as thin duration lines

**What changed:**
- In Live View timeline (`StreamViewPanel`), `runtime_stopped` markers titled “Analyser stopped” and “Stream stopped” render as thin time-lines (ms duration) instead of fixed-height rectangles.
- “ETR monitor stopped” is hidden from Live View (ETR integrity remains automatic for users via ETR analysis, while ETR errors/incidents/alarms continue to appear in alarm views).
- Lane live/offline logic no longer greys the lane if `runtime_stopped` is followed by continued `runtime_heartbeat` events (treats transient stops as spurious).

**Why:**
- Fixed-duration rectangles made brief analyser transitions look like long outages.
- Transient `runtime_stopped` events could incorrectly drive lane offline/grey state even while heartbeats were still arriving.
- ETR operational start/stop status is not needed in Live View; operators should rely on ETR errors/alarms for integrity checks.

**Operator impact:**
- Timeline is less noisy: “stopped” signals are now time-accurate thin lines.
- Live lanes remain green when the service is actually healthy (heartbeats continue).
- ETR monitor start/stop markers do not clutter Live View, while ETR alarms/incidents remain available for integrity verification.

## v3.2.2 — 2026-03-25

### fix(live-view): render all runtime_stopped markers as lines

**What changed:**
- Live View stop-marker rendering now treats *all* `runtime_stopped` events as thin duration lines **except** `ETR monitor stopped` (still hidden).
- This prevents synthetic “Session ended” (and other non-analyser/stream stop titles) from appearing as misleading fixed-height rectangles.

**Why:**
- Operators reported that stop markers still looked like rectangles in Live View. The remaining cases were `runtime_stopped` titles other than the exact “Analyser stopped” / “Stream stopped” strings we initially matched.

**Operator impact:**
- All stop markers become visually consistent as thin time-lines.
- Fewer false “outage-sized” blocks on the Live View timeline.

## v3.2.3 — 2026-03-25

### fix(live-view): correct ETR gap + hide analyser-stopped timeline marker

**What changed:**
- Live View ETR lane gradient no longer ends on decoder/analyser `runtime_stopped` events; it now ends only on `runtime_stopped` titled “ETR monitor stopped”.
- Live View no longer renders the “Analyser stopped” marker on the timeline (it remains visible in TS analyser logs/alarm views).

**Why:**
- Starting ETR under a decoder could prematurely terminate the ETR lane gradient, producing a visible gap even while `etr290_status` heartbeats were continuing.
- “Analyser stopped” is operational/log-only information; displaying it as a timeline marker created misleading “leftover” visuals.

**Operator impact:**
- ETR Live View becomes continuous when ETR is running under a decoder.
- “Analyser stopped” appears in logs only, reducing timeline clutter/noise.

## v3.2.4 — 2026-03-25

### fix(live-view): prevent ghost running after decoder stop

**What changed:**
- Live View (`StreamViewPanel`) no longer injects bootstrap `runtime_heartbeat` / OK `analyse_result` seeds for a lane if there is a recent `runtime_stopped` for that same lane.

**Why:**
- When STOP/STOP ALL is used, the server’s `isRunning` flag can lag for a few seconds. The Live View bootstrap seeding loop could re-assert “running” during that window, making stopped decoders look active again (especially in longer history ranges).

**Operator impact:**
- After STOP, lanes go offline consistently and do not re-appear by themselves in subsequent Live View ranges.

## v3.2.5 — 2026-03-25

### fix(live-view): correct ETR enable/disable grey behaviour

**What changed:**
- `StreamViewPanel` now uses the ETR lane gradient only when `etr290_status` heartbeats exist inside the current Live View window.
- The ETR lane gradient end marker is paired with the most recent `etr290_status` heartbeat (so old `ETR monitor stopped` events can’t truncate a re-enabled ETR lane).

**Why:**
- Previously, older retained `etr290_status` events caused the ETR lane to stay in an “unknown/grey” state after enabling/disabling ETR.
- ETR lane truncation could also be driven by an older stop event from a previous ETR run.

**Operator impact:**
- Enabling ETR under a decoder should immediately color the ETR lane based on current `etr290_status` heartbeats.
- Disabling ETR should revert the lane back to decoder/analyser-based coloring (no permanent grey).

## v3.2.6 — 2026-03-25

### feat(thumbnails): update Live View + Multiview from `thumbnail_frame`

**What changed:**
- Live View (`StreamViewPanel`) per-lane thumbnails now refresh as soon as the backend worker emits `thumbnail_frame`, instead of waiting for the next `analyse_result`.
- Multiview tiles (`DecoderMultiviewPanel`) now update their `result.thumbnailUrl` live from the same `thumbnail_frame` stream, so tiles stay “decode-live” during continuous monitoring.

**Why:**
- Operators want the visual thumbnail to track the running service in near real-time, not at probe-result cadence.

**Operator impact:**
- Multiview and Live View thumbnail motion/updates are more responsive and consistent during short probing gaps.

## v3.2.7 — 2026-03-25

### fix(thumbnails): remove multiview thumbnail flicker/drop

**What changed:**
- Fixed multiview “decode live” wiring to build the thumbnail image URL from `thumbnail_frame.msg.path` (JPEG file path) instead of `thumbnail_frame.msg.url` (input stream URL).

**Operator impact:**
- Multiview tile thumbnails should update smoothly without intermittent dropouts/up-refresh flicker.

## v3.2.0 — 2026-03-21

### feat(thumbnail): complete Phase 2 migration — thumbnails out-of-process

**What changed:**
- `TSAnalyser` now accepts an optional `thumbnailClient` constructor option (`ThumbnailWorkerClient`).
- When `thumbnailClient` is injected (standard production path via `api.js` and `routes/analyse.js`), `startContinuous()` delegates thumbnail management to the out-of-process worker instead of spawning `PersistentThumbnailCapture` in the API process.
- SRT slot coordination (`suspend`/`resume` during heavy probes) routes through `thumbnailClient.suspend/resume()` when the worker is active, falling back to the in-process `_persistentThumb` path otherwise.
- **Relay-backed SRT** (loopback unicast UDP) keeps the existing in-process one-shot timer loop — a persistent worker connection would hold the UDP port and block `ffprobe` probes from binding the same socket.
- `routes/analyse.js` passes `thumbnailClient` to the `TSAnalyser` constructor; the dead-code comment is removed.
- `api.js` `restoreState()` passes `thumbnailClient` to restored analysers.
- `api.js` SIGTERM handler now stops all active analysers before shutting down the worker, ensuring relay-backed SRT one-shot timers and any in-process ffmpeg children are cleaned up before `process.exit`.

**Why:**
Phase 2 built the worker/client infrastructure but the internal TSAnalyser thumbnail logic was never removed, leaving the worker idle on every boot. This completes the migration so all thumbnail ffmpeg processes run in the isolated worker process.

**Operator impact:**
- No behaviour change visible from the UI — thumbnails continue to update at the configured interval.
- ffmpeg thumbnail processes no longer run inside the API process; they run in the forked worker. CPU load is unchanged; crash isolation is improved.
- On server restart, thumbnails for active decoders resume automatically via the worker's `_replayActiveCaptures()` mechanism.

**Also fixed:**
- Worker restart backoff (`_restartDelayMs`) now resets to its initial value when the worker emits `ready`, preventing permanent 30 s delays after a crash-loop.

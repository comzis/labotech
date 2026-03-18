# Labotech Engineering Snag List

**Purpose:** Canonical log of defects found, root causes identified, and fixes applied.
Structured for replication — each entry states the symptom, the root cause, the fix, and
the invariant it produced so the same class of bug is not reintroduced.

**Process:**
1. Any engineer (human or AI agent) who finds a defect opens a new entry in `## Open` below.
2. When a fix is merged, the entry moves to `## Closed` with PR reference and a **Lesson** note.
3. **Lessons** feed back into `CLAUDE.md` and `docs/engineering-support-manual.md` as permanent rules.
4. Snag IDs are sequential and never reused.

---

## Open

_No open snags at time of writing (2026-03-18)._

---

## Closed

### SNAG-001 — SRT probe serialisation: 0 PIDs / 0 services despite full bitrate
- **Reported:** 2026-03-17 · **Fixed:** v3.1.53 · **PR:** #12
- **Symptom:** SRT streams showed correct bitrate but 0 PIDs and no services in the analyser panel.
- **Root cause:** `PersistentThumbnailCapture` held the SRT connection open while the heavy probe tried to connect a second time. Most contribution SRT encoders accept exactly one simultaneous caller — the second connection was silently rejected.
- **Fix:** Suspend thumbnail ffmpeg before the heavy probe, allow 600 ms settle, run probes sequentially, resume thumbnail in `finally`.
- **Lesson:** Any new process opening an SRT URL must participate in the same suspend/resume serialisation scheme. Documented in `CLAUDE.md §Known Pitfalls` and `architecture-roadmap §2.3`.

---

### SNAG-002 — RTP/UDP thumbnails broken after SRT thumbnail fix
- **Reported:** 2026-03-17 · **Fixed:** v3.1.52 · **PR:** #11
- **Symptom:** After scoping `PersistentThumbnailCapture` to SRT, RTP/UDP streams showed no thumbnail at all.
- **Root cause:** `PersistentThumbnailCapture` was removed globally, but RTP/UDP streams still needed one-shot thumbnail capture via `captureThumbnail()`. The fallback was not wired.
- **Fix:** `PersistentThumbnailCapture` scoped to SRT only; RTP/UDP uses one-shot `captureThumbnail()` with RTP-appropriate `analyzeduration`.
- **Lesson:** Always regression-test the non-SRT path when changing thumbnail capture logic.

---

### SNAG-003 — SRT thumbnail frozen for full 35 s probe budget
- **Reported:** 2026-03-17 · **Fixed:** v3.1.49–v3.1.51 · **PRs:** #11, #12
- **Symptom:** SRT thumbnail showed a frozen frame for up to 35 s during the heavy probe window.
- **Root cause:** The thumbnail was suspended for the entire combined duration of all sequential SRT probes (up to 35 s including tsanalyze). `resume()` was only called at the very end.
- **Fix:** `resume()` moved to `finally` block so it fires immediately after the last probe completes. Added 1.5 s settle delay before resume to allow SRT source reconnect cooldown.
- **Lesson:** Always put `resume()` in `finally`, not after the last sequential `await`. SRT sources may need a brief settle before accepting a new connection.

---

### SNAG-004 — Thumbnails not displaying after thumbnail worker wiring
- **Reported:** 2026-03-18 · **Fixed:** v3.1.64 · **PR:** #18
- **Symptom:** After Phase 2 thumbnail worker was wired into `api.js`, all thumbnails disappeared.
- **Root cause:** `_lastThumbnailUrl` on the `TSAnalyser` instance was no longer being updated because the thumbnail URL was now emitted by the worker process via IPC, not set directly.
- **Fix:** Wired the worker's `frame` IPC event to update `_lastThumbnailUrl` on the corresponding analyser instance.
- **Lesson:** When moving responsibilities from in-process to IPC-based worker, audit every field that was previously set as a side-effect of in-process execution.

---

### SNAG-005 — Duplicate thumbnail capture causing >1 min first-frame delay
- **Reported:** 2026-03-18 · **Fixed:** v3.1.65 · **PR:** #19
- **Symptom:** Multiview tiles took over 1 minute to show the first thumbnail.
- **Root cause:** Thumbnail capture was triggered twice per cycle — once by the worker and once by a remaining direct `captureThumbnail()` call that was not removed after wiring. Both competed for the semaphore, doubling the wait.
- **Fix:** Removed the duplicate direct call. Worker is now the sole thumbnail producer.
- **Lesson:** After wiring a worker, grep for all previous direct-call sites and remove them. Do not rely on the old path being a no-op — it runs.

---

### SNAG-006 — `matchAll` TypeError kept `lastResult: null` permanently
- **Reported:** 2026-03-17 · **Fixed:** v3.1.1 · See INC-006 in memory
- **Symptom:** All multiview tiles showed "Awaiting Frame" / "awaiting telemetry" indefinitely.
- **Root cause:** `_extractSrtStatsFromLog()` passed non-global regex literals to `String.matchAll()`. `matchAll` throws `TypeError` on non-global regex — caught silently, leaving `lastResult: null` on every cycle.
- **Fix:** Derive a global copy before calling: `new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g')`.
- **Lesson:** `matchAll` requires the `g` flag. Documented in `CLAUDE.md §Known Pitfalls`. Always derive global copy from table-driven regex literals.

---

### SNAG-007 — False-positive health penalties: SMPTE ST 2022-7 + bitrate drift
- **Reported:** 2026-03-17 · **Fixed:** v3.1.3 / v3.1.4 · See INC-007 in memory
- **Symptom:** Healthy RTP streams permanently alarmed amber due to SMPTE 2022-7 `insufficient_data` and bitrate drift penalties.
- **Root cause (a):** `insufficient_data` (normal during startup) deducted −4 pts from all RTP streams. Only `non_compliant` is a real fault.
- **Root cause (b):** Bitrate drift thresholds (3%/6%) applied to `ffprobe`-derived `measured` bitrate which varies 10–65% between 2.5 s windows — not a stable enough source for drift scoring.
- **Fix (a):** Removed `insufficient_data` penalty. Only `non_compliant` deducts.
- **Fix (b):** Drift scoring gated on `bitrateSource === 'tsduck'` only.
- **Lesson:** Never apply drift scoring to a bitrate source whose natural variance exceeds the threshold. Gate on source reliability. Documented in `CLAUDE.md §Known Pitfalls`.

---

### SNAG-008 — CC errors not flagging on RTP/UDP feeds
- **Reported:** 2026-03-17 · **Fixed:** v3.1.54 · **PR:** #13
- **Symptom:** Continuity Counter errors were silently ignored on RTP/UDP streams.
- **Root cause:** CC thresholds from the `srt-contribution` profile (warn ≥1, critical ≥4) were applied globally. `ffprobe` always joins multicast mid-stream and generates 1–10 CC errors during sync — these are not real faults but triggered immediate alarms.
- **Fix:** Per-protocol health thresholds: SRT uses `srt-contribution` profile; RTP/UDP uses `broadcast-balanced-v1` (warn ≥3, critical ≥8) to absorb join artefacts.
- **Lesson:** ffprobe CC join artefacts are a known multicast characteristic. Protocol-specific thresholds are mandatory. Documented in `CLAUDE.md §Known Pitfalls`.

---

### SNAG-009 — Audio meter bars showing reversed colours (silence appeared full/red)
- **Reported:** 2026-03-17 · **Fixed:** v3.1.54 · **PR:** #13
- **Symptom:** In the Decoder panel audio meters, silence showed as a full red bar; loud signal showed green.
- **Root cause:** RMS dB value (negative for audio, e.g. −24 dBFS) was used directly as a percentage without normalisation. Negative numbers inverted the fill direction.
- **Fix:** Normalised: `rmsH = ((rmsDb + 60) / 60) * 100`, clamped to 0–100. Colour zones applied correctly (green → amber → red from bottom up).
- **Lesson:** Audio level dB values are always negative (0 dBFS = clipping). Always normalise to a 0–100% fill before rendering.

---

### SNAG-010 — Timeline: grey gaps between events / wrong lane start position
- **Reported:** 2026-03-14 · **Fixed:** v3.1.6 / v3.1.14 · **PRs:** #1, #2
- **Symptom:** Timeline lanes had grey gaps between colour blocks; lanes started at the window left edge even for streams started mid-window.
- **Root cause (gaps):** Event blocks were not contiguous — small floating-point rounding gaps between blocks exposed the grey background.
- **Root cause (start):** `effectiveStartTs` used `probeTime` instead of `Date.now()` for the heartbeat seed, causing `isLive=false` immediately and rendering the lane as grey from the left edge.
- **Fix (gaps):** Extended each block to reach exactly the next block's start.
- **Fix (start):** Heartbeat seed uses `Date.now()`; `effectiveStartTs = timeStart` when `isLive=true`. Documented in `CLAUDE.md §Known Pitfalls`.
- **Lesson:** Live lanes always fill from left edge of the window. Heartbeat must use wall-clock time, not probe time.

---

### SNAG-011 — `health_alarm` events causing duplicate red/amber lane tinting
- **Reported:** 2026-03-15 · **Fixed:** v3.1.4 · **PR:** #2
- **Symptom:** Timeline lane showed double-tinted red/amber blocks at every severity transition.
- **Root cause:** `buildEventBlocks()` was not filtering out `health_alarm` category events. The gradient was already driven by `analyse_result`; `health_alarm` events created additional overlapping blocks.
- **Fix:** `buildEventBlocks()` filters `e.category !== 'health_alarm'`. `health_alarm` events are alarm-log-only.
- **Lesson:** `health_alarm` is a notification event, not a state-change event. It must never drive timeline block rendering. Documented in `CLAUDE.md §Known Pitfalls`.

---

### SNAG-012 — Ghost null-PID stream entries from ffprobe inflate PID counts
- **Reported:** 2026-03-15 · **Fixed:** v3.1.54 / v3.1.83 · **PRs:** #13, #32
- **Symptom:** Extra phantom streams appeared in PID tables and audio track lists (e.g. "AUDIO (5 TRACKS)" for a 4-track stream). Sort comparators placed phantom stream at PID 0 (first), not last.
- **Root cause:** `ffprobe` emits each elementary stream twice — once inside the program list (with PID) and once in the global stream array (without PID). `Number(null) === 0` caused null PIDs to sort first.
- **Fix:** `extractPidRows()` and `audioStreams` suppress null-PID rows when the same `codecType` has a real PID. Sort comparators map null PID to `Number.POSITIVE_INFINITY`. Documented in `CLAUDE.md §Known Pitfalls`.
- **Lesson:** `Number(null) === 0`. Always guard: `pid != null && Number.isFinite(Number(pid))`. Never coerce null PIDs directly.

---

### SNAG-013 — Multiview audio meters: only 1 of 4 stereo pairs had live levels
- **Reported:** 2026-03-18 · **Fixed:** v3.1.72 / v3.1.73 · **PRs:** #29, #32
- **Symptom:** Fullscreen multiview showed 4 VU meter slots but only the first pair was lit.
- **Root cause (stage 1):** `_probeAudioLevels()` had no `-map` flag — FFmpeg defaulted to selecting only the first audio Elementary Stream. Fixed in v3.1.72 with `amerge=inputs=N`.
- **Root cause (stage 2):** `astats` was passed as `-af` after a `-filter_complex` mapped output. FFmpeg silently drops the filter graph when `-af` follows a `-filter_complex`-mapped stream — no channel stats were produced.
- **Fix:** Embedded `astats=reset=1` directly inside the filter_complex chain: `amerge=inputs=N,astats=reset=1[aout]`. Removed the separate `-af` flag.
- **Lesson:** When using `-filter_complex` with named outputs, all post-processing filters must be part of the filter_complex graph — never added via separate `-af`. Mixing the two silently no-ops the `-af`.

---

### SNAG-014 — Multiview thumbnails anamorphic / cropped at tile edges
- **Reported:** 2026-03-18 · **Fixed:** v3.1.78 / v3.1.82 · **PRs:** #28, #31
- **Symptom (anamorphic):** Thumbnails were stretched vertically to fill the grid row — test card circles appeared as ellipses.
- **Root cause (anamorphic):** `gridAutoRows: '1fr'` stretched tiles to fill the container height, overriding `aspectRatio: '16/9'`.
- **Fix (anamorphic):** `gridAutoRows: 'auto'` + `alignContent: 'center'` + `aspectRatio: '16/9'` on tile root. Spare space shows as black, not stretched video.
- **Symptom (cropped):** Service name text clipped on left edge of thumbnail; broadcast content edges cropped.
- **Root cause (cropped):** `objectFit: 'cover'` crops the image to fill the container. For a near-16:9 JPEG in a 16:9 container, minor ratio differences cause edge clipping.
- **Fix (cropped):** `objectFit: 'contain'` with `background: '#000'` — full frame always visible with black letterbox if needed.
- **Lesson:** Broadcast monitoring must never crop picture content. `objectFit: contain` is the correct choice for all confidence-monitor thumbnails.

---

### SNAG-015 — ETR 290 startup: multicast join noise caused false P1 alarms
- **Reported:** 2026-03-18 · **Fixed:** v3.1.63 · **PR:** #19
- **Symptom:** Streams alarmed P1 (critical) for ~5 s immediately after decoder start.
- **Root cause:** `ETR290Analyser` began scoring from the first packet, which includes CC errors generated by joining the multicast mid-stream.
- **Fix:** 5 s startup grace period — no alarms emitted during the first 5 s of a new decoder session.
- **Lesson:** All multicast-join artefacts (CC errors, timestamp discontinuities) are expected in the first few seconds. Always apply a startup grace window before scoring.

---

### SNAG-016 — TSDuckMonitor: 4 correctness issues (Phase 3 pre-merge)
- **Reported:** 2026-03-18 · **Fixed:** v3.1.71 · **PR:** #24
- **Symptom (a):** PCR accuracy alarms fired on healthy streams.
- **Symptom (b):** SI interval check used wrong time base.
- **Symptom (c):** Bitrate calculation off by ×1000 on some streams.
- **Symptom (d):** Monitor restart loop did not respect backoff cap.
- **Root cause:** Implementation issues in `src/tsduck-monitor.js` identified during Phase 3 code review.
- **Fix:** Four targeted corrections before main merge. Details in release notes v3.1.71.
- **Lesson:** Run the Phase 3 monitor against a live stream for ≥5 min in staging before merging. Alarm false-positives are very visible to MCR operators.

---

### SNAG-017 — Decoder `+ Decoder` button rendered `+ + DECODER` (double plus)
- **Reported:** 2026-03-18 · **Fixed:** web v3.1.71 · **PR:** #28
- **Symptom:** Button label displayed `+ + DECODER` instead of `+ DECODER`.
- **Root cause:** Button text was `+ Decoder` but a `<Plus>` icon was also rendered — the text `+` and the icon `+` both appeared.
- **Fix:** Button text changed to `Decoder` (icon provides the `+`).
- **Lesson:** When using an icon-only prefix, the button text must not duplicate the symbol.

---

### SNAG-018 — UMD service name disappeared between probe cycles
- **Reported:** 2026-03-18 · **Fixed:** web v3.1.74 · **PR:** #28
- **Symptom:** Service name on multiview UMD overlay flickered to `—` between probe cycles.
- **Root cause:** `FullscreenThumbTile` had no latch — `rawSvc` returned `null` briefly when `result` was being refreshed, clearing the label.
- **Fix:** `svcLatch` state: `useEffect(() => { if (rawSvc) setSvcLatch(rawSvc); }, [rawSvc])`. Display uses `rawSvc || svcLatch || '—'`.
- **Lesson:** Any display value derived from probe results must be latched to the last known-good value. Probes are cyclical — transient nulls are expected. Pattern: `rawValue || latchedValue || fallback`.

---

## Invariants Produced

These rules were extracted from the snags above and are now enforced in `CLAUDE.md`:

| # | Rule | Source snag |
|---|---|---|
| I-1 | Any SRT connection attempt must suspend existing SRT connections first (600 ms settle) | SNAG-001 |
| I-2 | `matchAll` requires a `g` flag — always derive: `new RegExp(rx.source, rx.flags + 'g')` | SNAG-006 |
| I-3 | Bitrate drift scoring requires `bitrateSource === 'tsduck'` — never score `measured` | SNAG-007 |
| I-4 | Per-protocol CC thresholds: RTP/UDP uses broadcast-balanced-v1 floor, not srt-contribution | SNAG-008 |
| I-5 | `pid != null && Number.isFinite(Number(pid))` — never coerce nullable PID directly | SNAG-012 |
| I-6 | `health_alarm` events must not render timeline blocks — alarm-log only | SNAG-011 |
| I-7 | Live timeline lanes fill from left edge; heartbeat seed uses `Date.now()` not `probeTime` | SNAG-010 |
| I-8 | `objectFit: contain` for all confidence-monitor thumbnails — never `cover` | SNAG-014 |
| I-9 | `-af` must not follow a `-filter_complex` mapped output — embed in the chain | SNAG-013 |
| I-10 | Latch all probe-derived display values: `rawValue \|\| latch \|\| fallback` | SNAG-018 |
| I-11 | All multicast decoders require a startup grace window (≥5 s) before alarm scoring | SNAG-015 |

---

## How to Add a New Snag

```
### SNAG-NNN — Short one-line description
- **Reported:** YYYY-MM-DD · **Fixed:** vX.Y.Z · **PR:** #NN
- **Symptom:** What the operator/engineer observed.
- **Root cause:** The exact technical reason.
- **Fix:** What code changed and why.
- **Lesson:** The generalised rule that prevents recurrence. Add to CLAUDE.md if not already there.
```

*Last updated: 2026-03-18 — Claude Code*

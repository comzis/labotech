# Labotech v3.1 Release Notes

Date: 2026-03-15

## Overview

v3.1 is a broadcast-operator readiness release focused on three areas:

1. **Timeline Confidence Monitor** — MCR-grade lane visualisation with per-protocol alarm accuracy, stable live-lane rendering, and operator status labels.
2. **UI Hardening** — rAF-throttled crosshair cursor, Stop All control, larger lanes/thumbnails, soft monitoring colour palette.
3. **Health / Alarm Accuracy** — per-protocol CC/discontinuity thresholds to eliminate false alarms on multicast stream join.

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

---

## v3.1.18 — 2026-03-15

### Fix: Probe timeouts show as narrow amber ticks, not red blocks

**Root cause:** `ffprobe returned empty probe payload (no input packets observed during probe window)` is a ffprobe capture-window miss — ffprobe joined the multicast group but the capture window closed before any packets arrived. The service was delivering video fine. These were classified as `noSignal=true` → 15s critical red blocks, and with multiple occurrences every 12–28 seconds, created a solid false-positive red band.

**Changes:**
- `isProbeTimeoutError()` — new function, identifies capture-window timeouts as a distinct class from genuine signal loss
- `isExpectedNoSignalError()` — probe-timeout strings removed; returns false if `isProbeTimeoutError` matches
- `toEvent()` for `'error'` — uses `msg.details` as fallback for API-hydrated events (previously `msg.message` was undefined for hydrated events); probe timeouts get `category: 'runtime_probe_timeout'`, `severity: 'warning'`, `title: 'Probe timeout'`
- `decEvtSev()` — `runtime_probe_timeout` returns null (never affects gradient); `runtime_error` also checks `description` for probe-timeout text to suppress old localStorage events already stored as `runtime_error` with `noSignal=true`
- `EVENT_BLOCK_DURATION_MS['runtime_probe_timeout'] = 2000ms` — narrow tick
- `EVENT_STYLE_BY_CATEGORY['runtime_probe_timeout']` — semi-transparent amber

**Result:** Lanes stay green throughout probe capture failures. Probe timeouts appear as thin amber tick marks at their exact timestamp. Only genuine LOS (`connection refused`, `input disappeared`, etc.) still drives the gradient red.

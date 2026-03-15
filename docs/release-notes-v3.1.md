# Labotech v3.1 Release Notes

Date: 2026-03-15

## Overview

v3.1 is a broadcast-operator readiness release focused on three areas:

1. **Timeline Confidence Monitor** — MCR-grade lane visualisation with per-protocol alarm accuracy, stable live-lane rendering, and operator status labels.
2. **UI Hardening** — rAF-throttled crosshair cursor, Stop All control, larger lanes/thumbnails, soft monitoring colour palette.
3. **Health / Alarm Accuracy** — per-protocol CC/discontinuity thresholds to eliminate false alarms on multicast stream join.

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

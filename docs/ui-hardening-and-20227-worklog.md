# UI Hardening and SMPTE 2022-7 Worklog

Date: 2026-03-13

This document records the recent reliability, UX, and broadcast-observability work completed across Decoder, TS Analyser, Live View, Alarm Log, and Multiview.

## Scope Completed

- Live View event-state clarity and persistence hardening.
- Decoder PID table stability and disabled-state guidance.
- Alarm Log API/dev proxy fix and action feedback.
- TS Analyser action feedback and probe URL SRT stats hints.
- Decoder 2022-7 engineering metrics expansion.
- Multiview 2022-7 consolidated naming and denser card layout.
- Transport bitrate presentation updates for CBR operator trust.

## Implemented Changes

### 1) Live View (Timeline) Reliability

- Lane color semantics now separate event class from ETR state severity.
- Lane background can be ETR-state driven without non-ETR warnings repainting full lanes.
- Session persistence fixed by saving state on relevant dependency changes (not only once on mount).

Files:
- `web/src/components/StreamViewPanel.jsx`

### 2) Decoder Stream Profile PID Consistency

- PID rows normalized and deduplicated by `PID + codecType`.
- Stable row keys added to prevent React row reuse artifacts (PID/type visual mismatch).

Files:
- `web/src/components/DecoderPanelRevamp.jsx`

### 3) Alarm Log and API Tooling UX

- Dev proxy fix for `/api` to prevent local `DELETE /api/events` 404.
- Clear action now emits explicit success/error toast.
- JSONL/CSV export now emits explicit export confirmation.

Files:
- `web/vite.config.js`
- `web/src/App.jsx`
- `web/src/components/EventLogPanel.jsx`

### 4) TS Analyser Operator Feedback

- Added explicit action-note feedback for:
  - Start Probe prereq failures
  - Start Probe success/failure
  - Stop Selected / Stop All success/prereq states
- Added SRT URL stats flags for probe URLs:
  - `stats=1`
  - `statsintvl=1`

Files:
- `web/src/components/TSAnalyser.jsx`

### 5) Decoder Provisioning Defaults and ETR Guidance

- Removed prefilled decoder row port and Leg B port defaults.
- Added explicit disabled-state guidance for start/stop/ETR/apply controls.
- Kept ETR controls separate and explicit.

Files:
- `web/src/components/DecoderPanelRevamp.jsx`

### 6) 2022-7 RTP Compliance Visibility (Broadcast Engineering)

Added/expanded 2022-7 panel metrics:

- RTP sequence observed
- Sequence order (in-order/out-of-order)
- Gap events
- Duplicate events
- Reordered events
- Packet loss %
- Inter-packet delay avg
- Inter-packet delay p95
- Packet-arrival skew
- P95-AVG delta
- SMPTE compliant

Also retained/expanded SRT transport troubleshooting counters:

- NAK
- Retransmitted
- Dropped
- Lost
- ACK
- RTT

Files:
- `web/src/components/DecoderPanelRevamp.jsx`
- `src/ts-analyser.js`

### 7) 2022-7 Consolidated Multiview Naming and Tile Density

- When 2022-7 mode is enabled and decoder is sent to multiview, ID base uses:
  - `2022-7-consolidated`
- Multiview display title maps to:
  - `2022-7 consolidated`
  - `2022-7 consolidated #N` for suffix variants
- Tile grid made denser for higher card count without removing thumbnail/audio telemetry.

Files:
- `web/src/components/DecoderPanelRevamp.jsx`
- `web/src/components/DecoderMultiviewPanel.jsx`

### 8) TS Input Bitrate Stability for CBR Monitoring

- UI labels now distinguish transport-level TS rate vs elementary stream bitrate:
  - `TS Input Rate`
  - `TS Rate (rolling avg)`
  - `TS Rate Source`
  - `Rate Hold`
  - `ES Bitrate` for video stream bitrate
- Backend avoids regressing to low-confidence source on skipped heavy probe cycles by holding prior trusted transport measurement.

Files:
- `web/src/components/DecoderPanelRevamp.jsx`
- `src/ts-analyser.js`

## Validation Evidence

## Automated

- Backend tests:
  - `npm test`
  - Result: 122 passed, 0 failed
- Frontend build:
  - `npm run build --prefix web`
  - Result: success

## Browser Smoke (highlights)

- 2022-7 advanced metric labels: PASS
- SRT metric labels in 2022-7 panel: PASS
- Live View persistence (`24h`, `Cursor Frozen` across tab switch + refresh): PASS
- Alarm Log clear and export feedback: PASS
- Decoder start/ETR disabled-state guidance text: PASS
- Live attempt with 2022-7 + multiview:
  - UI reported `Started: 1 · Failed: 0`
  - Multiview title included `2022-7 consolidated`
  - App remained responsive

## Runtime Notes (Environment)

- Local runtime currently reports missing ffprobe binary:
  - `spawn ffprobe ENOENT`
  - `ffprobe not found`
- This affects deep analyser fidelity but does not negate UI wiring and naming validations.

## Production Validation Checklist

Run on target Ubuntu server:

```bash
ffprobe -version
curl -fsS http://<YOUR_SERVER_IP>:4000/health
```

Then validate in UI:

1. Start decoder in RTP + 2022-7 mode with multiview enabled.
2. Confirm multiview tile title is `2022-7 consolidated` (or numbered variant).
3. Confirm tile still shows:
   - thumbnail image
   - audio levels bars
4. In Decoder -> SMPTE ST 2022-7 tab, confirm sequence/skew/compliance metrics update live.
5. In Decoder -> Stream Profile, confirm:
   - TS Input Rate and TS Rate Source are populated
   - ES Bitrate remains separate for video stream.


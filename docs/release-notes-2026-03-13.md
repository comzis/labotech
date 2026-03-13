# Labotech Release Notes - 2026-03-13

## Scope

This release focuses on decoder/analyser operator UX, DVB-aligned event semantics, probe persistence, runtime hardening, and server-side event log retention.

## Highlights

- Decoder panel shifted to a compact, analysis-first layout.
- TS analyser and decoder state persistence improved across tab changes.
- ETR/event logs translated to clearer DVB operator terminology.
- Event retention added on server with 14-day rotating JSONL files and cleanup.
- Probe/runtime hardening added for ffprobe JSON failures and RTP fallback behavior.
- PID mapping behavior tightened to reduce stream PID shuffle risk.

## Frontend Changes

### Decoder and TS Analysis UI

- Compact decoder provisioning controls to match TS probe style.
- PID inventory moved to right-side analysis column.
- Live thumbnail panel added next to PID inventory.
- Lower analysis row restructured to:
  - ETR view on left
  - IAT/arrival forensics on right
- Equal-height ETR and IAT panels for cleaner operator view.

### Persistence and Monitoring Behavior

- TS analyser probe can run persistently until explicitly stopped.
- Decoder panel state persists across tab switches.
- Decoder multiview state/form persists across tab switches.
- Active state refresh behavior improved to reduce stale UI tiles.

### DVB/Operator Event Semantics

- Event titles/details now use DVB/ETR-aligned wording.
- Alarm log now includes:
  - Priority labels in operator format (e.g. Priority 1 (P1))
  - Normalized check names
  - PID reference when available
  - Alarm raised time and cleared time
- Timeline cards include PID and lifecycle timing context.

## Backend Changes

### Event Log Retention and Rotation

- Added daily event log rotation:
  - `logs/events-YYYY-MM-DD.jsonl`
- Added retention cleanup:
  - default 14 days (`EVENT_LOG_RETENTION_DAYS`)
  - periodic cleanup timer (`EVENT_LOG_CLEANUP_INTERVAL_MS`)
- Added startup hydration of in-memory ring from rotated files.
- `DELETE /api/events` now clears rotated files and legacy event file.

### Probe and Runtime Hardening

- Hardened ffprobe JSON parsing with explicit handling for:
  - empty payloads
  - invalid/truncated JSON payloads
- Added one-shot RTP probe fallback path:
  - retry probe via UDP-converted URL with forced mpegts demux when needed.

### PID Stability Improvements

- Enhanced PID probe result structure with indexed row context.
- `_applyPidMap` now validates stream-family compatibility before applying index-based PID patching.
- Maintains backward compatibility with existing pid-map call style.

## Operational Notes

- Production smoke tests should not require active multicast forwarding traffic unless forwarding is intentionally enabled.
- Core smoke path remains:
  - `/health`
  - `/streams`
  - `/analyse`
  - `/etr290`
  - `/api/events`
  - one-shot probe URL validation

## Verification Summary

- Backend tests: passing.
- TS analyser and ETR targeted tests: passing.
- Frontend production build: passing.


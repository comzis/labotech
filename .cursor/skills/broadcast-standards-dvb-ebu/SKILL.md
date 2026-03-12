---
name: broadcast-standards-dvb-ebu
description: Applies professional DVB and EBU broadcast engineering checks to Labotech code, configs, and UI flows. Use when implementing or reviewing encoder, transcoder, analyser, multicast forward, TS quality, or operational monitoring changes.
---

# Broadcast Standards DVB EBU

## When to Apply

Apply this skill for changes related to:
- MPEG-TS transport and service metadata
- RTP/UDP/SRT ingest and forwarding
- Decoder/analysis dashboards and quality alarms
- FFmpeg muxing, timing, PCR, continuity counters
- Operator-facing workflow labels and guardrails
- TS analyser health scoring and transport-integrity evidence (`dvb.health`, timestamp/CC counters)
- Stream timeline rendering and operator incident triage ergonomics

## Core Rules

1. Keep DVB service integrity explicit:
   - Preserve PAT/PMT/PCR visibility and service identity.
   - Show `serviceId`, `serviceName`, `serviceProvider`, PMT PID, PCR PID when available.
2. Enforce ETR 290 operator safety:
   - Surface P1/P2/P3 state clearly.
   - Always include continuity counter errors and PCR-related errors in quality views.
   - Keep timestamp-discontinuity and continuity-counter counters operator-visible in analyser evidence.
3. Prefer RTP/SRT-first UX:
   - Keep host and port in separate fields.
   - Keep protocol explicit; avoid ambiguous single URL-only forms for provisioning.
4. Protect multicast operations:
   - Keep forwarding opt-in, never automatic by default.
   - Respect active forwarder limits and duplicate destination protections.
5. Keep telemetry operational:
   - CPU and memory status must remain visible and threshold-colored in runtime header states.
6. Preserve analyser truth model:
   - Keep `dvb.health` scoring reasons actionable and traceable to measured evidence.
   - Keep bitrate source confidence and probe diagnostics exposed for operator trust.
7. Protect timeline interpretability:
   - Prefer duration blocks over sparse event dots for incident persistence readability.
   - Keep pointer popups dynamic so they avoid obscuring the inspected lane.

## Implementation Checklist

- [ ] Does the change preserve DVB SI/service mapping in API responses or UI cards?
- [ ] Are ETR 290 critical alarms visible without deep navigation?
- [ ] Are packet-quality indicators visible (`packet loss`, `jitter`, `PCR`, `CC`)?
- [ ] Are timestamp discontinuity and CC counters visible in TS analysis/forensics views?
- [ ] Does Stream View preserve duration-block semantics and low-occlusion popup behavior?
- [ ] Is decoder provisioning clean (separate protocol/host/port, no clutter)?
- [ ] Is multiview membership explicit (user-selected)?
- [ ] Are risky network defaults avoided (no implicit flood behavior)?

## Response Format (for reviews)

- `Blocking`: standards regressions that can break on-air reliability.
- `Warning`: degraded observability or operator ambiguity.
- `Info`: polish and consistency improvements.

## Reference

Use the thresholds and mapping notes in [DVB-EBU-REFERENCE.md](DVB-EBU-REFERENCE.md).

# DVB EBU Reference

## Transport and Service Essentials

- MPEG-TS transport visibility should include PAT/PMT/PCR context.
- Service presentation should include:
  - `serviceId`
  - `serviceName`
  - `serviceProvider`
  - `pmtPid`
  - `pcrPid`

## Quality Indicators for Operator UI

Minimum decoder quality cards should expose:
- Packet loss indicator (transport/sync related events)
- Jitter indicator (PCR accuracy/discontinuity signals)
- PCR error count
- CC error count

Use simple severity semantics:
- `0`: nominal (green)
- `1-5`: warning (amber)
- `>5`: critical (red)

## ETR 290 Visibility Guidance

- P1 alarms are always high-priority and must be immediately visible.
- P2 alarms should be visible in primary quality dashboard.
- P3 alarms may remain in detailed logs but should not hide P1/P2 status.

## UX Conventions

- Prefer RTP/SRT as primary modes; keep UDP available but de-emphasized.
- Keep protocol, host, and port as separate controls.
- Provide explicit user intent toggles:
  - start/stop monitor
  - add to multiview
  - enable forwarding

## Operational Safety Defaults

- Keep TS forwarding optional at provisioning time.
- Keep active forwarder limits in effect.
- Avoid automatic restore behaviors that could trigger multicast flooding unless explicitly enabled by environment configuration.

## Operational Recovery Checklist

- If expected monitoring tabs/features are missing after deployment, validate deployed ref before feature debugging.
- Confirm operator UI includes core workflows: Decoder, TS Analyser, Multiview, API, Stream View.
- Use deterministic recovery flow (`scripts/recover-prod-fast.sh`) to re-align source, build artifacts, and runtime containers.

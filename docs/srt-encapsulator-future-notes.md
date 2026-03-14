# SRT Encapsulator Future Notes

Date: 2026-03-11

## Current Implementation

- SRT encapsulation runs in a dedicated sidecar service (`labotech-encapsulator`).
- Transport uses Haivision `libsrt` through FFmpeg.
- Main API proxies sidecar operations via `/encap/*`.
- CPU isolation is configured with independent compose CPU sets.

## Why FFmpeg Is Kept Today

- Stable MPEG-TS demux/remux and stream copy pipeline.
- Existing DVB SI and PID mapping behavior already validated.
- Mature handling of RTP/UDP/SRT ingest edge cases.
- Built-in operational telemetry integrated with current UI model.

## Future Track: Pure Haivision Wrapper

- Goal: evaluate native `libsrt` wrapper path with lower overhead and tighter transport control.
- Risk: loss of FFmpeg TS/mux safety unless equivalent TS toolchain is introduced.
- Needed before migration:
  - Equivalent PMT/PAT/PID mapping controls
  - DVB service metadata parity checks
  - Operational metrics parity (RTT, loss, retrans, NAK, throughput)
  - Soak tests under sustained bitrate and fail/recover scenarios

## Proposed Migration Gates

1. Define acceptance criteria and rollback triggers.
2. Build minimal native SRT prototype for single pass-through flow.
3. Add TS integrity checks against current FFmpeg baseline.
4. Run dual-run comparison in lab (latency, loss behavior, CPU/core usage).
5. Promote only if parity or improvement is proven with no broadcast regressions.

# Labotech Project Memory

## Product Identity

Labotech is a **DVB-IP stream processor** — SRT encapsulation, multicast routing,
MPEG-TS analysis, multiview monitoring, and ETR 290 compliance checking.
It is NOT a broadcast encoder. Transcoding (1080p→1080i) is present but secondary
and currently limited. Never describe Labotech as an encoder in any output.
`SRTEncoder` / `encoder.js` are legacy class/file names — they perform SRT
encapsulation, not broadcast encoding.

## Agent Collaboration

You are **Cursor (Agent B)**. Claude Code is **Agent A**.
**Read `docs/agent-status.md` at the start of every session** — it contains:
- Current phase gates (hard stops you must not cross without operator clearance)
- Agent A's active branch and last completed work
- The frozen IPC contracts both agents share
- The merge log and known conflict files

Update the Agent B block in `docs/agent-status.md` before ending every session.
Branch prefix for all your work: `cursor/`

Current version: **3.1.58** — 149 tests passing.

## Runtime and Network

- Target host is an HPE DL360 on Ubuntu with Docker host networking.
- Management plane uses `eno1`; multicast traffic uses `eno2`.
- Multicast forward destination subnet is `239.100.25.0/26`.
- Multicast forwarding defaults to subnet validation; strict single-IP pinning is optional via `FORWARD_MULTICAST_IP`.

## Architecture Defaults

- Backend is Node.js + Express + WebSocket (`ws`) with in-memory `Map` state.
- Frontend is React + Vite in `web/`.
- FFmpeg and ffprobe are external runtime dependencies.
- TS analyser now includes a composite `dvb.health` model (score/severity/reasons) and transport integrity counters.
- Optional Dolby E support is implemented via external decoder adapter (`src/dolbye-adapter.js`) and is non-fatal when disabled.

## Operational Guardrails

- Route/process code must treat user input as untrusted.
- Multi-stage operations should be fail-safe (no orphaned processes).
- Keep docs, env defaults, and runtime bind settings aligned.

## Review Priorities

- Streaming path correctness (SRT/UDP/RTP compatibility).
- Process lifecycle and rollback behavior.
- API/frontend contract consistency.
- Security around shell/process invocation.
- Stream View readability and operator ergonomics (duration blocks, low-occlusion dynamic popup).

## Known Pitfalls (production-validated fixes)

### Null-to-zero PID coercion
`Number(null) === 0` and `Number.isFinite(0) === true`. Backend nulls PID 0 (PAT guard in `_mapStream`), but the frontend can re-coerce null→0 in sort comparators and display renderers. Guard all numeric coercions with `x != null &&`. Affects: `renderPidRef`, `extractPidRows`, `pickPreferredVideoStream`, `audioStreams` sort.

### tsanalyze SIGTERM + exit code
`tsanalyze` writes JSON on SIGTERM (our 9 s kill-timer) but exits non-zero. Old code checked `code !== 0` first and discarded all bitrate data — video/audio ES bitrates showed as `–`. Fix: parse stdout whenever non-empty, ignore exit code. Do not add `--input-timeout` to tsanalyze args (unsupported on production TSDuck version).

### Thundering herd on batch decoder start
9+ decoders starting simultaneously synchronise probe cycles, saturating CPU and multicast join slots. Mitigated by: startup jitter (0–4500 ms, hash-based on stream ID) + module-level semaphore (max 3 concurrent heavy probes, `TS_HEAVY_PROBE_MAX_CONCURRENT`).

### Timeline teal after page reload
`analyse_result` in `TELEMETRY_TYPES` → not persisted → after reload `firstAnalyseResultTs = Infinity` → all history shows teal/pending. Fix: `seedFromActiveAnalysers` synthesises a seed `analyse_result` at `lastResult.probeTime` with actual health severity.

### Pending/teal startup state removed (2026-03-15)
`runtime_started` previously returned `'pending'` (teal) until first `analyse_result`. With 0–4500 ms startup jitter + 7 s probe time, this showed 5–12 s of teal on every decoder start — looked like a stall+recovery to operators. Removed: `decEvtSev` now returns `'ok'` for `runtime_started` immediately. First `analyse_result` within one probe cycle confirms or changes state. Do not reintroduce pending state for startup — use error events for genuine signal loss.

### health_alarm lane block pollution
`health_alarm` events (severity transition markers) must not render as timeline blocks — `analyse_result` already drives the gradient. `buildEventBlocks` must filter `e.category !== 'health_alarm'`. Removing this filter causes duplicate red/amber tinting on every transition.

### Ghost null-PID stream entries
ffprobe emits the same ES twice: in program list (with PID) and global list (without PID). Both reach the frontend. Suppress null-PID rows in `extractPidRows` when a same-codecType row with a real PID exists. In sort comparators, null PID → `POSITIVE_INFINITY` not `0`.

## Deployment Memory

- If production UI appears to lose tabs/features, first suspect deployed ref/build drift rather than component deletion.
- Prefer deterministic recovery with `bash scripts/recover-prod-fast.sh <ref>` before deeper debugging.
- Verify expected tab IDs in `web/src/App.jsx` (`analyse`, `decoders`, `api`, `streamView`) during recovery.
- Before release/deploy, keep `README.md`, `USER_GUIDE.md`, and `docs/engineering-support-manual.md` aligned with runtime behavior.
- Dolby E adapter docs should remain Linux-executable focused and avoid platform-specific dead-end guidance.

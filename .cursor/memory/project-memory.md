# Labotech Project Memory

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

## Deployment Memory

- If production UI appears to lose tabs/features, first suspect deployed ref/build drift rather than component deletion.
- Prefer deterministic recovery with `bash scripts/recover-prod-fast.sh <ref>` before deeper debugging.
- Verify expected tab IDs in `web/src/App.jsx` (`analyse`, `decoders`, `api`, `streamView`) during recovery.
- Before release/deploy, keep `README.md`, `USER_GUIDE.md`, and `docs/engineering-support-manual.md` aligned with runtime behavior.
- Dolby E adapter docs should remain Linux-executable focused and avoid platform-specific dead-end guidance.

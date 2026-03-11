# Labotech Project Memory

## Runtime and Network

- Target host is an HPE DL360 on Ubuntu with Docker host networking.
- Management plane uses `eno1`; multicast traffic uses `eno2`.
- Multicast forward destination subnet is `239.100.25.0/26`.

## Architecture Defaults

- Backend is Node.js + Express + WebSocket (`ws`) with in-memory `Map` state.
- Frontend is React + Vite in `web/`.
- FFmpeg and ffprobe are external runtime dependencies.

## Operational Guardrails

- Route/process code must treat user input as untrusted.
- Multi-stage operations should be fail-safe (no orphaned processes).
- Keep docs, env defaults, and runtime bind settings aligned.

## Review Priorities

- Streaming path correctness (SRT/UDP/RTP compatibility).
- Process lifecycle and rollback behavior.
- API/frontend contract consistency.
- Security around shell/process invocation.

## Deployment Memory

- If production UI appears to lose tabs/features, first suspect deployed ref/build drift rather than component deletion.
- Prefer deterministic recovery with `bash scripts/recover-prod-fast.sh <ref>` before deeper debugging.
- Verify expected tab IDs in `web/src/App.jsx` (`analyse`, `decoders`, `api`, `streamView`) during recovery.

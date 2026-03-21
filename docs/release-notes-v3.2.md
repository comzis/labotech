# Release Notes — v3.2.x

Agent B (Cursor) release notes. Agent A release notes are in `docs/release-notes-v3.1.md`.

---

## v3.2.0 — 2026-03-21

### feat(thumbnail): complete Phase 2 migration — thumbnails out-of-process

**What changed:**
- `TSAnalyser` now accepts an optional `thumbnailClient` constructor option (`ThumbnailWorkerClient`).
- When `thumbnailClient` is injected (standard production path via `api.js` and `routes/analyse.js`), `startContinuous()` delegates thumbnail management to the out-of-process worker instead of spawning `PersistentThumbnailCapture` in the API process.
- SRT slot coordination (`suspend`/`resume` during heavy probes) routes through `thumbnailClient.suspend/resume()` when the worker is active, falling back to the in-process `_persistentThumb` path otherwise.
- **Relay-backed SRT** (loopback unicast UDP) keeps the existing in-process one-shot timer loop — a persistent worker connection would hold the UDP port and block `ffprobe` probes from binding the same socket.
- `routes/analyse.js` passes `thumbnailClient` to the `TSAnalyser` constructor; the dead-code comment is removed.
- `api.js` `restoreState()` passes `thumbnailClient` to restored analysers.
- `api.js` SIGTERM handler now stops all active analysers before shutting down the worker, ensuring relay-backed SRT one-shot timers and any in-process ffmpeg children are cleaned up before `process.exit`.

**Why:**
Phase 2 built the worker/client infrastructure but the internal TSAnalyser thumbnail logic was never removed, leaving the worker idle on every boot. This completes the migration so all thumbnail ffmpeg processes run in the isolated worker process.

**Operator impact:**
- No behaviour change visible from the UI — thumbnails continue to update at the configured interval.
- ffmpeg thumbnail processes no longer run inside the API process; they run in the forked worker. CPU load is unchanged; crash isolation is improved.
- On server restart, thumbnails for active decoders resume automatically via the worker's `_replayActiveCaptures()` mechanism.

**Also fixed:**
- Worker restart backoff (`_restartDelayMs`) now resets to its initial value when the worker emits `ready`, preventing permanent 30 s delays after a crash-loop.

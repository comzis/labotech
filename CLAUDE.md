# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Labotech** is a professional DVB-IP stream processor for an HPE DL360 server running Ubuntu. It handles SRT encapsulation, multicast routing, MPEG-TS analysis, multiview monitoring, and ETR 290 compliance checking. Transcoding (1080p→1080i interlace conversion) is present but considered a secondary and currently limited feature. There is no broadcast encoding capability — the product is an encapsulator, analyser, and multiview platform.

**Server target:** HPE DL360, Ubuntu Server, Docker with `network_mode: host`
- **eno1:** Management NIC → `10.67.18.29` → Web UI + API on port `4000`
- **eno2:** Multicast NIC → no IP → all `239.0.0.0/8` traffic routed here
- **Multicast forward subnet:** `239.100.25.0/26` (address `239.100.25.29`)

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express.js, WebSocket (`ws`) |
| Video processing | FFmpeg + ffprobe (system install via apt) |
| Frontend | React 18 (Vite), Tailwind CSS |
| Containerisation | Docker + docker-compose |
| Process management | Node `EventEmitter`, `child_process.spawn` |

## Build Commands

```bash
# Backend
npm install
npm test -- --runInBand            # all tests (138 tests across 6 suites)
npm test -- test/encoder.test.js  # single test file
npm start                         # run API server

# Frontend
cd web && npm install && npm run build   # build React app to web/dist/
cd web && npm run dev                    # Vite dev server (proxies to API)

# Docker
docker-compose up -d                     # production
docker-compose -f docker-compose.dev.yml up   # development with live reload

# Host setup (run once on Ubuntu server as root)
sudo bash scripts/setup-host.sh
sudo bash scripts/check-routes.sh       # verify networking
```

## Architecture

### Backend (`src/`)

All state is **in-memory `Map()` objects** — no database, no ORM.

- **`encoder.js`** — Core `SRTEncoder` class (extends `EventEmitter`). Key methods: `detectInputType()`, `buildInputArgs()`, `buildSRTUrl()`, `buildFFmpegArgs()`, `start()`, `stop()`, `parseStats()`.
- **`transcoder.js`** — Extends `SRTEncoder`. Implements `INTERLACE_PRESETS` map for four broadcast conversions: 1080p25→1080i50 (PAL), 1080p29.97→1080i59.94 (NTSC), 1080p50→1080i50 (HFR-PAL), 1080i50→1080p25 (deinterlace/OTT).
- **`multicast-forward.js`** — `MulticastForwarder` extends `EventEmitter` directly (not `SRTEncoder`). Validates all multicast addresses against `239.100.25.0/26` before use. Manages `eno2` routes via `ensureMulticastRoute()`.
- **`ts-analyser.js`** — `TSAnalyser` extends `EventEmitter` directly (not `SRTEncoder`). Parses PAT/PMT/PID tree via `parseStructure()`. Health assessment (`_attachHealthAssessment`) gates bitrate-drift scoring on `bitrateSource === 'tsduck'` only; SMPTE ST 2022-7 `insufficient_data` carries no score penalty.
- **`failover.js`** — `FailoverEncoder` with primary/backup input watchdog, 3s switchover threshold.
- **`api.js`** — Express server bound to `10.67.18.29:3000` (never `0.0.0.0`). WebSocket server on same port broadcasts `{ type: "stats", id, ...stats }` from all active stream processors.

### Routes (`routes/`)

Each route file maps to a feature domain: `streams.js`, `transcode.js`, `multicast.js`, `analyse.js`, `pipelines.js`, `scte35.js`.

### Frontend (`web/src/`)

React SPA. `App.jsx` handles tab routing to feature panels. Custom hooks in `hooks/` manage WS connection (`useWebSocket.js`), REST polling (`useStreams.js`), and TS probing (`useTSAnalysis.js`). `api.js` contains all `fetch()` wrappers.

Key frontend components:
- **`StreamViewPanel.jsx`** — UTC timeline across analyser/ETR lanes. Lane bars rendered via `LaneCanvas` (`HTMLCanvasElement fillRect`). Mouse crosshair updated via DOM ref (zero React re-renders); React state throttled to rAF for 60fps popup. `buildLaneGradient()` drives lane color; `parseGradientSegments()` converts the output for canvas draw. **Stop All** button in Active Decoders header.
- **`DecoderPanelRevamp.jsx`** — Decoder tab. Left column: Decoder Provisioning → **Confidence Monitor** (full-width 16:9 thumbnail) → ETR 290 Alarm Configuration. Active Decoders section has per-row STOP and a header-level **STOP ALL** button.
- **`DecoderMultiviewPanel.jsx`** — Multiview tiles, thumbnail display. Auto-seeding checks `anyActive` to avoid short-circuiting on stale server-restart IDs.

## Release Notes Rule

**Every commit that changes behaviour must be documented in `docs/release-notes-v3.1.md` before or in the same commit.**

- Add a new `## vX.Y.Z — YYYY-MM-DD` section at the top of the version block (below the overview).
- Include: what changed, why it was changed, and the operator impact.
- Bump `web/package.json` version (patch) for frontend-only changes; bump `package.json` for backend changes; bump both for full-stack changes.
- The pre-commit hook enforces the `web/package.json` version bump — do not bypass with `--no-verify`.

This rule applies to Claude Code and Cursor equally. No exceptions for "small" fixes — every operator-visible change needs a release note.

## Coding Rules

- Plain ES6 Node.js with `require()` — no TypeScript
- FFmpeg is always called via `child_process.spawn` — never `exec`
- Every class must extend `EventEmitter` and emit `started`, `stopped`, `error`, `stats`
- All multicast addresses must be validated against `239.100.25.0/26` before use
- API server must always bind to `10.67.18.29`, never `0.0.0.0`

## Build Order

See `labotech-project.md` for the full phased build sequence (Phases 1–5). Start with Phase 1 (Dockerfile → encoder.js → api.js + streams route → basic React shell) before moving to transcoding, multicast, TS analysis, and advanced features. Note: `encoder.js` / `SRTEncoder` is the SRT encapsulation engine — the class name is a legacy artefact; it does not perform broadcast encoding.

## Known Pitfalls

### `Number(null) === 0` — null PID coercion
`Number(null) === 0` and `Number.isFinite(0) === true`. Always guard with `x != null && Number.isFinite(Number(x))` before coercing PIDs or any nullable numeric field. The backend nulls PID 0 (PAT) in `_mapStream`; the frontend must not silently re-coerce it. Affects: `renderPidRef`, `extractPidRows`, all sort comparators on stream PIDs.

### tsanalyze: do not check `code === 0`
`tsanalyze` is killed by our 9 s SIGTERM timer and exits non-zero, but writes valid JSON to stdout before dying. Parse stdout whenever non-empty — gating on exit code discards all per-PID bitrate data. Do not pass `--input-timeout` (unsupported on production TSDuck).

### `matchAll` requires a global regex — derive with `new RegExp(rx.source, rx.flags + 'g')`
`String.prototype.matchAll()` throws `TypeError` when called with a non-global regex (missing `g` flag). In `_extractSrtStatsFromLog()` (`ts-analyser.js`) the regex literals in the stats-field table do not carry `g`. Always derive a global copy before calling `matchAll`: `new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g')`. Failure to do so keeps `lastResult: null` permanently and tiles show "Awaiting Frame" indefinitely.

### Per-protocol health thresholds — RTP/UDP vs SRT
`_healthThresholds()` in `ts-analyser.js` auto-selects CC and tsDisc tolerance by URL protocol:
- `srt://` — relaxed IAT/jitter (ARQ retransmission windows); strict CC (ARQ prevents errors)
- `rtp://` or `udp://` — `broadcast-balanced-v1` CC/tsDisc floor (`ccWarnCount≥3`, `ccCriticalCount≥8`) to absorb ffprobe multicast-join artefacts (ffprobe always joins mid-stream and generates 1–10 CC errors while syncing). Do **not** apply `srt-contribution` CC thresholds globally — RTP streams will permanently alarm red.

### Timeline lane color semantics — MCR operator contract
Lane color in `StreamViewPanel.jsx` means:
- **Green** — last probe ok; process confirmed running
- **Amber** — last probe warning
- **Red** — last probe critical or LOS
- **Grey** — process stopped (`runtime_stopped` received) or 30 s of total silence

**Live lanes fill from the left edge of the window** (`isLive = true` → `effectiveStartTs = timeStart`). Do not revert this — grey-left-while-running is confusing at MCR distance.

**Heartbeat seed must use `Date.now()`**, not `probeTime`. The `seedFromActiveAnalysers` bootstrap heartbeat refreshes every 5 s via `mergeTimelineEvents` (dedupes by key). Using `probeTime` makes `staleStopTs` immediately expired and the lane goes grey even though the process is running.

The stale detection uses `Math.max(lastSevEvtTs, lastHeartbeatTs)` so heartbeats (every ~5 s) keep lanes live between slow probe cycles (30–60 s).

### health_alarm must not render timeline blocks
`health_alarm` events are alarm-log-only. `buildEventBlocks()` in `StreamViewPanel.jsx` must filter `e.category !== 'health_alarm'`. The gradient is already driven by `analyse_result`; a separate block causes duplicate red/amber tinting on every severity transition.

### Ghost null-PID stream entries from ffprobe
ffprobe emits the same elementary stream twice in some cases: once inside the program list (with PID) and once in the global stream array (without PID). Suppress null-PID rows in `extractPidRows` when a same-codecType row with a real PID exists. Sort comparators must map null PID to `Number.POSITIVE_INFINITY`, not `0`.

### Thundering herd on batch decoder start
Multiple decoders started simultaneously synchronise their probe cycles. Mitigated by startup jitter (0–4500 ms) and a module-level heavy probe semaphore (default max 3 concurrent, `TS_HEAVY_PROBE_MAX_CONCURRENT`). Do not bypass either.

## UI Change Policy

**No UI changes may be made without consulting the operator first.**

This applies to:
- Layout, grid/flex structure, overflow/clip behaviour in any component
- Adding, removing, or reordering tabs or sub-tabs
- Tailwind responsive breakpoints (`xl:`, `lg:`, `hidden`, `block`)
- Colour values, badge styles, LED dots, branding, or header structure
- Any structural change to `DecoderMultiviewPanel.jsx`, `DecoderPanelRevamp.jsx`, `TSAnalyser.jsx`, or `App.jsx`

Acceptable without consultation:
- Backend-only fixes with no frontend impact
- Targeted single-element bug fixes that do not alter surrounding layout
- Test additions, build tooling, docs

See `docs/engineering-support-manual.md §13` and `.cursor/rules/change-safety-explicit-approval.mdc` for detail.

## Agent Collaboration

Claude Code (Agent A) and Cursor (Agent B) work in parallel on this repository.
**`docs/agent-status.md` is the shared logbook — read it at the start of every session.**
It contains: current phase gates, each agent's active branch, the frozen IPC contracts,
the merge log, and known conflict files. Update your status block before ending a session.

## Development Workflow

**Three AI tools are active on this repo. Read this section before making any changes.**

| Tool | Branch prefix | Role |
|---|---|---|
| Claude Code (this tool) | `feat/`, `fix/`, `chore/` | Multi-file features, backend logic, deploy scripts, refactors |
| Cursor | `cursor/` | Inline editing, small fixes, debugging sessions |
| Antigravity / Project IDX | `idx/` | Exploratory work, Google-ecosystem tooling |

### Rules — enforced for all tools

1. **Never push directly to `main`** — always work on a branch and open a PR
2. **One tool per branch** — commit + push before switching tools on the same task
3. **PR required to merge** — the human reviews and merges; no auto-merge
4. **Run tests before opening a PR** — `npm test -- --runInBand` must pass
5. **Frontend build must be clean** — `npm run build --prefix web` must produce 0 warnings

### AI telemetry — zero tolerance

Cursor's AI debugger has previously injected `fetch('http://127.0.0.1:7265/...')` telemetry into production files (see INC-003 in memory). The pre-commit hook at `.git/hooks/pre-commit` blocks any commit containing these patterns. If a commit is rejected, inspect the diff before force-bypassing.

Patterns blocked: `127.0.0.1:7265`, `#region agent log`, `antigravity.inject`

See `WORKFLOW.md` for the full day-to-day process.

## Configuration

- `config/presets.json` — 64 encapsulator/transcoder preset slots
- `config/multicast.json` — `{ nic: "eno2", subnet: "239.100.25.0/26", address: "239.100.25.29" }`
- `.env` — copy from `.env.example`; never commit `.env`

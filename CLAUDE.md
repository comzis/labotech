# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Labotech** is a professional broadcast encoder and stream management application for an HPE DL360 server running Ubuntu. It manages SRT streams, handles 1080p→1080i transcoding, routes multicast traffic, and analyses MPEG-TS structure.

**Server target:** HPE DL360, Ubuntu Server, Docker with `network_mode: host`
- **eno1:** Management NIC → `10.67.18.29` → Web UI + API on port `3000`
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

- **`encoder.js`** — Core `SRTEncoder` class (extends `EventEmitter`). All other processing classes extend this. Key methods: `detectInputType()`, `buildInputArgs()`, `buildSRTUrl()`, `buildFFmpegArgs()`, `start()`, `stop()`, `parseStats()`.
- **`transcoder.js`** — Extends `SRTEncoder`. Implements `INTERLACE_PRESETS` map for four broadcast conversions: 1080p25→1080i50 (PAL), 1080p29.97→1080i59.94 (NTSC), 1080p50→1080i50 (HFR-PAL), 1080i50→1080p25 (deinterlace/OTT).
- **`multicast-forward.js`** — `MulticastForwarder` class. Validates all multicast addresses against `239.100.25.0/26` before use. Manages `eno2` routes via `ensureMulticastRoute()`.
- **`ts-analyser.js`** — `TSAnalyser` class wrapping ffprobe. Parses PAT/PMT/PID tree via `parseStructure()`.
- **`failover.js`** — `FailoverEncoder` with primary/backup input watchdog, 3s switchover threshold.
- **`api.js`** — Express server bound to `10.67.18.29:3000` (never `0.0.0.0`). WebSocket server on same port broadcasts `{ type: "stats", id, ...stats }` from all active encoders.

### Routes (`routes/`)

Each route file maps to a feature domain: `streams.js`, `transcode.js`, `multicast.js`, `analyse.js`, `pipelines.js`, `scte35.js`.

### Frontend (`web/src/`)

React SPA. `App.jsx` handles tab routing to feature panels. Custom hooks in `hooks/` manage WS connection (`useWebSocket.js`), REST polling (`useStreams.js`), and TS probing (`useTSAnalysis.js`). `api.js` contains all `fetch()` wrappers.

## Coding Rules

- Plain ES6 Node.js with `require()` — no TypeScript
- FFmpeg is always called via `child_process.spawn` — never `exec`
- Every class must extend `EventEmitter` and emit `started`, `stopped`, `error`, `stats`
- All multicast addresses must be validated against `239.100.25.0/26` before use
- API server must always bind to `10.67.18.29`, never `0.0.0.0`

## Build Order

See `labotech-project.md` for the full phased build sequence (Phases 1–5). Start with Phase 1 (Dockerfile → encoder.js → api.js + streams route → basic React shell) before moving to transcoding, multicast, TS analysis, and advanced features.

## Known Pitfalls

### `Number(null) === 0` — null PID coercion
`Number(null) === 0` and `Number.isFinite(0) === true`. Always guard with `x != null && Number.isFinite(Number(x))` before coercing PIDs or any nullable numeric field. The backend nulls PID 0 (PAT) in `_mapStream`; the frontend must not silently re-coerce it. Affects: `renderPidRef`, `extractPidRows`, all sort comparators on stream PIDs.

### tsanalyze: do not check `code === 0`
`tsanalyze` is killed by our 9 s SIGTERM timer and exits non-zero, but writes valid JSON to stdout before dying. Parse stdout whenever non-empty — gating on exit code discards all per-PID bitrate data. Do not pass `--input-timeout` (unsupported on production TSDuck).

### health_alarm must not render timeline blocks
`health_alarm` events are alarm-log-only. `buildEventBlocks()` in `StreamViewPanel.jsx` must filter `e.category !== 'health_alarm'`. The gradient is already driven by `analyse_result`; a separate block causes duplicate red/amber tinting on every severity transition.

### Ghost null-PID stream entries from ffprobe
ffprobe emits the same elementary stream twice in some cases: once inside the program list (with PID) and once in the global stream array (without PID). Suppress null-PID rows in `extractPidRows` when a same-codecType row with a real PID exists. Sort comparators must map null PID to `Number.POSITIVE_INFINITY`, not `0`.

### Thundering herd on batch decoder start
Multiple decoders started simultaneously synchronise their probe cycles. Mitigated by startup jitter (0–4500 ms) and a module-level heavy probe semaphore (default max 3 concurrent, `TS_HEAVY_PROBE_MAX_CONCURRENT`). Do not bypass either.

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

- `config/presets.json` — 64 encoder preset slots
- `config/multicast.json` — `{ nic: "eno2", subnet: "239.100.25.0/26", address: "239.100.25.29" }`
- `.env` — copy from `.env.example`; never commit `.env`

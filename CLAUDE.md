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
npm test                          # all tests (57 tests across 4 suites)
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

## Configuration

- `config/presets.json` — 64 encoder preset slots
- `config/multicast.json` — `{ nic: "eno2", subnet: "239.100.25.0/26", address: "239.100.25.29" }`
- `.env` — copy from `.env.example`; never commit `.env`

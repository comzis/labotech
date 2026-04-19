# LABOTECH

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-267%20passed-brightgreen)](#testing)
[![Version](https://img.shields.io/badge/version-3.2.37-blue)](docs/release-notes-v3.2.md)
[![Node](https://img.shields.io/badge/node-20-green)](https://nodejs.org)
[![TSDuck](https://img.shields.io/badge/ETR290-TSDuck-orange)](https://tsduck.io)
[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://docker.com)

**v3.2.37 / web 3.1.157**

Professional DVB-IP stream processor for broadcast MCR operations.
Handles SRT encapsulation, multicast routing, MPEG-TS analysis, ETR 290 compliance, decoder multiview monitoring, and 1080p↔1080i interlace conversion.

> **Not an encoder.** Labotech is an encapsulator, analyser, and multiview platform.
> Transcoding is present but secondary. `SRTEncoder` is a legacy class name — it performs SRT encapsulation.

---

## Supported Platforms

| | Support level |
|---|---|
| **Ubuntu 22.04 LTS / 24.04 LTS** (x86_64) | ✅ Officially supported — CI and production validated |
| Other Debian-based Linux (x86_64) | ⚠️ Best effort — community supported |
| Other Linux distributions | ⚠️ Best effort — may require manual dependency adjustment |
| macOS / Windows | ❌ Not supported |

**Runtime requirements:** Docker + Compose v2 plugin, FFmpeg, TSDuck (`tsanalyze`), optional `tshark`/`tcpdump` for IAT capture. See `scripts/setup-host.sh` for the full install.

## Hardware Target

| Component | Detail |
|---|---|
| Server | x86_64 Linux server with `network_mode: host` Docker support (validated on typical 1U/2U rack servers) |
| OS | Ubuntu Server LTS (22.04 or 24.04) |
| Management NIC | `<management-nic>` → `$API_HOST` → Web UI + API port `4000` |
| Multicast NIC | `<multicast-nic>` → no IP → all `239.0.0.0/8` traffic |
| Multicast subnet | `<multicast-forward-subnet>` (default address `<multicast-forward-ip>`) |
| Container | Docker with `network_mode: host` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express.js, WebSocket (`ws`) |
| Video processing | FFmpeg + ffprobe (system install via apt) |
| TS analysis | TSDuck (`tsanalyze`) |
| Frontend | React 18, Vite 7, Tailwind CSS |
| Charts | Recharts |
| Notifications | Sonner |
| State | TanStack React Query |
| Containerisation | Docker + Compose v2 plugin |

---

## Quick Start

Primary operations references:

- `docs/server-optimisation-ubuntu.md` (Ubuntu runtime optimization and incident handling)
- `docs/ops-scripts-reference.md` (script catalog and deploy/recovery commands)
- `docs/day1-monitoring-checklist.md` (first-24h stability checklist)

### 1. Host setup (run once as root)

```bash
sudo bash scripts/setup-host.sh
sudo bash scripts/check-routes.sh       # verify networking
```

Optional high-load tuning (RTP/SRT/transcode):

```bash
sudo bash scripts/optimize-host-v2.sh
sudo bash scripts/rollback-host-optimization-v2.sh   # rollback
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set API_HOST, multicast addresses, SNMP targets
```

### 3. Production deployment

```bash
docker compose up -d                    # Compose v2 — docker-compose v1 NOT supported
```

### 3b. Standard update (recommended)

```bash
bash scripts/update-and-deploy-safe.sh
```

Post-deploy smoke test:

```bash
bash scripts/post-deploy-smoke.sh "$API_HOST" 4000
```

Recovery to a known ref:

```bash
bash scripts/recover-prod-fast.sh origin/main
```

Disk pressure emergency cleanup:

```bash
bash scripts/reclaim-disk-fast.sh --yes
```

### 4. Development (live reload)

```bash
docker compose -f docker-compose.dev.yml up
# or locally:
npm install && npm start
cd web && npm install && npm run dev
```

Web UI: `http://<API_HOST>:4000`  (set `API_HOST` in `.env`)

---

## Build Commands

```bash
# Backend
npm install
npm test -- --runInBand               # run full backend Jest suite
npm test -- test/encoder.test.js      # single suite
npm start                             # API server

# Frontend
cd web && npm install
npm run build                         # production build → web/dist/
npm run dev                           # Vite dev server (proxies to API)

# Docker (Compose v2 only)
docker compose up -d
docker compose -f docker-compose.dev.yml up
```

---

## Architecture

### Backend (`src/`)

All state is **in-memory `Map()` objects** — no database, no ORM.

| File | Class | Purpose |
|---|---|---|
| `encoder.js` | `SRTEncoder` | Core FFmpeg wrapper. SRT/UDP/RTP output, full DVB/MPEG-TS muxer compliance. Per-audio-pair codec, bitrate, PID and ISO 639-2 language. |
| `transcoder.js` | `Transcoder` | Extends `SRTEncoder`. Four broadcast interlace presets: 1080p25→1080i50 (PAL), 1080p29.97→1080i59.94 (NTSC), 1080p50→1080i50 (HFR-PAL), 1080i50→1080p25 (OTT). |
| `multicast-forward.js` | `MulticastForwarder` | UDP multicast forwarding via `<multicast-nic>`. Validates all addresses against `<multicast-forward-subnet>`. |
| `ts-analyser.js` | `TSAnalyser` | Continuous/one-shot MPEG-TS probe. PAT/PMT/PID tree, health scoring, TSDuckMonitor integration, thumbnail lifecycle, severity-aware probe cadence. |
| `tsduck-monitor.js` | `TSDuckMonitor` | Persistent `tsanalyze` runner per stream. Real-time PCR / SI / bitrate events. Suspend/resume for SRT single-connection constraint. |
| `thumbnail-worker.js` | — | Isolated worker process (Node `fork`). Owns all `ffmpeg` thumbnail captures. Crash-isolated from API. IPC: `start/stop/suspend/resume/shutdown`. |
| `thumbnail-worker-client.js` | `ThumbnailWorkerClient` | IPC client for the thumbnail worker. Routes `frame` events back to the correct `TSAnalyser` instance. |
| `monitoring.js` | — | `PersistentThumbnailCapture` (SRT streams), one-shot `captureThumbnail` (RTP/UDP), SNMP traps, syslog. Atomic JPEG write (`.tmp` → rename). |
| `monitoring-policy.js` | — | Named monitoring profiles (`broadcast-strict`, `broadcast-balanced-v1`, `srt-contribution`, `contribution-relaxed`, `ott-streaming`). Env + `config/monitoring-policy.json` overrides. |
| `tooling-preflight.js` | — | Startup tool check (ffmpeg, ffprobe, tsanalyze, tshark, tcpdump) and NIC capture permission probe. Results exposed via `/health`. |
| `iat-sniffer.js` | `IATSniffer` | NIC-level packet timestamp sniffer. `tshark`/`tcpdump` backend. IAT, jitter, loss metrics, SMPTE ST 2022-7 path assessment. |
| `etr290-analyser.js` | `ETR290Analyser` | Real-time ETR 290 P1/P2/P3 alarm parser. 5 s startup grace to suppress multicast-join artefacts. |
| `failover.js` | `FailoverEncoder` | Primary/backup input watchdog. 3 s switchover threshold. Emits `switched`. |
| `event-log.js` | — | 1000-event in-memory ring + `logs/events.jsonl` append. Seeded from disk on startup. |
| `scte35.js` | `SCTE35Injector` | SCTE-35 splice_insert payload builder. |
| `api.js` | — | Express bound to `API_HOST:4000` (env var). WebSocket broadcasts all stream events. Serves React SPA. |

### Routes (`routes/`)

| File | Endpoints |
|---|---|
| `streams.js` | `GET/POST/DELETE /streams` |
| `transcode.js` | `GET/POST/DELETE /transcode`, `GET /transcode/presets` |
| `multicast.js` | `GET/POST/DELETE /multicast/forward`, `GET /multicast/config` |
| `analyse.js` | `GET /analyse`, `POST /analyse/start`, `GET/DELETE /analyse/:id` |
| `etr290.js` | `GET/POST/DELETE /etr290`, `GET/POST /etr290/profiles` |
| `events.js` | `GET /api/events`, `DELETE /api/events` |
| `encap.js` | `GET/POST/DELETE /encap/channels`, `GET /encap/health` |
| `pipelines.js` | `POST /pipeline` — chained ingest → transcode → forward |
| `scte35.js` | `POST /scte35/splice` |

### Frontend (`web/src/`)

| Component | Purpose |
|---|---|
| `App.jsx` | Root shell, tab routing, WebSocket lifecycle, preflight/policy header badges |
| `StreamsPanel` | Active streams grid — output mode, DVB identity, audio PIDs, real-time metrics |
| `EncoderForm` | Full encoder config: output mode (SRT/UDP/RTP), DVB/TS service, per-pair audio matrix |
| `TranscodePanel` | 1080p→1080i presets + broadcast preset slot selector |
| `MulticastPanel` | `<multicast-nic>` forwarder controls and subnet status |
| `DecoderPanelRevamp` | Decoder provisioning, Confidence Monitor (16:9 thumbnail), ETR 290 alarm config, PID/audio/video breakdown |
| `DecoderMultiviewPanel` | Fullscreen MCR multiview — true 16:9 tiles, UMD overlays, vertical VU meters (all audio ES pairs), UTC clock, professional dark chrome header |
| `TSAnalyser` | One-shot TS probe, DVB service summary, ETR 290 view, continuous monitor workflows |
| `StreamViewPanel` | Live UTC timeline — canvas lane bars, rAF crosshair, right-edge OK/WARN/CRIT/LOS labels, IAT/jitter forensics popup |
| `EventLogPanel` | Alarm log (1000-event ring, severity filter, CSV/JSONL export) |
| `MetricsTile` | Recharts bitrate sparkline, SRT link health (RTT, loss %) |

---

## Decoder Multiview

The fullscreen multiview (`DecoderMultiviewPanel`) is designed for MCR distance viewing:

- **True 16:9 tiles** — `aspectRatio: 16/9`, `objectFit: contain` — no anamorphic stretch, no picture cropping
- **UMD overlay** — bottom-left of each thumbnail; service name (latched across probe cycles), bitrate. Broadcast Courier New monospace, Labotech cyan palette
- **Vertical VU meters** — all audio Elementary Stream pairs probed via `amerge` filter; 2 px bars, −60→0 dBFS, zone ticks at −18 dBFS and −9 dBFS
- **Status tally** — top-border colour per tile: green (ok), amber (warning/stale), red (critical), grey (stopped)
- **UTC timecode** — 1 Hz header clock, active only when fullscreen is open
- **Auto-seed** — on page load, active analysers seed the tile grid from last probe results

---

## TS Analyser and ETR 290

- **PID/program structure matrix** — PAT/PMT/PCR, per-stream details, null-PID ghost suppression
- **DVB summary** — service count, PID count, aggregate bitrate, monitoring policy, heavy probe cadence
- **Health model** (`dvb.health`) — composite score, severity, per-reason breakdown
- **Per-protocol thresholds** — SRT uses `srt-contribution` profile; RTP/UDP uses `broadcast-balanced-v1` floor (CC warn ≥3, critical ≥8) to absorb multicast-join artefacts
- **ETR 290 P1/P2/P3 alarms** — 5 s startup grace, hysteresis-gated severity transitions, alarm-log integration
- **Bitrate provenance** — `TRUSTED` (TSDuck PCR-derived) vs `MEASURED` (ffprobe) vs `HELD` (carry-forward)
- **SMPTE ST 2022-7** — dual-path loss/gap/duplicate/reorder assessment (NIC capture required)
- **IAT/jitter forensics** — `tshark`/`tcpdump` capture provenance surfaced per-stream

---

## Monitoring Policy

Five named profiles selectable via `config/monitoring-policy.json` or env:

| Profile | Standard | Use case |
|---|---|---|
| `broadcast-strict` | EBU R95 / ITU-R BT.656 | TX master control — zero tolerance |
| `broadcast-balanced-v1` | EBU R95 / ETSI TR 101 290 | MCR contribution (default) |
| `srt-contribution` | SRT Alliance / Haivision | SRT ARQ near-lossless delivery |
| `contribution-relaxed` | ETSI TR 101 290 / DVB-S2 | Satellite / long-haul with noise |
| `ott-streaming` | MPEG-DASH / HLS (ETSI TS 103 285) | IP end-user delivery |

All thresholds are env-overridable. Active profile visible in the header and in each analyser result.

---

## Tooling Preflight

On startup, Labotech checks tool availability and NIC capture permissions:

```
GET /health → .tooling.status        "ready" | "degraded"
             .tooling.tools          ffmpeg / ffprobe / tsanalyze / tshark / tcpdump
             .tooling.nicCapture     state, tool, reason
             .tooling.checkedAt      timestamp
```

Header badge shows `READY` / `DEGRADED` / `PENDING`. Refreshes every 5 minutes.

---

## Output Modes

| Mode | Format | Use case |
|---|---|---|
| `srt` | MPEG-TS over SRT (Haivision) | Contribution, ARQ low-latency |
| `udp` | MPEG-TS over UDP (`pkt_size=1316`) | Multicast distribution |
| `rtp` | MPEG-TS over RTP (`rtp_mpegts`) | Standards-compliant RTP delivery |

---

## DVB / MPEG-TS Compliance

Full DVB-compliant MPEG-TS output (ETSI EN 300 468 / ISO 13818-1):

- Service ID, Transport Stream ID, Original Network ID
- PMT PID, Video PID (PCR on video PID)
- Per-audio-pair PID — ISO 639-2 language tag per track
- Service name / provider in SI metadata

---

## Optional Dolby E Adapter

Non-fatal external decoder adapter in the TS analyser path.

```bash
DOLBYE_ENABLED=true
DOLBYE_DECODER_PATH=/usr/local/bin/dolbye-decoder
DOLBYE_DECODER_ARGS_JSON=["--input","{url}","--json"]
DOLBYE_DECODER_TIMEOUT_MS=4000
DOLBYE_REQUIRED_WHEN_DETECTED=false
```

---

## Screenshots

> 📸 Screenshots coming soon — see the Quick Start guide to run Labotech and explore the interface.

---

## Configuration

### `config/multicast.json`

```json
{ "nic": "<multicast-nic>", "subnet": "<multicast-forward-subnet>", "address": "<multicast-forward-ip>", "ttl": 10 }
```

### `config/monitoring-policy.json` (optional override)

```json
{ "profile": "broadcast-balanced-v1" }
```

### Key `.env` variables

```env
API_HOST=<your-management-nic-ip>
API_PORT=4000
MULTICAST_NIC=<multicast-nic>
FORWARD_MULTICAST_SUBNET=<multicast-forward-subnet>
THUMBNAIL_INTERVAL_SEC=5
THUMBNAIL_QUALITY_PROFILE=high        # or: low
EVENT_LOG_RING_SIZE=1000
TS_HEAVY_PROBE_MAX_CONCURRENT=3
MONITORING_POLICY_PROFILE=broadcast-balanced-v1
```

---

## Tests

```bash
npm test -- --runInBand    # run full backend Jest suite
```

| Suite | Tests | Coverage |
|---|---|---|
| `encoder.test.js` | 57 | Input detection, FFmpeg args, DVB muxer, SRT/UDP/RTP, PID assignment, stats parsing |
| `transcoder.test.js` | 16 | Interlace presets, yadif filter, broadcast conversions |
| `multicast.test.js` | 13 | Subnet validator, CIDR edge cases, URL building |
| `ts-analyser.test.js` | 54 | PAT/PMT/PID parsing, health scoring, per-protocol thresholds, probe scheduling |
| `etr290-analyser.test.js` | 6 | P1/P2/P3 alarm parsing, profile matching |
| `monitoring.test.js` | 3 | Thumbnail capture, atomic write, concurrency guard |
| `thumbnail-worker.test.js` | 28 | Worker IPC, start/stop/suspend/resume, frame events, crash isolation |
| `tsduck-monitor.test.js` | 14 | PCR/SI/bitrate event parsing, restart backoff, suspend/resume |

---

## Coding Rules

- Plain ES6 `require()` — no TypeScript
- FFmpeg and TSDuck always via `child_process.spawn` — never `exec`
- Every class extends `EventEmitter` and emits `started`, `stopped`, `error`, `stats`
- All multicast addresses validated against `<multicast-forward-subnet>` before use
- API binds to `API_HOST` env var — never `0.0.0.0`
- All state in-memory `Map()` — no database, no ORM
- `pid != null && Number.isFinite(Number(pid))` — never coerce nullable PIDs
- `matchAll` requires `g` flag — derive: `new RegExp(rx.source, rx.flags + 'g')`
- `-af` must not follow a `-filter_complex` mapped output — embed in the chain

---

## Known Limitations

- ETR 290 P3 SI table checks not yet implemented via TSDuck JSON output
- Authentication is frontend-only — server-side auth planned
- PCR accuracy numerical values not yet exposed in live view
- Compliance TS recording not yet implemented

## Roadmap

- [ ] ETR 290 P3 SI table monitoring (NIT/SDT/EIT/TDT via TSDuck)
- [ ] Server-side authentication
- [ ] AI-assisted alarm correlation and plain-language fault diagnosis
- [ ] Per-PID bitrate history graphs
- [ ] Compliance TS recording with event-triggered sidecar JSON
- [ ] Multi-site deployment support

---

## Engineering Docs

| Document | Purpose |
|---|---|
| `docs/README.md` | Documentation index, version numbering, hygiene notes |
| `docs/api-reference.md` | REST + WebSocket API |
| `docs/release-notes-v3.1.md` | Detailed changelog (v3.1.x / combined entries) |
| `docs/release-notes-v3.2.md` | v3.2.x release series |
| `docs/etr290-triage-guide.md` | ETR 290 alarm triage for operators |
| `docs/engineering-support-manual.md` | Operator and engineer runbook |
| `docs/git-workflow-and-rollback.md` | Production-safe git and rollback procedure |
| `docs/ops-scripts-reference.md` | Ops scripts reference |
| `docs/day1-monitoring-checklist.md` | Post-change operations checklist |
| `docs/server-optimisation-ubuntu.md` | Ubuntu host tuning and stability |
| `docs/production-forward-probe-runbook.md` | Forward/probe operations |
| `docs/tsduck-spike-findings.md` | TSDuck production capability findings |
| `USER_GUIDE.md` | End-user guide |
| `CLAUDE.md` | AI agent coding rules, pitfalls, and invariants |
| `docs/agent-status.md` | Multi-agent collaboration logbook (Claude Code + Cursor) |

---

## AI-Assisted Development

Labotech uses a structured multi-agent development model:

| Tool | Branch prefix | Role |
|---|---|---|
| Claude Code | `feat/`, `fix/`, `chore/` | Multi-file features, backend logic, deploy scripts, architecture |
| Cursor | `cursor/` | Inline editing, small fixes, debugging sessions |

Rules: never push directly to `main` · always branch + PR · human reviews and merges · `npm test -- --runInBand` must pass before PR · `npm run build --prefix web` must be 0 warnings.

Pre-commit hook blocks Cursor AI telemetry patterns (`127.0.0.1:7265`, `#region agent log`).

See `CLAUDE.md` and `docs/agent-status.md` for the full collaboration protocol.

---

## Acknowledgements

Labotech's stream timeline and monitoring interface was inspired by professional broadcast analysis tools used in the industry. The implementation is original, built entirely on open source foundations:

- [FFmpeg](https://ffmpeg.org) — Media processing
- [TSDuck](https://tsduck.io) — MPEG-TS analysis
- [Node.js](https://nodejs.org) — Backend runtime
- [React](https://reactjs.org) — Frontend framework
- [Docker](https://docker.com) — Container deployment

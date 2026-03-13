# LABOTECH

Professional broadcast stream processing and management for HPE DL360 on Ubuntu. Handles SRT/UDP/RTP workflows, 1080p↔1080i transcoding, multicast routing, TS analysis, ETR290 monitoring, and decoder multiview operations.

---

## Hardware Target

| Component | Detail |
|---|---|
| Server | HPE DL360, Ubuntu Server |
| Management NIC | `eno1` → `10.67.18.29` → Web UI + API port `4000` |
| Multicast NIC | `eno2` → no IP → all `239.0.0.0/8` traffic |
| Multicast subnet | `239.100.25.0/26` (default address `239.100.25.29`) |
| Container | Docker with `network_mode: host` |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express.js, WebSocket (`ws`) |
| Video processing | FFmpeg + ffprobe (system install via apt) |
| Frontend | React 18, Vite 7, Tailwind CSS |
| Charts | Recharts |
| Notifications | Sonner |
| State | TanStack React Query |
| Containerisation | Docker + docker-compose |

---

## Quick Start

### 1. Host setup (run once on Ubuntu server as root)

```bash
sudo bash scripts/setup-host.sh
sudo bash scripts/check-routes.sh   # verify networking
```

Optional (high-load RTP/SRT/transcode tuning profile):

```bash
sudo bash scripts/optimize-host-v2.sh
sudo bash scripts/check-routes.sh
```

Rollback v2 tuning:

```bash
sudo bash scripts/rollback-host-optimization-v2.sh
```

### 2. Configure environment

```bash
cp .env.example .env
# edit .env — set API_HOST, SRT_HOST, multicast addresses, SNMP targets
```

### 3. Production deployment

```bash
docker-compose up -d
```

### 3b. Standardized upgrade (git/systemd flow)

```bash
git fetch --all --tags --prune
bash scripts/upgrade-prod.sh <tag-or-ref>
```

Rollback:

```bash
bash scripts/rollback-last-tag.sh
```

Fast recover (if UI tabs/features are missing after deployment):

```bash
bash scripts/recover-prod-fast.sh origin/main
```

### 4. Development (live reload)

```bash
docker-compose -f docker-compose.dev.yml up
# or run locally:
npm install && npm start
cd web && npm install && npm run dev
```

Web UI: `http://10.67.18.29:4000`

---

## Build Commands

```bash
# Backend
npm install
npm test                          # 87 tests across 4 suites
npm test -- test/encoder.test.js  # single suite
npm start                         # API server

# Frontend
cd web && npm install
npm run build                     # production build → web/dist/
npm run dev                       # Vite dev server (proxies to API)

# Docker
docker-compose up -d
docker-compose -f docker-compose.dev.yml up
```

---

## Architecture

### Backend (`src/`)

All state is **in-memory `Map()` objects** — no database.

| File | Class | Purpose |
|---|---|---|
| `encoder.js` | `SRTEncoder` | Core FFmpeg wrapper. Supports SRT, UDP, RTP output with full DVB/MPEG-TS muxer compliance (service ID, PIDs, transport stream ID). Per-audio-pair codec, bitrate, PID and ISO 639-2 language. |
| `transcoder.js` | `Transcoder` | Extends `SRTEncoder`. Four broadcast interlace presets: 1080p25→1080i50 (PAL), 1080p29.97→1080i59.94 (NTSC), 1080p50→1080i50 (HFR-PAL), 1080i50→1080p25 (deinterlace/OTT). |
| `multicast-forward.js` | `MulticastForwarder` | UDP multicast forwarding via `eno2`. Validates all addresses against `239.100.25.0/26`. Manages routes via `ensureMulticastRoute()`. |
| `ts-analyser.js` | `TSAnalyser` | ffprobe wrapper. Parses PAT/PMT/PID tree via `parseStructure()`. One-shot and continuous probing modes. |
| `iat-sniffer.js` | `IATSniffer` | Optional NIC-level packet timestamp sniffer for continuous analyser workflows. Uses `tshark` or `tcpdump` to derive IAT/jitter/loss metrics and capture provenance. |
| `failover.js` | `FailoverEncoder` | Primary/backup input watchdog. 3-second switchover threshold. Emits `switched` event. |
| `scte35.js` | `SCTE35Injector` | SCTE-35 splice_insert payload builder for ad marker injection. |
| `monitoring.js` | — | Confidence thumbnail capture (ffmpeg), SNMP traps, syslog events. |
| `filters.js` | — | FFmpeg filter chain builders: logo overlay, noise reduction, scale. |
| `api.js` | — | Express server bound to `10.67.18.29:4000`. WebSocket broadcasts all encoder events. Serves React SPA from `web/dist/`. |

### Routes (`routes/`)

| File | Endpoints |
|---|---|
| `streams.js` | `GET/POST/DELETE /streams` |
| `transcode.js` | `GET/POST/DELETE /transcode`, `GET /transcode/presets` |
| `multicast.js` | `GET/POST/DELETE /multicast/forward`, `GET /multicast/config` |
| `analyse.js` | `GET /analyse`, `POST /analyse/start`, `GET/DELETE /analyse/:id` |
| `events.js` | `GET /api/events`, `DELETE /api/events` |
| `pipelines.js` | `POST /pipeline` — chained ingest → transcode → forward |
| `scte35.js` | `POST /scte35/splice` |

### Frontend (`web/src/`)

| Component | Purpose |
|---|---|
| `App.jsx` | Root shell, tab routing, WebSocket lifecycle toasts |
| `StreamsPanel` | Active streams grid — output mode badge, DVB service identity, audio pair PIDs, real-time metrics |
| `EncoderForm` | Full encoder configuration: output mode (SRT/UDP/RTP), DVB/TS service, per-pair audio matrix |
| `TranscodePanel` | 1080p→1080i presets + broadcast preset slot selector |
| `MulticastPanel` | `eno2` forwarder controls and subnet status |
| `TSAnalyser` | One-shot TS probe, DVB service summary/table, embedded ETR290 view, and continuous decoder/monitor workflows |
| `ConfidenceMonitor` | Thumbnail mosaic grid with live Mbps, DVB service name |
| `StreamViewPanel` | Live UTC timeline across analyser/ETR lanes with pointer popup, lane error context, and IAT/jitter forensics |
| `EventLogPanel` | Central alarm/event log with UTC timestamps, instance correlation, severity/status filters, and CSV/JSONL export |
| `MetricsTile` | Recharts bitrate sparkline, SRT link health (RTT, loss %) |

---

## DVB / MPEG-TS Compliance

The encoder supports full DVB-compliant MPEG-TS output (ETSI EN 300 468 / ISO 13818-1):

- **Service ID** (`-mpegts_service_id`)
- **Transport Stream ID** (`-mpegts_transport_stream_id`)
- **Original Network ID** (`-mpegts_original_network_id`)
- **PMT PID** (`-mpegts_pmt_start_pid`)
- **Video PID** — declared via `-streamid 0:<pid>`, PCR carried on video PID
- **Per-audio-pair PID** — `-streamid N:<pid>` for each track
- **Service name / provider** — written to SI metadata
- **Language tags** — ISO 639-2 per audio track (`-metadata:s:a:N language=xxx`)

---

## Output Modes

| Mode | Format | Use case |
|---|---|---|
| `srt` | MPEG-TS over SRT (Haivision) | Contribution, low-latency delivery with ARQ |
| `udp` | MPEG-TS over UDP (`pkt_size=1316`) | Multicast distribution, internal routing |
| `rtp` | MPEG-TS over RTP (`rtp_mpegts`) | Standards-compliant RTP delivery |

---

## TS Analyser and ETR290

The TS Analyser now includes transport, DVB, and ETR290 operator views:

- **PID/program structure matrix** (PAT/PMT/PCR and per-stream details)
- **DVB summary panel** with service count, PID count, stream breakdown, aggregate bitrate
- **Service table** showing SID, service name/provider, PMT PID, PCR PID
- **ETR290 monitor panel** (P1/P2/P3, alarms) embedded in analyser workflow
- **TS PID inventory** table for video/audio/data/other streams, including codec and bitrate
- **PID bitrate provenance label** for unresolved video remainder allocations (`(est.)`) so computed values are not mistaken for measured per-PID bitrate
- **ETR input bind IP** for RTP/UDP monitor URLs, so operators can pin monitoring to the intended interface path
- **ETR parser diagnostics** (matched lines and last match time) to verify monitor activity against live faults
- **IAT sniffer diagnostics** (attempted, capture method, sample count, error) for NIC-capture visibility
- **Transport integrity checks** for timestamp discontinuities and continuity counter (CC) errors
- **Composite health model** (`dvb.health`) including score, severity, and reasons for operator triage

---

## Optional Dolby E Adapter (Linux)

LABOTECH supports Dolby E via an optional external decoder adapter in the TS analyser path.

- Adapter is non-fatal: if disabled/unavailable, standard TS analysis continues.
- Use a Linux executable/script for decoder integration.

Environment variables (`.env`):

```bash
DOLBYE_ENABLED=true
DOLBYE_DECODER_PATH=/usr/local/bin/dolbye-decoder
DOLBYE_DECODER_ARGS_JSON=["--input","{url}","--json"]
# Fallback template if *_JSON is empty:
# DOLBYE_DECODER_ARGS=--input {url} --json
DOLBYE_DECODER_TIMEOUT_MS=4000
DOLBYE_REQUIRED_WHEN_DETECTED=false
```

Expected decoder output (JSON):

```json
{
  "detected": true,
  "decoded": true,
  "frameCount": 128,
  "programConfig": "5.1+2",
  "ok": true
}
```

Operator visibility fields:

- `dvb.dolbyE.detected`
- `dvb.dolbyE.decoded`
- `dvb.dolbyE.frameCount`
- `dvb.probeDiagnostics.dolbyE`

For deployment checks and troubleshooting runbook, see `docs/engineering-support-manual.md`.
For the latest UI hardening + SMPTE 2022-7 implementation details and validation evidence, see `docs/ui-hardening-and-20227-worklog.md`.

---

## Live View Timeline

`Live View` provides a UTC timeline that correlates analyser and ETR events in one place:

- **Duration block timeline**: compact color-coded line blocks represent event persistence by category/severity
- **Lane line severity at pointer**: lane baseline color reflects current severity near pointer (critical/warning/ok)
- **Dynamic pointer popup**: follows cursor quadrants to reduce lane occlusion while inspecting nearby evidence
- **De-noised status plotting**: repeated identical status samples are suppressed to avoid a misleading dotted-line effect
- **IAT/jitter telemetry source clarity**: lane cards expose arrival provenance (`tshark`, `tcpdump`, analyser-derived) so operators can distinguish NIC-capture from analyser-derived telemetry

---

## Alarm and Event Log

`Alarm Log` is a persistent operator-focused incident view:

- **Sources:** stream/transcode/multicast/analyser/ETR events and errors routed through centralized API broadcast
- **Scope:** `critical`, `warning`, and `info` severities, with explicit status (`alarm`, `error`, `no-signal`, `failover`, `started`, `stopped`, `info`)
- **UX controls:** unread critical badge on tab, severity filter, text search, clear log action
- **Export:** one-click **CSV** and **JSONL** export for NOC handover and post-incident review
- **Persistence:** in-memory ring + append-only `logs/events.jsonl`; seeded on page load from `GET /api/events`

---

## Input Bitrate Provenance

`SRTEncoder` input bitrate reporting is intentionally source-aware for live feeds where startup metadata may be missing:

- **`srt-stats`** — live SRT rate from periodic transport stats
- **`bitrate-watcher`** — periodic ffmpeg remux watcher for UDP/RTP inputs
- **`proxy-output`** — passthrough (`videoCodec=copy`) output-rate proxy when direct input-rate telemetry is absent
- **`stream-descriptor` / startup metadata** — one-shot source metadata when available

The API surface includes `inputBitrate` and provenance (`inputBitrateSource`) to support deterministic operator visibility.

---

## Encoder Presets

64 slots in `config/presets.json`, organised by category:

| Slots | Category |
|---|---|
| 1–16 | HD/SD H.264 and H.265 — standard bitrate range |
| 17–29 | HD/SD H.264 extended bitrates + 4:2:2 profiles |
| 30–36 | UHD/HDR — HEVC PQ10, HLG10, archival |
| 37–40 | HD H.264 — low-latency speed presets (ultrafast → faster) |
| 41–45 | HD H.265 10-bit SDR and HQ |
| 46–50 | 720p H.264 and H.265 |
| 51–57 | Broadcast audio codecs — MP2 (DVB), AC3, E-AC3 |
| 58–59 | 4K HEVC PQ10 / HLG10 |
| 60–61 | HD contribution / archival 4:2:2 |
| 62–63 | H.264 baseline and main profiles (legacy devices) |
| 64 | Pass-through / remux (`copy` video + audio) |

---

## Configuration

### `config/multicast.json`

```json
{
  "nic": "eno2",
  "subnet": "239.100.25.0/26",
  "address": "239.100.25.29",
  "ttl": 10
}
```

### `.env.example`

Key variables:

```env
API_HOST=10.67.18.29
API_PORT=4000
MANAGEMENT_NIC=eno1
MULTICAST_NIC=eno2
FORWARD_MULTICAST_SUBNET=239.100.25.0/26
FORWARD_MULTICAST_IP=239.100.25.29
RESTORE_STREAMS_ON_BOOT=false
RESTORE_TRANSCODERS_ON_BOOT=false
RESTORE_FORWARDERS_ON_BOOT=false
MAX_ACTIVE_FORWARDERS=1
SRT_HOST=your.destination.server.com
SRT_PORT=9999
SRT_LATENCY=2000
SNMP_MANAGER_HOST=10.67.18.1
SYSLOG_HOST=10.67.18.1
THUMBNAIL_INTERVAL_SEC=5
THUMBNAIL_QUALITY_PROFILE=high
EVENT_LOG_RING_SIZE=500
```

Thumbnail quality profile options:

- `THUMBNAIL_QUALITY_PROFILE=high` (default): 640px capture, cleaner multiview image, higher CPU.
- `THUMBNAIL_QUALITY_PROFILE=low`: 320px capture, lower CPU, lower visual quality.

---

## Coding Rules

- Plain ES6 Node.js with `require()` — no TypeScript
- FFmpeg always via `child_process.spawn` — never `exec`
- Every class extends `EventEmitter` and emits `started`, `stopped`, `error`, `stats`
- All multicast addresses validated against `239.100.25.0/26` before use
- API server always binds to `10.67.18.29` — never `0.0.0.0`
- All state in-memory `Map()` — no database, no ORM

---

## Tests

```bash
npm test
# 87 tests across 4 suites — encoder, transcoder, multicast, ts-analyser
```

| Suite | Tests | Coverage |
|---|---|---|
| `encoder.test.js` | 91 | Input detection, FFmpeg args, DVB muxer, output modes (SRT/UDP/RTP), PID assignment, stats parsing |
| `transcoder.test.js` | 13 | Interlace presets, yadif filter, broadcast conversions |
| `multicast.test.js` | 13 | Subnet validator, CIDR edge cases, URL building |
| `ts-analyser.test.js` | 12 | PAT/PMT/PID parsing, orphan streams, continuous probing |

---

## Release Safety

- Production-safe git and rollback runbook: `docs/git-workflow-and-rollback.md`
- Engineering operations runbook: `docs/engineering-support-manual.md`
- UI hardening and SMPTE 2022-7 worklog: `docs/ui-hardening-and-20227-worklog.md`
- Day-1 post-change operations checklist: `docs/day1-monitoring-checklist.md`
- Ubuntu host tuning scripts: `scripts/optimize-host-v2.sh` and `scripts/rollback-host-optimization-v2.sh`
- Standardized production upgrade: `bash scripts/upgrade-prod.sh [tag-or-ref]`
- Deploy a fixed version tag/ref: `bash scripts/deploy-ref.sh <tag-or-ref>`
- Roll back quickly to prior tag: `bash scripts/rollback-last-tag.sh`

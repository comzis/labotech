# Labotech — Project Structure & Build Prompt

## Project Structure

```
labotech/
│
├── README.md
├── .env                          # Environment variables (never commit)
├── .env.example                  # Template — commit this
├── .gitignore
│
├── docker-compose.yml            # Production deployment
├── docker-compose.dev.yml        # Local development overrides
├── Dockerfile                    # Node.js + FFmpeg image
│
├── src/                          # ── BACKEND (Node.js) ──────────────────
│   │
│   ├── index.js                  # Entry point — starts API server
│   │
│   ├── encoder.js                # Core SRTEncoder class (EventEmitter)
│   │                             #   buildInputArgs(), buildFFmpegArgs()
│   │                             #   buildSRTUrl(), detectInputType()
│   │                             #   start(), stop(), parseStats()
│   │
│   ├── transcoder.js             # Extends SRTEncoder
│   │                             #   1080p25→1080i50 (PAL)
│   │                             #   1080p29.97→1080i59.94 (NTSC)
│   │                             #   1080p50→1080i50 (HFR-PAL)
│   │                             #   1080i50→1080p25 (deinterlace/OTT)
│   │                             #   INTERLACE_PRESETS map
│   │
│   ├── multicast-forward.js      # MulticastForwarder class
│   │                             #   <multicast-nic> / <multicast-forward-subnet>
│   │                             #   buildMulticastUrl()
│   │                             #   ensureMulticastRoute()
│   │                             #   checkMulticastRoute()
│   │                             #   isInSubnet() validator
│   │
│   ├── ts-analyser.js            # TSAnalyser class
│   │                             #   ffprobe -show_programs -show_streams
│   │                             #   parseStructure() → PAT/PMT/PID tree
│   │                             #   probe(), startContinuous()
│   │
│   ├── failover.js               # FailoverEncoder class
│   │                             #   primary/backup input watchdog
│   │                             #   3s switchover threshold
│   │
│   ├── filters.js                # Filter chain builders
│   │                             #   buildLogoOverlay()
│   │                             #   buildNoiseReduction()
│   │                             #   buildScaleFilter()
│   │
│   ├── scte35.js                 # SCTE-35 ad marker injection
│   │                             #   buildSpliceInsert()
│   │
│   ├── monitoring.js             # Confidence thumbnails, SNMP, syslog
│   │                             #   captureThumbnail()
│   │                             #   sendSnmpTrap()
│   │
│   └── api.js                    # Express REST API + WebSocket server
│                                 #   Binds to <management-nic-ip>:3000
│                                 #   All routes wired here
│
├── routes/                       # ── API ROUTES (separate files) ────────
│   ├── streams.js                # POST/GET/DELETE /streams
│   ├── transcode.js              # POST /transcode, GET /transcode/presets
│   ├── multicast.js              # POST/GET/DELETE /multicast/forward
│   │                             # GET /multicast/config
│   ├── analyse.js                # GET /analyse, POST /analyse/start
│   │                             # GET/DELETE /analyse/:id
│   ├── pipelines.js              # POST /pipeline (ingest→transcode→forward)
│   └── scte35.js                 # POST /scte35/splice
│
├── config/                       # ── CONFIGURATION ──────────────────────
│   ├── presets.json              # 64 encoder preset slots
│   └── multicast.json            # Multicast subnet config
│                                 #   { nic: "<multicast-nic>",
│                                 #     subnet: "<multicast-forward-subnet>",
│                                 #     address: "<multicast-forward-ip>" }
│
├── web/                          # ── FRONTEND (React) ───────────────────
│   │
│   ├── index.html                # Single-page app shell
│   │
│   └── src/
│       ├── App.jsx               # Root component, tab routing
│       │
│       ├── components/
│       │   ├── StreamsPanel.jsx          # Active streams list + controls
│       │   ├── EncoderForm.jsx           # Start encoder/transcoder form
│       │   ├── TranscodePanel.jsx        # 1080p→1080i presets UI
│       │   ├── MulticastPanel.jsx        # <multicast-nic> forward controls + status
│       │   ├── TSAnalyser.jsx            # PAT→PMT→PID tree + metrics
│       │   ├── ConfidenceMonitor.jsx     # Thumbnail mosaic grid
│       │   ├── MetricsTile.jsx           # Bitrate tile + sparkline
│       │   ├── Sparkline.jsx             # SVG sparkline chart
│       │   ├── PidBadge.jsx              # Hex PID badge (0x0101)
│       │   └── StatusDot.jsx             # Live/stopped/error indicator
│       │
│       ├── hooks/
│       │   ├── useWebSocket.js           # WS connection + message handler
│       │   ├── useStreams.js             # REST polling for stream list
│       │   └── useTSAnalysis.js         # TS probe + continuous update
│       │
│       └── api.js                        # fetch() wrappers for all endpoints
│
├── scripts/                      # ── HOST SETUP SCRIPTS ─────────────────
│   ├── setup-host.sh             # One-time server setup:
│   │                             #   install smcroute, netplan config,
│   │                             #   sysctl multicast settings,
│   │                             #   UDP buffer tuning (25MB)
│   ├── add-multicast-route.sh    # ip route add <multicast-forward-subnet> dev <multicast-nic>
│   └── check-routes.sh           # Verify all routes + rp_filter status
│
└── test/                         # ── TESTS ──────────────────────────────
    ├── encoder.test.js           # Unit tests for SRTEncoder
    ├── transcoder.test.js        # Unit tests for Transcoder presets
    ├── multicast.test.js         # Unit tests for subnet validator
    └── ts-analyser.test.js       # Unit tests for TS structure parser
```

---

## Environment Variables (`.env.example`)

```env
# ── Server ─────────────────────────────────────────
API_HOST=<management-nic-ip>
API_PORT=3000
NODE_ENV=production

# ── Network interfaces ──────────────────────────────
MANAGEMENT_NIC=<management-nic>
MULTICAST_NIC=<multicast-nic>

# ── Multicast forward subnet ────────────────────────
FORWARD_MULTICAST_SUBNET=<multicast-forward-subnet>
FORWARD_MULTICAST_IP=<multicast-forward-ip>
MULTICAST_TTL=10

# ── SRT output defaults ─────────────────────────────
SRT_HOST=your.destination.server.com
SRT_PORT=9999
SRT_LATENCY=2000
SRT_PASSPHRASE=change_this_in_production

# ── Encoding defaults ───────────────────────────────
VIDEO_BITRATE=8M
AUDIO_BITRATE=256k
VIDEO_CODEC=libx264
AUDIO_CODEC=aac

# ── Monitoring ──────────────────────────────────────
SNMP_MANAGER_HOST=<snmp-manager-ip>
SYSLOG_HOST=<syslog-host-ip>
SYSLOG_PORT=514
THUMBNAIL_INTERVAL_SEC=5
```

---

## Build Order (recommended implementation sequence)

```
Phase 1 — Foundation
  1. Dockerfile + docker-compose.yml
  2. src/encoder.js               (core FFmpeg wrapper)
  3. src/api.js + routes/streams.js
  4. Basic React shell (App.jsx + StreamsPanel)

Phase 2 — Transcoding
  5. src/transcoder.js            (1080p→1080i presets)
  6. routes/transcode.js
  7. web/src/components/TranscodePanel.jsx

Phase 3 — Multicast Forwarding
  8. src/multicast-forward.js     (MulticastForwarder + route check)
  9. routes/multicast.js
  10. scripts/setup-host.sh
  11. web/src/components/MulticastPanel.jsx

Phase 4 — TS Analysis
  12. src/ts-analyser.js          (ffprobe wrapper)
  13. routes/analyse.js
  14. web/src/components/TSAnalyser.jsx
  15. web/src/components/MetricsTile + Sparkline

Phase 5 — Advanced Features
  16. src/failover.js
  17. src/scte35.js
  18. src/monitoring.js           (thumbnails, SNMP)
  19. routes/pipelines.js         (combined ingest→transcode→forward)
  20. web/src/components/ConfidenceMonitor.jsx
```

---
---

# Claude Prompt — Start Building Labotech

> Copy everything below this line into a new Claude conversation
> with the labotech skill loaded.

---

## PROMPT

You are building **Labotech** — a professional DVB-IP stream processor (encapsulation, analysis, multiview, ETR 290) for x86_64 Linux — **not** a broadcast encoder. Ubuntu Server LTS is the validated target.

Use the **labotech skill** for all implementation decisions. Read the relevant reference files before writing any code.

---

### Infrastructure

- **Server:** x86_64 Linux (Ubuntu Server LTS validated), Docker (`network_mode: host`)
- **<management-nic>:** Management NIC → IP `<management-nic-ip>` → Web UI and API on port `4000`
- **<multicast-nic>:** Multicast NIC → no IP → all `239.0.0.0/8` traffic routed here
- **Multicast forward subnet:** `<multicast-forward-subnet>` (address `<multicast-forward-ip>`)

---

### Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express.js, WebSocket (ws) |
| Video processing | FFmpeg (system install via apt) |
| Frontend | React 18 (Vite), Tailwind CSS |
| Containerisation | Docker + docker-compose |
| Process management | Node EventEmitter, child_process.spawn |

---

### What to build — Phase 1 (Foundation)

Start with **Phase 1** only. Build these four things in order:

**1. `Dockerfile`**
- Base: `node:20-slim`
- Install: `ffmpeg ffprobe` via apt
- Working dir: `/app`
- Copy `package.json`, run `npm install`, copy `src/`
- Expose port `3000`
- CMD: `node src/index.js`

**2. `docker-compose.yml`**
- Service name: `labotech`
- `network_mode: host`
- `cap_add: [NET_ADMIN]`
- Mount `./config:/app/config` and `./logs:/app/logs`
- All `.env` values passed through
- Restart policy: `unless-stopped`

**3. `src/encoder.js`** — Core `SRTEncoder` class
- Extends `EventEmitter`
- Constructor takes: `input`, `host`, `port`, `latency`, `passphrase`, `streamId`, `videoBitrate`, `audioBitrate`, `videoCodec`, `preset`, `pixFmt`
- `detectInputType(url)` — returns `rtp`, `udp`, `rtsp`, `file`, `device`
- `buildInputArgs()` — correct FFmpeg input flags per input type (no `-re` for RTP/UDP multicast)
- `buildSRTUrl()` — assembles `srt://host:port?mode=caller&latency=...`
- `buildFFmpegArgs()` — full FFmpeg argument array
- `start()` — spawns FFmpeg, wires stderr to `parseStats()`, emits `started`
- `stop()` — sends `SIGTERM`
- `parseStats(line)` — parses FFmpeg stderr progress, emits `stats` event with `{ frame, fps, bitrate, speed, dropFrames }`
- `isRunning` boolean property

**4. `src/api.js` + `routes/streams.js`**
- Express server binding to `<management-nic-ip>:4000`
- WebSocket server on same port
- Routes:
  - `GET /streams` — list all active streams
  - `POST /streams` — start encoder (body: `{ id, input, host, port, latency, videoBitrate, passphrase }`)
  - `GET /streams/:id` — get stream details + last stats
  - `DELETE /streams/:id` — stop stream
  - `GET /health` — returns `{ status: "ok", uptime, streams: count }`
- WebSocket broadcasts `{ type: "stats", id, ...stats }` from all active encoders
- Auto-reconnect with 3s delay, max 5 retries

---

### Rules

- Read `references/api.md` before writing `src/api.js`
- Read `references/outputs.md` before writing any FFmpeg output URLs
- Every class must extend `EventEmitter` and emit `started`, `stopped`, `error`, `stats`
- No TypeScript — plain ES6 Node.js with `require()`
- No ORM — no database — all state is in-memory `Map()` objects
- FFmpeg is always called via `child_process.spawn` — never `exec`
- All multicast addresses must be validated against `<multicast-forward-subnet>` before use
- Docker container must never bind to `0.0.0.0` on the API — always `<management-nic-ip>`

---

### After Phase 1 is complete and working, move to Phase 2:

> "Phase 1 is done. Now build Phase 2 — the transcoder.
> Read `references/transcoder.md` and implement `src/transcoder.js`
> with all four PAL/NTSC/HFR presets, then add `routes/transcode.js`."

---

### After Phase 2, move to Phase 3:

> "Phase 2 is done. Now build Phase 3 — multicast forwarding.
> Read `references/multicast-forward.md` and implement
> `src/multicast-forward.js` with the `MulticastForwarder` class,
> `ensureMulticastRoute()`, subnet validator, and `routes/multicast.js`."

---

### After Phase 3, move to Phase 4:

> "Phase 3 is done. Now build Phase 4 — TS analysis.
> Read `references/ts-analyser.md` and implement `src/ts-analyser.js`
> with `TSAnalyser`, `parseStructure()`, continuous probing, and
> the full React `TSAnalyser.jsx` dashboard component."

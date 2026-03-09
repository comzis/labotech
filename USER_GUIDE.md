# Labotech User Guide

**Broadcast Encoder & Stream Management System**

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Server Setup](#2-server-setup)
3. [Starting the Application](#3-starting-the-application)
4. [Streams Panel](#4-streams-panel)
5. [Transcode Panel](#5-transcode-panel)
6. [Multicast Panel](#6-multicast-panel)
7. [TS Analyser](#7-ts-analyser)
8. [Confidence Monitor](#8-confidence-monitor)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. System Overview

Labotech manages broadcast-grade SRT encoding, 1080p→1080i transcoding, multicast forwarding, and MPEG-TS stream analysis from a single web interface.

**Network layout:**

| Interface | Role | IP |
|---|---|---|
| `eno1` | Management — Web UI & API | `10.67.18.29` |
| `eno2` | Multicast — no IP assigned | all `239.0.0.0/8` traffic |

- **Web UI / API:** `http://10.67.18.29:4000`
- **Multicast subnet:** `239.100.25.0/26` (forward address `239.100.25.29`)

---

## 2. Server Setup

Run once on the Ubuntu server as root:

```bash
sudo bash scripts/setup-host.sh
sudo bash scripts/check-routes.sh   # verify multicast routing
```

Copy and configure the environment file:

```bash
cp .env.example .env
# .env is pre-configured for production — do not change API_HOST or API_PORT
```

---

## 3. Starting the Application

### Production (Docker)

```bash
docker-compose up -d
```

The UI is then available at `http://10.67.18.29:4000`.

### Development (local Mac)

**Terminal 1 — Backend:**
```bash
npm install
npm start
# → Labotech API listening on http://127.0.0.1:4000
```

**Terminal 2 — Frontend:**
```bash
cd web && npm install && npm run dev
# → http://localhost:5173
```

The status indicator in the top-right corner shows **ONLINE** (green) when the WebSocket connection to the backend is active.

---

## 4. Streams Panel

Manages live SRT/UDP/RTP encoder channels.

### Deploy a New Broadcast Channel

Click **Deploy New Broadcast Channel** to expand the Engine Configuration form.

**Transport & Networking**

| Field | Description |
|---|---|
| Channel ID | Unique name for this stream (e.g. `ch1-news`) |
| Input Source | UDP multicast, SRT, or file (e.g. `udp://239.0.0.1:5000`) |
| Output Mode | `SRT`, `UDP`, or `RTP` |
| SRT Target Host | Destination IP or hostname |
| Port | Default `9999` |
| Latency (ms) | SRT buffer — default `2000` ms |
| Passphrase | Optional AES encryption key |
| Encryption | AES-128 / AES-192 / AES-256 / None |
| Adapter / Bind IP | Source NIC binding (use `10.67.18.29` for eno1) |
| Stream ID | Optional SRT stream identifier |

**Audio Matrix** — configure up to 8 audio pairs:

| Column | Description |
|---|---|
| Src | Input audio track index (0-based) |
| Codec | `aac`, `mp2`, `ac3`, `eac3`, or `copy` |
| Bitrate | e.g. `256k`, `384k` |
| Ch | Channels: 1 (mono), 2 (stereo), 6 (5.1) |
| PID | MPEG-TS PID — leave blank for auto-assignment |
| Lang | ISO 639-2 language code (e.g. `eng`, `fra`) |

**DVB / TS Service** — MPEG-TS multiplex metadata:

| Field | Description |
|---|---|
| Service ID | DVB service identifier |
| TS ID | Transport stream ID |
| Orig. Network ID | Original network identifier |
| PMT PID | Programme Map Table PID (default `4096`) |
| Video PID | Elementary video stream PID (default `256`) |
| PCR PID | Automatically set to Video PID |
| Service Name | Human-readable channel name |
| Service Provider | Broadcaster name |

**Video Matrix:**

| Field | Description |
|---|---|
| Codec | `libx264`, `libx265`, or `copy` |
| Profile | `baseline`, `main`, `high`, `high422` |
| Preset | Encoding speed vs quality (`medium` recommended) |
| Bitrate | e.g. `8M`, `15M` |
| GOP | Group of Pictures size (use `50` for PAL, `60` for NTSC) |

Click **INITIATE ENGINE** to start the stream.

### Active Streams

Running channels appear as cards showing:
- Live/stopped status dot
- Output mode badge (SRT / UDP / RTP)
- Input source and destination
- DVB service identity and PID map
- Real-time bitrate / packet loss metrics

Click **Stop** to terminate a channel.

---

## 5. Transcode Panel

Handles broadcast format conversion (interlace/deinterlace/frame-rate normalisation).

### Deploy a Transcoder

Click **Deploy Transcoder** to open the three-step form.

**Step 1 — Transformation Matrix**

Select the broadcast conversion profile:

| Profile | Conversion | Use Case |
|---|---|---|
| 1080p25 → 1080i50 (PAL) | Progressive to interlaced | PAL playout |
| 1080p29.97 → 1080i59.94 (NTSC) | Progressive to interlaced | NTSC playout |
| 1080p50 → 1080i50 (HFR-PAL) | High frame-rate to interlaced | HFR PAL playout |
| 1080i50 → 1080p25 (Deinterlace) | Interlaced to progressive | OTT / streaming output |

**Step 2 — Format Matrix**

- **Preset Slot:** Select one of 64 pre-configured broadcast presets (bitrate, codec, profile), or use **Manual Configuration** to set custom bitrates.
- **Video Bitrate / Audio Bitrate:** Leave blank to inherit preset defaults.

**Step 3 — Destination Matrix**

| Field | Description |
|---|---|
| Stream ID | Unique name for this transcoder pipeline |
| Input Source | Source stream URL |
| Target Host | Destination IP |
| Port | Destination port |

Click **INITIATE TRANSCODE** to start.

### Running Pipelines

Active transcoder jobs appear as cards with live metrics. Click **Terminate** to stop.

---

## 6. Multicast Panel

Forwards MPEG-TS multicast streams via `eno2`.

> All destination addresses must be within `239.100.25.0/26`.

### Start a Forwarder

| Field | Description |
|---|---|
| Forwarder ID | Unique name |
| Source URL | Input multicast (e.g. `udp://239.0.0.1:5000`) |
| Destination IP | Must be within `239.100.25.0/26` |
| Destination Port | UDP port |

The panel also displays the current multicast NIC configuration (`eno2`, subnet, TTL).

---

## 7. TS Analyser

Probes any MPEG-TS stream and displays the full PAT/PMT/PID tree.

1. Enter a stream URL (e.g. `udp://239.0.0.1:5000`)
2. Click **Analyse**
3. The panel displays:
   - Programme Association Table (PAT)
   - Programme Map Tables (PMT) per service
   - All PIDs with type, codec, bitrate, and language

Useful for verifying DVB compliance and diagnosing multiplexer issues.

---

## 8. Confidence Monitor

Provides a real-time health overview of all active streams and transcoders.

- Green indicator — stream healthy, bitrate nominal
- Amber — bitrate deviation detected
- Red — stream error or packet loss threshold exceeded

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Status shows **OFFLINE** | Backend not running | Run `npm start` or `docker-compose up -d` |
| 500 errors on all API calls | Backend crashed or not started | Check terminal for errors; restart backend |
| Blank page | Vite dev server not running | Run `cd web && npm run dev` |
| Multicast route error | `eno2` route not configured | Run `sudo bash scripts/setup-host.sh` |
| Stream fails to start | FFmpeg not installed | Run `sudo apt install ffmpeg` on server |
| EPERM on node_modules | Stale Docker-owned files | Run `sudo rm -rf node_modules && npm install` |

---

*Labotech is designed for HPE DL360 running Ubuntu Server with Docker.*

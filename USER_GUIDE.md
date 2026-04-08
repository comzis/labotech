# Labotech User Guide

**DVB-IP Stream Processor & Management System**

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Server Setup](#2-server-setup)
3. [Ubuntu Optimisation for Broadcast Processing](#3-ubuntu-optimisation-for-broadcast-processing)
4. [Starting the Application](#4-starting-the-application)
5. [Streams Panel](#5-streams-panel)
6. [Transcode Panel](#6-transcode-panel)
7. [Multicast Panel](#7-multicast-panel)
8. [TS Analyser](#8-ts-analyser)
9. [Confidence Monitor](#9-confidence-monitor)
10. [Alarm and Event Log](#10-alarm-and-event-log)
11. [Engineering Support Manual](#11-engineering-support-manual)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. System Overview

Labotech manages broadcast-grade SRT encapsulation, 1080p↔1080i conversion, multicast forwarding, and MPEG-TS stream analysis from a single web interface.

**Network layout:**

| Interface | Role | IP |
|---|---|---|
| `eno1` | Management — Web UI & API | `<server-ip>` |
| `eno2` | Multicast — no IP assigned | all `239.0.0.0/8` traffic |

- **Web UI / API:** `http://<server-ip>:4000`
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
# Edit .env for your deployment before first start.
```

For local frontend development, also create a web env file:

```bash
cp web/.env.example web/.env
# Edit web/.env credentials/metadata as needed for local dev.
```

### 2.1 Environment variables quick reference

Root `.env` (backend/runtime):

- **Required:** `API_HOST`, `API_PORT`, `MANAGEMENT_NIC`, `MULTICAST_NIC`, `FORWARD_MULTICAST_SUBNET`
- **Security-sensitive:** `SRT_PASSPHRASE`, `VITE_ADMIN_PASS`, `VITE_OPS_PASS` (never commit real values)
- **Common optional:** `LABOTECH_RELEASE`, `MONITORING_POLICY_PROFILE`, `THUMBNAIL_INTERVAL_SEC`
- **Advanced optional:** ETR tuning (`ETR290_*`), input/probe tuning (`TS_INPUT_*`, `TSDUCK_MONITOR_INTERVAL_MS`), event-log tuning (`EVENT_LOG_*`)

Frontend `web/.env` (Vite build-time):

- `VITE_ADMIN_PASS`, `VITE_OPS_PASS`
- `VITE_APP_VERSION`, `VITE_RELEASE_VERSION`, `VITE_BUILD_TIME_UTC`
- `VITE_THUMB_INTERVAL_MS`

Notes:

- `VITE_*` variables are bundled into frontend assets at build time.
- Keep real passwords only in local/server `.env` files; do not commit secrets.

---

## 3. Ubuntu Optimisation for Broadcast Processing

These steps should be applied once on the HPE DL360 Ubuntu Server to ensure low-latency, high-throughput FFmpeg performance for live broadcast workloads.

### 3.1 Install FFmpeg

```bash
sudo apt update
sudo apt install -y ffmpeg
ffmpeg -version   # verify — must be 4.x or later
```

For best H.264 performance, build FFmpeg with `--enable-libx264`:

```bash
sudo apt install -y libx264-dev libx265-dev
# or use a pre-built PPA with full codec support:
sudo add-apt-repository ppa:savoury1/ffmpeg4
sudo apt update && sudo apt install -y ffmpeg
```

### 3.2 CPU Governor — Performance Mode

Sets all CPU cores to maximum clock speed, eliminating frequency-scaling latency during encoding:

```bash
sudo apt install -y cpufrequtils
echo 'GOVERNOR="performance"' | sudo tee /etc/default/cpufrequtils
sudo systemctl restart cpufrequtils

# Verify
cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor
```

### 3.2b One-command host optimization profile (recommended)

Use the bundled script for combined kernel/network/CPU baseline tuning:

```bash
sudo bash scripts/optimize-host-v2.sh
sudo bash scripts/check-routes.sh
```

Rollback:

```bash
sudo bash scripts/rollback-host-optimization-v2.sh
```

### 3.3 Network Buffer Tuning

Prevents UDP packet drops on high-bitrate multicast and SRT streams:

```bash
sudo tee /etc/sysctl.d/99-labotech.conf << 'EOF'
# Increase UDP receive/send buffers (128 MB)
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.core.rmem_default = 26214400
net.core.wmem_default = 26214400

# Increase network device backlog queue
net.core.netdev_max_backlog = 50000

# UDP socket buffer limits
net.ipv4.udp_rmem_min = 8192
net.ipv4.udp_wmem_min = 8192

# Multicast — allow multiple sockets to bind same port
net.ipv4.ip_local_port_range = 1024 65535

# Reduce TCP TIME_WAIT for SRT control connections
net.ipv4.tcp_tw_reuse = 1
EOF

sudo sysctl -p /etc/sysctl.d/99-labotech.conf
```

### 3.4 Disable IRQ Balancing & Pin NICs to Cores

On the HPE DL360, binding `eno2` interrupts to dedicated CPU cores reduces packet processing jitter:

```bash
sudo apt install -y irqbalance
sudo systemctl stop irqbalance
sudo systemctl disable irqbalance

# Find eno2 IRQ numbers
grep eno2 /proc/interrupts

# Pin each IRQ to a specific core (e.g. core 4)
# Replace <IRQ_NUM> with values from above
echo 4 | sudo tee /proc/irq/<IRQ_NUM>/smp_affinity_list
```

### 3.5 Real-Time Scheduling for FFmpeg

Allows FFmpeg processes to use real-time CPU scheduling, preventing frame drops under load:

```bash
# Add the labotech service user to the realtime group
sudo groupadd -f realtime
sudo usermod -aG realtime $USER

# Set RT limits
sudo tee /etc/security/limits.d/99-realtime.conf << 'EOF'
@realtime   soft  rtprio  99
@realtime   hard  rtprio  99
@realtime   soft  memlock unlimited
@realtime   hard  memlock unlimited
EOF
```

Reboot or re-login for limits to take effect.

### 3.6 Disable Unnecessary Services

Free CPU and memory by stopping services not needed on a dedicated encoder:

```bash
sudo systemctl disable --now snapd
sudo systemctl disable --now unattended-upgrades
sudo systemctl disable --now ModemManager
sudo systemctl disable --now avahi-daemon
```

> **Note:** If you see `Failed to disable unit: Unit file avahi-daemon.service does not exist`, `avahi-daemon` is not installed — this is normal on a minimal Ubuntu Server image and can be safely ignored.

### 3.7 Hugepages (Optional — for high channel counts)

Reduces TLB pressure when running 10+ simultaneous FFmpeg processes:

```bash
# Allocate 512 x 2MB hugepages (1 GB total)
echo 512 | sudo tee /proc/sys/vm/nr_hugepages

# Make persistent
echo 'vm.nr_hugepages = 512' | sudo tee -a /etc/sysctl.d/99-labotech.conf
```

### 3.8 Verify Optimisations

```bash
# CPU governor
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
# → performance

# Network buffers
sysctl net.core.rmem_max
# → 134217728

# FFmpeg can access real-time priority
ulimit -r
# → 99
```

---

## 4. Starting the Application

### Production (Docker)

```bash
docker-compose up -d
```

The UI is then available at `http://<server-ip>:4000`.

### Production (without Docker)

```bash
npm install
npm start
```

The UI is then available at `http://<server-ip>:4000`.

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

## 5. Streams Panel

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
| Adapter / Bind IP | Source NIC binding (use `<server-ip>` for eno1) |
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
- Input bitrate provenance (`inputBitrateSource`) for live feeds:
  - `srt-stats` (live SRT rate)
  - `bitrate-watcher` (UDP/RTP periodic remux measurement)
  - `proxy-output` (passthrough fallback)
  - startup metadata paths when available

Click **Stop** to terminate a channel.

---

## 6. Transcode Panel

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

## 7. Multicast Panel

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

## 8. TS Analyser

Probes any MPEG-TS stream and displays the full PAT/PMT/PID tree.

1. Enter a stream URL (e.g. `udp://239.0.0.1:5000`)
2. Click **Analyse**
3. The panel displays:
   - Programme Association Table (PAT)
   - Programme Map Tables (PMT) per service
   - All PIDs with type, codec, bitrate, and language
   - Health summary (`dvb.health.score`, `dvb.health.severity`, `dvb.health.reasons`)
   - Timestamp discontinuity counters (`dvb.timestampDiscontinuity`)
   - Continuity Counter error counters (`dvb.continuityCounterErrors`)
   - Arrival telemetry provenance (`dvb.arrival.captureMethod`) for IAT/jitter/loss:
     - `tshark` / `tcpdump` = NIC-capture
     - `tsduck` = analyser-derived
     - `unavailable` = capture tool missing
   - Optional Dolby E adapter diagnostics (`dvb.dolbyE`) when enabled

Useful for verifying DVB compliance and diagnosing multiplexer issues.

When a PID bitrate cell shows `(est.)`, it indicates TS remainder allocation to an unresolved video PID, not a direct per-PID measured bitrate.

---

## 9. Confidence Monitor

Provides a real-time health overview of all active streams and transcoders.

- Green indicator — stream healthy, bitrate nominal
- Amber — bitrate deviation detected
- Red — stream error or packet loss threshold exceeded

---

## 10. Alarm and Event Log

`Alarm Log` is the operational event console for all engine functions (encoder, transcoder, multicast, decoder/analyser, ETR).

### What it shows

- UTC timestamp per event
- Instance ID (exact stream/transcoder/decoder/forwarder/monitor)
- Severity (`critical`, `warning`, `info`)
- Status (`alarm`, `error`, `no-signal`, `failover`, `started`, `stopped`, `info`)
- Explanatory event title and details

### Operator controls

- Severity filter
- Text search (instance/message/status)
- **Clear** log (resets active view and backend ring)
- **Download JSONL** and **Download CSV** for incident handover/reporting

### Persistence behavior

- Events are persisted by backend to `logs/events.jsonl`
- UI seeds from `GET /api/events` on load/reconnect
- Expected no-signal probe faults are logged as status context and are not promoted as repeated popup alarms

---

## 11. Engineering Support Manual

For deployment, rollback, TS analysis accuracy path (`tsduck` + fallback), Stream View timeline operation, multiview refresh behavior, and production troubleshooting workflows, use:

- `docs/engineering-support-manual.md`
- `docs/ui-hardening-and-20227-worklog.md` (latest decoder/multiview/2022-7 implementation and validation log)

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Cannot connect to UI | Wrong IP in browser | Use `http://<server-ip>:4000` where `<server-ip>` is your eno1 address |
| Status shows **OFFLINE** | Backend not running | Run `npm start` or `docker-compose up -d` |
| 500 errors on all API calls | Backend crashed or not started | Check terminal for errors; restart backend |
| Blank page | Vite dev server not running | Run `cd web && npm run dev` |
| Multicast route error | `eno2` route not configured | Run `sudo bash scripts/setup-host.sh` |
| Stream fails to start | FFmpeg not installed | Run `sudo apt install ffmpeg` on server |
| IAT lane shows analyser-derived/unavailable | NIC capture tool missing | Install `tshark` or `tcpdump` and verify with `which tshark \|\| which tcpdump` |
| EPERM on node_modules | Stale Docker-owned files | Run `sudo rm -rf node_modules && npm install` |

---

*Labotech is designed for HPE DL360 running Ubuntu Server with Docker.*

# Labotech API Reference

**Base URL:** `http://<YOUR_SERVER_IP>:4000`
**Version:** v3.1.91
**Protocol:** REST (JSON) + WebSocket

---

## Contents

1. [Health](#health)
2. [Streams (SRT Encapsulator)](#streams)
3. [Transcode](#transcode)
4. [Multicast Forward](#multicast-forward)
5. [Analyse (TS Decoder/Monitor)](#analyse)
6. [ETR 290](#etr-290)
7. [Pipeline](#pipeline)
8. [SCTE-35](#scte-35)
9. [Events Log](#events-log)
10. [Multiview](#multiview)
11. [WebSocket Protocol](#websocket-protocol)
12. [Error Responses](#error-responses)

---

## Health

### `GET /health`

Returns server status, tooling availability, and system telemetry.

**Response `200`**
```json
{
  "status": "ok",
  "version": "3.1.91",
  "release": "v3.1.91",
  "uptime": 3721.4,
  "streams": 2,
  "telemetry": {
    "cpuPercent": 12.3,
    "load1m": 0.85,
    "memoryPercent": 34.1,
    "memoryUsedMB": 2731,
    "memoryTotalMB": 8001,
    "processRssMB": 142,
    "heapUsedMB": 67
  },
  "tooling": {
    "status": "ready",
    "tools": {
      "ffmpeg":     { "available": true,  "version": "6.1" },
      "ffprobe":    { "available": true,  "version": "6.1" },
      "tsanalyze":  { "available": true,  "version": "3.37" },
      "tshark":     { "available": true,  "version": "4.2.0" },
      "tcpdump":    { "available": true },
      "nicCapture": { "available": true }
    }
  },
  "monitoringPolicy": { ... }
}
```

---

## Streams

SRT encapsulation engine. Takes any input (file, SRT, UDP, RTMP) and outputs SRT, UDP, or RTP.

### `GET /streams`

List all active streams.

**Response `200`** — array of stream objects.

---

### `POST /streams`

Start a new SRT encapsulator stream.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique stream ID |
| `input` | string | ✓ | Input URL (`srt://`, `udp://`, `rtp://`, `rtmp://`, file path) |
| `host` | string | ✓* | Output destination host/IP (*required unless `outputMode=null`) |
| `port` | number | ✓* | Output destination port |
| `outputMode` | string | | `srt` (default), `udp`, `rtp`, `null` |
| `latency` | number | | SRT latency in ms (default 2000) |
| `passphrase` | string | | SRT encryption passphrase |
| `streamId` | string | | SRT stream ID |
| `videoBitrate` | string | | e.g. `"8M"` |
| `videoCodec` | string | | `h264`, `hevc`, `copy` |
| `audioCodec` | string | | `aac`, `mp2`, `copy` |
| `audioBitrate` | string | | e.g. `"192k"` |
| `audioPairs` | array | | Per-pair audio config: `[{ codec, bitrate, channels }]` |
| `rateMode` | string | | `cbr` or `vbr` |
| `preset` | string | | FFmpeg preset (`fast`, `medium`, etc.) |
| `profile` | string | | H.264 profile (`high`, `main`, `baseline`) |
| `gopSize` | number | | GOP size in frames |
| `pixFmt` | string | | Pixel format (`yuv420p`, etc.) |
| `ttl` | number | | UDP/RTP multicast TTL |
| `localAddr` | string | | Local bind address for output |
| `inputLocalAddr` | string | | Local bind address for SRT input |
| `serviceId` | number | | DVB service ID |
| `transportStreamId` | number | | MPEG-TS transport stream ID |
| `originalNetworkId` | number | | DVB original network ID |
| `pmtPid` | number | | PMT PID override |
| `videoPid` | number | | Video PID override |
| `serviceName` | string | | DVB service name |
| `serviceProvider` | string | | DVB service provider |

**Response `201`** — stream object
**Response `400`** — validation error
**Response `409`** — ID already exists

---

### `GET /streams/:id`

Get a single stream by ID.

**Response `200`** — stream object
**Response `404`** — not found

---

### `DELETE /streams/:id`

Stop and remove a stream. Waits up to 5 s for clean shutdown.

**Response `200`**
```json
{ "stopped": "my-stream-id" }
```

---

## Transcode

Interlace/format conversion engine (1080p↔1080i). Uses the same FFmpeg pipeline as Streams with added transcode presets.

### `GET /transcode/presets`

List available interlace conversion presets.

**Response `200`**
```json
[
  { "key": "pal",        "name": "1080p25 → 1080i50",       "inputFps": 25,    "outputFps": 50,    "interlaced": true },
  { "key": "ntsc",       "name": "1080p29.97 → 1080i59.94", "inputFps": 29.97, "outputFps": 59.94, "interlaced": true },
  { "key": "hfr-pal",   "name": "1080p50 → 1080i50",        "inputFps": 50,    "outputFps": 50,    "interlaced": true },
  { "key": "deinterlace","name": "1080i50 → 1080p25",        "inputFps": 50,    "outputFps": 25,    "interlaced": false }
]
```

---

### `GET /transcode/broadcast-presets`

List output format preset slots from `config/presets.json` (64 slots).

**Response `200`** — array of preset slot objects.

---

### `GET /transcode`

List all active transcoders.

---

### `POST /transcode`

Start a transcoder. Same fields as `POST /streams` plus:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | |
| `input` | string | ✓ | |
| `host` | string | ✓ | |
| `port` | number | ✓ | |
| `transcodePreset` | string | | Interlace preset key (`pal`, `ntsc`, `hfr-pal`, `deinterlace`) |
| `broadcastPresetSlot` | number | | Slot index from `config/presets.json` (0–63) |

**Response `201`** — transcoder object
**Response `400`** — validation error
**Response `409`** — ID conflict

---

### `GET /transcode/:id`

Get transcoder status.

---

### `DELETE /transcode/:id`

Stop transcoder.

**Response `200`**
```json
{ "stopped": "my-transcoder-id" }
```

---

## Multicast Forward

Re-outputs any input stream as RTP/UDP multicast on `<multicast-nic>` (`<multicast-forward-subnet>`).

### `GET /multicast/config`

Returns the active multicast configuration.

**Response `200`**
```json
{
  "nic":     "<multicast-nic>",
  "subnet":  "<multicast-forward-subnet>",
  "address": "<multicast-forward-ip>",
  "ttl":     10
}
```

---

### `GET /multicast/forward`

List all active forwarders.

---

### `POST /multicast/forward`

Start a multicast forwarder.

> **Engineer approval required.** Only one forwarder allowed simultaneously. Destination must match `<multicast-forward-ip>` (or configured policy if pinning is disabled).

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique forwarder ID |
| `sourceUrl` | string | ✓ | Input URL (`udp://`, `rtp://`, `srt://`) |
| `destIp` | string | ✓ | Must match allowed multicast policy (default pinned to `<multicast-forward-ip>`) |
| `destPort` | number | | Destination port (default 1234) |
| `nic` | string | | Output NIC (default `<multicast-nic>`) |
| `ttl` | number | | Multicast TTL (default 10) |
| `engineerApproved` | boolean | ✓ | Must be `true` — safety interlock |

**Response `201`** — forwarder object
**Response `400`** — validation / route error
**Response `403`** — approval missing or wrong destination
**Response `409`** — ID conflict or duplicate destination
**Response `429`** — forwarder limit reached (1 max)

---

### `GET /multicast/forward/:id`

Get forwarder status.

---

### `DELETE /multicast/forward/:id`

Stop forwarder. Waits for clean shutdown.

**Response `200`**
```json
{ "stopped": "my-forwarder-id" }
```

---

## Analyse

Continuous MPEG-TS analysis engine. One analyser per decoder. Manages thumbnails, ETR 290 probe, IAT sniffer, tsanalyze, and ffprobe internally. For SRT sources, automatically starts an **SRTRelay** to avoid single-listener slot conflicts.

### `GET /analyse`

With no query parameters: list all active analysers.
With `?url=...`: run a **one-shot probe** on the given URL and return immediately.

**One-shot probe response `200`**
```json
{
  "url": "rtp://<multicast-forward-ip>:6501",
  "bitrate": 18157000,
  "programs": [ ... ],
  "streams": [ ... ],
  "pids": [ ... ]
}
```

---

### `POST /analyse/start`

Start continuous monitoring for a decoder.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Unique analyser ID (conventionally matches the decoder ID) |
| `url` | string | ✓ | Source URL (`srt://`, `rtp://`, `udp://`) |
| `interval` | number | | Probe interval in ms (default: policy-driven, ~30–60 s) |
| `nicName` | string | | NIC for IAT sniffer (default: `<multicast-nic>`) |

> **SRT sources:** The relay starts automatically. `effectiveUrl` switches to `udp://127.0.0.1:PORT` (djb2-hashed from the SRT URL, range 5500–5599). All internal consumers use the relay's UDP copy — no slot contention.

**Response `201`** — analyser object
**Response `400`** — missing fields
**Response `409`** — ID already exists

---

### `GET /analyse/:id`

Get analyser status including last probe result, health, and thumbnail URL.

**Response `200`** — analyser object

---

### `DELETE /analyse/:id`

Stop analyser, remove thumbnail file.

**Response `200`**
```json
{ "stopped": "decoder-1234567890" }
```

---

## ETR 290

DVB ETR 290 compliance monitor. Checks Priority 1/2/3 alarms in real-time.

> **SRT sources:** ETR290 now works transparently when the decoder's SRT relay is active. The relay's local UDP copy is used automatically. If no relay is present yet (decoder not started), start the decoder first.

### `GET /etr290`

List all active ETR 290 monitors.

---

### `GET /etr290/profiles`

List saved ETR 290 alarm threshold profiles.

---

### `POST /etr290/profiles`

Save a named ETR 290 threshold profile.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | ✓ | Profile name |
| `description` | string | | Human-readable description |
| `config` | object | | Threshold overrides (see `PUT /etr290/:id/config`) |

**Response `201`** — saved profile object

---

### `DELETE /etr290/profiles/:name`

Delete a saved profile.

**Response `200`** `{ "deleted": "profile-name" }`
**Response `404`** — not found

---

### `POST /etr290/start`

Start ETR 290 monitoring.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Monitor ID. Convention: `etr-<analyserID>` so the orphan watchdog can auto-stop when the decoder stops |
| `url` | string | ✓ | Source URL. SRT is redirected to relay if available; returns 422 if relay not ready |
| `nicName` | string | | NIC name for capture (default `<multicast-nic>`) |
| `profileName` | string | | Apply a saved profile as base config |
| `config` | object | | Threshold overrides merged on top of profile |

**Response `201`** — ETR monitor object
**Response `400`** — validation error
**Response `404`** — profile not found
**Response `409`** — ID conflict
**Response `422`** — SRT source with no relay available; start the decoder first

---

### `GET /etr290/:id`

Get ETR 290 monitor status and current alarm state.

---

### `PUT /etr290/:id/config`

Update alarm thresholds on a running monitor. Takes effect immediately.

**Request body**

| Field | Type | Description |
|---|---|---|
| `config` | object | Threshold fields (e.g. `{ "ccWarnCount": 3, "ccCriticalCount": 8 }`) |
| `profileName` | string | Apply saved profile as base, then merge `config` on top |

**Response `200`** — updated monitor object

---

### `DELETE /etr290/:id`

Stop and remove ETR 290 monitor.

**Response `200`** `{ "stopped": "etr-decoder-1234" }`

---

## Pipeline

Creates a linked 3-stage pipeline: SRT encapsulator → transcoder (optional) → multicast forward (optional). Rolls back all stages on any failure.

### `POST /pipeline`

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | ✓ | Pipeline ID prefix. Stages get IDs `{id}-enc`, `{id}-tc`, `{id}-fwd` |
| `input` | string | ✓ | Source URL |
| `srtHost` | string | ✓ | SRT output host |
| `srtPort` | number | ✓ | SRT output port |
| `transcodePreset` | string | | Interlace preset; omit to skip transcoding |
| `multicastDestIp` | string | | Multicast destination (must match allowed policy, default `<multicast-forward-ip>`) |
| `multicastPort` | number | | Multicast port |
| `enableForward` | boolean | | Must be `true` to activate multicast stage |
| `engineerApproved` | boolean | | Required when `enableForward=true` |
| `videoBitrate` | string | | e.g. `"8M"` |
| `audioBitrate` | string | | e.g. `"192k"` |
| `passphrase` | string | | SRT passphrase |

**Response `201`**
```json
{
  "id": "my-pipeline",
  "stages": [
    { "stage": "encoder",    "id": "my-pipeline-enc" },
    { "stage": "transcoder", "id": "my-pipeline-tc" },
    { "stage": "multicast",  "id": "my-pipeline-fwd" }
  ]
}
```

---

## SCTE-35

### `POST /scte35/splice`

Build a SCTE-35 splice insert payload.

**Request body**

| Field | Type | Description |
|---|---|---|
| `spliceEventId` | number | Unique splice event ID |
| `outOfNetwork` | boolean | `true` = out-of-network indicator |
| `duration` | number | Break duration in 90kHz ticks |
| `ptsTime` | number | PTS splice time in 90kHz ticks |
| `uniqueProgramId` | number | |
| `availNum` | number | |
| `availsExpected` | number | |

**Response `200`**
```json
{
  "status": "injected",
  "payload": "<base64-encoded SCTE-35 section>"
}
```

---

## Events Log

Ring buffer of the last 1000 non-telemetry events (alarms, state changes, errors).

### `GET /api/events`

**Response `200`** — array of event objects, newest first.

```json
[
  {
    "type": "health_alarm",
    "id": "decoder-1234567890",
    "severity": "critical",
    "reason": "CC errors above threshold",
    "ts": 1710766800000
  }
]
```

---

## Multiview

### `GET /api/multiview`

Get multiview layout configuration.

### `POST /api/multiview`

Save multiview layout configuration.

---

## WebSocket Protocol

Connect to `ws://<YOUR_SERVER_IP>:4000`.

On connect the server sends:
```json
{ "type": "connected", "uptime": 3721.4 }
```

### Inbound message types (server → client)

| Type | Frequency | Description |
|---|---|---|
| `connected` | once | Connection confirmation |
| `stats` | ~1 s | SRT encapsulator stats (`bitrate`, `rtt`, `dropped`, etc.) |
| `srtStats` | ~1 s | SRT link layer stats |
| `transcode_stats` | ~1 s | Transcoder stats |
| `multicast_stats` | ~1 s | Multicast forwarder stats |
| `analyse_result` | 5–60 s | Full TS probe result for a decoder |
| `health_alarm` | on transition | Severity change (ok→warn→critical or back). Persisted to event log. |
| `etr290_status` | ~1 s | Full ETR 290 alarm state for a monitor |
| `etr290_alarm` | on alarm | Single ETR alarm event |
| `etr290_incident_started` | on alarm | ETR incident opened |
| `etr290_incident_updated` | on alarm | ETR incident updated |
| `etr290_incident_cleared` | on clear | ETR incident resolved |
| `analyse_started` | on start | Analyser started |
| `analyse_stopped` | on stop | Analyser stopped |
| `etr290_stopped` | on stop | ETR monitor stopped |
| `thumbnail_frame` | variable | New thumbnail available `{ id, url, path }` |
| `info` | variable | Informational message from any engine |
| `error` | on error | Engine error `{ id, message }` |
| `stopped` | on stop | SRT stream stopped |
| `transcode_stopped` | on stop | Transcoder stopped |
| `multicast_stopped` | on stop | Multicast forwarder stopped |

> `stats`, `analyse_result`, and `etr290_status` are high-frequency telemetry and are **not** persisted to the event log. All other types are logged.

### `analyse_result` payload

```json
{
  "type": "analyse_result",
  "id": "decoder-1234567890",
  "probeTime": 1710766800000,
  "bitrate": 18157000,
  "bitrateSource": "tsduck",
  "severity": "ok",
  "health": {
    "score": 95,
    "severity": "ok",
    "reasons": []
  },
  "programs": [
    {
      "programNumber": 1,
      "pmtPid": 256,
      "streams": [
        { "pid": 257, "codecType": "video", "codecName": "h264", "width": 1920, "height": 1080 },
        { "pid": 258, "codecType": "audio", "codecName": "aac",  "channels": 2, "sampleRate": 48000 }
      ]
    }
  ],
  "iat": { "p95Ms": 12.4, "p99Ms": 18.1, "jitterMs": 2.1, "lossRate": 0 },
  "cc": { "ccErrors": 0, "severity": "ok" },
  "thumbnailUrl": "/logs/thumbnails/decoder-1234567890.jpg?t=1710766800000"
}
```

### `health_alarm` payload

```json
{
  "type": "health_alarm",
  "id": "decoder-1234567890",
  "severity": "warn",
  "previousSeverity": "ok",
  "reason": "IAT P95 above warn threshold (48 ms > 30 ms)",
  "ts": 1710766800000
}
```

---

## Error Responses

All errors return JSON:

```json
{ "error": "Human-readable description" }
```

| Code | Meaning |
|---|---|
| `400` | Bad request — missing or invalid field |
| `403` | Forbidden — engineer approval missing or destination not allowed |
| `404` | Resource not found |
| `409` | Conflict — ID already exists or duplicate destination |
| `422` | Unprocessable — SRT ETR with no relay available |
| `429` | Too many — forwarder limit reached |
| `500` | Internal server error |

---

## Environment Variables

Key env vars that affect API behaviour:

| Variable | Default | Description |
|---|---|---|
| `API_HOST` | `<YOUR_SERVER_IP>` | Bind address — never change to `0.0.0.0` |
| `API_PORT` | `4000` | Listen port |
| `MULTICAST_NIC` | `<multicast-nic>` | Multicast output NIC |
| `FORWARD_MULTICAST_SUBNET` | `<multicast-forward-subnet>` | Allowed multicast subnet |
| `FORWARD_MULTICAST_IP` | `<multicast-forward-ip>` | Pinned multicast destination |
| `MULTICAST_TTL` | `10` | Multicast TTL |
| `RESTORE_STREAMS_ON_BOOT` | `false` | Auto-restore encapsulators on container start |
| `RESTORE_TRANSCODERS_ON_BOOT` | `false` | Auto-restore transcoders on container start |
| `RESTORE_FORWARDERS_ON_BOOT` | `false` | Auto-restore multicast forwarders on container start |
| `ETR_ORPHAN_GRACE_MS` | `15000` | Grace period before stopping orphan ETR monitors |
| `TS_HEAVY_PROBE_MAX_CONCURRENT` | `3` | Max concurrent heavy probe processes |
| `THUMBNAIL_MAX_CONCURRENT` | `2` | Max concurrent thumbnail captures |
| `LABOTECH_RELEASE` | git describe | Release string shown in `/health` |

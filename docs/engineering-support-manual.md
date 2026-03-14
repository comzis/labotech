# Engineering Support Manual

## Purpose

This manual is the operator and engineering runbook for LABOTECH support workflows:

- Safe deployment and rollback
- Decoder and multiview refresh behavior
- TS analysis accuracy path (NIC-capture preferred for arrival telemetry, `tsduck` and metadata fallback supported)
- Optional Dolby E external decoder adapter deployment and verification
- Stream View timeline usage
- Common production troubleshooting patterns

---

## 1) Deployment and Verification

### Standard production upgrade

Run from the LABOTECH repo on the target server:

```bash
cd ~/LaboTech/labotech
bash scripts/upgrade-prod.sh HEAD
```

Deploy a specific ref:

```bash
bash scripts/upgrade-prod.sh <tag-or-commit>
```

### Post-upgrade checks

```bash
systemctl is-active labotech
curl -fsS http://10.67.18.29:4000/health
bash scripts/preflight-monitoring-tools.sh 10.67.18.29 4000
bash scripts/post-deploy-smoke.sh 10.67.18.29 4000
```

### Fast production recovery (UI/features missing after deploy)

If tabs/features disappear after deployment (for example missing `TS Analyser`, `Multiview`, `API`, or `Stream View`), run:

```bash
cd ~/LaboTech/labotech
bash scripts/recover-prod-fast.sh origin/main
```

This flow:

- fetches and checks out the target ref
- verifies key UI component files and tab IDs exist
- rebuilds backend/frontend dependencies
- recreates Docker stack with `docker compose`
- validates `/health`

If health fails:

```bash
sudo journalctl -u labotech -n 200 --no-pager
```

---

## 2) TS Analysis Accuracy Strategy

LABOTECH uses a layered approach:

1. NIC packet-capture worker (`IATSniffer`) using `tshark` or `tcpdump` for IAT/jitter/loss telemetry in continuous mode
2. `tsduck` (`tsanalyze --json`) for transport/SI enrichment
3. FFmpeg transport bitrate probe as fallback
4. ffprobe metadata paths for compatibility

The UI labels bitrate provenance with `dvb.bitrateSource`:

- `tsduck` (preferred)
- `measured` (FFmpeg remux timing)
- `format` or `streams` (fallback metadata paths)

Arrival telemetry provenance is exposed with `dvb.arrival.captureMethod`:

- `tshark` or `tcpdump` when NIC capture is active
- `tsduck` when analyser-derived arrival telemetry is used
- `unavailable` when capture tools are missing

### Current behavior in continuous mode

To reduce multiview lag:

- Continuous probes run on fixed target cadence.
- Heavy transport and SI sampling are executed every few cycles.
- Lightweight cycles continue to update service/audio/thumbnail data.
- Scheduler cadence is exposed in analyser diagnostics (`dvb.probeDiagnostics.scheduler`).

This reduces perceived UI lag while preserving periodic ground-truth sampling.

### Phase 4 operator clarity indicators

Operator dashboards now expose:

- `Rate confidence` (`TRUSTED` / `FALLBACK` / `UNKNOWN`)
- `Probe method` (`NIC-tshark`, `NIC-tcpdump`, `ANALYSER`, `UNAVAILABLE`)
- Active policy profile and heavy-probe cadence summary

This allows quick triage of whether bitrate/arrival values come from wire capture or fallback estimators.

---

## 3) Capture Tool and `tsduck` Installation

### NIC capture tools (`tshark` / `tcpdump`)

Install one of the packet-capture tools for analyser IAT forensics:

```bash
sudo apt update
sudo apt install -y tshark tcpdump
```

Verify:

```bash
which tshark || which tcpdump
```

If neither tool is installed, LABOTECH remains operational and marks arrival telemetry as analyser-derived/unavailable in diagnostics.

### Container parity check (host vs runtime)

When running with Docker, verify tools inside the running service container, not only on host:

```bash
docker compose exec labotech sh -lc 'which ffmpeg ffprobe tsanalyze tshark tcpdump || true'
docker compose exec labotech sh -lc 'ffmpeg -version | sed -n "1p"; ffprobe -version | sed -n "1p"'
```

Host and container can differ. `/health` reports what the service process sees at runtime.

### `tsduck` installation

### APT package available

```bash
sudo apt update
sudo apt install -y tsduck
tsanalyze --version
```

### If APT cannot locate `tsduck`

If you see:

- `E: Unable to locate package tsduck`
- `tsanalyze: command not found`

Use source build:

```bash
sudo apt update
sudo apt install -y git build-essential pkg-config python3 curl

cd /tmp
git clone https://github.com/tsduck/tsduck.git
cd tsduck

scripts/install-prerequisites.sh
make -j"$(nproc)" default
sudo make install

hash -r
tsanalyze --version
```

Note: LABOTECH remains operational without `tsduck`; it will use fallback probes.

---

### 3.1) Optional Dolby E External Decoder Adapter

LABOTECH supports Dolby E via an optional external decoder adapter. This path is intentionally non-fatal:

- If disabled/unconfigured, core TS analysis remains operational.
- If enabled and decoder is unavailable, Dolby E diagnostics report degraded state in analyser telemetry.

#### Requirements

1. Use a Linux executable/script as decoder command target.
2. Decoder must be callable by the LABOTECH runtime user (`boro` in systemd installs).
3. Prefer JSON output from decoder for deterministic parsing.

#### Environment configuration

Add to `.env`:

```bash
DOLBYE_ENABLED=true
DOLBYE_DECODER_PATH=/usr/local/bin/dolbye-decoder
# Preferred (exact tokenization):
DOLBYE_DECODER_ARGS_JSON=["--input","{url}","--json"]
# Fallback template if *_JSON is empty:
# DOLBYE_DECODER_ARGS=--input {url} --json
DOLBYE_DECODER_TIMEOUT_MS=4000

# Optional strict policy:
DOLBYE_REQUIRED_WHEN_DETECTED=true
```

Decoder output (recommended JSON shape):

```json
{
  "detected": true,
  "decoded": true,
  "frameCount": 128,
  "programConfig": "5.1+2",
  "ok": true
}
```

#### Install/permission checks

```bash
sudo install -m 0755 /path/to/vendor-decoder /usr/local/bin/dolbye-decoder
sudo -u boro /usr/local/bin/dolbye-decoder --version
```

If the command requires shared libs, verify with:

```bash
ldd /usr/local/bin/dolbye-decoder
```

#### Runtime verification

1. Restart service:

```bash
sudo systemctl restart labotech
```

2. Run an analyser session on known Dolby E content.
3. In TS Analyser / Stream View evidence, validate:
   - `dvb.dolbyE.detected`
   - `dvb.dolbyE.decoded`
   - `dvb.dolbyE.frameCount`
   - `dvb.probeDiagnostics.dolbyE` (`enabled`, `configured`, `ok`, `error`)
4. Confirm health impact appears when Dolby E is detected but not decoded:
   - `dvb.health.reasons` should include Dolby E decode/missing-decoder reason.

#### Failure semantics

- Adapter disabled/unset path: no crash; Dolby E state marked unavailable.
- Decoder command timeout/non-zero exit: no crash; error captured under `dvb.dolbyE.error`.
- Strict mode (`DOLBYE_REQUIRED_WHEN_DETECTED=true`): health score penalized when Dolby E is present but external decode path is not available.

---

## 4) Stream View Operations

`Stream View` provides a horizontal UTC timeline with live status evidence.

### Features

- Multi-lane timeline (per analyser/monitor ID)
- Mouse crosshair and pointer UTC
- Lane status at pointer
- Event evidence panel (bitrate source, SI compliance, arrival metrics)
- Dynamic pointer popup that repositions near cursor to reduce lane occlusion
- Duration-block rendering per lane:
  - compact line blocks represent event persistence windows
  - block color follows severity/category style
- Type legend (ETR alarm / incident / runtime / analyse) uses same shared style source as lane blocks
- Lane baseline color at pointer reflects local severity (critical/warning/ok)

### Controls

- Window: `5m`, `15m`, `1h`
- Scale mode:
  - `Normalized` (per-lane local scaling)
  - `Absolute` (shared global scale across lanes)
- Cursor mode:
  - `Freeze Cursor` to lock current UTC inspection point

### Interpreting IAT/Jitter panels

- IAT/jitter/loss values come from `dvb.arrival`.
- If lane badge shows NIC capture (`tshark`/`tcpdump`), values are derived from raw packet timestamps on the selected NIC.
- If lane badge shows analyser-derived, values come from analyser telemetry fallback.
- If panel says telemetry is unavailable, check probe diagnostics shown in the same lane card:
  - `tsduck attempted`
  - `tsduck available`
  - `tsduck ok`
  - `tsduck error` (if any)
  - `iatSniffer attempted`
  - `iatSniffer captureMethod`
  - `iatSniffer sampleCount`
- Repeated identical status samples are intentionally de-noised in timeline plotting so the view does not look like a synthetic dotted line.

---

## 5) Multiview Operations

`Decoder Multiview` supports continuous live probe cards.

### Refresh behavior

- Refresh interval is configurable per tile provisioning.
- Effective UI freshness depends on:
  - configured interval
  - probe runtime
  - heavy-sample cycle timing

### Freshness indicator

Per-card update age is displayed and updates every second.

- Engineer Mode ON labels:
  - `fresh silicon`
  - `cache warming`
  - `radio silence`
- Engineer Mode OFF labels:
  - `live`
  - `delayed`
  - `stale`

Toggle in Multiview header:

- `Engineer Mode: ON/OFF`

---

## 6) ETR / DVB Diagnostics

### ETR views

- Priority blocks (P1/P2/P3)
- Alarm log
- Live UTC timeline
- Monitor diagnostics (matched line count + last match UTC)

### DVB and PID reliability

LABOTECH merges multiple data sources to improve correctness:

- ffprobe program/global stream merge by index
- ffmpeg PID backfill for missing stream IDs
- optional tsduck enrichment for bitrate/services/PID/SI

If PID count or bitrate appears inconsistent:

1. Confirm active input is stable.
2. Check `bitrateSource` in UI.
3. Validate `tsanalyze --version` on server.
4. Verify analyser interval is not too aggressive for source/network conditions.

PID inventory tables can show `(est.)` on bitrate cells. This marks TS remainder allocation to unresolved video PID rows (computed value, not direct per-PID measurement).

### Health scoring and transport integrity counters

TS analyser publishes a composite health object under `dvb.health`:

- `score` (0–100), `severity` (`ok`/`warning`/`critical`), `reasons[]`
- `sourceConfidence` and effective threshold values

Transport integrity signals included in scoring:

- `dvb.timestampDiscontinuity`:
  - total discontinuities
  - PCR/PTS/DTS/non-monotonous DTS breakdown
- `dvb.continuityCounterErrors`:
  - total CC error count
  - PID-scoped vs generic CC errors

Optional Dolby E adapter signals included when enabled:

- `dvb.dolbyE.detected`
- `dvb.dolbyE.decoded`
- `dvb.dolbyE.frameCount`
- `dvb.probeDiagnostics.dolbyE`

### Encoder input bitrate provenance

For live feeds where startup descriptors are missing, use `inputBitrateSource` to understand origin:

- `srt-stats` for live SRT transport rate
- `bitrate-watcher` for UDP/RTP periodic ffmpeg remux measurement
- `proxy-output` for passthrough (`videoCodec=copy`) fallback
- `stream-descriptor`/startup metadata when available

### ETR monitor truthfulness checks

1. Ensure monitor URL matches the exact path under test (host/port/protocol).
2. For RTP/UDP, set `Input Bind IP` to pin monitor ingress path when required.
3. Compare ETR UI diagnostics with backend logs:
   - rising matched count and recent last-match time should align with observed faults.
4. If transport faults are visible externally but not in UI, confirm monitor is attached to the same multicast group/interface as the external probe.

---

## 7) Troubleshooting Quick Reference

### Port already in use (`EADDRINUSE`)

Symptom:

- service starts then exits immediately
- logs show bind error on `10.67.18.29:4000`

Action:

```bash
sudo ss -ltnp | rg ":4000"
sudo systemctl restart labotech
```

### No thumbnails in multiview

Check:

- analyser is active
- tile has recent probe updates
- filesystem write access to thumbnail directory

### Timeline appears empty

Check:

- WebSocket connected status is online
- at least one analyser/ETR monitor is running
- selected window (`5m`/`15m`/`1h`) contains events

### Dolby E adapter shows unavailable

Check:

- `DOLBYE_ENABLED=true` is present in runtime environment
- `DOLBYE_DECODER_PATH` points to a Linux executable
- service user can execute decoder:

```bash
sudo -u boro "$DOLBYE_DECODER_PATH" --version
```

- `dvb.probeDiagnostics.dolbyE.error` for exact adapter failure

### Dolby E detected but decoded=false

Check:

- input stream is confirmed Dolby E (independent probe/tool)
- decoder args template uses `{url}` placeholder correctly
- decoder timeout is sufficient for probe duration (`DOLBYE_DECODER_TIMEOUT_MS`)
- vendor decoder dependencies are present (`ldd` clean output)

---

## 8) Change-Control Note

For production support:

- Prefer `upgrade-prod.sh` for deterministic upgrades.
- Verify health endpoint after every deployment.
- Run preflight and smoke scripts after deployment:

```bash
bash scripts/preflight-monitoring-tools.sh 10.67.18.29 4000
bash scripts/post-deploy-smoke.sh 10.67.18.29 4000
```

- Keep this manual updated whenever probe cadence, timelines, or TS analysis paths change.

---

## 9) Production Incident Register

### INC-001 — `Uncaught exception: Error: tcpdump exited 1` (2026-03-11)

**Server:** `gva-boro-probe` · **Service:** `labotech[853167]`

**Symptom**

```
Mar 11 11:22:01 gva-boro-probe labotech[853167]: Uncaught exception: Error: tcpdump exited 1
Mar 11 11:22:23 gva-boro-probe labotech[853167]: Uncaught exception: Error: tcpdump exited 1
```

Repeated every ~22 seconds. Service continued running (global `uncaughtException` handler in `src/index.js` logs and swallows), but IAT forensics were non-functional.

**Root cause**

`boro` user lacked `CAP_NET_RAW` capability. `tcpdump` was found via `which` (binary exists), spawned successfully, attempted to open a raw socket on `eno2`, received `Operation not permitted`, and exited with code 1.

Two code bugs amplified this into an uncaught exception:

1. `IATSniffer._spawnCapture()` used `proc.on('exit')` instead of `proc.on('close')`, meaning `stderrBuf` was not fully flushed when the handler fired. The stderr reason was lost, leaving only `"tcpdump exited 1"`.
2. The `emit('error')` path in the exit handler could reach the global Node.js uncaught exception handler under certain Node version / listener timing conditions.

**Fix applied** — commits `1f59ccc`

- `proc.on('exit')` → `proc.on('close')` in `IATSniffer._spawnCapture()` (guarantees stderr flushed before reading).
- Removed `emit('error')` from both the spawn-error and close handlers in `IATSniffer`. A non-zero exit is a permissions/config fault, not a runtime error. `emit('unavailable')` and `lastError` are the correct signal paths.
- Added safety-net `on('error', ...)` listener to `IATSniffer` instance in `TSAnalyser.startContinuous()`. Any residual error is forwarded as an `info` event on `TSAnalyser` (surfaced in UI, not fatal).

**Server-side permanent fix (run once as root)**

```bash
# Grant raw-socket capability to the binary (survives user/group changes)
sudo setcap cap_net_raw+eip /usr/bin/tcpdump

# Verify
getcap /usr/bin/tcpdump
# → /usr/bin/tcpdump cap_net_raw=eip

sudo -u boro tcpdump -i eno2 -c 3 udp -q 2>&1 | head -5
```

Add to `scripts/setup-host.sh` so the capability survives `apt upgrade`:

```bash
setcap cap_net_raw+eip /usr/bin/tcpdump
```

**Verify fix**

```bash
sudo journalctl -u labotech --since "5 min ago" --no-pager | grep -E "Uncaught|tcpdump"
# should return no lines
```

---

### INC-002 — Multiview thumbnail corruption and macroblocking (2026-03-11)

**Symptom**

Multiview tiles showing:
- Corrupted JPEG with colour block artefacts (classic B-frame reference error pattern)
- Tiles blanking to "No Signal" between probe cycles
- Slow refresh (4+ seconds per tile visible lag) under 4+ concurrent decoders

**Root causes**

| # | Cause | Scope |
|---|---|---|
| 1 | `thumbnail=24` at `fps=8` buffered 3 seconds of frames per capture. With 4+ concurrent decoders, 4+ FFmpeg processes competed for CPU and I/O simultaneously | Backend `monitoring.js` |
| 2 | FFmpeg wrote directly to `<id>.jpg`. Browser loaded the file during a concurrent write from the next cycle → partial JPEG read → corruption artefacts | Backend `monitoring.js` |
| 3 | `setThumbFailed(false)` was triggered by `result?.probeTime` (every probe cycle), blanking the tile while the next JPEG was being written | Frontend `DecoderMultiviewPanel.jsx` |
| 4 | FFmpeg attached mid-GOP without skipping B-frames. P/B frames decoded before their I-frame reference produced the coloured block macroblocking pattern | Backend `monitoring.js` |

**Fixes applied** — commits `169af60`, `f2e3f8b`

**Backend `src/monitoring.js`:**

- Concurrency queue: at most 2 simultaneous thumbnail FFmpeg processes (`THUMBNAIL_MAX_CONCURRENT` env, default 2).
- Atomic write: FFmpeg outputs to `<id>.jpg.tmp.jpg` then `fs.rename()` to `<id>.jpg`. Browser never reads a half-written file.
- `-skip_frame noref`: instructs decoder to skip non-reference (B) frames. Eliminates the primary cause of macroblocking — P/B frames decoded before their I-frame is available.
- `select=eq(pict_type\,I)`: filter passes only I-frames to thumbnail selector. I-frames are fully self-contained; no reference dependency, no artefact from broken reference chains.
- `pp=de/de`: H.264 loop deblocking post-processing applied to selected frame before JPEG encode. Smooths DCT block boundaries.
- `hqdn3d=2:2:6:6`: stronger temporal + spatial denoise (was `1.2:1.2:4:4`).
- JPEG quality `qv 3→2` (lower = higher quality in FFmpeg scale).
- `analyzeduration 3s→4s` to cover streams with longer I-frame intervals.

**Frontend `web/src/components/DecoderMultiviewPanel.jsx`:**

- `displaySrc` state tracks the last successfully loaded thumbnail independently. Tile shows last good frame while the next JPEG is being written.
- Probing the new candidate URL with a hidden `Image()` object before committing it to `displaySrc` — avoids flicker from a failed load.
- `thumbFailed` reset only when the thumbnail URL path changes, not on every `probeTime`.
- Audio level meter uses exponential smoothing (`0.75/0.25 blend`) and a 3dB/sample rate limiter to prevent meter jumping.

**Tuning env vars (set in `.env` or `docker-compose`)**

```bash
THUMBNAIL_MAX_CONCURRENT=2     # raise to 3 if CPU headroom allows with 8+ decoders
THUMBNAIL_INTERVAL_SEC=5       # default; increase to 10 on constrained hardware
THUMBNAIL_QUALITY_PROFILE=low  # 320px, qv=5 — use when decoder count >= 8
```

**Known trade-off**

`select=eq(pict_type\,I)` requires `pick=4` I-frames in the analysis window. At a standard 1s GOP this needs ~4s buffering, covered by `analyzeduration=4s`. Streams with longer GOPs (some VBR encoders use 2–3s GOPs) may timeout on first attempt and succeed on retry. If `Thumbnail timeout` appears frequently in logs:

```bash
# Increase in monitoring.js _doCaptureThumbnail:
# -analyzeduration 6000000  (6s)
# timer setTimeout 14000    (14s)
```

---

### INC-003 — Cursor AI debugger telemetry injected into production files (2026-03-11)

**Symptom**

Production files `src/monitoring.js` and `web/src/components/DecoderMultiviewPanel.jsx` contained `// #region agent log` blocks auto-injected by the Cursor IDE AI debugger feature:

```js
fetch('http://127.0.0.1:7265/ingest/0cd02315-6fd1-4a1e-9c1a-d013ef8dc69e', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '320b2a' },
  body: JSON.stringify({ streamId: safeId, elapsedMs: ..., thumbnailUrl: ..., probeTime: ... })
}).catch(() => {});
```

**Impact**

- These calls target `localhost:7265` (Cursor's local ingest port) so they fail silently in production (`.catch(() => {})`).
- However: stream IDs, timing data, and thumbnail URLs are serialised and sent to the ingest endpoint when running in a Cursor IDE session.
- This code was committed to git before review.

**Resolution**

Both injected blocks removed in commit `169af60`. All production data remains server-side.

**Prevention**

- Review `git diff` before committing. Look for `#region agent log`, `127.0.0.1:7265`, `X-Debug-Session-Id`.
- Add pre-commit grep hook:

```bash
# .git/hooks/pre-commit (chmod +x)
#!/bin/sh
if git diff --cached | grep -q '127.0.0.1:7265'; then
  echo "ERROR: Cursor agent telemetry detected in staged changes. Remove before committing."
  exit 1
fi
```

---

## 10) UI Improvements Log (2026-03-11)

### Alarm & Event Log panel

New `Alarm Log` tab (`web/src/components/EventLogPanel.jsx`) aggregates all WebSocket events into a structured log:

- UTC timestamp, instance ID, severity (critical / warning / info), status, event title, details
- Severity filter buttons + free-text search
- 1000-event in-memory ring (newest at top)
- Toast popup suppression: expected no-signal faults (`ffprobe exited 1`, `connection refused`, `immediate exit requested`) are routed to log only, not popup
- 15s dedup window on identical error toasts

**Severity mapping**

| WS message type | Severity |
|---|---|
| `etr290_alarm` P1 | critical |
| `etr290_alarm` P2 | warning |
| `error` (unexpected) | critical |
| `error` (no-signal pattern) | warning |
| `switched` (failover) | warning |
| `started` / `stopped` / `info` | info |

### Visual improvements

- Background: `#070b14` (deep navy) + `rgba(255,255,255,0.055)` dot grid — previous `#1c1c1c` grid was invisible on `#080808`
- Live stream cards: `ring-1 ring-cyan-500/20` + `shadow-[0_0_32px_-6px_rgba(34,211,238,0.18)]` cyan glow; top accent strip (cyan for running, gray for stopped)
- Bitrate readouts in MetricsTile: `text-xl tracking-tight` — MCR-readable from 1.5m
- Panel surface: `bg-[#0d1117]` + inset top-edge highlight simulates instrument panel depth
- Header height reduced; tab buttons tighter for 9-tab layout without overflow

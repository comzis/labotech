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

### Deploy fail-fast disk guard

`scripts/deploy-one-shot.sh` now fails early when disk/inode headroom is too low to safely run `git fetch` or Docker rebuild.

Defaults:

- `MIN_FREE_MB=8192` (8 GB minimum on repo FS and Docker root FS)
- `MIN_FREE_INODE_PCT=10` (minimum free inode percentage)

Override example:

```bash
MIN_FREE_MB=12288 MIN_FREE_INODE_PCT=12 bash scripts/deploy-one-shot.sh 10.67.18.29 4000
```

### Automated housekeeping (systemd timer example)

Use the provided unit templates to run weekly cleanup and reduce "no space left on device" incidents.

Install:

```bash
sudo cp scripts/systemd/labotech-housekeeping.service /etc/systemd/system/
sudo cp scripts/systemd/labotech-housekeeping.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now labotech-housekeeping.timer
```

Check:

```bash
systemctl status labotech-housekeeping.timer --no-pager
systemctl list-timers --all | rg labotech-housekeeping
journalctl -u labotech-housekeeping.service -n 100 --no-pager
```

### Engineering handover command set (server)

Use this sequence during handover to apply latest code and deploy safely with disk guards.

```bash
cd ~/LaboTech/labotech
git fetch origin
git checkout main
git pull --ff-only origin main
git log --oneline -n 4
```

Enable housekeeping timer (run once per host):

```bash
sudo cp scripts/systemd/labotech-housekeeping.service /etc/systemd/system/
sudo cp scripts/systemd/labotech-housekeeping.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now labotech-housekeeping.timer
systemctl list-timers --all | rg labotech-housekeeping
```

Run deployment:

```bash
bash scripts/deploy-one-shot.sh
```

Optional stricter thresholds:

```bash
MIN_FREE_MB=12288 MIN_FREE_INODE_PCT=12 bash scripts/deploy-one-shot.sh
```

Post-deploy verification:

```bash
curl -fsS http://10.67.18.29:4000/health | jq .
bash scripts/preflight-monitoring-tools.sh 10.67.18.29 4000
bash scripts/post-deploy-smoke.sh 10.67.18.29 4000
```

If disk-related failure occurs:

```bash
df -h
df -i
docker system df
docker builder prune -af
docker image prune -af
docker container prune -f
docker system prune -af
sudo journalctl --vacuum-time=7d
sudo apt-get clean
bash scripts/deploy-one-shot.sh
```

### One-command safe update + deploy

Use this wrapper when frequent disk pressure causes `git fetch` failures before deployment.
It performs:

1. disk/inode precheck (repo FS + Docker root)
2. auto-cleanup if below threshold
3. `git fetch/pull` on target branch
4. `deploy-one-shot` execution

```bash
cd ~/LaboTech/labotech
bash scripts/update-and-deploy-safe.sh 10.67.18.29 4000 labotech
```

Engineer notes:

- Run from any directory; the script self-resolves repo root and executes there.
- Branch/remote defaults are `origin/main` and can be overridden with `GIT_REMOTE` and `GIT_BRANCH`.
- It removes stale `.git/index.lock` before fetch to recover common interrupted pulls.
- It aborts before `git fetch` if disk remains under threshold after cleanup.

Optional environment flags:

```bash
# stricter thresholds
MIN_FREE_MB=12288 MIN_FREE_INODE_PCT=12 bash scripts/update-and-deploy-safe.sh

# alternate git target (hotfix / staging branches)
GIT_REMOTE=origin GIT_BRANCH=release/3.0.0-hotfix bash scripts/update-and-deploy-safe.sh

# disable auto-clean and fail immediately on low disk
AUTO_CLEAN_ON_LOW_DISK=0 bash scripts/update-and-deploy-safe.sh

# aggressive cleanup mode (includes compose down + prune volumes)
AUTO_CLEAN_AGGRESSIVE=1 bash scripts/update-and-deploy-safe.sh
```

Recommended execution policy:

1. Normal operation: use defaults (`AUTO_CLEAN_ON_LOW_DISK=1`, aggressive off).
2. If repeated low-disk incidents persist: enable `AUTO_CLEAN_AGGRESSIVE=1` during a planned maintenance window.
3. For compliance-sensitive windows: set `AUTO_CLEAN_ON_LOW_DISK=0` and handle cleanup manually with change approval.

Expected operator outcomes:

- **Success path:** script prints git HEAD, then `deploy-one-shot` stages and health checks pass.
- **Encapsulator readiness nuance:** a successful deploy means the encapsulator health gate passed within deploy checks; this greatly reduces restart-time false alarms but does not guarantee zero race window for the first UI poll.
- **Encapsulator readiness mode:** by default, encapsulator readiness check is skipped to avoid blocking deploy on sidecar/network turbulence. Enable with `ENCAP_HEALTH_CHECK_ENABLED=1`, and optionally enforce fail-fast with `ENCAP_HEALTH_REQUIRED=1`.
- **Auto triage on sidecar miss:** when encapsulator readiness fails, deploy now prints triage output (`compose ps`, `:4100` listener, host curl probe, and service logs). Disable with `ENCAP_TRIAGE_ON_FAIL=0`.
- **Interactive offender handling:** if `:4100` is occupied during triage, deploy can prompt to terminate detected listener PID(s). Enabled by default in interactive shells; disable with `ENCAP_PROMPT_KILL_ON_4100=0`.
- **Disk guard stop:** script exits early with explicit low-disk message before mutating git state.
- **Deploy stop:** preflight/smoke/health assertions fail with stage name; investigate service logs.

Fast troubleshooting:

```bash
# 1) inspect pressure quickly
df -h /
df -i /
docker system df

# 2) rerun with stricter floor and aggressive cleanup
MIN_FREE_MB=12288 AUTO_CLEAN_AGGRESSIVE=1 bash scripts/update-and-deploy-safe.sh

# 3) if still failing, run normal deploy diagnostics
bash scripts/preflight-monitoring-tools.sh 10.67.18.29 4000
bash scripts/post-deploy-smoke.sh 10.67.18.29 4000
```

Strict encapsulator gate (optional):

```bash
ENCAP_HEALTH_CHECK_ENABLED=1 ENCAP_HEALTH_REQUIRED=1 ENCAP_HEALTH_RETRIES=24 ENCAP_HEALTH_DELAY_SEC=5 \
  bash scripts/deploy-one-shot.sh 10.67.18.29 4000 labotech
```

Disable deploy triage output (optional):

```bash
ENCAP_TRIAGE_ON_FAIL=0 bash scripts/deploy-one-shot.sh 10.67.18.29 4000 labotech
```

Disable interactive kill prompt (optional):

```bash
ENCAP_PROMPT_KILL_ON_4100=0 bash scripts/deploy-one-shot.sh 10.67.18.29 4000 labotech
```

UI-assisted offender resolution (Streams panel):

- In `Streams` when the red sidecar error banner is shown, use `Resolve Port 4100`.
- Flow: inspect listeners on `127.0.0.1:4100` -> confirm dialog -> backend sends `SIGTERM` to allowlisted offenders.
- Allowlist defaults to: `encapsulator,boro,dashboard`.
- Configure with env:
  - `ENCAP_KILL_ALLOWLIST` (comma-separated regex tokens)
  - `ENCAP_KILL_ENABLED=0` to disable kill action
  - `ENCAP_KILL_FORCE_ANY=1` to bypass allowlist (not recommended)
- If offender remains due to host/container PID namespace boundaries, run host script `scripts/triage-port-kill.sh`.

Standalone interactive offender script (recommended during incidents):

```bash
# default port 4100
bash scripts/triage-port-kill.sh

# custom port
bash scripts/triage-port-kill.sh 4100
```

### Incident playbook: encapsulator unreachable on `127.0.0.1:4100`

Symptom during deploy:

- `encapsulator not ready yet (N/24)` keeps increasing
- `curl http://127.0.0.1:4100/health` fails from host

Immediate recovery:

```bash
cd ~/LaboTech/labotech

# 1) stop stuck deploy loop
# Ctrl+C

# 2) inspect runtime state
docker compose ps
docker compose logs --tail=200 labotech-encapsulator
curl -v --max-time 5 http://127.0.0.1:4100/health
sudo ss -ltnp | awk 'NR==1 || /:4100/'

# 3) restart sidecar only
docker compose restart labotech-encapsulator
sleep 5
curl -fsS --max-time 5 http://127.0.0.1:4100/health
```

If still failing:

```bash
# force recreate encapsulator service
docker compose up -d --build --force-recreate labotech-encapsulator

docker compose logs --tail=200 labotech-encapsulator
curl -fsS --max-time 5 http://127.0.0.1:4100/health
```

After sidecar health recovers:

```bash
RECREATE_ALL=1 bash scripts/update-and-deploy-safe.sh 10.67.18.29 4000 labotech
```

Interpretation guide:

- Listener present + health OK: startup race, safe to continue deploy.
- No listener on `:4100`: sidecar did not start; logs contain root cause.
- Listener exists but curl fails: process unhealthy or blocked on startup path.
- Wrong process owns `:4100`: stop conflicting service and redeploy.

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

### Timeline retention policy (recommended)

`Stream View` should use a **26-hour retention horizon** for UI hydration and API backlog fetch.

Why `26h`:

- The largest operator window is `24h`.
- `+2h` safety buffer covers clock skew, refresh delays, and brief service interruptions.

Expected behavior:

- Browser state restore keeps only events newer than `now - 26h`.
- Event API hydration uses `GET /api/events?since=<now-26h>` to avoid loading older ring entries.
- Real-time WebSocket flow is unchanged.
- A stream is considered running/stopped by lifecycle events (`runtime_started` / `runtime_stopped`), **not** by retention age alone.

Operational note:

- `26h` is a memory horizon for timeline evidence, not a forced "stream still running" duration.
- If stale context is suspected during troubleshooting, clear browser storage or run `DELETE /api/events` in controlled maintenance windows.

### Timeline warning hysteresis and SI behavior

To reduce false-positive orange blips in `Stream View` during transient probe joins:

- Backend health severity now applies hysteresis:
  - `warning` escalates only after 2 consecutive warning probes.
  - `critical` escalates immediately.
  - `ok` recovers immediately.
- Frontend timeline treats `dvb.health.severity` as authoritative when present (`ok` / `warning` / `critical`).
- SI table violations (`nit/sdt/eitPf/tdt`) are used as warning fallback only when a legacy result has no health object.

Diagnostic fields exposed in analyser health:

- `dvb.health.hysteresis.raw`
- `dvb.health.hysteresis.warnCount`
- `dvb.health.hysteresis.critCount`

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

Recent hardening for PID correctness:

- PID 0 (PAT) is explicitly excluded from tsduck PID extraction and enrichment paths.
- tsduck PID extraction now keeps the best entry per PID (prefers bitrate-bearing rows) to avoid PMT-reference rows masking measured bitrate rows.
- Fallback/tsduck orphan append paths require `pid > 0`, preventing PAT from surfacing as a stream candidate.

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

### INC-004 — Multiview tiles permanently "AWAITING TELEMETRY" (2026-03-15)

**Symptom**

All Decoder Multiview tiles showed "AWAITING TELEMETRY", Programs: 0, PIDs: 0 after tab switch, even when decoders were running and producing data visible in the Decoder tab.

**Root causes**

Two independent issues combined:

1. **React 18 auto-batching** — When `stats` messages (emitted every 1–2 s by active encoders) and `analyse_result` messages (emitted every 5 s per analyser) arrived close together in the same JavaScript event loop tick, React 18 batched all `setLastMessage()` calls within the WS `onmessage` handler into a single state update. Only the last value survived. If `stats` was last, the `analyse_result` was silently dropped and `resultsById` was never updated.

2. **Slow fallback poll** — The `refreshActives()` REST poll interval was 12 000 ms. If `lastResult` was null on the server at mount time (probe in progress), tiles had to wait up to 12 s for the fallback to catch the first completed probe — or indefinitely if the WS was batching the results away.

**Fix applied** — commit `72b496d`

- `useWebSocket.js`: replaced direct `setLastMessage(value)` with a `setTimeout(0)` drain queue. Messages are pushed to a ref-based queue and dequeued one-per-event-loop-tick, preventing React from batching multiple messages into one render.
- `DecoderMultiviewPanel.jsx`: reduced `MULTIVIEW_REFRESH_MS` from 12 000 → 5 000 ms. Added mount-phase rapid-retry loop: if `activeIds` is non-empty but no tile has `probeTime` data, `refreshActives()` is re-called every 2 s up to 6 times (12 s window).
- `useTSAnalysis.js`: `type: 'error'` WS messages for analyser IDs now write a `probeError` field into `resultsById` so tiles show `probe error: <reason>` in red rather than waiting indefinitely. Also added `setActiveIds` on `analyse_started` events.

**Verification**

After switching to the Multiview tab:
- Tiles should populate within 5 s if probes are healthy.
- If probes fail, the red `probe error:` label appears (stream offline or wrong URL).
- Switching tabs rapidly no longer causes permanent blank tiles.

---

### INC-005 — SRT false CRITICAL on stream connect (2026-03-15)

**Symptom**

When a new SRT decoder was started the health chip in the Decoder panel and timeline turned CRITICAL red for 20–40 s before recovering to OK. The source signal was clean — no real transport errors.

**Root cause**

During SRT key negotiation, IAT estimator warm-up, and initial ffprobe PSI lock, the first several probes returned high IAT P95 / jitter values that breached the health thresholds. The health scoring system had no grace window for this expected startup transient.

**Fix applied** — commit `6b3a21d`

- `TSAnalyser` constructor initialises `this._startupGraceRemaining = null`.
- First continuous probe sets grace: 8 probes (~40 s) for `srt://`, 4 probes (~20 s) for all other protocols.
- While grace > 0, `_attachHealthAssessment()` returns `severity: 'ok'` regardless of raw metrics. `dvb.health.startupGrace: true` is set in the result so operators can distinguish grace from genuine OK.
- `this.lastResult` is assigned the grace-overridden result so it is correctly restored on tab switch.

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

---

## 11) SRT Transport Monitoring (2026-03-15)

### How SRT stats are collected

SRT statistics are extracted from `ffmpeg`'s libsrt verbose output during the transport bitrate probe. For `srt://` URLs the probe runs with `-loglevel verbose` so libsrt writes telemetry lines to stderr. A dedicated regex parser then extracts these values.

Field names in libsrt verbose output:

| Field | Description |
|---|---|
| `mbpsRecvRate` | Receive rate (Mbps) |
| `mbpsBandwidth` | Estimated link bandwidth (Mbps) |
| `msRTT` | Round-trip time (ms) |
| `pktRecvTotal` | Total packets received |
| `pktRcvLossTotal` | Unrecovered packet loss count |
| `pktRetransTotal` | Packets re-sent after NAK |
| `pktSentACKTotal` | Cumulative positive acknowledgements |
| `pktSentNAKTotal` | Cumulative negative acknowledgements |
| `pktRcvDrop` | Packets dropped (arrived too late to recover) |

These fields appear in `dvb.srtStats` on every probe result and are displayed in the **SRT Transport** subtab in both the Decoder panel and TS Analyser.

### SRT health threshold auto-relaxation

SRT ARQ retransmissions produce higher IAT P95 and jitter values than UDP multicast. Health thresholds for `srt://` streams are automatically raised to avoid false CRITICAL hits from normal ARQ activity:

| Metric | UDP/RTP default | SRT minimum |
|---|---|---|
| IAT P95 warn | profile value | 120 ms |
| IAT P95 critical | profile value | 400 ms |
| Jitter warn | profile value | 10 ms |
| Jitter critical | profile value | 40 ms |

The larger of the active profile value and the SRT minimum is used. Other metrics (CC errors, loss %, tsDisc) use the active profile unchanged.

### SRT startup grace period

On a fresh `srt://` connection, libsrt performs key negotiation and the I-frame lock takes several seconds. To prevent false CRITICAL alarms during this window:

- First **8 continuous probes** (~40 s) hold health at `ok` regardless of metric values.
- UDP/RTP streams hold `ok` for **4 probes** (~20 s).
- Grace state is visible in analyser health: `dvb.health.startupGrace: true`.
- One-shot probes (TS Analyser tool, not continuous decoder) bypass the grace period.

### PBKEYLEN mismatch (AES-128 vs AES-256)

If the sender uses AES-256 (`pbkeylen=32`) and the probe URL uses the default `pbkeylen=16` (AES-128), the ffprobe handshake fails and the probe exits 1. The SRT tab will show "AWAITING STATS". Workaround: add `pbkeylen=32` to the decoder URL. Example:

```
srt://10.67.18.29:5000?stats=1&statsintvl=1&pbkeylen=32&passphrase=<key>
```

---

## 12) Multiview Reliability (2026-03-15)

### How multiview tiles receive data

Each `DecoderMultiviewPanel` mount creates a fresh `useTSAnalysis` hook instance with empty state. Data reaches tiles via two paths:

1. **REST restore** — on mount `refreshActives()` calls `GET /analyse` which returns each running analyser's `lastResult`. If the probe has already completed, tiles populate immediately.
2. **WebSocket** — every probe cycle (default 5 s) the server emits `{ type: "analyse_result", id, ...result }`. The panel's `onWsResult` handler updates `resultsById`.

### Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Tiles stuck at "awaiting telemetry" after tab switch | `lastResult` null on server (first probe not yet complete) | Mount-phase retry loop retries `refreshActives()` every 2 s × 6 = 12 s window |
| Some tiles never populate | React 18 auto-batching drops intermediate `setLastMessage` calls when `stats` and `analyse_result` arrive in the same JS event loop tick | WS message queue: messages drain one-per-`setTimeout(0)` so none are lost |
| Tile shows red "probe error:" text | ffprobe/ffmpeg cannot connect to stream URL (stream offline, wrong PBKEYLEN, firewall) | Verify stream URL is reachable from server; check `analyse_result` or `error` WS messages |
| Tile visible but no data, analyser shows RUNNING | Server was just restarted; analyser re-registered but first probe still in flight | Wait up to 40 s for SRT (8-probe grace), 20 s for UDP/RTP (4-probe grace) |

### Multiview panel routing

Panel routing (`decoderIds` per panel) is stored in `sessionStorage` under key `labotech:decoder-multiview:state:v1`. After a server restart the analysers are gone from memory but the panel routing persists in the browser. The user must re-start the analysers (Decoder tab or multiview "Add Decoder") — the tiles will then auto-populate once `refreshActives()` finds running analysers.

Auto-seeding: if no panel routing exists at all (first use), the first panel is seeded with all active analyser IDs when `refreshActives()` first returns results.

**Stale routing after server restart (v3.1.1 fix)**

Before v3.1.1, the auto-seeding logic had an `assignedCount > 0` short-circuit: if any decoder IDs were already stored in `sessionStorage`, the seeding effect returned early without checking whether those IDs were actually alive. After a server restart the server's in-memory analyser map is empty, so every stored ID is stale — `visibleIds` (intersection of stored IDs with `activeIds`) computed to `[]` and all tiles remained blank permanently.

Fix: the seeding effect now checks `anyActive = storedIds.some(id => activeIds.includes(id))`. If stored IDs exist but none are in `activeIds`, the stale routing is discarded and auto-seeding runs as if it were a first-use scenario. Operator action: after server restart, start the analysers from the Decoder tab; tiles will auto-populate once `refreshActives()` detects the newly running analysers.

### Refresh cadence

- **REST poll:** every 5 s (matches probe cadence).
- **Mount-phase rapid retry:** every 2 s, up to 6 retries, while `activeIds` has entries with no `probeTime` data.
- **WS updates:** near-real-time; one per probe cycle per analyser.

---

## 13) UI Change-Control Policy (2026-03-15)

**No UI changes — layout, component additions, styling, or tab structure — may be made without consulting the operator first.**

This policy was established after several sessions where UI refactoring (thumbnail removal from quality dashboard, badge styling changes, punchline row position) introduced regressions or disrupted MCR workflows that were functioning correctly.

### What requires consultation

- Any change to component layout, grid structure, or overflow/clipping behaviour
- Adding, removing, or reordering tabs or sub-tabs
- Changing visibility breakpoints (`xl:`, `lg:`, `hidden`)
- Modifying colour values, badge styles, or LED-dot indicators
- Any change to `DecoderMultiviewPanel.jsx`, `DecoderPanelRevamp.jsx`, `TSAnalyser.jsx`, or `App.jsx` beyond targeted bug fixes

### What does NOT require consultation

- Backend-only fixes (ts-analyser.js, routes, monitoring.js)
- Test additions or corrections
- Build tooling and pre-commit hooks
- Documentation updates

### Prior regressions requiring extra care

| Component | What broke | Root cause |
|---|---|---|
| `DecoderMultiviewPanel.jsx` | Tiles permanently "AWAITING TELEMETRY" | React 18 WS message batching dropped `analyse_result` payloads |
| `DecoderPanelRevamp.jsx` | Policy dropdown unresponsive | `overflow: hidden` on parent container clipped the dropdown portal |
| `App.jsx` | Punchline and CPU metrics disappeared at <1280 px | Both used `hidden xl:` and were on separate rows; at 110% zoom the xl breakpoint wasn't reached |

---

## 14) CPU and Memory Tuning (gva-boro-probe)

### Hardware — gva-boro-probe

| | |
|---|---|
| CPU | 2× Intel Xeon Gold 5120 @ 2.2 GHz |
| Physical cores | 14 per socket × 2 = **28 cores** |
| Logical threads | 56 (Hyper-Threading enabled) |
| RAM | 64 GB (32 GB per socket, Advanced ECC) |
| NUMA topology | Node 0: CPUs 0-13, 28-41 · Node 1: CPUs 14-27, 42-55 |

Verify with: `numactl --hardware`

---

### Phase 1 fix — 2026-03-15 (initial scale-out)

With 9 concurrent decoder lanes, the `labotech` container was hitting 401% CPU utilisation against a 4-core (cpuset 0-3) ceiling. Each lane spawns three concurrent processes:

| Process | Purpose |
|---|---|
| FFmpeg (ETR 290 monitor) | Continuous MPEG-TS demux, stderr parsed for P1/P2 alarms |
| ffprobe / tsanalyze (TS analyser) | Periodic deep probe, PAT/PMT/PID/bitrate extraction |
| tshark / tcpdump (IAT sniffer) | NIC packet capture, arrival jitter measurement |

9 lanes × 3 processes = **27 concurrent heavy processes on 4 cores**. Under CPU starvation each FFmpeg instance failed to schedule its receive socket read in time, causing internal UDP buffer drops reported as `Packet corrupt (stream = N, dts = ...)` — which the ETR 290 analyser correctly logged as `transport_error` P2 alarms. This created false alarm noise on the timeline despite the source signal being clean.

Interim fix: raised to `cpuset 0-15` (16 cores), `mem_limit 8192m`, heap 6 GB.

---

### Phase 2 fix — 2026-03-17 (NUMA-aligned full allocation, v3.1.43)

The Phase 1 fix crossed NUMA boundaries (`cpuset 0-15` spans socket 0 cores 0-13 and socket 1 cores 14-15), introducing cross-socket memory latency for all child process allocations. With the server dedicated exclusively to Labotech, full NUMA-aligned allocation was applied.

#### Current allocation (`docker-env.txt`)

```
# labotech — NUMA node 0
LABOTECH_CPUS=24.0
LABOTECH_CPUSET=0-13,28-41
LABOTECH_MEM_LIMIT=24g
LABOTECH_SHM_SIZE=1g
NODE_OPTIONS=--max-old-space-size=16384

# encapsulator — NUMA node 1
ENCAPSULATOR_CPUS=16.0
ENCAPSULATOR_CPUSET=14-27,42-55
ENCAPSULATOR_MEM_LIMIT=8g

# Probe concurrency
TS_HEAVY_PROBE_MAX_CONCURRENT=8
THUMBNAIL_MAX_CONCURRENT=4
```

#### Why NUMA matters here

ffprobe, tsanalyze, and ffmpeg each spawn as separate OS processes. When a process allocates memory it prefers the NUMA node local to the core it's running on. If the process is scheduled on socket 0 but memory is allocated from socket 1, every cache miss crosses the inter-socket QPI link (node distance 21 vs 10 for local). With 8+ simultaneous heavy probes this compounds into measurable latency.

Pinning `labotech` to `0-13,28-41` ensures all its child processes stay on NUMA node 0 and allocate from node 0's 32 GB. The encapsulator is pinned to NUMA node 1 for the same reason.

#### Probe concurrency

`TS_HEAVY_PROBE_MAX_CONCURRENT` raised from 3 → 8. Each heavy probe is primarily NIC I/O wait (ffprobe must buffer ~2.5 s of multicast packets before analysis; tsanalyze runs for up to 9 s). On 28 logical threads, 8 simultaneous probes leaves ample headroom for the event loop and ETR monitors.

#### FFmpeg / transcoder thread behaviour

FFmpeg auto-detects available cores from the cgroup cpuset. No `-threads` override is needed — each transcode or encode job sees 24 logical threads and schedules itself accordingly. If multiple simultaneous transcodes are observed saturating CPU, add `-threads 6` (or similar) to `buildFFmpegArgs()` in `src/encoder.js` to cap per-job usage.

#### Encapsulator guardrails

`ENCAP_CAPACITY_PER_CORE=20` and `ENCAP_CAPACITY_STREAM_MBPS=22` are per-core multipliers used by the guardrail admission logic — they scale the configured ceiling with core count, not actual throughput. With the 16-core NUMA 1 allocation the stream ceiling becomes `16 × 20 = 320`, but this is an admission guardrail threshold, not a validated capacity figure. Real usable throughput depends on live traffic profile and host conditions. `ENCAP_CPU_BLOCK_PCT=75` is the primary hard limit and takes precedence; treat the stream ceiling as a planning guide to be validated under live load.

---

### Scaling reference

| Active decoder lanes | Recommended CPUSET (NUMA 0) | Recommended MEM_LIMIT |
|---|---|---|
| 1–4 | `0-7` (8 cores) | 8g |
| 5–9 | `0-13` (14 cores) | 16g |
| 10–20 | `0-13,28-41` (28 threads) | 24g |
| 20+ | `0-13,28-41` + raise `TS_HEAVY_PROBE_MAX_CONCURRENT` | 24g |

Rule of thumb: **~1.5–2 cores and ~400 MB per active decoder lane** (ETR + analyser + IAT sniffer combined).

---

### ETR noise suppression (related, Phase 1)

CPU starvation also caused spurious `transport_error` and `pcr_disc` alarms. Two changes were made to `src/etr290-analyser.js`:

1. **Burst window**: `_pendingCounts` resets if the last match for a check was >30s ago (`PENDING_BURST_WINDOW_MS=30000`). Converts threshold from "N hits ever" to "N hits within 30s".
2. **Higher defaults for noisy checks**: `transport_error` and `pcr_disc` default threshold raised from 1 to 3 — requires a genuine burst of 3 occurrences within 30s before an incident is raised. Overridable per-monitor via profile thresholds.

---

### Analyser state persistence (v3.1.42)

Prior to v3.1.42, active TS analysers (decoder lanes) were not saved to `config/state.json`. Every container restart wiped all decoder registrations — the TS timeline went dead and operators had to re-add decoders manually.

Fix: `state-persistence.js` now saves `{ id, url, interval, nicName }` for every running analyser. `restoreState()` in `api.js` always restores analysers on boot (no env var gate). `routes/analyse.js` calls `saveState()` on every `POST /analyse/start` and `DELETE /analyse/:id`.

**Operator action**: add decoders once after upgrading to v3.1.42 — they will survive all future deploys automatically.

---

### Diagnostics

```bash
# Full health snapshot
bash scripts/diagnose.sh

# Confirm NUMA topology
numactl --hardware

# Confirm cgroup CPU assignment for running container
docker inspect labotech | grep -A5 Cpuset

# Live CPU usage per container
docker stats --no-stream labotech labotech-encapsulator
```

---

## 15) Canvas-Based Timeline Lane Renderer (v3.1.5)

### Background

Prior to v3.1.5, each timeline lane bar in `StreamViewPanel.jsx` was rendered as a `<div>` with a CSS `linear-gradient` string as its background. `buildLaneGradient()` produced one colour stop per event segment; with 20+ active lanes and many events per lane these strings could contain hundreds of stops. CSS gradient rendering at that density is slow (browser recalculates on every resize/scroll), unreliable on Chromium/WebKit (visual gaps between stops, sub-pixel rounding artefacts), and non-deterministic in colour accuracy at narrow segment widths.

### Replacement: `LaneCanvas` component

`StreamViewPanel.jsx` now uses a `LaneCanvas` React component for each lane bar. The gradient string from `buildLaneGradient()` is **unchanged** — it is still produced by the same logic. `LaneCanvas` converts it into draw calls:

1. `parseGradientSegments(gradientStr)` — parses the gradient CSS string into `{ leftPct, widthPct, color }[]` segment objects.
2. `LaneCanvas` mounts a `<canvas>` element, attaches a `ResizeObserver`, and on each size change schedules a `requestAnimationFrame` repaint.
3. Each segment is drawn as a `fillRect()` block using the 2D canvas context. Pixel-perfect crisp edges, no sub-pixel gap artefacts.

### Operational notes

- `buildLaneGradient()` logic is **completely untouched** — no change to event colour mapping, severity colours, or gradient generation.
- Canvas rendering is purely a frontend performance and visual quality improvement.
- If a lane bar appears blank after upgrade, verify the browser supports `HTMLCanvasElement` (all modern browsers do) and check console for `parseGradientSegments` parse warnings.
- `ResizeObserver` + `requestAnimationFrame` ensures the canvas repaints correctly on window resize and timeline zoom changes without layout jank.

### Change-control note

`LaneCanvas` and `parseGradientSegments` in `StreamViewPanel.jsx` are performance-critical rendering paths. Do not modify them without consulting the operator — visual regressions (gaps, wrong colours, missing segments) in the timeline are high-impact for MCR operators. See §13 and `.cursor/rules/change-safety-explicit-approval.mdc`.

---

### INC-006 — `_extractSrtStatsFromLog` matchAll TypeError — tiles permanently "Awaiting Frame" (v3.1.1)

**Symptom**

Decoder Multiview tiles and Stream View lane cards showed "Awaiting Frame" / "awaiting telemetry" indefinitely on all SRT streams, even when the analyser was receiving data. `lastResult` on the server remained `null` after every probe cycle. No visible error in the UI; server logs showed a recurring `TypeError`.

**Root cause**

`_extractSrtStatsFromLog()` in `src/ts-analyser.js` called `String.prototype.matchAll()` using the non-global regex literals stored in the stats-field table (e.g. `/mbpsRecvRate:\s*([\d.]+)/i` without the `g` flag). `matchAll()` requires a global regex and throws `TypeError: String.prototype.matchAll called with a non-global RegExp argument` when given a non-global one. This exception propagated up through the probe cycle, aborting the result assignment on every call. Because the probe never completed cleanly, `lastResult` stayed `null` and the REST restore path had nothing to seed tiles from.

**Fix applied** — v3.1.1

Inside `_extractSrtStatsFromLog()`, the call site uses a `last()` helper. Before passing each regex to `matchAll()`, a global copy is derived:

```js
const globalRx = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g');
str.matchAll(globalRx)
```

The original regex literals in the table are unchanged; only the local call site is patched.

**Verification**

```bash
sudo journalctl -u labotech --since "2 min ago" --no-pager | grep -i "matchAll\|TypeError"
# should return no lines after upgrade
```

Then open Decoder Multiview — tiles should populate within one probe cycle (~5 s).

---

### INC-007 — Health assessment false positives (v3.1.4)

#### INC-007a — SMPTE ST 2022-7 `insufficient_data` penalising all RTP streams

**Symptom**

All RTP streams scored −4 pts on every health cycle under `SMPTE ST 2022-7` compliance checks, even on streams where no dual-NIC path was configured. The health chip showed WARNING/CRITICAL on otherwise clean sources.

**Root cause**

`_attachHealthAssessment()` in `src/ts-analyser.js` applied a −4 point penalty for `smpte2022_7.status === 'insufficient_data'`. This status is set whenever the NIC capture layer has not yet gathered enough RTP sequence-number data to assess dual-path compliance — a completely normal operating condition for any single-NIC or non-redundancy deployment. The penalty turned a "data not available" diagnostic state into a health deduction on every probe.

**Fix applied** — v3.1.4

The `insufficient_data` branch is removed from the penalty table. Only `non_compliant` (confirmed dual-path failure) now deducts points. `insufficient_data` is still reported in `dvb.health.reasons` for diagnostic visibility but carries zero score impact.

#### INC-007b — Bitrate drift scoring on ffprobe-derived measurements

**Symptom**

Health assessments periodically showed CRITICAL for "bitrate drift" on streams with stable, known-good bitrates. The drift reason cited percentage swings of 10–65% between probe windows.

**Root cause**

Drift thresholds (3% warn / 6% critical) were applied to the `measured` bitrate field, which is derived from ffprobe's 2.5-second probe window. Short-window ffprobe measurements naturally vary 10–65% between cycles on CBR and VBR streams due to GOP/keyframe alignment within the window — this is expected measurement noise, not a real bitrate change.

**Fix applied** — v3.1.4

Drift scoring in `_attachHealthAssessment()` is now gated on `bitrateSource === 'tsduck'`. TSDuck uses a long continuous PCR-derived window (typically 10–30 s) that produces stable bitrate readings where 3%/6% thresholds are meaningful. ffprobe-derived `measured` values are excluded from drift scoring entirely.

**Verification**

After upgrade, open a running decoder and confirm:
- Health chip shows OK on a stable clean source.
- `dvb.health.reasons` array does not contain a bitrate-drift entry.
- `bitrateSource` field in analyser telemetry confirms which path is active.

---

## 16) SRT Receiver — Caller Mode (2026-03-18)

### Overview

Labotech supports SRT in **caller mode only** for decoder inputs. The system connects outbound to the gateway/encoder; there is no listener/rendezvous mode. All SRT connections use eno1 (management NIC, `10.67.18.29`) — eno2 has no IP address and must never be used for SRT.

### Provisioning an SRT decoder

**Option A — Smart paste (recommended)**

Paste the full SRT connection string provided by the gateway directly into the **Host / IP** field of Decoder Provisioning. The UI auto-extracts:

| Field | Source in URI |
|---|---|
| Host | `srt://<host>:...` |
| Port | `...:<port>` |
| Passphrase | `passphrase=...` |
| Key length | `pbkeylen=...` |
| Latency | `tsbpddelay=...` (ms) |
| Mode | switched to SRT automatically |

Example string: `srt://185.148.228.45:40002?mode=caller&passphrase=CF95BE5316EC&tsbpddelay=4000&pbkeylen=32`

**Option B — Manual entry**

Set Mode to `SRT`, enter Host / IP and Port manually, then set Passphrase and Key Length in the SRT Options section.

### Engine selection

The system automatically selects the optimal encapsulation engine:

| Condition | Engine |
|---|---|
| SRT or UDP input + SRT output + copy mode + srt-live-transmit installed | `srt-live-transmit` (SLT) |
| Any other configuration | `ffmpeg` |

Stream cards show a green `SLT` badge or grey `FFmpeg` badge. `/health` reports `tooling.tools.srtLiveTransmit: true/false`.

### NIC binding — mandatory

Every SRT caller connection must include `adapter=10.67.18.29`. This is applied automatically in:
- `ts-analyser.js` → `_withLiveInputHints()` (ffprobe probes)
- `monitoring.js` → `_buildSrtSrc()` (thumbnail capture)
- `encoder.js` → `_buildSltInputUri()` / `buildInputArgs()` (encapsulator)

If adding any new code that opens an `srt://` URL, this parameter is mandatory (see SNAG-019, SNAG-020, Invariant I-12).

### SRT Transport stats

The **SRT Transport** tab in Decoder Provisioning shows live stats once the first transport probe completes (~10–15 s after start). Stats are parsed from libsrt verbose log output. Health thresholds are relaxed for SRT vs UDP:
- IAT P95 critical: ≥ 400 ms (vs 200 ms for UDP)
- Jitter critical: ≥ 40 ms (vs 20 ms for UDP)

This accounts for ARQ retransmission windows which naturally increase IAT variance.

### Troubleshooting SRT decoder

| Symptom | Likely cause | Check |
|---|---|---|
| SRT Transport tab shows "NOT SRT / AWAITING STATS" | Input URL does not use `srt://` scheme | Verify mode is set to SRT, not UDP/RTP |
| Blank Confidence Monitor after start | ffmpeg thumbnail routed via eno2 | Verify v3.1.77+ is deployed (`/health` version field) |
| ffprobe exits code 1 immediately | Missing `adapter=` in probe URL | Verify v3.1.76+ deployed; check `journalctl -u labotech | grep adapter=` |
| `srtLiveTransmit: false` in `/health` | Binary not in container | Rebuild image with `docker compose build --no-cache`; verify Dockerfile `srt-builder` stage present |
| Connection timeout | Passphrase mismatch or wrong pbkeylen | Confirm passphrase and key length match gateway config exactly |

---

## 17) Landing Page — Operator Identity (2026-03-18)

The landing page uses **Bebas Neue** (Google Fonts, loaded via `index.html`) for the `LABOTECH` hero title. This font is industry-standard for broadcast MCR signage and lower-third graphics.

Layout:
```
OPERATOR ACCESS          ← 9px Courier New, tracked, muted blue
LABOTECH                 ← Bebas Neue 72px, silver #b8c8dc
Stream Management Platform  ← 11px Courier New, dim
[ENTER LABOTECH button]
```

If Bebas Neue fails to load (no internet on isolated deployment), the browser falls back to `"Arial Narrow", Arial, sans-serif` which degrades gracefully. For air-gapped deployments, self-host the font file and update the `<link>` in `web/index.html`.


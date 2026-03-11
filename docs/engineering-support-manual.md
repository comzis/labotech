# Engineering Support Manual

## Purpose

This manual is the operator and engineering runbook for LABOTECH support workflows:

- Safe deployment and rollback
- Decoder and multiview refresh behavior
- TS analysis accuracy path (NIC-capture preferred for arrival telemetry, `tsduck` and metadata fallback supported)
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

This reduces perceived UI lag while preserving periodic ground-truth sampling.

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

## 4) Stream View Operations

`Stream View` provides a horizontal UTC timeline with live status evidence.

### Features

- Multi-lane timeline (per analyser/monitor ID)
- Mouse crosshair and pointer UTC
- Lane status at pointer
- Event evidence panel (bitrate source, SI compliance, arrival metrics)
- Pointer popup with lane-specific nearby ETR errors (`±30s`)
- Marker legend:
  - alarm = red dot
  - ETR status = cyan tick
  - analyser sample = green square
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

---

## 8) Change-Control Note

For production support:

- Prefer `upgrade-prod.sh` for deterministic upgrades.
- Verify health endpoint after every deployment.
- Keep this manual updated whenever probe cadence, timelines, or TS analysis paths change.

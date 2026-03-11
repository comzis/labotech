# Engineering Support Manual

## Purpose

This manual is the operator and engineering runbook for LABOTECH support workflows:

- Safe deployment and rollback
- Decoder and multiview refresh behavior
- TS analysis accuracy path (`tsduck` preferred, fallback supported)
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

1. `tsduck` (`tsanalyze --json`) for best transport-level accuracy
2. FFmpeg transport bitrate probe as fallback
3. ffprobe metadata paths for compatibility

The UI labels bitrate provenance with `dvb.bitrateSource`:

- `tsduck` (preferred)
- `measured` (FFmpeg remux timing)
- `format` or `streams` (fallback metadata paths)

### Current behavior in continuous mode

To reduce multiview lag:

- Continuous probes run on fixed target cadence.
- Heavy transport and SI sampling are executed every few cycles.
- Lightweight cycles continue to update service/audio/thumbnail data.

This reduces perceived UI lag while preserving periodic ground-truth sampling.

---

## 3) `tsduck` Installation

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

### Controls

- Window: `5m`, `15m`, `1h`
- Scale mode:
  - `Normalized` (per-lane local scaling)
  - `Absolute` (shared global scale across lanes)
- Cursor mode:
  - `Freeze Cursor` to lock current UTC inspection point

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

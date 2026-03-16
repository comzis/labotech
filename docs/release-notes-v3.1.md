# Labotech v3.1 Release Notes

Date: 2026-03-16 (latest: v3.1.34)

## Overview

v3.1 is a broadcast-operator readiness release focused on four areas:

1. **Timeline Confidence Monitor** — MCR-grade lane visualisation with per-protocol alarm accuracy, stable live-lane rendering, operator status labels, and smooth 60fps now-line.
2. **UI Hardening** — rAF-throttled crosshair cursor, Stop All control, larger lanes/thumbnails, soft monitoring colour palette, short-window zoom (30s/1m/2m).
3. **Health / Alarm Accuracy** — per-protocol CC/discontinuity thresholds; probe timeouts separated from genuine signal loss.
4. **False Positive Elimination** — ffprobe capture-window misses no longer drive lane red; noSignal recovery in one probe cycle.

---

## v3.1.34 — 2026-03-16

### Fix: Add GV/LK Blue and Red Multicast categories; filter invalid IPs from import

New source JSON introduced four additional prefixes not present in the original files. Added to `deriveCategory()` and category order:
- `GV_BMCAST_*` → GV Blue Multicast (199 streams)
- `GV_RMCAST_*` → GV Red Multicast (199 streams)
- `LK_BMCAST_*` → LK Blue Multicast (64 streams)
- `LK_RMCAST_*` → LK Red Multicast (64 streams)

Extraction script updated to filter non-multicast IPs (e.g. `0.0.0.0`) and `_old` legacy entries. Clean extracted file: **914 unique valid streams**.

---

## v3.1.33 — 2026-03-16

### Feature: Auto-categorised collapsible groups for loaded stream tiles

With large stream registries (e.g. 389 streams), a flat tile grid is unworkable. Loaded (inactive) tiles are now grouped into collapsible category sections, derived automatically from the stream name prefix — no extra column in the CSV/JSON needed.

**Category mapping (auto-derived, ordered):**
| Prefix | Category |
|---|---|
| `GV_IPDEC_*` | GV IP Decoders |
| `LK_IPDEC_*` | LK IP Decoders |
| `GV_TS_ENC_*` | GV Encoders |
| `LK_TS_ENC_*` | LK Encoders |
| `GV_RX_*` | GV Receivers |
| `LK_RX_*` | LK Receivers |
| `*_old` | Legacy |
| anything else | Other |

Each category shows a header with name and stream count. Click to collapse/expand. Active (live) tiles remain ungrouped at the top. Legacy streams extracted from source JSON were excluded from the clean import file.

---

## v3.1.32 — 2026-03-16

### Fix: Move Import/Export buttons to header toolbar alongside Decoder button

Import and Export buttons relocated from the stream registry section into the main header toolbar, styled consistently with the existing Decoder and Panel buttons. Export button only appears when the active panel has streams configured. Removes the separate registry toolbar row.

---

## v3.1.31 — 2026-03-16

### Ops: One-command setup scripts for cron and Docker log rotation

Replaces manual copy-paste commands with two runnable scripts:

**`scripts/setup-disk-guard-cron.sh`** — installs the nightly 3am disk-guard cron entry:
```bash
bash scripts/setup-disk-guard-cron.sh
```
Writes `/etc/cron.d/labotech-disk-guard` automatically. Accepts optional username arg (default: `boro`).

**`scripts/setup-docker-log-rotation.sh`** — configures Docker daemon global log rotation:
```bash
bash scripts/setup-docker-log-rotation.sh
```
Writes `/etc/docker/daemon.json` and restarts the Docker daemon. Prompts for confirmation if the file already exists. **Causes brief container downtime — run during a quiet period.**

---

## v3.1.30 — 2026-03-16

### Ops: Scheduled disk housekeeping script (`scripts/disk-guard.sh`)

**Problem:** Disk fills up silently between deploys. The `update-and-deploy-safe.sh` cleanup only runs when a deploy is triggered and disk is already low — by then it may be too late.

**Solution:** `scripts/disk-guard.sh` — a standalone cleanup script safe to run from cron while Labotech is live (no container stop or restart). Cleans five categories:
1. Docker container JSON logs (`/var/lib/docker/containers/*/*-json.log`) — truncated in-place, the primary silent killer
2. Unused Docker images and build cache (`docker system prune -af`)
3. apt package cache + orphaned packages
4. systemd journal vacuumed to 200 MB / 7 days
5. Thumbnail JPEGs older than 1 hour from `logs/thumbnails/`

Logs before/after free space for root and Docker volumes, with a warning if free space is still below `WARN_FREE_MB` (default 2 GB) after cleanup.

**Cron entry (run once on server as root):**
```bash
echo '0 3 * * * boro bash /home/boro/LaboTech/labotech/scripts/disk-guard.sh >> /var/log/labotech-disk-guard.log 2>&1' \
  | sudo tee /etc/cron.d/labotech-disk-guard
```

**Docker daemon log rotation (run once on server as root):**
```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
sudo systemctl restart docker
```
This caps logs at the daemon level for all containers as a belt-and-braces measure alongside the per-service limits already in `docker-compose.yml`.

**Operator impact:** Disk no longer fills up silently. Daily 3am run reclaims build cache, logs, and thumbnails. Operators see reclaimed MB in `/var/log/labotech-disk-guard.log`.

---

## v3.1.29 — 2026-03-16

### Fix: Remove duplicate `background` key in StreamViewPanel severity badge

`StreamViewPanel.jsx` had two `background` entries in the same style object for the severity badge (lines 1806/1810). The first (`cfg.bg`) was silently overwritten by the second (`#070b14ee`). Removed the dead `cfg.bg` entry; no visual change — the dark overlay was already winning.

---

## v3.1.28 — 2026-03-16

### Feature: Stream registry import/export + visual tile distinction for Multiview

**Stream registry per panel (server-persisted):**
Each Multiview panel now has an independent stream registry — a named list of `{ name, ip, port, mode }` entries that survive browser refreshes, server restarts, and cross-workstation sessions. Registry data is stored in `config/multiview-panels.json` via two new API endpoints: `GET /api/multiview/panels` (load) and `PUT /api/multiview/panels` (save, debounced 800ms). localStorage acts as an offline fallback and is kept in sync.

**Import CSV or JSON:**
Click the **Import** button in the Stream Registry toolbar to load streams from a `.csv` or `.json` file.
- CSV format: `name,ip,port,mode` (header row optional). Mode defaults to `rtp` if omitted.
- JSON format: `[{ "name": "...", "ip": "...", "port": "..." }]` or `{ "streams": [...] }`.
- Duplicate IP:port pairs are silently skipped on import.

**Export CSV:**
Click **Export CSV** to download all streams for the active panel as `multiview-<panel>-streams.csv`. Import the same file on any workstation running Labotech to instantly replicate the panel layout.

**Visual tile distinction — Loaded vs Active:**
Two distinct tile states are now rendered in the grid:
- **Active (LIVE) tiles** — existing cyan-border treatment with thumbnail, audio meters, and stats. These are streams currently being probed.
- **Loaded tiles** — dark navy (`#090e18`) background, dim blue left accent border (`rgba(40,90,200,0.5)`), "Loaded" badge in blue/grey. Show IP:port but no thumbnail. Operators can distinguish at-a-glance which feeds are configured vs actively monitored.

**Start from loaded tile:**
Each Loaded tile has a green **▶ Start** button. Clicking it launches a continuous TSAnalyser probe for that stream and immediately promotes the tile to Active in the same panel. The stream ID is derived deterministically from `name+ip+port`, so the same stream started twice lands on the same decoder slot.

**Remove from registry:**
Each Loaded tile has a × dismiss button to remove the entry from the panel registry.

**OPS access:** Import/Export is available to all roles. It is an operational task (pre-show setup, roster changes), not engineering config.

**Operator impact:** MCR operators can now pre-configure an entire show's multicast roster (import CSV), monitor a subset live, and share the configuration across workstations without manual re-entry.

---

## v3.1.27 — 2026-03-16

### Fix: Panel names now survive server restarts and browser re-logins

**Two root causes identified:**

**1. React mount race condition (persist overwrites load):**
The persist effect ran on mount with the initial default state (single empty "BES" panel) *before* the load effect's `setState` calls were applied. In the brief window between those two effects, localStorage was overwritten with default state. Fixed with a `hydratedRef` — the persist effect is blocked until the load effect has finished restoring state.

**2. Stale decoder IDs across sessions:**
Panel `decoderIds` were persisted across sessions, but decoder IDs are timestamp-based (`decoder-17773668150861`) and change on every server restart or decoder stop/start. After a redeploy, stored IDs matched nothing in `activeIds` → auto-seed triggered → first panel routing reset → custom panel routing lost. Fixed by not restoring `decoderIds` from storage. Panel names and structure are preserved; decoder routing is always seeded fresh from `activeIds` each session by the existing auto-seed logic.

**Result:** Panel names ("MCR-A", "BES", etc.) survive indefinitely across logins, server restarts, and redeployments. Decoder routing auto-populates correctly on each session start.

---

## v3.1.26 — 2026-03-16

### Fix: Auto-clear thumbnail cache + LVM root volume prune on every deploy

**Thumbnail cache wipe (always, not just on low disk):**
Stale or 0-byte JPEG files left from a previous crashed/disk-full run were served to the multiview and rendered as black frames until the next probe cycle overwrote them. `update-and-deploy-safe.sh` now removes all `logs/thumbnails/*.jpg` before calling `deploy-one-shot.sh`. The count of removed files is logged. Thumbnails regenerate automatically within the first probe cycle (≤5s) after startup.

**LVM root volume cleanup added to `auto_cleanup`:**
`/dev/mapper/ubuntu--vg-ubuntu--lv` was not explicitly targeted by the existing cleanup. Added to `auto_cleanup` (runs automatically when disk is below threshold):
- `apt-get autoremove -y` (was missing, reclaims orphaned packages)
- `journalctl --vacuum-time=7d` (tightened from 14d)
- `find /tmp -atime +1 -delete` (clears stale temp files)
- Logs free MB on the root LV after cleanup for visibility

---

## v3.1.25 — 2026-03-16

### Fix: preflight script — replace `node` with `jq` for health JSON parsing

**Problem:** `scripts/preflight-monitoring-tools.sh` used an inline `node` heredoc to parse the `/health` response. Node.js is not installed on the host — it runs only inside the Docker container. Every deploy failed at the preflight stage with `node: command not found`.

**Fix:** Replaced the `node` block with four `jq` one-liners. `jq` is already a hard requirement of `deploy-one-shot.sh` (checked in `require_cmds`) so it is guaranteed to be present.

---

## v3.1.24 — 2026-03-16

### Revert: Restore thumbnail analyzeduration and attempt timeouts to v3.1.22 values

**Problem:** v3.1.23 reduced `analyzeduration` (2s→1s), `probesize` (3MB→1.5MB), and attempt timeouts (8s→5s) to speed up first thumbnail. This caused regressions on production streams:
- 1s `analyzeduration` insufficient to find the first I-frame on some streams — attempts timed out and fell through to attempt 4 (any-frame fallback), producing macroblocked thumbnails.
- Increased probe timeout error rate as more thumbnail attempts failed within the shorter window.

**Fix:** Restored `monitoring.js` exactly to v3.1.22 state:
- `analyzeduration`: I-frame path `2000000` (2s), fallback `7000000` (7s)
- `probesize`: I-frame path `3000000` (3MB), fallback `7000000` (7MB)
- All attempt timeouts: `8000ms`

No other files changed. v3.1.21 (localStorage), v3.1.22 (storage key v2) changes are preserved and unaffected.

---

## v3.1.23 — 2026-03-16

### Perf: Faster multiview thumbnail — reduce analyze latency and fallback timeouts

**Problem:** First thumbnail on a fresh decoder was slow to appear ("Awaiting Frame" for 10–32 seconds) due to three compounding issues:
- `analyzeduration: 2s` — ffmpeg spent 2 seconds analysing the stream format before decoding a single frame. For a live broadcast stream the codec is known within the first few packets; 2s was pure wasted wait.
- Fallback ladder attempt timeouts were all 8s — if attempt 1 failed (e.g. `pp=de/de` filter unavailable on this ffmpeg build), attempt 2 did not start until 8s elapsed. Worst case: 32s before any thumbnail appeared.
- `probesize: 3MB` — read up to 3MB of stream data for format detection, adding further latency on attempt start.

**Fix:**
- `analyzeduration` on I-frame path: `2000000` → `1000000` (1s)
- `probesize` on I-frame path: `3000000` → `1500000` (1.5MB)
- Attempt 1, 2, 3 timeouts: `8000ms` → `5000ms` (fail fast to reach bare-scale attempt sooner)
- Attempt 4 (last resort / any frame) retains 8s timeout for very long GOP streams

**Result:** First thumbnail appears in 2–4s on a typical broadcast stream. Worst-case (all 4 attempts exhaust): 23s instead of 32s.

---

## v3.1.22 — 2026-03-16

### Fix: Multiview storage key bumped to v2 — clears stale localStorage data

**Problem:** v3.1.21 switched multiview state from `sessionStorage` to `localStorage`. Any pre-existing entry under the old key `labotech:decoder-multiview:state:v1` in `localStorage` (from a prior dev or test session) was now being loaded, producing corrupt panel state and breaking the multiview on first load after the upgrade.

**Fix:** Storage key bumped to `labotech:decoder-multiview:state:v2`. The old key is simply ignored; the component starts clean. Panels created from this version onward will persist correctly across refreshes and restarts.

---

## v3.1.21 — 2026-03-16

### Fix: MCR panels now persist across page refresh and tab close

**Root cause:** `DecoderMultiviewPanel` stored all state (panel names, panel count, decoder routing per panel, engineer mode label) in `sessionStorage`. Session storage is scoped to the browser tab — it is wiped the moment the tab is closed or the page is refreshed. Any MCR panel created during a shift was silently lost.

**Fix:** Changed both `sessionStorage.getItem` and `sessionStorage.setItem` calls to `localStorage`. The storage key (`labotech:decoder-multiview:state:v1`) is unchanged — existing sessions will migrate transparently on first load because the same key is now read from `localStorage`.

**Result:** Panel names, decoder routing, engineer mode label, and active panel selection all survive page refresh, browser restart, and shift handover.

---

## v3.1.20 — 2026-03-16

### Fix: Docker log rotation + post-deploy image prune

**Problem:** Disk filled up progressively between deploys from two sources:
- Docker container logs had no size cap. The TS analyser runs ffprobe every 30 s per stream; stderr from each probe cycle is captured by the JSON log driver, which grew unbounded in `/var/lib/docker/containers/`.
- `deploy-one-shot.sh` builds with `--no-cache` every deploy, leaving orphaned image layers in `/var/lib/docker/overlay2` that were never pruned.

**Fix:**
- `docker-compose.yml` — added `logging: driver: json-file, max-size: 50m, max-file: 5` to `labotech`; `max-size: 20m, max-file: 3` to `labotech-encapsulator`. Capped at ~310 MB total log retention across both containers.
- `deploy-one-shot.sh` — added `docker image prune -f` as a `run_stage_warn` step after health assertions pass. Runs automatically on every successful deploy; non-fatal if it fails.

**Steady-state disk budget (Docker):** ≤ 310 MB logs + current image layers only.

---

## v3.1.19 — 2026-03-16

### Perf: Smooth 60fps now-line; reduce live tick to 250ms

**Problem:** The cyan current-time line moved in 2-second jumps because `LIVE_TICK_MS=2000` caused `nowMs` state (and thus the entire timeline content) to update every 2 seconds.

**Fix:**
- `LIVE_TICK_MS` reduced 2000 → **250ms**: content jump is now 0.08% (~1px) at 5m window — imperceptible.
- Now-line driven by `requestAnimationFrame` loop via `nowLineRef` DOM ref — updates at 60fps with zero React re-renders. Same pattern as the crosshair cursor.
- `timeStartRef` / `effectiveWindowMsRef` hold latest values without restarting the rAF loop on every 250ms tick.
- Works correctly in both live and custom range modes: hides when current time is outside the visible window.

---

## v3.1.18 — 2026-03-15

### Fix: Probe timeouts show as narrow amber ticks, not red blocks

**Root cause:** `ffprobe returned empty probe payload (no input packets observed during probe window)` is a ffprobe capture-window miss — ffprobe joined the multicast group but the capture window closed before any packets arrived. The service was delivering video fine. These were classified as `noSignal=true` → 15s critical red blocks, and with multiple occurrences every 12–28 seconds, created a solid false-positive red band.

**Changes:**
- `isProbeTimeoutError()` — new function, identifies capture-window timeouts as a distinct class from genuine signal loss.
- `isExpectedNoSignalError()` — probe-timeout strings removed; returns false if `isProbeTimeoutError` matches.
- `toEvent()` for `'error'` — uses `msg.details` as fallback for API-hydrated events; probe timeouts get `category: 'runtime_probe_timeout'`, `severity: 'warning'`, `title: 'Probe timeout'`.
- `decEvtSev()` — `runtime_probe_timeout` returns null (never affects gradient); `runtime_error` also checks `description` for probe-timeout text to suppress old localStorage events.
- `EVENT_BLOCK_DURATION_MS['runtime_probe_timeout'] = 2000ms` — narrow tick.
- `EVENT_STYLE_BY_CATEGORY['runtime_probe_timeout']` — semi-transparent amber.

**Result:** Lanes stay green throughout probe capture failures. Probe timeouts appear as thin amber tick marks at their exact timestamp. Only genuine LOS (`connection refused`, `input disappeared`, etc.) still drives the gradient red.

---

## v3.1.17 — 2026-03-15

### Feature: Short timeframe windows + remove Scale toggle

**New window options:** `30s`, `1m`, `2m` added at the start of the timeline window selector. Useful for watching brief signal glitches at close zoom — combined with the v3.1.16 noSignal fix, a 1-second glitch is now clearly visible as a narrow red segment at 30s/1m scale.

**Scale Normalised/Absolute toggle removed:** The toggle controlled shared Y-axis min/max on IAT/jitter sparklines in the forensics popup. Since the popup is per-lane, a global cross-lane scale added no diagnostic value — per-lane auto-scaling is more readable. Removed: `scaleMode` state, `globalRanges` useMemo, `sparkScale()` helper, and persistence.

---

## v3.1.16 — 2026-03-15

### Fix: Brief noSignal events clear on first ok probe

Signal-loss events (`runtime_error noSignal`) were holding the lane RED for 2× probe interval (~30–60s) because `OKS_TO_CLEAR=2` required two consecutive ok results before recovery. A 1-second glitch appeared as a large red block.

Signal presence is binary — once the first ok probe confirms the signal is back, the red segment ends. Added `noSignalRecovery` flag: after a `noSignal` event, the next single ok probe clears the critical state. If a subsequent `analyse_result critical` confirms sustained degradation, `noSignalRecovery` resets and normal 2-probe hysteresis resumes.

Result: a brief signal glitch now shows as ~one probe interval of red (~5–15s on `broadcast-balanced-v1`) instead of 60–120s.

---

## v3.1.15 — 2026-03-15

### Fix: Status label visibility (timeline)

- Lane canvas container shortened to `right: 46px` so it no longer paints over the right-edge status chip.
- Status label background set to opaque (`#070b14ee`) — readable regardless of lane colour beneath.

---

## v3.1.14 — 2026-03-15

### Fix: Lane start position reflects actual decoder start time

- Lane bar now begins at `Math.max(timeStart, lastExplicitStartTs)` — decoders started mid-window show a partial bar from their real start, not from the left window edge.
- Bootstrap-only lanes (no explicit `runtime_started` event) correctly fill from window start.

---

## v3.1.13 — 2026-03-15

### Feature: Visual polish for MCR readability

- Lane height increased (LANE_STEP_PX 34 → 44 px, bar thickness 8 → 12 px).
- Thumbnail size increased (14×10 → 26×18 px).
- Green colour changed from neon `#00dd55` to soft monitoring green `#3db86a` — reduced eye strain on low-light MCR displays.

---

## v3.1.12 — 2026-03-15

### Feature: Right-edge status labels per timeline lane

- Each lane now shows a chip at the right edge: **OK** / **WARN** / **CRIT** / **LOS**.
- LOS (Loss of Signal) shown when no heartbeat within the stale threshold.
- Derived from `laneStatusById` useMemo over fullLaneMap — no extra API calls.
- Consistent with Elecard Boro / Telestream PRISM operator conventions.

---

## v3.1.11 — 2026-03-15

### Fix: Tombstone race condition (isLive false after fast restart)

- `stopAfterActive` anchor changed from `firstActiveTs` → `lastExplicitStartTs`.
- Eliminates false LOS when `seedFromActiveAnalysers` fires a synthetic `runtime_stopped` tombstone between stop and restart events.

---

## v3.1.10 — 2026-03-14

### Docs: CLAUDE.md corrections (Cursor review)

- API port corrected 3000 → 4000 throughout guidance.
- Inheritance model corrected: `TSAnalyser` and `MulticastForwarder` extend `EventEmitter` directly, not `SRTEncoder`.

---

## v3.1.9 — 2026-03-14

### Fix: isLive — heartbeat-in-window as primary live condition

- Added `lastHeartbeatTs >= timeStart` as a third OR condition for `isLive`.
- Eliminates lanes going grey: previous condition `staleStopTs >= timeEnd` was always false for live windows (now+30s < now+5min).

---

## v3.1.8 — 2026-03-14

### Docs: CLAUDE.md — timeline colour contract and protocol threshold rules

- Documented green/amber/red/grey lane semantics.
- Documented per-protocol CC threshold override rule.
- Documented heartbeat-must-use-`Date.now()` invariant.
- Documented live-lane fill-from-left-edge convention.

---

## v3.1.7 — 2026-03-14

### Fix: Solid colour lanes on page load

- Bootstrap heartbeat seed changed from `probeTime` → `Date.now()`.
- `probeTime` from server could be minutes stale, causing heartbeat to expire immediately on load and all lanes to render grey.

---

## v3.1.6 — 2026-03-14

### Fix: Grey gaps between events eliminated

- `lastActivityTs` now computed as `Math.max(lastSevEvtTs, lastHeartbeatTs)`.
- Previous logic used only `lastSevEvtTs`; probe cycle (30–60 s) exceeded LANE_ACTIVITY_STALE_MS (30 s) causing periodic grey flashes between probes.

---

## v3.1.5 — 2026-03-14

### Feature: Stop All button in Active Decoders

- Added STOP ALL button to the Active Decoders section header in DecoderPanelRevamp.
- Visible only when one or more decoders are active.
- Iterates active IDs, calls `stop()` per decoder, then refreshes the active list.

---

## v3.1.4 — 2026-03-14

### Fix: Per-protocol CC thresholds + rAF crosshair cursor

**Per-protocol health thresholds:**
- `_healthThresholds()` in `ts-analyser.js` now auto-selects `broadcast-balanced-v1` floor values (ccWarnCount ≥ 3, ccCriticalCount ≥ 8, tsDiscWarnCount ≥ 3, tsDiscCriticalCount ≥ 8) for RTP and UDP multicast sources.
- Eliminates false CC/discontinuity alarms caused by ffprobe joining mid-stream — a normal 1–10 packet window at join time was triggering `srt-contribution` policy alarms (ccWarnCount = 1).
- SRT streams retain the configured policy thresholds unchanged.

**rAF-throttled crosshair cursor:**
- Crosshair line position updated via direct DOM ref (`crosshairLineRef`) — zero React re-renders at 120 Hz mousemove.
- React state (mouseX/Y/laneId for popup) throttled to `requestAnimationFrame` (≤ 60 fps).
- `onMouseLeave` cancels pending rAF and hides line immediately.

---

## v3.1.3 — 2026-03-14

### Fix: False-positive health penalties removed

- SMPTE 2022-7 `insufficient_data` no longer penalises the health score — probe windows shorter than `minSamples` are ambiguous, not degraded.
- Bitrate drift within normal transient bounds no longer penalises on first probe.

---

## v3.1.2 — 2026-03-14

### Feature: Canvas-rendered timeline lane bars

- Replaced CSS gradient `div` with `LaneCanvas` (`HTMLCanvasElement`) per lane.
- Eliminates CSS repaint overhead on dense timelines; gradient rendered via `fillRect` in a `useEffect`.

---

## v3.1.1 — 2026-03-14 (tag)

### Feature: Confidence Monitor layout and live thumbnail restore

- Confidence Monitor panel moved below Decoder Provisioning section.
- ETR 290 panel moved below Confidence Monitor.
- Live frame thumbnail restored to Decoder Quality Dashboard.

---

## Upgrade Notes

- No schema migrations or config file changes required.
- `config/monitoring-policy.json` profile selection unchanged — RTP/UDP threshold floor is applied automatically in code.
- Run `bash scripts/deploy-one-shot.sh` on the server to apply.

## Verification

- Backend tests: 107 passing.
- Frontend production build: 0 warnings.
- Health endpoint: `status=ok`, `tsanalyze.available=true`.


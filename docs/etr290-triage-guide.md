# ETR 290 Triage Guide — Labotech Operations

**Version:** v3.1.92 | **Date:** 2026-03-18 | **Applies to:** Labotech v3.1+

---

## 1. What Is ETR 290 Monitoring?

ETSI TR 101 290 (ETR 290) defines three priority tiers of error checks for MPEG-TS transport streams. Labotech runs a continuous ffmpeg-based ETR monitor per decoder and classifies every ffmpeg stderr event against these tiers in real time.

| Priority | Severity in UI | Meaning |
|---|---|---|
| **P1** | `critical` (red) | Service is lost or undecodable — immediate action required |
| **P2** | `warning` (amber) | Service degraded — monitor closely, investigate promptly |
| **P3** | `warning` (amber) | SI/PSI table errors — lower urgency, note and schedule investigation |

---

## 2. Enabling ETR on a Decoder

1. **Decoder tab → select a decoder** in the left list.
2. Scroll to **ETR 290 Alarm Configuration** (below Confidence Monitor thumbnail).
3. Click **Enable ETR**. The monitor starts within ~5 seconds.
   - For SRT sources: the relay must be running first (it starts automatically when the decoder starts). If relay is not yet ready the button will return an error — wait a few seconds and retry.
4. The **ETR status panel** appears with three columns (P1 / P2 / P3) and a live alarm log.

### ETR IDs

Each ETR monitor is named `etr-<decoder-id>`. Example: decoder `SRT-FEED-01` → ETR monitor `etr-SRT-FEED-01`.

---

## 3. P1 — Critical Alarms (Service Loss)

P1 faults indicate the transport stream is fundamentally broken. Decoders downstream will lose picture and/or audio.

| Check ID | Label | What Triggers It | Typical Cause |
|---|---|---|---|
| `ts_sync` | **TS Sync Loss** | Lost sync byte sequence (`0x47` header missing) | Complete signal loss, severe bit errors, wrong input URL |
| `sync_byte` | **Sync Byte Error** | Individual `0x47` not found in expected position | Corrupted TS framing, wrong packet size (not 188-byte aligned) |
| `pat_error` | **PAT Error** | No PAT found / PAT missing / PAT invalid | Mux not outputting PAT, program table corrupted |
| `cc_error` | **CC Error** | Continuity counter discontinuity on any PID | Packet loss in network, RTP reordering, SRT ARQ failure |
| `pmt_error` | **PMT Error** | PMT missing or invalid | Encoder not sending PMT, or PAT references wrong PID |
| `pid_error` | **PID Error** | Unknown PID, PID not found | Elementary stream PID not in PMT, wrong source stream |

### P1 Triage Steps

```
P1 alarm firing?
│
├─ ts_sync / sync_byte
│   → Check physical link: SFP status, cable, optical power
│   → Check source encoder is outputting — connect reference monitor
│   → Verify SRT/UDP receive stats: zero packets → source is down
│
├─ pat_error / pmt_error
│   → Run a probe: Decoder tab → probe button → check PAT/PMT in PID table
│   → If PIDs appear but PAT error persists: ffprobe SI cache delay (normal <10s at startup)
│   → If PIDs absent: source encoder PSI issue — contact encoder operator
│
├─ cc_error
│   → Check CC error count in TS Analyser → dvb.continuityCounterErrors
│   → SRT source: inspect SRT stats panel — high pktRetransTotal or pktDropped?
│     → If yes: network path issue (packet loss), increase SRT latency at source
│   → RTP/UDP source: 1–10 CC errors on startup are normal (ffprobe joins mid-stream)
│     → If errors persist beyond 60 s: genuine loss in network
│
└─ pid_error
    → Verify source stream program structure hasn't changed
    → Force reprobe: stop decoder, restart
```

---

## 4. P2 — Warning Alarms (Service Degraded)

P2 faults indicate timing or integrity problems that may cause viewer artefacts, A/V sync drift, or downstream equipment errors.

| Check ID | Label | What Triggers It | Typical Cause |
|---|---|---|---|
| `transport_error` | **Transport Error** | `transport_error_indicator` set in TS header, or ffmpeg reports corrupt packet | Bit errors in network, corrupted packets passing through |
| `crc_error` | **CRC Error** | CRC check failed on SI table (PAT/PMT/NIT/etc.) | SI table corruption, bit flip in PSI section |
| `pcr_disc` | **PCR Discontinuity** | PCR/DTS/PTS values jump non-monotonically | Encoder discontinuity (channel change), network jitter exceeding PCR buffer |
| `pcr_acc` | **PCR Accuracy** | PCR jitter too high, clock drift detected | Source encoder instability, transcoder PTS rebuild issue |
| `pcr_rep` | **PCR Repetition** | PCR too sparse (not sent frequently enough) | Encoder mux issue, low-bandwidth stream with sparse PCR |
| `pts_error` | **PTS Error** | PTS/DTS out of order | B-frame encoder issue, clock wrap, buffer underrun |
| `cat_error` | **CAT Error** | CAT missing or invalid | Encrypted stream without CA descriptor — only relevant for CA-carrying streams |

### P2 Triage Steps

```
P2 alarm firing?
│
├─ transport_error
│   → Check network path BER (bit error rate): use external probe or SFP diagnostics
│   → RTP/UDP: single transport_error on startup is normal (threshold = 3 hits in 30s)
│   → Persistent: packet corruption in network switch or SFP module
│
├─ pcr_disc
│   → Check if source encoder had a restart: PCR restarts after encoder reboot
│   → Check TS analyser dvb.timestampDiscontinuity — is it isolated or recurring?
│   → Isolated (1–2 at stream start): normal — encoder clock sync artefact
│   → Recurring: investigate encoder PTS rebuild, transcoder clock stability
│
├─ pcr_acc / pcr_rep
│   → Inspect source encoder PCR insertion interval (should be ≤ 40 ms per DVB)
│   → Check network jitter: TS Analyser → arrival → iatP95 > 40 ms is a concern
│   → For SRT: check relay SRT stats pktSndBuf and pktRcvBuf; high values indicate buffering
│
├─ crc_error
│   → Usually caused by SI table corruption — intermittent bit errors in network
│   → Check BER / optical power if fibre; check cable for RF systems
│
└─ pts_error
    → If isolated at stream start: normal B-frame encoder join artefact
    → If recurring: contact encoder operator — PTS rebuild or mux issue
```

---

## 5. P3 — Informational Alarms (SI/PSI Table Issues)

P3 faults are non-service-threatening in most cases but should be logged and reviewed during scheduled maintenance.

| Check ID | Label | What It Means |
|---|---|---|
| `nit_error` | **NIT Error** | Network Information Table has an error — incorrect network descriptor |
| `sdt_error` | **SDT Error** | Service Description Table error — service name/provider data malformed |
| `eit_error` | **EIT Error** | Event Information Table error — EPG data issue |
| `rst_error` | **RST Error** | Running Status Table error |
| `tdt_error` | **TDT Error** | Time and Date Table error — UTC time broadcast incorrect |
| `empty_buf` | **Empty Buffer** | Buffer underflow — stream momentarily ran dry |

P3 alarms do not affect picture/audio. Schedule investigation at next maintenance window unless frequency is high.

---

## 6. False Positives — When Alarms Are Expected and Safe to Dismiss

### 6a. Startup Artefacts (0–15 seconds after Enable ETR)

The ETR monitor has a **5-second startup grace** period (`ETR290_STARTUP_GRACE_MS=5000`). During grace, incidents are suppressed. However, a brief burst of artefacts may still appear in the alarm log in the first 15 seconds as the monitor syncs:

- 1–10 **CC errors** from RTP/UDP multicast join (ffprobe always joins mid-GOP)
- 1–3 **transport_error** events from first-packet corruption on join
- Single **pcr_disc** from the initial clock sync

These are cosmetic. If alarms clear within 15–30 seconds, the source is healthy.

### 6b. SRT Source — Startup Window

For SRT sources (relay-backed), the relay requires a full SRT latency window to fill its buffer (~4 seconds for typical 4000 ms latency sources). ETR receives the relay's UDP output, so no startup artefacts from SRT join — but expect:

- Brief `transport_error` if relay was just started (first TS packets may be mid-GOP)

### 6c. Channel Change / Encoder Restart

When the source encoder restarts or switches programme:

- **PAT error**, **PCR discontinuity** for 2–5 seconds until new stream is stable
- These are expected — confirm encoder is stable, then reset alarms via the alarm log

### 6d. Transport Error Burst Threshold

`transport_error` and `pcr_disc` require **3 hits within 30 seconds** before an incident is raised (default `NOISY_CHECK_DEFAULTS`). A single packet error does not raise an incident. If you see a count of 1–2 in the alarm log but no incident, this is the burst-window protection in effect.

---

## 7. ETR 290 Alarm Configuration — Threshold Tuning

Access via **Decoder tab → ETR 290 Alarm Configuration → Settings icon**.

| Setting | Default | Description |
|---|---|---|
| **Profile** | `default` | Named threshold set. Profiles can be saved and recalled. |
| **Per-check threshold** | 1 (most checks), 3 (`transport_error`, `pcr_disc`) | Number of hits within the burst window before an incident is raised. Increase for noisy sources. |
| **PID filter** | none | Restrict monitoring to specific PIDs. Useful to isolate video vs audio paths. |

**When to increase thresholds:**
- Source is known to produce occasional jitter (e.g. contribution encoder on WAN)
- You want P3 alarms only for persistent faults, not single-event blips

**When to keep thresholds at 1:**
- QC monitoring where any error is significant
- Legal compliance monitoring

---

## 8. Reading the ETR Timeline

The **Stream View** tab shows a UTC timeline per decoder lane. ETR alarms affect the lane colour:

| Lane Colour | Meaning |
|---|---|
| **Green** | Last probe OK, ETR clean |
| **Amber** | P2 or P3 alarm active |
| **Red** | P1 alarm active, or continuous loss of signal |
| **Grey** | Decoder stopped, or 30 seconds of silence (no heartbeat) |

The ETR alarm log (right column in Stream View) shows each incident with:
- UTC start time
- Priority (P1/P2/P3)
- Check ID and label
- Sample lines from ffmpeg stderr that triggered the match
- Duration (resolved incidents show end time)

---

## 9. Backend Diagnostics — ETR Process Health

### Check if ETR is running

```bash
# On server, in Docker:
docker compose logs labotech | grep -i "etr-" | tail -20

# List active ETR monitors via API:
curl -s http://10.67.18.29:4000/etr290 | jq '[.[] | {id, url, isRunning}]'
```

### Check alarm counts

```bash
curl -s http://10.67.18.29:4000/etr290 | jq '.[] | {id, counts: .alarms | group_by(.checkId) | map({check: .[0].checkId, count: length})}'
```

### Restart an ETR monitor

```bash
# Stop:
curl -s -X DELETE http://10.67.18.29:4000/etr290/etr-<decoder-id>

# Start again (replace URL):
curl -s -X POST http://10.67.18.29:4000/etr290/start \
  -H "Content-Type: application/json" \
  -d '{"id": "etr-<decoder-id>", "url": "udp://239.x.x.x:PORT"}'
```

### ETR not starting on SRT source

If ETR returns 422 on an SRT source, the relay may not be running.

```bash
# Check relay:
docker compose logs labotech | grep -i "srt-relay" | tail -10

# Expected: [srt-relay:SRT-FEED-01-relay] ffmpeg exited... restart in 5000ms
# or:       SRT relay ready → udp://127.0.0.1:55xx
```

If relay is not starting, restart the decoder:

```bash
curl -s -X DELETE http://10.67.18.29:4000/analyse/etr-<decoder-id>
curl -s -X POST http://10.67.18.29:4000/analyse/start -H "Content-Type: application/json" \
  -d '{"id": "<decoder-id>", "url": "srt://..."}'
```

---

## 10. Priority Alarm Quick Reference

### P1 — Immediate Action

| Alarm | First Check | Second Check |
|---|---|---|
| TS Sync Loss | Is source encoder running? | Check SRT/UDP receive (zero pkt → source down) |
| PAT Error | ffprobe PIDs — do they appear? | Contact encoder operator if PAT absent >30 s |
| CC Error | SRT stats: pktDropped > 0? | Network packet loss (traceroute, BER) |
| PMT Error | Same as PAT Error | — |
| PID Error | Source programme structure changed? | Restart decoder to reprobe |

### P2 — Monitor Closely

| Alarm | First Check | Second Check |
|---|---|---|
| Transport Error | Network BER / optical power | Single event within 30 s = normal |
| PCR Discontinuity | Encoder restart? | TS Analyser: dvb.timestampDiscontinuity trend |
| PCR Accuracy | SRT jitter / iatP95 | Encoder PCR insertion interval |
| PTS Error | Isolated at start? (normal) | Recurring → encoder mux fault |
| CRC Error | Optical/cable path error | — |

### P3 — Schedule Investigation

| Alarm | Notes |
|---|---|
| NIT / SDT / EIT / RST / TDT Error | Non-service-threatening. Check if broadcaster is sending correct SI. |
| Empty Buffer | Source bitrate dip — check encoder output |

---

## 11. Noise Suppression Summary

Labotech applies several layers of noise suppression to prevent false P2/P1 incidents:

| Mechanism | Value | Effect |
|---|---|---|
| Startup grace | 5 s | No incidents during first 5 s after monitor start |
| Burst window | 30 s | Hit counter resets if check is quiet for 30 s; requires burst, not lifetime accumulation |
| Noisy check defaults | `transport_error: 3`, `pcr_disc: 3` | Requires 3 hits before incident (vs 1 for other checks) |
| Relay startup buffer | 600 ms | Relay fires `ready` event after 600 ms to ensure stream is flowing before consumers start |
| Incident clear grace | 12 s | Incident held open for 12 s after last match before resolving — prevents flapping |

---

*Document maintained by engineering. Update with each ETR-related release.*

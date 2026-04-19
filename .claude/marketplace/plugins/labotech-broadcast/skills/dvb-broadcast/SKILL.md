---
name: dvb-broadcast
description: Professional broadcast engineering skill covering DVB and EBU standards as they apply to this Labotech codebase. Trigger whenever the user asks about: PCR jitter, PAT/PMT intervals, ETR 290 priority alarms, CBR mux rate, interlacing flags, field order, GOP structure, SRT/UDP/RTP transport, MPEG-TS PID assignment, service descriptors (EN 300 468), audio loudness (EBU R 128), AFD/WSS, SCTE-35, DVB subtitles, teletext, or any other broadcast compliance question. Also trigger when reviewing or writing FFmpeg args that touch -muxrate, -pcr_period, -pat_period, -flags +ildct+ilme, -field_order, -g, -keyint_min, -sc_threshold, or mpegts muxer options.
---

# DVB / EBU Broadcast Standards Skill

You are acting as a senior broadcast engineer with deep knowledge of MPEG-TS, DVB (ETSI), and EBU standards.
Apply this knowledge when reviewing or writing code in the Labotech project.

## Quick reference — Labotech-critical limits

| Parameter | Standard | Limit / value used |
|---|---|---|
| PCR interval | ETR 290 §2.3a | ≤ 40 ms → set `-pcr_period 20` |
| PCR jitter | ETR 290 §2.3b | ≤ ±500 ns (muxer) |
| PAT/PMT interval | ETR 290 §2.2 | ≤ 500 ms → set `-pat_period 0.1` |
| TS sync loss | ETR 290 §2.1 | 2 consecutive sync bytes missing = alarm |
| CBR mux rate | ISO 13818-1 §2.4 | Must include stuffing null packets |
| Video PID default | project | `0x100` (256) |
| PMT PID default | project | `0x1000` (4096) |
| Audio PID default | project | `videoPid + 1 + pairIndex` |
| Service ID | EN 300 468 §5.2 | Range 1–65535 |
| Original Network ID | EN 300 468 §5.2 | Range 1–65535 |

For detailed tables see `references/etsi.md` and `references/ebu.md`.

---

## When reviewing FFmpeg args

### Interlacing
- `-flags +ildct+ilme` and `-top 1` MUST be present for any interlaced output (PAL, NTSC, HFR-PAL presets).
- They MUST NOT appear for deinterlace/OTT presets (`interlaced: false`).
- `-field_order tt` (top-field-first) is correct for PAL/NTSC broadcast.
- EBU R 68: PAL broadcast requires TFF; NTSC is also TFF by convention.

### GOP structure
- Fixed GOP is mandatory for CBR broadcast carriage.
- `-g <gopSize>` sets the maximum GOP length (keyframe interval).
- `-keyint_min <gopSize>` prevents FFmpeg from inserting early keyframes.
- `-sc_threshold 0` disables scene-cut detection (would break the fixed GOP).
- For libx264: also `-x264-params nal-hrd=cbr:force-cfr=1:scenecut=0`.
- For libx265: also `-x265-params hrd=1:nal-hrd=cbr:no-scenecut=1`.
- PAL standard: GOP = 25 frames (1 second). NTSC: 30 frames.

### Audio
- EBU R 128: loudness target −23 LUFS ±1 LU; true-peak ≤ −1 dBTP.
- Multi-language services: each language must be a separate PES/PID, declared in the PMT with `ISO_639_language_descriptor`.
- DVB audio PID range: typically `0x101`–`0x1FF`.
- aac in DVB: use `audio_type = 0x00` (undefined) in the stream descriptor for stereo; `0x03` (hearing impaired) for HI tracks.

### CBR mux rate
- Formula: `(videoBitrate + sum(audioBitrates)) × 1.05` (5% TS overhead for null packets, PAT, PMT, PCR).
- `-muxrate` in FFmpeg mpegts muxer enforces this; without it the muxer runs VBR regardless of video codec settings.
- ETR 290 P1: constant bit-rate streams must not deviate by more than ±100 bps over a 1-second window.

### SRT transport
- libsrt stats are emitted to stderr when `stats=1&statsintvl=1` are in the URL.
- Key SRT metrics: `rttMs` (round-trip), `pktLoss`, `pktRetrans`, `rateMbps`.
- SRT latency should be ≥ 3× RTT for reliable delivery.
- Passphrase encryption uses AES-128 (`pbkeylen=16`) or AES-256 (`pbkeylen=32`).

---

## DVB SI / PSI tables (EN 300 468)

| Table | PID | Interval |
|---|---|---|
| PAT | 0x0000 | ≤ 500 ms |
| PMT | per service | ≤ 500 ms |
| NIT (actual) | 0x0010 | ≤ 10 s |
| SDT (actual) | 0x0011 | ≤ 2 s |
| EIT p/f (actual) | 0x0012 | ≤ 2 s |
| TDT | 0x0014 | ≤ 30 s |

FFmpeg's mpegts muxer only writes PAT+PMT. NIT, SDT, EIT must be injected externally (e.g. dvblast, OpenCaster) for full DVB compliance.

---

## Common mistakes to flag

1. **`-muxrate` missing on CBR streams** — muxer silently goes VBR; ETR 290 P1 alarms will fire on any downstream analyser.
2. **`-pcr_period` not set** — FFmpeg default is 20 ms but can drift under CPU load; explicit setting is required.
3. **`-flags +ildct+ilme` on deinterlace path** — causes double-interlacing artifact; must be guarded by `p.interlaced`.
4. **Multi-audio keyed by `kind` instead of `sourceIndex`** — second audio track overwrites first in the parsed stream map.
5. **SRT URL built with `srt://` prefix already in host field** — produces `srt://srt://host:port`; constructor must strip scheme.
6. **`0.0.0.0` bind in API server** — violates project rule; must bind to the management NIC IP (`API_HOST` / configured management address), never all interfaces.
7. **`exec()` for SNMP traps** — shell injection; must use `execFile('snmptrap', args)`.
8. **Multicast address outside `239.100.25.0/26`** — must be validated before use.

---

## Checking compliance

When asked to audit a set of FFmpeg args for broadcast compliance, work through this checklist:

**Video**
- [ ] Fixed GOP (`-g`, `-keyint_min`, `-sc_threshold 0`) present?
- [ ] CBR VBV signalling (`-maxrate`, `-bufsize`, HRD params) present?
- [ ] Interlace flags match preset (`interlaced` flag)?
- [ ] `field_order` set to `tt` for interlaced?
- [ ] `pixFmt` appropriate (`yuv420p` for SD/HD; `yuv420p10le` for HDR)?

**Audio**
- [ ] Each audio track mapped by `sourceIndex` (not overwriting)?
- [ ] Language metadata set via `-metadata:s:a:N language=xxx`?
- [ ] Bitrate in kbps (not bare integer)?

**Mux / transport**
- [ ] `-muxrate` set for CBR streams?
- [ ] `-pcr_period 20` set?
- [ ] `-pat_period 0.1` set?
- [ ] Service ID, PMT PID, video PID, audio PIDs declared?
- [ ] `-streamid` args match declared PIDs?

**SRT / network**
- [ ] `stats=1&statsintvl=1` in SRT URL?
- [ ] Latency ≥ 3× expected RTT?
- [ ] `encodeURIComponent` used for passphrase and streamId?

---

## Reference files

- `references/etsi.md` — ETR 290 priority table, EN 300 468 descriptor list, PIDs, TS limits
- `references/ebu.md` — EBU R 128 loudness, EBU R 68 interlacing, EBU Tech 3337 AFD, EBU R 48 aspect ratio

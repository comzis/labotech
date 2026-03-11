# EBU Reference — R 128, R 68, Tech 3337, R 48, Tech 3293

## EBU R 128 — Loudness Normalisation

Mandatory for EBU-compliant broadcast delivery.

| Parameter | Value |
|---|---|
| Programme Loudness | −23 LUFS (±1 LU tolerance) |
| True-Peak Maximum | −1 dBTP |
| Loudness Range (LRA) | ≤ 20 LU recommended |
| Measurement gate | −10 LU relative (gated) |
| Measurement window | Momentary: 400 ms; Short-term: 3 s; Integrated: full programme |

### FFmpeg loudness filter
```
loudnorm=I=-23:LRA=11:TP=-1
```
For two-pass accurate measurement:
```bash
# Pass 1 — measure
ffmpeg -i input.ts -af loudnorm=I=-23:LRA=11:TP=-1:print_format=json -f null -
# Pass 2 — apply with measured values
ffmpeg -i input.ts -af loudnorm=I=-23:LRA=11:TP=-1:measured_I=<I>:measured_LRA=<LRA>:measured_TP=<TP>:measured_thresh=<thresh>:offset=<offset>:linear=true output.ts
```

### Audio codec loudness notes
- AAC: encoder applies its own AGC; disable with `-aac_coder twoloop` or encode at target level.
- MP2: no built-in loudness management; loudness must be controlled upstream.
- EBU R 128 S1 (streaming): same targets apply.

---

## EBU R 68 — Interlacing

Defines field order and scanning for PAL/NTSC broadcast.

| Format | Field order | Frame rate | Field rate |
|---|---|---|---|
| 1080i50 (PAL) | Top Field First (TFF) | 25 fps | 50 Hz |
| 1080i59.94 (NTSC) | Top Field First (TFF) | 29.97 fps | 59.94 Hz |
| 576i50 (SD PAL) | Top Field First (TFF) | 25 fps | 50 Hz |
| 480i59.94 (SD NTSC) | Bottom Field First (BFF) | 29.97 fps | 59.94 Hz |

### FFmpeg interlacing flags
- `-field_order tt` = top-field-first (TFF) for PAL/NTSC 1080i
- `-field_order bb` = bottom-field-first (BFF) for SD NTSC (rare in this project)
- `-flags +ildct+ilme` = enable interlaced DCT + interlaced motion estimation (libx264/libx262)
- `-top 1` = signal top-field-first in the video stream header

### Interlace filter (encoder path)
```
interlace=scan=tff:lowpass=1
```
- `lowpass=1`: vertical low-pass to reduce interlace twitter on fine horizontal detail.
- `scan=tff`: produces Top Field First output.

### Deinterlace filter (OTT/IP path)
```
yadif=mode=send_frame:parity=tff:deint=all
```
- `mode=send_frame`: one output frame per input frame (not field — use `send_field` for double-rate).
- `parity=tff`: hint that input is TFF.
- `deint=all`: deinterlace all frames (not just interlaced-flagged ones).

---

## EBU Tech 3337 — AFD (Active Format Description)

AFD signals the active picture area within the video frame.

| AFD code | Meaning | Use |
|---|---|---|
| 0000 | Unspecified | Default if not signalled |
| 1000 | Full frame (16:9 or 4:3) | Full-screen content |
| 1001 | Full frame (4:3 letterboxed in 16:9) | SD content in HD wrapper |
| 1010 | 16:9 letterbox in 4:3 frame | HD content in SD |
| 1011 | 14:9 letterbox in 4:3 | 14:9 intermediate |
| 1101 | 4:3 pillarbox in 16:9 | SD content in HD |
| 1110 | 16:9 anamorphic | Anamorphic source |
| 1111 | Full frame (same AR as coded frame) | Native content |

AFD is carried in the video user data SEI (H.264/H.265) or MPEG-2 user_data.
In MPEG-TS it can also be carried in a `data_broadcast_descriptor` in the PMT.

---

## EBU R 48 — Aspect Ratio Signalling

| Coded frame | Display AR | WSS/AFD required |
|---|---|---|
| 16:9 progressive | 16:9 | AFD 1000 |
| 4:3 with 16:9 content | 16:9 letterbox | AFD 1010 |
| 16:9 with 4:3 content | 4:3 pillarbox | AFD 1101 |

WSS (Wide Screen Signalling) is the SD analogue equivalent; irrelevant for HD/UHD.

---

## EBU Tech 3293 — DVB Subtitles

DVB subtitles are carried in a separate PES on their own PID, declared in PMT with `subtitling_descriptor` (tag 0x59).

| Field | Value |
|---|---|
| PES stream ID | 0xBD (private stream 1) |
| Subtitle type | 0x01 (DVB subtitles, no AR) / 0x10 (DVB subtitles with AR) |
| Ancillary page ID | Secondary page for HI subtitles |

FFmpeg does not natively mux DVB bitmap subtitles. External tools (e.g. Subtitle Workshop, OpenCaster) are required for full DVB subtitle compliance.

---

## EBU R 22 — Multichannel Audio

| Channel | Label |
|---|---|
| 1 | Left (L) |
| 2 | Right (R) |
| 3 | Centre (C) |
| 4 | Low Frequency Effects (LFE) |
| 5 | Left Surround (Ls) |
| 6 | Right Surround (Rs) |

5.1 in DVB: typically carried as Dolby AC-3 or E-AC-3 (descriptor 0x6A / 0x7A).
AAC 5.1 is also valid under DVB (descriptor 0x7C with `component_type = 0x05`).

In FFmpeg: `-ac 6` for 5.1; channel layout must be `5.1(side)` for correct surround mapping.

---

## EBU R 29 — Contribution Codec Levels (reference only)

| Level | Typical use | Max bitrate |
|---|---|---|
| Lossless / JPEG 2000 | Studio contribution | 500 Mbps |
| AVC High Profile L4.1 | HD contribution | 50 Mbps |
| HEVC Main 10 | 4K contribution | 150 Mbps |
| AVC HP L3.2 | HD distribution | 15–20 Mbps |
| AVC HP L3.1 | HD streaming | 8–12 Mbps |

Labotech default: AVC High Profile, 8 Mbps, 1080p/i — consistent with HD distribution tier.

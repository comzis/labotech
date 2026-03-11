# ETSI / DVB Reference — ETR 290 & EN 300 468

## ETR 290 (TS 101 290) Priority Alarms

### Priority 1 — Transport stream syntax
| ID | Test | Threshold |
|---|---|---|
| 1.1 | TS sync byte loss | 2 consecutive 0x47 missing |
| 1.2 | Sync byte error | Wrong value at sync position |
| 1.3 | PAT error | Missing or interval > 500 ms |
| 1.3a | PAT 2 | No program with NIT in PAT |
| 1.4 | Continuity counter error | Wrong sequence |
| 1.5 | PMT error | Missing or interval > 500 ms |
| 1.6 | PID error | Referenced PID not present for > 5 s |

### Priority 2 — Transport stream
| ID | Test | Threshold |
|---|---|---|
| 2.1 | Transport error indicator | Set in header |
| 2.2 | CRC error | Bad CRC in PSI |
| 2.3a | PCR discontinuity | > 100 ms gap |
| 2.3b | PCR accuracy | Jitter > ±500 ns |
| 2.3c | PCR interval | > 40 ms |
| 2.4 | PTS error | PTS not monotonically increasing |
| 2.5 | CAT error | CA PID present but no CAT |

### Priority 3 — Application
| ID | Test |
|---|---|
| 3.1 | NIT actual missing (PID 0x0010) |
| 3.2 | SI repetition rates out of range |
| 3.3 | Unreferenced PID |
| 3.4 | SDT actual missing |
| 3.5 | EIT p/f actual missing |
| 3.6 | RST missing |
| 3.7 | TDT/TOT missing |

---

## EN 300 468 — DVB SI Descriptors (common)

| Tag | Name | Use |
|---|---|---|
| 0x40 | network_name_descriptor | NIT |
| 0x41 | service_list_descriptor | NIT |
| 0x43 | satellite_delivery_system | NIT |
| 0x44 | cable_delivery_system | NIT |
| 0x47 | bouquet_name_descriptor | BAT |
| 0x48 | service_descriptor | SDT — name, provider, type |
| 0x4A | linkage_descriptor | SDT, NIT |
| 0x4D | short_event_descriptor | EIT — title + short text |
| 0x4E | extended_event_descriptor | EIT — full description |
| 0x52 | stream_identifier_descriptor | PMT — component tag |
| 0x56 | teletext_descriptor | PMT |
| 0x59 | subtitling_descriptor | PMT — DVB subtitles |
| 0x5A | terrestrial_delivery_system | NIT |
| 0x6A | AC-3 (Dolby) descriptor | PMT |
| 0x7A | enhanced_AC-3 descriptor | PMT |
| 0x7C | AAC descriptor | PMT |
| 0x81 | ISO_639_language_descriptor | PMT — audio language |

### ISO 639-2 Audio Language Codes (common)
| Code | Language | Audio type |
|---|---|---|
| `eng` | English | 0x00 (undefined/main) |
| `fra` | French | 0x00 |
| `deu` | German | 0x00 |
| `spa` | Spanish | 0x00 |
| `ita` | Italian | 0x00 |
| `por` | Portuguese | 0x00 |
| `ara` | Arabic | 0x00 |
| Audio type `0x01` | Clean effects (no dialogue) | |
| Audio type `0x02` | Hearing impaired (HI) | |
| Audio type `0x03` | Visual impaired commentary | |

---

## MPEG-TS PID Ranges (ISO 13818-1)

| Range | Use |
|---|---|
| 0x0000 | PAT |
| 0x0001 | CAT |
| 0x0002 | TSDT |
| 0x0003–0x000F | Reserved |
| 0x0010 | NIT, ST |
| 0x0011 | SDT, BAT, ST |
| 0x0012 | EIT, ST, CIT |
| 0x0013 | RST, ST |
| 0x0014 | TDT, TOT, ST |
| 0x0015 | Network synchronisation |
| 0x0016–0x001B | Reserved |
| 0x001C | Inband Signalling |
| 0x001D | Measurement |
| 0x001E | DIT |
| 0x001F | SIT |
| 0x0020–0x1FFE | General purpose (video, audio, data, PMT) |
| 0x1FFF | Null packets |

Labotech defaults: video `0x100` (256), PMT `0x1000` (4096), audio from `0x101` upward.

---

## CBR Mux Rate Calculation

```
muxrate = (videoBps + sum(audioBps)) × 1.05
```

- The 5% overhead covers: null stuffing packets, PAT, PMT, PCR, and TS headers.
- ETR 290 P1: CBR streams must not deviate > ±100 bps over 1 s.
- FFmpeg: `-muxrate <bytes_per_second>` (note: FFmpeg takes bits/s, not bytes/s — confirmed by mpegts muxer source).
- Without `-muxrate`, the mpegts muxer produces VBR output regardless of `-b:v` and `-maxrate`.

---

## DVB Service Types (EN 300 468, Table 87)

| Value | Service type |
|---|---|
| 0x01 | Digital television service (SD) |
| 0x02 | Digital radio sound service |
| 0x16 | Advanced codec digital HD television service |
| 0x19 | Advanced codec HD digital television service (HEVC) |
| 0x1F | UHD service (HEVC) |

---

## SCTE-35 Integration Notes

- Splice points are signalled in-band at PID declared in PMT with `registration_descriptor('CUEI')`.
- Labotech `src/scte35.js` handles splice insert / splice null injection.
- EBU/SMPTE: SCTE-35 messages should arrive ≥ 4 s before splice point for reliable downstream switching.
- `splice_immediate` flag bypasses the pre-roll; use only for emergency interrupts.

# SRT Encapsulator Fine-Tuned Profile

Date: 2026-03-14  
Target: HPE DL360 (Ubuntu), Docker host networking, Labotech `v2.0.0+`

## Objective

Run SRT encapsulation as an isolated sidecar with predictable CPU behavior, guardrail protection, and verified `libsrt` capability, while keeping the main Labotech control-plane stable.

## Final Architecture

- `labotech` container: UI + API + legacy modules (`/streams`, `/transcode`, `/multicast`, `/analyse`, `/etr290`)
- `labotech-encapsulator` container: dedicated SRT encapsulation service (`/encap/*` via API proxy)
- Main API proxies sidecar endpoints:
  - `/encap/health`
  - `/encap/channels`
  - `/encap/channels/:id`

## Fine-Tuned Runtime Profile

Use this exact `docker-env.txt` baseline:

```bash
API_HOST=10.67.18.29
API_PORT=4000

LABOTECH_CPUS=4.0
LABOTECH_CPUSET=0-3
LABOTECH_MEM_LIMIT=4096m
LABOTECH_SHM_SIZE=512m

ENCAPSULATOR_CPUS=4.0
ENCAPSULATOR_CPUSET=4-7
ENCAPSULATOR_MEM_LIMIT=4096m
ENCAPSULATOR_SHM_SIZE=256m

ENCAPSULATOR_HOST=127.0.0.1
ENCAPSULATOR_PORT=4100

ENCAP_CPU_GUARDRAIL_ENABLED=true
ENCAP_CPU_WARN_PCT=70
ENCAP_CPU_BLOCK_PCT=75
ENCAP_CAPACITY_PER_CORE=20
ENCAP_CAPACITY_STREAM_MBPS=22

TS_INPUT_FIFO_SIZE=10000000
TS_INPUT_TIMEOUT_US=7000000
TS_INPUT_REORDER_QUEUE_SIZE=512
```

## Capacity Model (Guardrail Ceiling — Not a Throughput Guarantee)

`ENCAP_CAPACITY_PER_CORE=20` defines the per-core admission ceiling used by the guardrail logic:

```
guardrailCeiling = ENCAPSULATOR_CORES × ENCAP_CAPACITY_PER_CORE
```

Example with `ENCAPSULATOR_CPUSET=4-7` (4 cores): ceiling = `4 × 20 = 80`.

**This is a configured admission threshold, not a validated throughput figure.** Real usable capacity depends on live traffic profile (bitrate mix, burst behaviour, SRT retransmit load) and host conditions (CPU activity from other containers, memory pressure, NIC saturation). The `ENCAP_CPU_BLOCK_PCT=75` CPU ceiling is the primary runtime safety net and takes precedence over the stream-count ceiling.

Guardrail behaviour:

- `warn`: at/above `ENCAP_CPU_WARN_PCT` (CPU) or 90% of stream ceiling — operator alert only
- `block`: refuses new channel start with HTTP `429` when `ENCAP_CPU_BLOCK_PCT` or stream ceiling is exceeded

Treat the stream ceiling as a starting point for capacity planning; validate against observed CPU headroom under real traffic before committing to it operationally.

## Deployment Commands

```bash
cd "/path/to/LaboTech"
git fetch --all --tags
git checkout v2.0.0

docker compose down
docker compose up -d --build
docker compose ps
```

## Verification Commands

```bash
curl "http://10.67.18.29:4000/health"
curl "http://10.67.18.29:4000/encap/health"
curl "http://10.67.18.29:4000/encap/channels"
```

Expected encapsulator health signals:

- `"status":"ok"`
- `"capabilities":{"libsrt":true,...}`
- `"guardrail":{"enabled":true,...}`

## Protocol Behavior

- Supported ingest for encapsulation:
  - `rtp://...` -> SRT output
  - `udp://...` -> SRT output
- Output:
  - SRT caller (`srt://target:port?...`)
- Pipeline mode:
  - TS pass-through (`copy`), no video transcode

## Functional Smoke Template

Create one UDP->SRT and one RTP->SRT test channel:

```bash
curl -X POST "http://10.67.18.29:4000/encap/channels" \
  -H "Content-Type: application/json" \
  -d '{"id":"smoke-udp-srt","input":"udp://127.0.0.1:6000","host":"127.0.0.1","port":9000,"latency":2000}'

curl -X POST "http://10.67.18.29:4000/encap/channels" \
  -H "Content-Type: application/json" \
  -d '{"id":"smoke-rtp-srt","input":"rtp://127.0.0.1:5000","host":"127.0.0.1","port":9001,"latency":2000}'
```

Cleanup:

```bash
curl -X DELETE "http://10.67.18.29:4000/encap/channels/smoke-udp-srt"
curl -X DELETE "http://10.67.18.29:4000/encap/channels/smoke-rtp-srt"
```

## Rollback

```bash
docker compose down
git checkout <previous-stable-tag>
docker compose up -d --build
```

## Notes

- On macOS dev hosts, memory usage may appear near 100% due to cache accounting. Use pressure/swap indicators for real pressure assessment.
- `libsrt` health detection is protocol-based (`ffmpeg -protocols` must show `srt`).

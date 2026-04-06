# Production Runbook: Forward + Probe Verification

This runbook validates end-to-end multicast forwarding and TS probing in production, then cleanly rolls back the test forwarder.

## Preconditions

- API is reachable on `http://<YOUR_SERVER_IP>:4000`
- Docker/system service is healthy (`/health` returns `status: ok`)
- You have a known-live RTP source URL (example used below):
  - `rtp://239.100.29.49:6501`

## 6-command workflow

1) **Start test forwarder**

```bash
curl -sS -X POST "http://<YOUR_SERVER_IP>:4000/multicast/forward" -H "Content-Type: application/json" -d '{"id":"fwd-smoke-1","sourceUrl":"rtp://239.100.29.49:6501","destIp":"239.100.25.29","destPort":6501,"engineerApproved":true}'
```

2) **Confirm forwarder is active**

```bash
curl -sS "http://<YOUR_SERVER_IP>:4000/multicast/forward"
```

3) **Run analyser probe against forwarded destination**

```bash
curl -sS "http://<YOUR_SERVER_IP>:4000/analyse?url=rtp://239.100.25.29:6501"
```

4) **Stop test forwarder**

```bash
curl -sS -X DELETE "http://<YOUR_SERVER_IP>:4000/multicast/forward/fwd-smoke-1"
```

5) **Confirm forwarder list is empty/expected**

```bash
curl -sS "http://<YOUR_SERVER_IP>:4000/multicast/forward"
```

6) **Clear test event noise (optional but recommended)**

```bash
curl -sS -X DELETE "http://<YOUR_SERVER_IP>:4000/api/events"
```

## Expected outcomes

- Command 1 returns forwarder JSON (no `error` key).
- Command 3 returns analyser JSON payload (program/stream data) instead of ffprobe error.
- Command 5 no longer shows `fwd-smoke-1`.

## Troubleshooting

- `spawn ip ENOENT`:
  - Runtime image is missing `iproute2`, rebuild image with `iproute2` installed.
- `ffprobe exited 1` with empty stderr:
  - Usually no traffic at destination group/port.
  - Re-check source URL is live and forwarding started successfully.
- `Input/output error` from ffprobe:
  - Traffic absent or payload is not decodable MPEG-TS on that URL.

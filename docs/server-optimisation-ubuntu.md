# Server Optimisation Runbook (Ubuntu)

This runbook is for Ubuntu hosts running Labotech with Docker Compose.
It focuses on preventing process storms and keeping decoder thumbnail and analyser workloads stable.

## Scope

- Host OS: Ubuntu (systemd + Docker Compose v2)
- Runtime services:
  - `labotech` (often container name `labotech-dev` in dev compose)
  - `labotech-encapsulator`
- Target symptom class:
  - runaway `tshark`/`tsp`/`ffmpeg` worker fan-out
  - high PID count and sustained high CPU
  - slow thumbnail behavior caused by probe-worker contention

## 1) Required Runtime Settings (`.env`)

Set these keys in server `.env` (repository root on server):

```bash
NODE_OPTIONS=--max-old-space-size=6144
TS_HEAVY_PROBE_MAX_CONCURRENT=2

ANALYSER_URL_DEDUP_GUARD=true
ANALYSER_URL_DEDUP_CHECK_MS=10000
ANALYSER_URL_RESTART_COOLDOWN_MS=45000
ANALYSER_URL_DEDUP_ALERT_WINDOW_MS=60000
ANALYSER_URL_DEDUP_ALERT_THRESHOLD=5
```

Quick verify:

```bash
grep -E '^(NODE_OPTIONS|TS_HEAVY_PROBE_MAX_CONCURRENT|ANALYSER_URL_DEDUP_GUARD|ANALYSER_URL_DEDUP_CHECK_MS|ANALYSER_URL_RESTART_COOLDOWN_MS|ANALYSER_URL_DEDUP_ALERT_WINDOW_MS|ANALYSER_URL_DEDUP_ALERT_THRESHOLD)=' .env
```

## 2) Deploy Flow (Ubuntu server)

Use the project-safe deploy path:

```bash
bash scripts/update-and-deploy-safe.sh
```

Or explicit sequence:

```bash
git checkout main
git pull --ff-only origin main
docker compose -f docker-compose.dev.yml build labotech
docker compose -f docker-compose.dev.yml up -d --force-recreate labotech
```

## 3) Post-Deploy Verification

Use the management bind IP from your environment (`API_HOST`), not always `127.0.0.1`.

```bash
docker compose -f docker-compose.dev.yml ps
curl -sS http://<API_HOST>:4000/health
curl -sS http://<API_HOST>:4000/api/analyse/active | jq 'length'
docker stats --no-stream labotech-dev
docker top labotech-dev -eo pid,ppid,pcpu,pmem,comm,args | sed -n '1,120p'
```

## 4) What "Healthy" Looks Like

- `docker compose ps`: `labotech` and `labotech-encapsulator` are `healthy`.
- `/health`:
  - `status: "ok"`
  - expected runtime version
  - `telemetry.analyserDedup` present
- PID and CPU:
  - no uncontrolled growth in PID count
  - CPU remains bounded around active workload, not multi-thousand percent sustained
- Process list:
  - one coherent worker set per active decoder lane
  - no repeated duplicate watcher chains for the same URL

## 5) Dedupe/Auto-Heal Signals

Expected one-time logs on startup when old duplicate state exists:

- `Skipping duplicate analyser ...`
- `Auto-stopped orphan ETR monitor ...`

These indicate cleanup is working, not failure.

From `/health`:

- `telemetry.analyserDedup.duplicateAutoStopped`
- `telemetry.analyserDedup.staleAutoStopped`
- `telemetry.analyserDedup.alertsRaised`

If `alertsRaised` increments repeatedly, treat as control-loop instability and investigate client start behavior.

## 6) Fast Incident Response (Ubuntu)

1. Capture evidence first:
   - `docker compose -f docker-compose.dev.yml ps`
   - `docker stats --no-stream labotech-dev`
   - `docker top labotech-dev -eo pid,ppid,pcpu,pmem,comm,args | sed -n '1,200p'`
   - `docker logs --since 10m labotech-dev | sed -n '1,240p'`
2. Confirm `.env` contains required keys.
3. Recreate service:
   - `docker compose -f docker-compose.dev.yml up -d --force-recreate labotech`
4. Re-check `/health` and PID/CPU after 1-2 minutes.

## 7) Ubuntu Notes

- Compose warning about top-level `version:` in compose files is cosmetic when present; remove it to keep output clean.
- Some minimal container shells do not provide `ps`/`pgrep`; use `docker top` from host instead.
- Host tuning scripts remain available:
  - `sudo bash scripts/optimize-host-v2.sh`
  - `sudo bash scripts/rollback-host-optimization-v2.sh`

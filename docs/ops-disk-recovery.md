# Disk Recovery Runbook

Use this runbook when deploys fail with `No space left on device` or root disk approaches 100%.

## 1) Fast Triage

```bash
cd ~/LaboTech/labotech
df -h
docker system df
```

If `/` is near full or Docker usage is high, continue to emergency reclaim.

## 2) Emergency Reclaim (Aggressive)

This removes unused Docker images/cache/volumes and may stop running services.

```bash
cd ~/LaboTech/labotech
bash scripts/reclaim-disk-fast.sh --yes
```

Re-check space:

```bash
df -h
docker system df
```

If space is still low, identify largest directories:

```bash
sudo du -xhd1 / | sort -rh | head -20
sudo du -xhd1 /var | sort -rh | head -20
sudo du -xhd1 /var/lib/docker | sort -rh | head -20
```

## 3) Install Docker Log Rotation (Prevention)

Docker JSON logs can silently grow and quickly fill root disk. Install persistent rotation:

```bash
cd ~/LaboTech/labotech
sudo bash scripts/install-docker-log-rotation.sh
```

Verify current settings and largest active log files:

```bash
bash scripts/check-docker-log-rotation.sh
```

Optional custom limits:

```bash
sudo MAX_SIZE=100m MAX_FILES=5 bash scripts/install-docker-log-rotation.sh
```

## 4) Resume Deploy

After cleanup:

```bash
cd ~/LaboTech/labotech
git fetch --prune origin && git pull --ff-only origin main
bash scripts/update-and-deploy-safe.sh
```

## 5) Notes and Risks

- `reclaim-disk-fast.sh --yes` is intentionally destructive for unused Docker artifacts.
- Next deploy can be slower because images must be rebuilt/pulled.
- If service uptime is critical, schedule aggressive reclaim during maintenance windows.
- Keep at least several GB free before deploy; low free space can break `git fetch` and Docker builds.

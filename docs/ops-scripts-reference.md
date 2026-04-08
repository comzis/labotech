# Operations Scripts Reference

Canonical usage guide for scripts under `scripts/`.

Related runbooks:

- `docs/server-optimisation-ubuntu.md` — Ubuntu-specific runtime optimization, verification, and incident response.
- `docs/day1-monitoring-checklist.md` — first-24h post-deploy monitoring cadence.

## Host Setup and Network

### `scripts/setup-host.sh`
- **Purpose:** one-time Ubuntu host bootstrap (dependencies, UDP sysctl, multicast route, NIC prep).
- **Run as:** root.
- **Command:** `sudo bash scripts/setup-host.sh`
- **Key env:** `MULTICAST_NIC`, `FORWARD_MULTICAST_SUBNET`.

### `scripts/check-routes.sh`
- **Purpose:** verify multicast route, rp_filter, UDP sysctl, interface state, IGMP memberships.
- **Run as:** regular user (sudo optional for fuller visibility).
- **Command:** `bash scripts/check-routes.sh`
- **Key env:** `MULTICAST_NIC`, `FORWARD_MULTICAST_SUBNET`.

### `scripts/add-multicast-route.sh`
- **Purpose:** idempotently add forward subnet route on multicast NIC.
- **Run as:** root.
- **Command:** `sudo bash scripts/add-multicast-route.sh`
- **Key env:** `MULTICAST_NIC`, `FORWARD_MULTICAST_SUBNET`.

### `scripts/optimize-host-v2.sh`
- **Purpose:** apply high-throughput host tuning profile (sysctl + governor + irqbalance).
- **Run as:** root.
- **Command:** `sudo bash scripts/optimize-host-v2.sh`
- **Rollback:** `sudo bash scripts/rollback-host-optimization-v2.sh`
- **Key env:** `MGMT_NIC`, `MULTICAST_NIC`, `FORWARD_MULTICAST_SUBNET`.

### `scripts/rollback-host-optimization-v2.sh`
- **Purpose:** remove v2 profile and restore prior/default governor/sysctl.
- **Run as:** root.
- **Command:** `sudo bash scripts/rollback-host-optimization-v2.sh`

## Deploy and Recovery

### `scripts/update-and-deploy-safe.sh`
- **Purpose:** safe production flow: disk headroom checks, optional auto-clean, git update, deploy.
- **Run as:** regular deploy user on server.
- **Command:** `bash scripts/update-and-deploy-safe.sh`
- **Args:** `[API_HOST] [API_PORT] [SERVICE]` (defaults: `<YOUR_SERVER_IP>`, `4000`, `labotech`).
- **Key env:** `MIN_FREE_MB`, `MIN_FREE_INODE_PCT`, `AUTO_CLEAN_ON_LOW_DISK`, `AUTO_CLEAN_AGGRESSIVE`, `GIT_REMOTE`, `GIT_BRANCH`.

### `scripts/deploy-one-shot.sh`
- **Purpose:** rebuild/restart stack and run health/tooling/preflight/smoke assertions.
- **Run as:** regular deploy user on server.
- **Command:** `bash scripts/deploy-one-shot.sh`
- **Args:** `[API_HOST] [API_PORT] [SERVICE]`.
- **Key env:** `LABOTECH_RELEASE`, `MIN_FREE_MB`, `MIN_FREE_INODE_PCT`, `RECREATE_ALL`, encapsulator triage flags (`ENCAP_*`).

### `scripts/recover-prod-fast.sh`
- **Purpose:** deterministic recovery to a known git ref, rebuild, and health verify.
- **Run as:** regular deploy user.
- **Command:** `bash scripts/recover-prod-fast.sh`
- **Optional ref:** `bash scripts/recover-prod-fast.sh origin/main`

## Disk and Log Operations

### `scripts/disk-housekeeping.sh`
- **Purpose:** safe recurring cleanup (Docker JSON logs, app logs, prune, journal, apt, tmp).
- **Run as:** regular user; sudo/root recommended for maximum cleanup effect.
- **Commands:**
  - One-off: `bash scripts/disk-housekeeping.sh`
  - Daily cron install: `bash scripts/disk-housekeeping.sh --install-cron`
- **Key env:** `DISK_HOUSEKEEPING_LOG`, `WARN_FREE_MB`.

### `scripts/reclaim-disk-fast.sh`
- **Purpose:** aggressive incident cleanup for low-disk deploy failures.
- **Run as:** regular user with sudo available.
- **Command:** `bash scripts/reclaim-disk-fast.sh --yes`
- **Optional:** `--skip-down` (less reclaim potential).
- **Effect:** may stop services and remove unused images/cache/volumes.

### `scripts/install-docker-log-rotation.sh`
- **Purpose:** persist Docker JSON log rotation in `/etc/docker/daemon.json` and restart Docker.
- **Run as:** root.
- **Command:** `sudo bash scripts/install-docker-log-rotation.sh`
- **Optional env:** `MAX_SIZE` (default `50m`), `MAX_FILES` (default `3`), `DOCKER_DAEMON_JSON`.

### `scripts/check-docker-log-rotation.sh`
- **Purpose:** report effective Docker log driver/options and largest JSON logs.
- **Run as:** regular user (sudo optional for full file visibility).
- **Command:** `bash scripts/check-docker-log-rotation.sh`
- **Optional env:** `DOCKER_DAEMON_JSON`.

## Validation and Triage Helpers

### `scripts/preflight-monitoring-tools.sh`
- **Purpose:** verify host tools and read API `/health` tooling/policy fields.
- **Command:** `bash scripts/preflight-monitoring-tools.sh [API_HOST] [API_PORT]`

### `scripts/post-deploy-smoke.sh`
- **Purpose:** minimal health assertion for status/version/release/tooling/policy fields.
- **Command:** `bash scripts/post-deploy-smoke.sh [API_HOST] [API_PORT]`

### `scripts/triage-port-kill.sh`
- **Purpose:** interactive helper to identify/terminate listeners on a port (default `4100`).
- **Command:** `bash scripts/triage-port-kill.sh [PORT]`
- **Key env:** `AUTO_NO=1` to disable kill prompts.

## Service Installation

### `scripts/install-service.sh`
- **Purpose:** install and start systemd unit `labotech.service` on host.
- **Run as:** root.
- **Command:** `sudo bash scripts/install-service.sh`

## Legacy / Caution

### `scripts/rollback-last-tag.sh`
- **Status:** currently references `scripts/deploy-ref.sh`, which is not present in this repository.
- **Recommendation:** prefer `scripts/recover-prod-fast.sh <ref>` for deterministic rollback/recovery.

---

## Removed Redundant Script

- `scripts/emergency-clean.sh` was removed as redundant.
- Use:
  - `scripts/disk-housekeeping.sh` for routine safe cleanup.
  - `scripts/reclaim-disk-fast.sh --yes` for emergency aggressive reclaim.

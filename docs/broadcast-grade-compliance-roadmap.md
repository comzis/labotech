# Broadcast Grade Compliance Roadmap

This roadmap defines a safe rollout for bringing Labotech monitoring closer to broadcast-grade operations while preserving existing decoder/timeline behavior.

## Scope

- Add runtime **tool capability + NIC capture permission preflight**.
- Introduce a central **monitoring policy object** for analyser cadence and core thresholds.
- Keep changes **read-only** for operator UI in this phase (visibility first, no control writes).
- Preserve current event model and analyzer payload compatibility.

## Phase 1 - Capability And Permission Preflight

### Goal

Expose whether required probe tools are present and whether NIC capture is likely usable on the configured multicast interface.

### Implementation

- Add backend preflight module:
  - Check presence/version for `ffmpeg`, `ffprobe`, `tsanalyze`, `tshark`, `tcpdump`.
  - Run a short capture permission smoke test on multicast NIC (`eno2` or configured NIC) using preferred capture tool.
  - Cache and refresh snapshot periodically.
- Extend `/health` with:
  - `tooling.status`, `tooling.tools`, `tooling.nicCapture`, `tooling.checkedAt`.
- Add read-only UI indicator in the top header:
  - Probe status (`READY`/`DEGRADED`/`PENDING`)
  - Capture backend in use (`tshark`/`tcpdump`/none)

### Risks

- Tool commands may behave differently by distro/package version.
- NIC permission probe can be inconclusive in low-traffic windows.

### Mitigation

- Keep probe short and non-fatal.
- Return explicit reason strings in health payload.
- Never block service startup from this check.

## Phase 2 - Monitoring Policy Object

### Goal

Centralize threshold/cadence decisions so analyzer scoring and scheduling are predictable, auditable, and tunable.

### Implementation

- Add `config/monitoring-policy.json` as baseline policy profile.
- Add policy loader module with env override compatibility.
- Wire policy into TS analyser:
  - Probe cadence: `baseIntervalMs`, `heavyProbeEvery`.
  - Health thresholds: loss/jitter/IAT/CC/timestamp score penalties.
  - SMPTE ST 2022-7 thresholds.
  - Bitrate stability envelope checks (warning/critical drift).
- Surface policy summary in:
  - `/health.monitoringPolicy`
  - Analyzer result metadata (`dvb.monitoringPolicy`)
  - Header read-only badge (`Policy <profile>`)

### Risks

- Threshold changes can affect severity distribution and alert coloring.
- Overly strict bitrate envelope may raise noisy warnings on unstable feeds.

### Mitigation

- Keep defaults aligned with existing behavior.
- Start with conservative bitrate drift penalties.
- Keep all thresholds externally tunable.

## Validation Plan

- Backend:
  - `npm test -- test/ts-analyser.test.js`
  - `npm test` (full pass if no blockers)
- Frontend:
  - `cd web && npm run build`
- Manual checks:
  - Confirm `/health` includes `tooling` and `monitoringPolicy`.
  - Confirm header shows probe status + policy profile.
  - Confirm active analyzer still emits `analyse_result` and timeline remains functional.

## Phase 3 - Multi-Rate Probe Scheduler

### Goal

Make probe cadence explicit, time-based, and drift-tolerant to avoid thundering herd effects and unstable heavy-probe timing across many decoders.

### Implementation

- Move heavy probe triggering from cycle-count heuristic to time-based schedule:
  - first continuous cycle runs heavy probe
  - subsequent heavy probes use `heavyProbeIntervalMs`
- Keep base analysis cadence anchored to target timestamps (not elapsed-only loop delay).
- Add cadence knobs in policy:
  - `probeCadence.heavyProbeIntervalMs`
  - `probeCadence.minLoopDelayMs`
  - `probeCadence.startupJitterMaxMs`
- Extend analyser diagnostics with scheduler evidence:
  - active cadence
  - next heavy probe timestamp
  - next probe timestamp

### Risks

- Too short heavy interval can increase host load.
- Too long heavy interval can delay TS/arrival confidence refresh.

### Mitigation

- Conservative defaults (`15s` heavy interval on `5s` base cadence).
- Explicit min loop delay to prevent tight retry loops under probe overrun.
- Keep all values env/policy configurable for site tuning.

## Phase 4 - Operator UI Clarity

### Goal

Make operator trust explicit by showing confidence, source, method, and scheduler/policy context near live bitrate and quality indicators.

### Implementation

- Add analyzer UI indicators for:
  - bitrate confidence (`TRUSTED` / `FALLBACK` / `UNKNOWN`)
  - probe method (`NIC-*` / `ANALYSER` / `UNAVAILABLE`)
  - policy profile and heavy-probe cadence
- Add decoder quality dashboard indicators for the same context.
- Keep changes read-only (no control-path behavior changes).

### Risks

- UI density can increase cognitive load if indicators are too verbose.

### Mitigation

- Keep indicators compact and KPI-style.
- Reuse existing severity palette for consistent interpretation.

## Phase 5 - Ops And Service Hardening

### Goal

Reduce deployment risk by adding deterministic post-deploy checks and explicit runtime readiness scripts.

### Implementation

- Add `scripts/preflight-monitoring-tools.sh`:
  - validates local toolchain presence
  - queries `/health` for tooling/policy summary
- Add `scripts/post-deploy-smoke.sh`:
  - validates required `/health` fields and release metadata
- Add dev compose healthchecks for API and encapsulator services.
- Update engineering runbook with post-deploy command sequence.

### Risks

- Script assumptions may differ across target images.

### Mitigation

- Keep scripts dependency-light (`bash`, `curl`, `node`).
- Keep outputs explicit and actionable for operators.

## Rollout Notes

- No database migration required.
- Safe to deploy as rolling update.
- If needed, rollback by restoring previous `src/api.js`, `src/ts-analyser.js`, and removing policy/preflight modules.

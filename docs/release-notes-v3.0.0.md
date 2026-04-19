# Labotech v3.0.0 Release Notes

Date: 2026-03-14

## Highlights

- Major `v3.0.0` release with broadcast-grade monitoring baseline (Phases 1–5).
- Added backend tooling preflight and policy-aware health exposure for operator trust.
- Added policy-driven multi-rate analyser scheduler with jitter-safe cadence controls.
- Improved UI clarity with confidence/source/method indicators in TS Analyser and Decoder dashboards.
- Added operations hardening scripts and runbook updates for deterministic post-deploy checks.

## Phase Delivery Summary

### Phase 1 - Capability And Permission Preflight

- Added runtime checks for:
  - `ffmpeg`
  - `ffprobe`
  - `tsanalyze`
  - `tshark`
  - `tcpdump`
- Added NIC capture permission smoke-check state in `/health` under `tooling`.
- Added periodic preflight refresh and readiness/degraded status model.

### Phase 2 - Monitoring Policy Object

- Added `config/monitoring-policy.json` as baseline policy profile.
- Added policy loader in `src/monitoring-policy.js` with env override support.
- Wired policy into TS analyser thresholds and health scoring.
- Exposed policy summary in `/health` and analyser payloads.

### Phase 3 - Multi-Rate Scheduler Hardening

- Replaced cycle-only heavy probe behavior with time-based heavy interval logic.
- Added scheduler cadence controls:
  - `baseIntervalMs`
  - `heavyProbeEvery`
  - `heavyProbeIntervalMs`
  - `minLoopDelayMs`
  - `startupJitterMaxMs`
- Added scheduler diagnostics to analyser probe diagnostics for runtime traceability.

### Phase 4 - Operator UI Clarity

- TS Analyser UI now shows:
  - rate confidence (`TRUSTED`/`FALLBACK`/`UNKNOWN`)
  - probe method (`NIC-*`/`ANALYSER`/`UNAVAILABLE`)
  - policy profile
  - heavy probe cadence
- Decoder quality dashboard now mirrors confidence/method/policy context.
- Timeline severity palette and lane tint consistency tightened for clearer triage.

### Phase 5 - Ops And Service Hardening

- Added scripts:
  - `scripts/preflight-monitoring-tools.sh`
  - `scripts/post-deploy-smoke.sh`
- Added dev compose healthchecks for API and encapsulator.
- Updated engineering support runbook with preflight/smoke verification sequence.

## Version And UI Identity

- Backend version: `3.0.0`
- Frontend version: `3.0.0`
- Release label source remains `LABOTECH_RELEASE` (`v3.0.0` expected in deployment env).
- UI rack identity updated to `Rack Interface MkIII`.

## Validation Performed

- Backend tests: `npm test` (all passing)
- Targeted analyser tests: `npm test -- test/ts-analyser.test.js` (all passing)
- Frontend production build: `cd web && npm run build` (successful)
- Runtime smoke:
  - `/health` includes tooling and policy fields
  - preflight script output validated
  - post-deploy smoke script output validated

## Operational Upgrade Notes

- After deploy, run:
  - `bash scripts/preflight-monitoring-tools.sh <YOUR_SERVER_IP> 4000`
  - `bash scripts/post-deploy-smoke.sh <YOUR_SERVER_IP> 4000`
- If NIC capture is degraded due to permissions, monitoring remains functional with fallback sources but confidence/method indicators will show degraded state.

## Changed Files (v3.0.0 scope)

- `config/monitoring-policy.json`
- `docker-compose.dev.yml`
- `docs/broadcast-grade-compliance-roadmap.md`
- `docs/engineering-support-manual.md`
- `package.json`
- `web/package.json`
- `src/api.js`
- `src/monitoring-policy.js`
- `src/tooling-preflight.js`
- `src/ts-analyser.js`
- `test/ts-analyser.test.js`
- `web/src/App.jsx`
- `web/src/components/TSAnalyser.jsx`
- `web/src/components/DecoderPanelRevamp.jsx`
- `web/src/components/StreamViewPanel.jsx`
- `scripts/preflight-monitoring-tools.sh`
- `scripts/post-deploy-smoke.sh`

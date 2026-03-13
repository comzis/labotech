# Day-1 Monitoring Checklist

Use this checklist for the first 24 hours after deploying Labotech UI/decoder/SMPTE or host optimization changes.

## 0-15 Minutes (Immediate Validation)

- Verify API health repeatedly:
  - `curl -fsS http://10.67.18.29:4000/health`
- Check container/service startup logs:
  - `docker compose logs --tail=200 labotech`
- UI quick validation:
  - Decoder start/stop responds correctly.
  - Multiview tiles render with thumbnail and audio bars.
  - SMPTE ST 2022-7 panel populates sequence/order/skew metrics on active RTP A/B feeds.

## 15-120 Minutes (Stability Window)

Every 15-30 minutes:

- Check health endpoint remains stable.
- Watch logs for recurring process errors, especially:
  - `spawn ffprobe ENOENT`
  - repeated decoder start/stop failures
  - repeated analyser probe failures
- Confirm alarm volume is expected (no sustained unexplained critical flood).

Spot-check active decoder(s):

- `TS Input Rate` behaves as expected for CBR services.
- `TS Rate Source` remains high-confidence (`tsduck` or `measured`).
- 2022-7 sequence counters are plausible for the traffic profile.

## Peak-Traffic Window (Load Validation)

- Confirm UI responsiveness on:
  - Decoder panel
  - Multiview
  - Live View timeline
- Confirm `2022-7 consolidated` naming remains correct in multiview.
- Watch 2022-7 quality indicators:
  - gap events
  - duplicate events
  - reordered events
  - packet-arrival skew
- Ensure ETR290 P1 alarms are actionable events, not uncontrolled noise.

## End-of-Day Capture (Evidence Pack)

- Save screenshots:
  - Decoder 2022-7 metrics panel
  - Multiview with active tiles and audio bars
  - Alarm Log state
- Save recent runtime logs:
  - `docker compose logs --tail=200 labotech > /tmp/labotech-day1.log`
- Re-run host validation:
  - `sudo bash scripts/check-routes.sh`
  - `curl -fsS http://10.67.18.29:4000/health`

## Trigger Conditions (Escalate Immediately)

- Health endpoint intermittent failures.
- Persistent packet loss/jitter deterioration vs baseline.
- Sustained high sequence anomalies (gap/reorder/duplicate).
- Repeated decoder monitor crashes/restarts.
- Multiview tile freezes, missing thumbnails, or missing audio bars.

## Fast Response Path

1. Capture logs + screenshots immediately.
2. Confirm host tuning is still active:
   - `sudo bash scripts/check-routes.sh`
3. If host tuning regression is suspected, rollback safely:
   - `sudo bash scripts/rollback-host-optimization-v2.sh`
4. Restart runtime and re-check health:
   - `docker compose up -d`
   - `curl -fsS http://10.67.18.29:4000/health`


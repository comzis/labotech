import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import Sparkline from './Sparkline';
import { getEvents, getAnalysers, getETR290Monitors } from '../api';
import { C } from './BroadcastUI';

const STREAMVIEW_STATE_KEY = 'labotech:streamview:state:v2';

const WINDOW_OPTIONS = [
  { value: 5 * 60 * 1000, label: '5m' },
  { value: 15 * 60 * 1000, label: '15m' },
  { value: 60 * 60 * 1000, label: '1h' },
  { value: 6 * 60 * 60 * 1000, label: '6h' },
  { value: 12 * 60 * 60 * 1000, label: '12h' },
  { value: 24 * 60 * 60 * 1000, label: '24h' },
];

const P1_KEYS = ['ts_sync', 'sync_byte', 'pat_error', 'cc_error', 'pmt_error', 'pid_error'];
const P2_KEYS = ['transport_error', 'crc_error', 'pcr_disc', 'pcr_acc', 'pcr_rep', 'pts_error', 'cat_error'];
const MAX_EVENTS = 1500;
const EVENT_RETENTION_MS = 26 * 60 * 60 * 1000; // keep slightly above max 24h window
const LANE_ACTIVITY_STALE_MS = 30 * 1000; // auto-expire no-heartbeat runtime lanes
const STARTED_RECENTLY_MS = 90 * 1000;
const LIVE_TICK_MS = 2000;
const MAX_FUTURE_SKEW_MS = 5000;
const ACTIVE_ANALYSER_SEED_MS = 5000;
const EVENT_BLOCK_DURATION_MS = {
  etr290_alarm: 14000,
  etr290_incident: 18000,
  etr290_incident_cleared: 6000,
  runtime_error: 15000,
  runtime_started: 22000,
  runtime_heartbeat: 5000,
  runtime_stopped: 14000,
  failover: 16000,
  analyse_result: 7000,
  health_alarm: 14000,
  etr290_status: 5000,
};
const EVENT_STYLE_BY_CATEGORY = {
  etr290_alarm: { alpha: 'ee', borderAlpha: 'cc', glowAlpha: '88' },
  etr290_incident: { alpha: 'dd', borderAlpha: 'bb', glowAlpha: '70' },
  etr290_incident_cleared: { alpha: '99', borderAlpha: '88', glowAlpha: '55' },
  runtime_error: { alpha: 'ff', borderAlpha: 'ea', glowAlpha: 'cc' },
  runtime_started: { alpha: 'ee', borderAlpha: 'cc', glowAlpha: '99' },
  runtime_heartbeat: { alpha: '94', borderAlpha: '84', glowAlpha: '3c' },
  runtime_stopped: { alpha: 'dd', borderAlpha: 'bb', glowAlpha: '88' },
  failover: { alpha: 'd0', borderAlpha: 'b4', glowAlpha: '66' },
  analyse_result: { alpha: 'cf', borderAlpha: 'b2', glowAlpha: '6e' },
  health_alarm: { alpha: 'ee', borderAlpha: 'cc', glowAlpha: '88' },
  etr290_status: { alpha: '94', borderAlpha: '82', glowAlpha: '44' },
};
const LEGEND_TYPE_ITEMS = [
  { key: 'start', label: 'start', category: 'runtime_started', severity: 'ok' },
  { key: 'etr_alarm', label: 'ETR alarm', category: 'etr290_alarm', severity: 'critical' },
  { key: 'incident', label: 'incident', category: 'etr290_incident', severity: 'warning' },
  { key: 'runtime', label: 'runtime', category: 'runtime_error', severity: 'critical' },
  { key: 'analyse', label: 'analyse', category: 'analyse_result', severity: 'ok' },
];
const ETR_CHECK_TERMS = {
  ts_sync: 'TS sync loss',
  sync_byte: 'Sync byte error',
  pat_error: 'PAT error',
  cc_error: 'Continuity count error',
  pmt_error: 'PMT error',
  pid_error: 'PID error',
  transport_error: 'Transport error indicator',
  crc_error: 'CRC error',
  pcr_disc: 'PCR discontinuity',
  pcr_acc: 'PCR accuracy error',
  pcr_rep: 'PCR repetition error',
  pts_error: 'PTS error',
  cat_error: 'CAT error',
};

function toDateTimeLocalValue(ts) {
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (v) => String(v).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseDateTimeLocalValue(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function normalizeEtrKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function etrPriorityLabel(priority) {
  if (priority === 'p1') return 'Priority 1 (P1)';
  if (priority === 'p2') return 'Priority 2 (P2)';
  return 'Priority 3 (P3)';
}

function etrSeverityFromPriority(priority) {
  if (priority === 'p1') return 'critical';
  if (priority === 'p2') return 'warning';
  return 'info';
}

function inferPriorityFromCheck(checkKey) {
  if (P1_KEYS.includes(checkKey)) return 'p1';
  if (P2_KEYS.includes(checkKey)) return 'p2';
  return 'p3';
}

function etrCheckLabel(checkKey, fallback) {
  if (checkKey && ETR_CHECK_TERMS[checkKey]) return ETR_CHECK_TERMS[checkKey];
  return fallback || 'ETR check';
}

function buildEtrMeta(msg) {
  const normalizedCheck = normalizeEtrKey(msg.checkId || msg.key || msg.label || '');
  const priority = String(msg.priority || inferPriorityFromCheck(normalizedCheck || '')).toLowerCase();
  const checkLabel = etrCheckLabel(normalizedCheck, msg.label || msg.checkId || msg.key || 'ETR check');
  return {
    priority,
    priorityLabel: etrPriorityLabel(priority),
    severity: etrSeverityFromPriority(priority),
    checkKey: normalizedCheck || null,
    checkLabel,
  };
}

function isExpectedNoSignalError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('ffprobe exited 1') ||
    m.includes('empty probe payload') ||
    m.includes('no input packets observed during probe window') ||
    m.includes('connection refused') ||
    m.includes('input/output error') ||
    m.includes('server returned 404') ||
    m.includes('immediate exit requested')
  );
}

function normalizeLaneId(rawId) {
  const id = String(rawId || '').trim();
  if (!id) return 'unknown';
  // Collapse monitor/analyser/runtime identifiers into one canonical lane id.
  // This avoids split lanes such as etr-<id>, analyser-<id>, and decoder-<id>
  // all rendering independently for the same underlying stream lifecycle.
  let lane = id.replace(/^etr[-_:]/i, '');
  lane = lane.replace(/^analyser[-_:]/i, 'decoder-');
  return lane || id;
}

function toUtc(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function parseEventTimestamp(rawTime) {
  const now = Date.now();
  if (rawTime == null) return now;
  if (typeof rawTime === 'number' && Number.isFinite(rawTime)) {
    return rawTime > (now + MAX_FUTURE_SKEW_MS) ? now : rawTime;
  }
  if (typeof rawTime === 'string') {
    const trimmed = rawTime.trim();
    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric > (now + MAX_FUTURE_SKEW_MS) ? now : numeric;
    }
    const parsed = new Date(trimmed).getTime();
    if (Number.isFinite(parsed)) return parsed > (now + MAX_FUTURE_SKEW_MS) ? now : parsed;
  }
  return now;
}

function toEvent(msg) {
  if (!msg?.type) return null;
  const ts = parseEventTimestamp(msg.time);
  if (!Number.isFinite(ts)) return null;
  if (msg.type === 'etr290_alarm') {
    const laneId = normalizeLaneId(msg.id || 'etr');
    const etr = buildEtrMeta(msg);
    // Timeline uses 'p1' (→ cyan) to distinguish service-affecting from generic red alarms.
    // EventLogPanel uses 'critical' (red) separately — the two panels intentionally differ.
    const severity = etr.priority === 'p1' ? 'p1' : etr.priority === 'p2' ? 'warning' : 'info';
    return {
      key: `${ts}-${msg.id || 'unknown'}-${msg.label || 'alarm'}`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_alarm',
      severity,
      title: `ETR 290 ${etr.priorityLabel} alarm: ${etr.checkLabel}`,
      description: msg.message || '',
      evidence: {
        etr: {
          priority: etr.priority,
          priorityLabel: etr.priorityLabel,
          checkKey: etr.checkKey,
          checkLabel: etr.checkLabel,
        },
      },
    };
  }
  if (msg.type === 'etr290_status') {
    const laneId = normalizeLaneId(msg.id || 'etr');
    const status = msg.status || {};
    const hasP1 = P1_KEYS.some((k) => status[k] === 'error');
    const hasP2 = P2_KEYS.some((k) => status[k] === 'error');
    const statusPriority = hasP1 ? 'p1' : hasP2 ? 'p2' : 'p3';
    const activeChecks = Object.keys(status)
      .filter((k) => status[k] === 'error')
      .map((k) => {
        const checkKey = normalizeEtrKey(k);
        return {
          checkKey,
          checkLabel: etrCheckLabel(checkKey, k),
        };
      });
    const hasActiveChecks = activeChecks.length > 0;
    return {
      key: `${ts}-${msg.id || 'unknown'}-status`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_status',
      // Keep status heartbeats informational to avoid conflicting with alarm/incident views.
      severity: 'info',
      // But retain true ETR state for lane-level timeline coloring.
      stateSeverity: hasP1 ? 'p1' : hasP2 ? 'warning' : 'ok',
      title: hasP1 ? 'ETR 290 status heartbeat: Priority 1 active' : hasP2 ? 'ETR 290 status heartbeat: Priority 2 active' : 'ETR 290 status heartbeat: nominal',
      description: activeChecks.length > 0
        ? `Active checks: ${activeChecks.map((c) => c.checkLabel).join(', ')}`
        : 'No active ETR 290 errors',
      evidence: {
        runtime: msg.runtime || null,
        etr: {
          priority: statusPriority,
          priorityLabel: etrPriorityLabel(statusPriority),
          activeChecks,
          hasActiveChecks,
        },
      },
    };
  }
  if (msg.type === 'etr290_incident_started' || msg.type === 'etr290_incident_updated') {
    const laneId = normalizeLaneId(msg.id || 'etr');
    const etr = buildEtrMeta(msg);
    return {
      key: `${ts}-${laneId}-${msg.incidentId || msg.checkId}-${msg.type}`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_incident',
      severity: etr.severity,
      title: `ETR 290 incident ${msg.type.endsWith('started') ? 'started' : 'updated'}: ${etr.checkLabel}`,
      description: msg.lastMessage || msg.message || '',
      evidence: {
        etr: {
          priority: etr.priority,
          priorityLabel: etr.priorityLabel,
          checkKey: etr.checkKey,
          checkLabel: etr.checkLabel,
        },
        incidentId: msg.incidentId || null,
        checkId: msg.checkId || null,
        hitCount: msg.hitCount || 0,
        pid: msg.pid ?? null,
        pidHex: msg.pidHex || null,
      },
    };
  }
  if (msg.type === 'etr290_incident_cleared') {
    const laneId = normalizeLaneId(msg.id || 'etr');
    const etr = buildEtrMeta(msg);
    return {
      key: `${ts}-${laneId}-${msg.incidentId || msg.checkId}-cleared`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_incident_cleared',
      severity: 'ok',
      title: `ETR 290 incident cleared: ${etr.checkLabel}`,
      description: msg.lastMessage || '',
      evidence: {
        etr: {
          priority: etr.priority,
          priorityLabel: etr.priorityLabel,
          checkKey: etr.checkKey,
          checkLabel: etr.checkLabel,
        },
        incidentId: msg.incidentId || null,
        checkId: msg.checkId || null,
        durationMs: msg.durationMs || null,
      },
    };
  }
  if (msg.type === 'analyse_result') {
    const laneId = normalizeLaneId(msg.id || 'analyse');
    const dvb = msg.dvb || {};
    const si = dvb.si || {};
    const compliance = si.compliance || {};
    const hasSiViolation = ['nit', 'sdt', 'eitPf', 'tdt'].some((k) => compliance[k] === false);
    const healthSeverity = dvb?.health?.severity;
    // health.severity is the authoritative, hysteresis-gated value from the backend.
    // hasSiViolation is only used as a fallback for results that predate the health
    // assessment (no health object present). Never let a raw single-cycle SI flag
    // bypass the backend hysteresis gate.
    const severity = healthSeverity === 'critical' || healthSeverity === 'warning' || healthSeverity === 'ok'
      ? healthSeverity
      : (hasSiViolation ? 'warning' : 'ok');
    const healthScore = Number.isFinite(dvb?.health?.score) ? dvb.health.score : null;
    const title = severity === 'critical'
      ? 'TS Analysis (critical)'
      : severity === 'warning'
        ? 'TS Analysis (warning)'
        : 'TS Analysis (OK)';
    const bitrateBps = Number(dvb.bitrateBps);
    const bitrateMbps = Number.isFinite(bitrateBps) && bitrateBps > 0 ? Number((bitrateBps / 1e6).toFixed(3)) : null;
    return {
      key: `${ts}-${msg.id || 'analyse'}-analyse`,
      ts,
      id: laneId,
      rawId: msg.id || 'analyse',
      category: 'analyse_result',
      severity,
      title,
      description: `${dvb.pidCount ?? 0} PID · ${dvb.serviceCount ?? 0} svc · ${bitrateMbps != null ? bitrateMbps.toFixed(2) : '0.00'} Mbps${healthScore != null ? ` · health ${healthScore}/100` : ''}`,
      evidence: {
        bitrateSource: dvb.bitrateSource || null,
        bitrateMbps,
        pidCount: dvb.pidCount ?? null,
        serviceCount: dvb.serviceCount ?? null,
        siIntervalsSec: si.intervalsSec || null,
        siCompliance: compliance || null,
        arrival: dvb.arrival || null,
        timestampDiscontinuity: dvb.timestampDiscontinuity || null,
        continuityCounterErrors: dvb.continuityCounterErrors || null,
        dolbyE: dvb.dolbyE || null,
        probeDiagnostics: dvb.probeDiagnostics || null,
        health: dvb.health || null,
      },
    };
  }
  if (msg.type === 'health_alarm') {
    const laneId = normalizeLaneId(msg.id || 'analyse');
    const severity = msg.severity === 'critical' ? 'critical' : msg.severity === 'warning' ? 'warning' : 'ok';
    const title = severity === 'critical'
      ? 'TS Health alarm: critical'
      : severity === 'warning'
        ? 'TS Health alarm: warning'
        : 'TS Health cleared';
    const reasons = Array.isArray(msg.reasons) ? msg.reasons : [];
    return {
      key: `${ts}-${msg.id || 'analyse'}-health_alarm-${severity}`,
      ts,
      id: laneId,
      rawId: msg.id || 'analyse',
      category: 'health_alarm',
      severity,
      title,
      description: reasons.length > 0 ? reasons.join('; ') : (severity === 'ok' ? 'Health restored' : 'Health degraded'),
      evidence: { score: msg.score ?? null, prevSeverity: msg.prevSeverity || null, reasons },
    };
  }
  if (msg.type === 'error') {
    const laneId = normalizeLaneId(msg.id || 'system');
    const isNoSignal = isExpectedNoSignalError(msg.message);
    return {
      key: `${ts}-${msg.id || 'system'}-error-${msg.message || ''}`,
      ts,
      id: laneId,
      rawId: msg.id || 'system',
      category: 'runtime_error',
      severity: 'critical',
      title: isNoSignal ? 'Input signal missing' : 'Engine error',
      description: msg.message || 'Unknown runtime error',
      evidence: { noSignal: isNoSignal },
    };
  }
  if (msg.type === 'switched') {
    const laneId = normalizeLaneId(msg.id || 'system');
    return {
      key: `${ts}-${msg.id || 'system'}-switched`,
      ts,
      id: laneId,
      rawId: msg.id || 'system',
      category: 'failover',
      severity: 'warning',
      title: 'Failover switch',
      description: msg.message || 'Primary input switched to backup',
    };
  }
  if (msg.type === 'started' || msg.type === 'analyse_started') {
    const laneId = normalizeLaneId(msg.id || 'system');
    const isAnalyser = msg.type === 'analyse_started';
    return {
      key: `${ts}-${msg.id || 'system'}-${msg.type}`,
      ts,
      id: laneId,
      rawId: msg.id || 'system',
      category: 'runtime_started',
      severity: 'ok',
      title: isAnalyser ? 'Analyser started' : 'Stream started',
      description: msg.message || `${msg.id} ${isAnalyser ? 'analyser started' : 'started'}`,
    };
  }
  if (msg.type === 'etr290_stopped') {
    const laneId = normalizeLaneId(msg.id || 'etr');
    return {
      key: `${ts}-${msg.id || 'etr'}-etr290_stopped`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'runtime_stopped',
      severity: 'unknown',
      title: 'ETR monitor stopped',
      description: `${msg.id} ETR 290 monitor stopped`,
    };
  }
  if (msg.type === 'stopped' || msg.type === 'transcode_stopped' || msg.type === 'multicast_stopped' || msg.type === 'analyse_stopped') {
    const laneId = normalizeLaneId(msg.id || 'system');
    const isAnalyser = msg.type === 'analyse_stopped';
    return {
      key: `${ts}-${msg.id || 'system'}-${msg.type}`,
      ts,
      id: laneId,
      rawId: msg.id || 'system',
      category: 'runtime_stopped',
      severity: 'unknown',
      title: isAnalyser ? 'Analyser stopped' : 'Stream stopped',
      description: msg.message || `${msg.id} ${isAnalyser ? 'analyser stopped' : 'stopped'}`,
    };
  }
  return null;
}

function colorForSeverity(severity) {
  if (severity === 'p1') return '#00ddff';   // neon-cyan
  if (severity === 'critical') return '#ff2233'; // led-red
  if (severity === 'warning') return '#ffaa00';  // led-amber
  if (severity === 'ok') return '#3db86a';   // soft monitoring green
  return '#00ddff';
}

function laneSeverity(event) {
  if (!event) return 'unknown';
  return event.stateSeverity || event.severity || 'unknown';
}

function laneStateSeverity(event) {
  if (!event) return null;
  // Keep lane baseline tied to heartbeat truth only (current ETR state),
  // and render incidents/alarms as overlays so past incidents don't tint
  // the whole lane state after they have cleared.
  if (event.category !== 'etr290_status') return null;
  return laneSeverity(event);
}

function laneColorForEvent(event) {
  if (!event) return '#ffffff26';
  const sev = laneStateSeverity(event);
  if (!sev) return '#44556666';
  if (sev === 'p1') return '#00ddffcc';
  if (sev === 'critical') return '#ff4d5fcc';
  if (sev === 'warning') return '#ffd84dcc';
  if (sev === 'ok') return '#3db86ab8';
  return '#44556666';
}

function colorForLaneSeverity(severity) {
  if (severity === 'p1') return '#00ddff';
  if (severity === 'critical') return '#ff2233';
  if (severity === 'warning') return '#ffaa00';
  if (severity === 'ok') return '#3db86a';
  if (severity === 'pending') return '#00bbcc'; // stream active, awaiting first analysis probe
  return '#445566';
}

function laneTintForSeverity(severity) {
  if (severity === 'p1') return `${colorForLaneSeverity(severity)}e0`;
  if (severity === 'critical') return `${colorForLaneSeverity(severity)}e0`;
  if (severity === 'warning') return `${colorForLaneSeverity(severity)}d8`;
  if (severity === 'ok') return `${colorForLaneSeverity(severity)}e0`;   // bright green, clearly visible
  if (severity === 'pending') return `${colorForLaneSeverity(severity)}90`; // muted teal, "waiting"
  return '#44556638'; // inactive — slightly transparent dark-blue, clearly not active
}

function buildLaneGradient(events, timeStart, windowMs) {
  // No events at all → unknown (inactive), never green by default
  if (!Array.isArray(events) || events.length === 0 || windowMs <= 0) {
    return 'linear-gradient(90deg, #44556638 0%, #44556638 100%)';
  }
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const hasEtrStateEvents = sorted.some((e) => laneStateSeverity(e) != null);

  // Fallback for decoder/analyser lanes (no ETR heartbeat present).
  // Build a severity-aware gradient: green = healthy, red = LOS/error, amber = warning.
  // Hysteresis: critical/warning → ok requires OKS_TO_CLEAR consecutive ok probes so
  // a single brief recovery probe doesn't paint a green blip inside a red LOS block.
  if (!hasEtrStateEvents) {
    const OKS_TO_CLEAR = 2;

    function decEvtSev(e) {
      if (e.category === 'runtime_error') {
        // Only genuine LOS errors (no input signal) drive the gradient red.
        // Engine/process errors (probe hiccups, config faults) are not signal
        // quality indicators — they must not override the analyse_result truth.
        return e.evidence?.noSignal ? 'critical' : null;
      }
      if (e.category === 'runtime_started' && !e?.evidence?.bootstrap) {
        // Start green immediately — the first analyse_result (arriving within
        // one probe cycle) will confirm or change to amber/red if needed.
        // Showing 'pending'/teal here looked like a stall+recovery on every
        // decoder startup, which was visually misleading for operators.
        return 'ok';
      }
      if (e.category === 'analyse_result') return e.severity || 'ok';
      return null;
    }

    const sevEvts = sorted.filter((e) => decEvtSev(e) != null);
    if (sevEvts.length === 0) {
      return 'linear-gradient(90deg, #44556638 0%, #44556638 100%)';
    }

    const sevLevel = (s) => s === 'critical' ? 2 : s === 'warning' ? 1 : 0;
    const isBad = (s) => s === 'critical' || s === 'warning';

    // Build de-noised state-change list with hysteresis.
    // Rules:
    //   - Escalation (ok→bad or warn→critical): immediate, resets okStreak.
    //   - Downgrade (critical→warning): immediate transition, preserves okStreak.
    //   - Recovery (bad→ok): requires OKS_TO_CLEAR consecutive ok events.
    //     Exception: after a runtime_error noSignal event (binary signal-presence),
    //     only ONE ok probe is required to clear. noSignalRecovery is reset to
    //     false as soon as a sustained analyse_result critical confirms the state.
    //   - Repeated same-severity bad events do NOT reset okStreak — prevents
    //     alternating warn/ok patterns from locking the lane permanently red.
    let stateSev = null;
    let okStreak = 0;
    let noSignalRecovery = false; // true = next single ok clears critical
    const stateChanges = []; // { ts, sev }

    for (const e of sevEvts) {
      const raw = decEvtSev(e);
      if (!raw) continue;
      if (isBad(raw)) {
        if (sevLevel(raw) > sevLevel(stateSev)) {
          // Escalation: reset streak, record transition.
          okStreak = 0;
          // Signal-loss events are binary: present or absent. One ok probe is
          // sufficient to confirm recovery. Sustained probe-critical overrides.
          noSignalRecovery = (e.category === 'runtime_error' && !!e.evidence?.noSignal);
          stateChanges.push({ ts: e.ts, sev: raw });
          stateSev = raw;
        } else if (sevLevel(raw) < sevLevel(stateSev)) {
          // Downgrade (e.g. critical→warning): transition immediately,
          // keep okStreak so recovery can continue counting.
          stateChanges.push({ ts: e.ts, sev: raw });
          stateSev = raw;
        } else if (noSignalRecovery && e.category === 'analyse_result') {
          // Sustained probe confirms the critical state — revert to normal hysteresis.
          noSignalRecovery = false;
        }
        // Same severity: no change, no streak reset.
      } else { // ok-like (ok or pending)
        if (isBad(stateSev)) {
          okStreak++;
          const clearAt = noSignalRecovery ? 1 : OKS_TO_CLEAR;
          if (okStreak >= clearAt) {
            okStreak = 0;
            noSignalRecovery = false;
            stateChanges.push({ ts: e.ts, sev: raw });
            stateSev = raw;
          }
        } else {
          okStreak = 0;
          if (stateSev !== raw) {
            stateChanges.push({ ts: e.ts, sev: raw });
            stateSev = raw;
          }
        }
      }
    }

    if (stateChanges.length === 0) {
      return 'linear-gradient(90deg, #44556638 0%, #44556638 100%)';
    }

    const firstActiveTs = stateChanges[0].ts;
    // Anchor stopAfterActive to the LAST non-bootstrap start, not the first.
    // Tombstone race: seedFromActiveAnalysers fires between a stop and a restart,
    // injecting a synthetic runtime_stopped. The new runtime_started arrives via WS
    // shortly after. Using firstActiveTs would make stopAfterActive find the
    // tombstone even when a real start supersedes it — leaving the lane grey.
    const explicitStarts = sorted.filter(
      (e) => e.category === 'runtime_started' && !e?.evidence?.bootstrap
    );
    const hasExplicitStart = explicitStarts.length > 0;
    const lastExplicitStartTs = hasExplicitStart
      ? explicitStarts[explicitStarts.length - 1].ts
      : firstActiveTs;
    const stopAfterActive = sorted.find(
      (e) => e.category === 'runtime_stopped' && e.ts >= lastExplicitStartTs
    );
    const lastSevEvtTs = sevEvts[sevEvts.length - 1]?.ts || firstActiveTs;
    // Include runtime_heartbeat in the activity timestamp so the lane stays
    // live-colored between probe cycles (heartbeats arrive every ~5s while the
    // process runs; analyse_result may only arrive every 30-60s+).
    const lastHeartbeatTs = sorted.filter((e) => e.category === 'runtime_heartbeat').pop()?.ts || 0;
    const lastActivityTs = Math.max(lastSevEvtTs, lastHeartbeatTs);
    const staleStopTs = lastActivityTs + LANE_ACTIVITY_STALE_MS;
    const timeEnd = timeStart + windowMs;
    // isLive conditions (any one is sufficient):
    //  1. hasExplicitStart — a real (non-bootstrap) runtime_started exists with no stop
    //  2. staleStopTs >= timeEnd — recent severity event within stale threshold (historical windows)
    //  3. lastHeartbeatTs >= timeStart — heartbeat received during the current window.
    //     This is the primary condition for live windows: seed heartbeats fire every 5s
    //     at Date.now(), so for any 5-minute live window now >= timeStart always holds.
    //     Without this, staleStopTs = now+30s vs timeEnd = now+5min → always false.
    const isLive = !stopAfterActive && (
      hasExplicitStart ||
      staleStopTs >= timeEnd ||
      lastHeartbeatTs >= timeStart
    );
    // Apply stale cutoff for non-live lanes even when no explicit stop event exists.
    const effectiveEndTs = stopAfterActive
      ? Math.min(timeEnd, stopAfterActive.ts)
      : (isLive ? timeEnd : Math.min(timeEnd, lastActivityTs + LANE_ACTIVITY_STALE_MS));
    const gradientEnd = effectiveEndTs;

    // Initial severity: last state change at or before timeStart.
    let initSev = null;
    for (const sc of stateChanges) {
      if (sc.ts > timeStart) break;
      initSev = sc.sev;
    }

    // Determine where the lane bar should begin:
    //   • Real start known → clamp to window left edge or actual start position.
    //     e.g. started 30 min ago inside a 1h window → bar starts at 50%.
    //   • Bootstrap-only (fresh page load, no WS history yet) → fill from window
    //     left edge: we know the decoder is running but don't have the actual start
    //     timestamp, so we assume it was running before the window.
    const effectiveStartTs = hasExplicitStart
      ? Math.max(timeStart, lastExplicitStartTs)
      : timeStart;
    const startX = Math.min(100, Math.max(0, ((effectiveStartTs - timeStart) / windowMs) * 100));
    const stopX = Math.min(100, Math.max(0, ((effectiveEndTs - timeStart) / windowMs) * 100));

    const INACTIVE = laneTintForSeverity(null); // inactive/pre-stream dark-blue

    if (!isLive && stopX <= startX) {
      return `linear-gradient(90deg, ${INACTIVE} 0%, ${INACTIVE} 100%)`;
    }

    // Determine starting color: use initSev if known, else use first in-window change.
    const firstInWindowSev = stateChanges.find((sc) => sc.ts > timeStart)?.sev || 'ok';
    let curSev = initSev || firstInWindowSev;

    const parts = [];
    if (startX > 0) {
      parts.push(`${INACTIVE} 0%`);
      parts.push(`${INACTIVE} ${startX}%`);
    }
    parts.push(`${laneTintForSeverity(curSev)} ${startX}%`);

    for (const sc of stateChanges) {
      if (sc.ts <= timeStart || sc.ts > gradientEnd) continue;
      const x = Math.min(100, Math.max(0, ((sc.ts - timeStart) / windowMs) * 100));
      if (sc.sev !== curSev) {
        parts.push(`${laneTintForSeverity(curSev)} ${x}%`);
        parts.push(`${laneTintForSeverity(sc.sev)} ${x}%`);
        curSev = sc.sev;
      }
    }

    if (effectiveEndTs < timeEnd) {
      parts.push(`${laneTintForSeverity(curSev)} ${stopX}%`);
      parts.push(`${INACTIVE} ${stopX}%`);
      parts.push(`${INACTIVE} 100%`);
    } else {
      parts.push(`${laneTintForSeverity(curSev)} 100%`);
    }

    return `linear-gradient(90deg, ${parts.join(', ')})`;
  }

  // Determine initial severity: scan ALL pre-window events (not just leading ones)
  // so a runtime_started before the window doesn't short-circuit finding etr290_status.
  let currentSeverity = 'unknown';
  for (const e of sorted) {
    if (e.ts > timeStart) break;
    const state = laneStateSeverity(e);
    if (state) currentSeverity = state;
  }

  // Respect runtime_stopped — find the earliest stop after the first ETR status event.
  const firstEtrTs = sorted.find((e) => laneStateSeverity(e) != null)?.ts ?? -Infinity;
  const stopEvent = sorted.find((e) => e.category === 'runtime_stopped' && e.ts >= firstEtrTs);
  const timeEnd = timeStart + windowMs;
  // ETR gradient ends at stop event (if within window), otherwise extends to window edge.
  const gradientEnd = (stopEvent && stopEvent.ts < timeEnd) ? stopEvent.ts : timeEnd;

  const parts = [`${laneTintForSeverity(currentSeverity)} 0%`];
  for (const e of sorted) {
    if (e.ts < timeStart || e.ts > gradientEnd) continue;
    const nextSeverity = laneStateSeverity(e);
    if (!nextSeverity) continue;
    const x = Math.min(100, Math.max(0, ((e.ts - timeStart) / windowMs) * 100));
    parts.push(`${laneTintForSeverity(currentSeverity)} ${x}%`);
    parts.push(`${laneTintForSeverity(nextSeverity)} ${x}%`);
    currentSeverity = nextSeverity;
  }

  const INACTIVE_ETR = laneTintForSeverity(null);
  if (stopEvent && stopEvent.ts < timeEnd) {
    const stopX = Math.min(100, Math.max(0, ((stopEvent.ts - timeStart) / windowMs) * 100));
    parts.push(`${laneTintForSeverity(currentSeverity)} ${stopX}%`);
    parts.push(`${INACTIVE_ETR} ${stopX}%`);
    parts.push(`${INACTIVE_ETR} 100%`);
  } else {
    parts.push(`${laneTintForSeverity(currentSeverity)} 100%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

function buildEventBlocks(events, timeStart, windowMs) {
  if (!Array.isArray(events) || events.length === 0 || windowMs <= 0) return [];
  const end = timeStart + windowMs;
  return events
    .filter((e) => e && e.ts != null)
    // Suppress nominal analyse heartbeat blocks; they create misleading
    // gray/green segmentation when lane baseline already indicates state.
    .filter((e) => !(e.category === 'analyse_result' && e.severity === 'ok'))
    .filter((e) => e.category !== 'runtime_heartbeat')
    // health_alarm is a transition marker for the alarm log only — the gradient
    // already reflects severity via analyse_result events, so rendering a separate
    // block here creates duplicate/overlapping tinting on the lane.
    .filter((e) => e.category !== 'health_alarm')
    // Synthetic "bootstrap started" markers are only lane-seeding helpers
    // and should not render as visible event blocks.
    .filter((e) => !(e.category === 'runtime_started' && e?.evidence?.bootstrap))
    .map((e, idx) => {
      const startTs = Math.max(timeStart, e.ts);
      const baseDur = EVENT_BLOCK_DURATION_MS[e.category] || 6000;
      const sev = laneSeverity(e);
      const severityFactor = sev === 'critical' ? 1.35 : sev === 'warning' ? 1.15 : 1.0;
      const dur = Math.round(baseDur * severityFactor);
      const endTs = Math.min(end, startTs + dur);
      if (endTs <= timeStart || startTs >= end) return null;
      const leftPct = ((startTs - timeStart) / windowMs) * 100;
      const rightPct = ((endTs - timeStart) / windowMs) * 100;
      const widthPct = Math.max(0.45, rightPct - leftPct);
      const vis = getEventVisualStyle(e.category, e.severity);
      return {
        key: `${e.key}-blk-${idx}`,
        leftPct: Math.max(0, Math.min(100, leftPct)),
        widthPct: Math.max(0, Math.min(100, widthPct)),
        color: vis.color,
        bg: vis.bg,
        border: vis.border,
        glow: vis.glow,
        title: `${toUtc(e.ts)} - ${e.title}`,
      };
    })
    .filter(Boolean);
}

function getEventVisualDurationMs(event) {
  if (!event) return 6000;
  const baseDur = EVENT_BLOCK_DURATION_MS[event.category] || 6000;
  const sev = laneSeverity(event);
  const severityFactor = (sev === 'critical' || sev === 'p1') ? 1.35 : sev === 'warning' ? 1.15 : 1.0;
  return Math.round(baseDur * severityFactor);
}

function getEventVisualStyle(category, severity) {
  const style = EVENT_STYLE_BY_CATEGORY[category] || { alpha: 'cc', borderAlpha: 'aa', glowAlpha: '66' };
  let color = colorForSeverity(severity);
  if (category === 'etr290_incident' || category === 'etr290_incident_cleared') color = '#cc44ff'; // neon-purple
  return {
    color,
    bg: `${color}${style.alpha}`,
    border: `${color}${style.borderAlpha}`,
    glow: `${color}${style.glowAlpha}`,
  };
}

// Parse a CSS linear-gradient(90deg, …) string into canvas-ready segments.
// Keeps buildLaneGradient logic untouched — only the paint path changes.
function parseGradientSegments(gradientStr) {
  if (!gradientStr || !gradientStr.startsWith('linear-gradient')) return [];
  try {
    const inner = gradientStr.slice(gradientStr.indexOf(',') + 1, -1).trim();
    // Split on commas that are NOT inside a color function like rgba(…)
    const stops = inner.split(/,(?![^(]*\))/).map((s) => s.trim());
    const parsed = stops.map((stop) => {
      const m = stop.match(/^(.*\S)\s+([\d.]+)%$/);
      if (!m) return null;
      return { color: m[1], pct: parseFloat(m[2]) };
    }).filter(Boolean);
    const segments = [];
    let i = 0;
    while (i < parsed.length) {
      const color = parsed[i].color;
      const startPct = parsed[i].pct;
      let endPct = startPct;
      while (i < parsed.length && parsed[i].color === color) {
        endPct = parsed[i].pct;
        i++;
      }
      if (endPct > startPct) segments.push({ leftPct: startPct, widthPct: endPct - startPct, color });
    }
    return segments;
  } catch (_) {
    return [];
  }
}

// Canvas-backed lane bar — replaces the CSS gradient div.
// Draws crisp coloured rects, hardware-accelerated, no DOM node per segment.
function LaneCanvas({ gradient, height = 8 }) {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const segments = parseGradientSegments(gradient);
    const rafRef = { id: null };
    const draw = () => {
      const W = canvas.offsetWidth;
      if (W <= 0) return;
      if (canvas.width !== W) canvas.width = W;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, height);
      for (const seg of segments) {
        const x = Math.floor((seg.leftPct / 100) * W);
        const w = Math.max(1, Math.ceil((seg.widthPct / 100) * W));
        ctx.fillStyle = seg.color;
        ctx.fillRect(x, 0, w, height);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(rafRef.id);
      rafRef.id = requestAnimationFrame(draw);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(rafRef.id);
      observer.disconnect();
    };
  }, [gradient, height]);
  return (
    <canvas
      ref={canvasRef}
      height={height}
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
    />
  );
}

// Events that exist only for lane-seeding / lifecycle bookkeeping — never
// surface as the "nearest event" in the cursor readout.
function isInternalEvent(e) {
  return e.category === 'runtime_heartbeat' ||
    (e.category === 'runtime_started' && e?.evidence?.bootstrap);
}

function canonicalizeEventLane(event) {
  if (!event) return null;
  const laneId = normalizeLaneId(event.id || event.rawId || 'unknown');
  if (laneId === event.id) return event;
  return { ...event, id: laneId };
}

function num(v, digits = 3) {
  const n = Number(v);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

export default function StreamViewPanel({ lastMessage, onSelectDecoder }) {
  const LANE_TOP_PX = 52;
  const LANE_STEP_PX = 44;
  const LANE_LINE_THICKNESS_PX = 12;
  const [windowMs, setWindowMs] = useState(WINDOW_OPTIONS[1].value);
  const [events, setEvents] = useState([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [mouseX, setMouseX] = useState(null);
  const [mouseY, setMouseY] = useState(null);
  const [mouseLaneId, setMouseLaneId] = useState(null);
  const [freezeCursor, setFreezeCursor] = useState(false);
  const [scaleMode, setScaleMode] = useState('normalized');
  const [rangeMode, setRangeMode] = useState('relative'); // relative | custom
  const [customStartInput, setCustomStartInput] = useState('');
  const [customEndInput, setCustomEndInput] = useState('');
  const [customRange, setCustomRange] = useState(null); // { startMs, endMs }
  const [rangeError, setRangeError] = useState('');
  const [uiRestored, setUiRestored] = useState(false);
  const [laneThumbnailById, setLaneThumbnailById] = useState({});
  // Crosshair DOM ref — updated directly to avoid React re-renders on every mousemove
  const crosshairLineRef = useRef(null);
  // Pending mouse position for rAF-throttled state update
  const pendingMouseRef = useRef(null);
  const mouseRafRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STREAMVIEW_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(Number(parsed.windowMs))) setWindowMs(Number(parsed.windowMs));
        if (Array.isArray(parsed.events)) {
          const cutoff = Date.now() - EVENT_RETENTION_MS;
          setEvents(
            parsed.events
              .map(canonicalizeEventLane)
              .filter(Boolean)
              .filter((e) => e.ts >= cutoff)  // drop events older than 26h on load
              .slice(-MAX_EVENTS)
          );
        }
        if (parsed.scaleMode === 'normalized' || parsed.scaleMode === 'absolute') setScaleMode(parsed.scaleMode);
        if (parsed.rangeMode === 'relative' || parsed.rangeMode === 'custom') setRangeMode(parsed.rangeMode);
        if (typeof parsed.customStartInput === 'string') setCustomStartInput(parsed.customStartInput);
        if (typeof parsed.customEndInput === 'string') setCustomEndInput(parsed.customEndInput);
        if (parsed.customRange && Number.isFinite(parsed.customRange.startMs) && Number.isFinite(parsed.customRange.endMs)) {
          setCustomRange({ startMs: parsed.customRange.startMs, endMs: parsed.customRange.endMs });
        }
        if (typeof parsed.freezeCursor === 'boolean') setFreezeCursor(parsed.freezeCursor);
      }
    } catch (_) {}
    setUiRestored(true);
  }, []);

  useEffect(() => {
    if (!uiRestored) return;
    if (customStartInput && customEndInput) return;
    const end = Date.now();
    const start = end - windowMs;
    setCustomStartInput(toDateTimeLocalValue(start));
    setCustomEndInput(toDateTimeLocalValue(end));
  }, [uiRestored, customStartInput, customEndInput, windowMs]);

  useEffect(() => {
    if (!uiRestored) return;
    try {
      localStorage.setItem(
        STREAMVIEW_STATE_KEY,
        JSON.stringify({
          windowMs,
          events: events.slice(-MAX_EVENTS),
          scaleMode,
          rangeMode,
          customStartInput,
          customEndInput,
          customRange,
          freezeCursor,
        })
      );
    } catch (_) {}
  }, [
    uiRestored,
    windowMs,
    events,
    scaleMode,
    rangeMode,
    customStartInput,
    customEndInput,
    customRange,
    freezeCursor,
  ]);

  const mergeTimelineEvents = (prev, incoming) => {
    const cutoffTs = Date.now() - EVENT_RETENTION_MS;
    const byKey = new Map(
      (prev || [])
        .map(canonicalizeEventLane)
        .filter((e) => e && Number.isFinite(e.ts) && e.ts >= cutoffTs)
        .filter(Boolean)
        .map((e) => [e.key, e])
    );
    (incoming || []).forEach((e) => {
      const normalized = canonicalizeEventLane(e);
      if (!normalized) return;
      if (!Number.isFinite(normalized.ts) || normalized.ts < cutoffTs) return;
      byKey.set(normalized.key, normalized);
    });
    return Array.from(byKey.values()).sort((a, b) => a.ts - b.ts).slice(-MAX_EVENTS);
  };

  useEffect(() => {
    if (!lastMessage) return;
    const event = toEvent(lastMessage);
    if (!event) return;
    setEvents((prev) => {
      const lastSimilar = [...prev].reverse().find((e) => e.id === event.id && e.category === event.category);
      if (lastSimilar) {
        const sameSeverity = lastSimilar.severity === event.severity;
        const sameTitle = lastSimilar.title === event.title;
        const dt = Math.abs(event.ts - lastSimilar.ts);
        // De-noise repetitive status/analyser points so timeline is not a dotted mock line.
        if (sameSeverity && sameTitle && dt < 8000 && event.category !== 'etr290_alarm') {
          return prev;
        }
      }
      return mergeTimelineEvents(prev, [event]);
    });
  }, [lastMessage]);

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      try {
        const seed = await getEvents();
        if (!mounted || !Array.isArray(seed)) return;
        const normalized = seed.map(toEvent).filter(Boolean);
        setEvents((prev) => mergeTimelineEvents(prev, normalized));
      } catch (_) {}
    };
    hydrate();
    const t = setInterval(hydrate, 10000);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  // Guardrail for burst starts: if WS lifecycle messages are dropped during rapid
  // batch creation, synthesize a visible "started" marker from active analysers.
  useEffect(() => {
    let mounted = true;
    const seedFromActiveAnalysers = async () => {
      try {
        const [list, etrList] = await Promise.all([
          getAnalysers().catch(() => []),
          getETR290Monitors().catch(() => []),
        ]);
        if (!mounted) return;
        const analysers = Array.isArray(list) ? list : [];
        const etrs = Array.isArray(etrList) ? etrList : [];
        setLaneThumbnailById((prev) => {
          const activeLaneIds = new Set(
            analysers
              .filter((a) => a?.id)
              .map((a) => normalizeLaneId(a.id))
          );
          const next = {};
          activeLaneIds.forEach((laneId) => {
            if (prev[laneId]) next[laneId] = prev[laneId];
          });
          analysers.forEach((a) => {
            if (!a?.id) return;
            const laneId = normalizeLaneId(a.id);
            const thumb = typeof a?.lastResult?.thumbnailUrl === 'string'
              ? a.lastResult.thumbnailUrl.trim()
              : '';
            if (thumb) next[laneId] = thumb;
          });
          const prevKeys = Object.keys(prev);
          const nextKeys = Object.keys(next);
          if (prevKeys.length === nextKeys.length && prevKeys.every((k) => prev[k] === next[k])) {
            return prev;
          }
          return next;
        });

        // Normalised IDs of everything currently alive on the server.
        const serverActiveIds = new Set([
          ...analysers.filter((a) => a?.isRunning && a.id).map((a) => normalizeLaneId(a.id)),
          ...etrs.filter((m) => m?.id).map((m) => normalizeLaneId(m.id)),
        ]);

        const synthetic = analysers
          .filter((a) => a && a.isRunning && a.id)
          .map((a) => {
            const laneId = normalizeLaneId(a.id);
            const ts = Date.now();
            return {
              key: `bootstrap-${laneId}-started`,
              ts,
              id: laneId,
              rawId: a.id,
              category: 'runtime_started',
              severity: 'ok',
              title: 'Analyser active',
              description: a.url || `${a.id} active`,
              evidence: { bootstrap: true },
            };
          });
        // Synthesise an analyse_result seed event from the analyser's lastResult.
        // Without this, after a page reload firstAnalyseResultTs = Infinity and the
        // entire historical window shows as teal/pending rather than the actual
        // health state that was running overnight.
        const analyseSeeds = analysers
          .filter((a) => a && a.isRunning && a.id && a.lastResult)
          .map((a) => {
            const laneId = normalizeLaneId(a.id);
            const dvb = a.lastResult?.dvb || {};
            const probeTs = Number(a.lastResult?.probeTime);
            const ts = Number.isFinite(probeTs) && probeTs > 0 ? probeTs : Date.now();
            // Seed is always 'ok': its purpose is to anchor the timeline as green after a
            // page reload (preventing the full window showing teal/pending). Real alarm states
            // arrive via WebSocket within one probe cycle and override this seed.
            // Injecting warning/critical from lastResult caused persistent phantom alarms
            // when a probe-join artefact had set severity on a single decoder.
            const bitrateBps = Number(dvb.bitrateBps);
            const bitrateMbps = Number.isFinite(bitrateBps) && bitrateBps > 0 ? Number((bitrateBps / 1e6).toFixed(3)) : null;
            return {
              key: `seed-analyse-${laneId}`,
              ts,
              id: laneId,
              rawId: a.id,
              category: 'analyse_result',
              severity: 'ok',
              title: 'TS Analysis (OK)',
              description: `${dvb.pidCount ?? 0} PID · ${dvb.serviceCount ?? 0} svc · ${bitrateMbps != null ? bitrateMbps.toFixed(2) : '0.00'} Mbps (seed)`,
              evidence: { health: dvb.health || null, bootstrap: true },
            };
          });

        const heartbeat = analysers
          .filter((a) => a && a.isRunning && a.id)
          .map((a) => {
            const laneId = normalizeLaneId(a.id);
            return {
              key: `heartbeat-${laneId}`,
              // Always use Date.now() — this seed confirms the analyser is alive
              // RIGHT NOW. Using probeTime here causes the heartbeat to be stale
              // (minutes old), making staleStopTs expire and the lane go grey.
              ts: Date.now(),
              id: laneId,
              rawId: a.id,
              category: 'runtime_heartbeat',
              severity: 'ok',
              title: 'Analyser heartbeat',
              description: a.url || `${a.id} active`,
              evidence: { bootstrap: true },
            };
          });

        setEvents((prev) => {
          // Only inject bootstrap for lanes not yet present.
          const seen = new Set(prev.map((e) => e.id));
          const missing = synthetic.filter((e) => !seen.has(e.id));

          // Tombstone: any lane with an explicit start but no stop that is NOT
          // in the current active server list gets a synthetic runtime_stopped.
          // This recovers from server restarts where analyse_stopped was never
          // broadcast — preventing ghost lanes accumulating in localStorage.
          const tombstones = [];
          for (const id of seen) {
            if (serverActiveIds.has(id)) continue;
            const laneEvts = prev.filter((e) => e.id === id).sort((a, b) => a.ts - b.ts);
            const lastExplicit = [...laneEvts].reverse().find(
              (e) => e.category === 'runtime_started' && !e?.evidence?.bootstrap
            );
            if (!lastExplicit) continue;
            const lastStop = laneEvts.filter(
              (e) => e.category === 'runtime_stopped' && e.ts >= lastExplicit.ts
            ).pop();
            if (lastStop) continue;
            // Set tombstone at the last known event time so the lane closes at
            // the point we last heard from it, not at an arbitrary future time.
            const lastEvt = laneEvts[laneEvts.length - 1];
            tombstones.push({
              key: `tombstone-${id}-${lastExplicit.ts}`,
              ts: (lastEvt?.ts || lastExplicit.ts) + 1000,
              id,
              rawId: id,
              category: 'runtime_stopped',
              severity: 'unknown',
              title: 'Session ended',
              description: `${id} — not in active server list`,
            });
          }

          return mergeTimelineEvents(prev, [...missing, ...analyseSeeds, ...heartbeat, ...tombstones]);
        });
      } catch (_) {}
    };
    seedFromActiveAnalysers();
    const t = setInterval(seedFromActiveAnalysers, ACTIVE_ANALYSER_SEED_MS);
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (rangeMode !== 'relative') return undefined;
    const t = setInterval(() => setNowMs(Date.now()), LIVE_TICK_MS);
    return () => clearInterval(t);
  }, [rangeMode]);

  const timeEnd = rangeMode === 'custom' && customRange ? customRange.endMs : nowMs;
  const timeStart = rangeMode === 'custom' && customRange ? customRange.startMs : (timeEnd - windowMs);
  const effectiveWindowMs = Math.max(1, timeEnd - timeStart);
  const visibleEvents = useMemo(
    () => events.filter((e) => e.ts >= timeStart && e.ts <= timeEnd),
    [events, timeStart, timeEnd]
  );

  const timelineEvents = useMemo(() => {
    if (effectiveWindowMs <= 0) return [];
    return visibleEvents.map((e) => ({
      ...e,
      xPct: Math.min(100, Math.max(0, ((e.ts - timeStart) / effectiveWindowMs) * 100)),
    }));
  }, [visibleEvents, timeStart, effectiveWindowMs]);

  // fullLaneMap indexes ALL events (full localStorage history, not windowed).
  // Used by buildLaneGradient so that pre-window ETR/runtime status events
  // correctly set the initial lane colour when returning after hours away.
  const fullLaneMap = useMemo(() => {
    const m = {};
    for (const e of events) {
      if (!m[e.id]) m[e.id] = [];
      m[e.id].push(e);
    }
    return m;
  }, [events]);

  // laneIds: union of in-window lanes AND lanes that have pre-window EXPLICIT
  // starts but no matching stop (stream running longer than the current window).
  // Bootstrap-only starts are intentionally excluded — they are seeding hints
  // for the current session, not historical run markers. Tombstone injection in
  // seedFromActiveAnalysers handles lanes whose server process has ended.
  const laneIds = useMemo(() => {
    const idSet = new Set(timelineEvents.map((e) => e.id));
    for (const [id, evts] of Object.entries(fullLaneMap)) {
      if (idSet.has(id)) continue;
      const sorted = [...evts].sort((a, b) => a.ts - b.ts);
      const lastExplicitStart = [...sorted].reverse().find(
        (e) => e.category === 'runtime_started' && !e?.evidence?.bootstrap
      );
      if (!lastExplicitStart) continue;
      const lastStop = sorted.filter(
        (e) => e.category === 'runtime_stopped' && e.ts >= lastExplicitStart.ts
      ).pop();
      if (!lastStop) idSet.add(id);
    }
    return Array.from(idSet).sort();
  }, [timelineEvents, fullLaneMap]);

  const laneMap = useMemo(() => {
    const m = {};
    for (const id of laneIds) m[id] = [];
    for (const e of timelineEvents) {
      if (!m[e.id]) m[e.id] = [];
      m[e.id].push(e);
    }
    return m;
  }, [timelineEvents, laneIds]);

  const pointerUtc = mouseX == null ? null : (timeStart + (effectiveWindowMs * mouseX) / 100);

  const lanePointerStatus = useMemo(() => {
    if (mouseX == null || laneIds.length === 0) return [];
    // Only snap to an event if it's within 8% of the cursor position.
    // This prevents hovering over gray (pre-stream) areas from snapping to
    // a distant event and showing misleading popup content like "TS Analysis OK".
    const MAX_SNAP_PCT = 8;
    return laneIds.map((id) => {
      const laneEvents = (laneMap[id] || []).filter((e) => !isInternalEvent(e));
      if (laneEvents.length === 0) return { id, event: null };
      let best = null;
      let bestDist = Infinity;
      for (const e of laneEvents) {
        const dist = Math.abs(e.xPct - mouseX);
        if (dist < bestDist) {
          best = e;
          bestDist = dist;
        }
      }
      return { id, event: bestDist <= MAX_SNAP_PCT ? best : null };
    });
  }, [mouseX, laneIds, laneMap]);

  const selectedLaneId = mouseLaneId || lanePointerStatus.find((row) => row.event)?.id || null;
  const pointerMatchWindowMs = useMemo(
    () => Math.max(250, Math.min(1500, Math.round(effectiveWindowMs * 0.002))),
    [effectiveWindowMs]
  );
  const selectedLaneExactEvents = useMemo(() => {
    if (!selectedLaneId || pointerUtc == null) return [];
    return (laneMap[selectedLaneId] || [])
      .filter((e) => !isInternalEvent(e))
      .filter((e) => {
        const tsMatch = Math.abs(e.ts - pointerUtc) <= pointerMatchWindowMs;
        const durationMs = getEventVisualDurationMs(e);
        const inVisualBlock = pointerUtc >= e.ts && pointerUtc <= (e.ts + durationMs);
        return tsMatch || inVisualBlock;
      })
      .sort((a, b) => Math.abs(a.ts - pointerUtc) - Math.abs(b.ts - pointerUtc))
      .slice(0, 5);
  }, [selectedLaneId, pointerUtc, laneMap, pointerMatchWindowMs]);
  const selectedLaneNearestEvent = useMemo(() => {
    if (!selectedLaneId || pointerUtc == null) return null;
    const laneEvents = (laneMap[selectedLaneId] || []).filter((e) => !isInternalEvent(e));
    if (laneEvents.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const e of laneEvents) {
      const durationMs = getEventVisualDurationMs(e);
      const inVisualBlock = pointerUtc >= e.ts && pointerUtc <= (e.ts + durationMs);
      const dist = inVisualBlock ? 0 : Math.abs(e.ts - pointerUtc);
      if (dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }, [selectedLaneId, pointerUtc, laneMap]);
  const selectedLaneEvent = selectedLaneExactEvents[0] || null;
  const selectedEvent = selectedLaneEvent || selectedLaneNearestEvent;

  const forensicByLane = useMemo(() => {
    const byLane = {};
    for (const id of laneIds) {
      const samples = (laneMap[id] || [])
        .filter((e) => e.category === 'analyse_result' && e.evidence)
        .sort((a, b) => a.ts - b.ts);
      const iatMin = samples.map((e) => num(e.evidence?.arrival?.iatMs?.min)).filter((v) => v != null);
      const iatAvg = samples.map((e) => num(e.evidence?.arrival?.iatMs?.avg)).filter((v) => v != null);
      const iatP95 = samples.map((e) => num(e.evidence?.arrival?.iatMs?.p95)).filter((v) => v != null);
      const jitter = samples.map((e) => num(e.evidence?.arrival?.jitterMs)).filter((v) => v != null);
      const loss = samples.map((e) => num(e.evidence?.arrival?.packetLossPct)).filter((v) => v != null);
      byLane[id] = {
        samples,
        iatMin,
        iatAvg,
        iatP95,
        jitter,
        loss,
        latest: samples.length > 0 ? samples[samples.length - 1] : null,
      };
    }
    return byLane;
  }, [laneIds, laneMap]);

  const globalRanges = useMemo(() => {
    const collect = (field) => laneIds.flatMap((id) => forensicByLane[id]?.[field] || []);
    const mk = (arr) => {
      if (!arr.length) return { min: null, max: null };
      return { min: Math.min(...arr), max: Math.max(...arr) };
    };
    return {
      iatMin: mk(collect('iatMin')),
      iatAvg: mk(collect('iatAvg')),
      iatP95: mk(collect('iatP95')),
      jitter: mk(collect('jitter')),
      loss: mk(collect('loss')),
    };
  }, [forensicByLane, laneIds]);

  const sparkScale = (metric) => {
    if (scaleMode !== 'absolute') return { minValue: null, maxValue: null };
    return {
      minValue: globalRanges[metric]?.min ?? null,
      maxValue: globalRanges[metric]?.max ?? null,
    };
  };

  const laneLineById = useMemo(() => {
    const out = {};
    for (const id of laneIds) {
      // Use full history so pre-window ETR/runtime events set initial lane colour
      out[id] = buildLaneGradient(fullLaneMap[id] || [], timeStart, effectiveWindowMs);
    }
    return out;
  }, [laneIds, fullLaneMap, timeStart, effectiveWindowMs]);

  // Current status label per lane — derived from the last known severity event
  // in fullLaneMap (pre-window history included) plus live heartbeat presence.
  // Values: 'ok' | 'warning' | 'critical' | 'los' | null (not running)
  const laneStatusById = useMemo(() => {
    const out = {};
    for (const id of laneIds) {
      const events = fullLaneMap[id] || [];
      const sorted = [...events].sort((a, b) => a.ts - b.ts);
      // Is there a recent heartbeat confirming the process is alive?
      const lastHeartbeatTs = sorted.filter((e) => e.category === 'runtime_heartbeat').pop()?.ts || 0;
      const isAlive = lastHeartbeatTs >= timeStart;
      // Check for explicit stop after the last start (process not running)
      const explicitStarts = sorted.filter((e) => e.category === 'runtime_started' && !e?.evidence?.bootstrap);
      const lastStartTs = explicitStarts.length > 0 ? explicitStarts[explicitStarts.length - 1].ts : 0;
      const stoppedAfterStart = sorted.some((e) => e.category === 'runtime_stopped' && e.ts >= lastStartTs && lastStartTs > 0);
      if (!isAlive && stoppedAfterStart) { out[id] = null; continue; }
      if (!isAlive && lastHeartbeatTs === 0 && explicitStarts.length === 0) { out[id] = null; continue; }
      // Last known severity from analyse_result or runtime_error (LOS)
      const losEvent = sorted.filter((e) => e.category === 'runtime_error' && e.evidence?.noSignal).pop();
      const lastAnalyse = sorted.filter((e) => e.category === 'analyse_result').pop();
      // LOS takes priority if it is newer than the last ok analyse
      if (losEvent && (!lastAnalyse || losEvent.ts > lastAnalyse.ts)) {
        out[id] = 'los';
      } else if (lastAnalyse) {
        out[id] = lastAnalyse.severity || 'ok';
      } else {
        out[id] = 'ok'; // running but no probe result yet
      }
    }
    return out;
  }, [laneIds, fullLaneMap, timeStart]);

  const laneBlocksById = useMemo(() => {
    const out = {};
    for (const id of laneIds) {
      out[id] = buildEventBlocks(laneMap[id] || [], timeStart, effectiveWindowMs);
    }
    return out;
  }, [laneIds, laneMap, timeStart, effectiveWindowMs]);
  const laneRecentStartById = useMemo(() => {
    const out = {};
    for (const id of laneIds) {
      const latestStart = (laneMap[id] || [])
        .filter((e) => e.category === 'runtime_started' && !e?.evidence?.bootstrap)
        .sort((a, b) => b.ts - a.ts)[0];
      out[id] = Boolean(latestStart && (timeEnd - latestStart.ts) <= STARTED_RECENTLY_MS);
    }
    return out;
  }, [laneIds, laneMap, timeEnd]);

  const popupPos = useMemo(() => {
    if (mouseX == null || mouseY == null) return null;
    const rightBias = mouseX > 72;
    const lowerBias = mouseY > 58;
    return {
      left: rightBias ? `calc(${mouseX}% - 372px)` : `calc(${mouseX}% + 12px)`,
      top: lowerBias ? `calc(${mouseY}% - 190px)` : `calc(${mouseY}% + 12px)`,
    };
  }, [mouseX, mouseY]);

  const applyCustomRange = () => {
    const startMs = parseDateTimeLocalValue(customStartInput);
    const endMs = parseDateTimeLocalValue(customEndInput);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      setRangeError('Enter both start and end date/time.');
      return;
    }
    if (endMs <= startMs) {
      setRangeError('End must be later than start.');
      return;
    }
    setCustomRange({ startMs, endMs });
    setRangeError('');
    setRangeMode('custom');
  };

  const setRelativeWindow = (ms) => {
    setWindowMs(ms);
    setRangeMode('relative');
    setRangeError('');
  };

  const resetToLiveWindow = () => {
    const end = Date.now();
    const start = end - windowMs;
    setCustomStartInput(toDateTimeLocalValue(start));
    setCustomEndInput(toDateTimeLocalValue(end));
    setCustomRange(null);
    setRangeMode('relative');
    setRangeError('');
    setFreezeCursor(false);
    if (crosshairLineRef.current) crosshairLineRef.current.style.display = 'none';
    setMouseX(null);
    setMouseY(null);
    setMouseLaneId(null);
  };

  return (
    <div className="broadcast-legacy" style={{ fontFamily: "'Courier New',monospace", color: C.text, display: 'grid', gap: 16 }}>
      <BentoCard icon={Activity} title="Live View">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] text-gray-400">Horizontal UTC timeline by monitor/analyser lane</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRelativeWindow(opt.value)}
                className={`text-[11px] px-2 py-0.5 rounded border ${
                  rangeMode === 'relative' && windowMs === opt.value
                    ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10'
                    : 'border-white/10 text-gray-400 bg-black/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => setScaleMode((m) => (m === 'normalized' ? 'absolute' : 'normalized'))}
              className={`text-[11px] px-2 py-0.5 rounded border ${
                scaleMode === 'absolute'
                  ? 'border-led-amber/50 text-led-amber bg-led-amber/10'
                  : 'border-white/10 text-gray-400 bg-black/20'
              }`}
            >
              Scale: {scaleMode === 'absolute' ? 'Absolute' : 'Normalized'}
            </button>
            <button
              onClick={() => setFreezeCursor((v) => !v)}
              className={`text-[11px] px-2 py-0.5 rounded border ${
                freezeCursor
                  ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10'
                  : 'border-white/10 text-gray-400 bg-black/20'
              }`}
            >
              {freezeCursor ? 'Cursor Frozen' : 'Freeze Cursor'}
            </button>
            <button
              onClick={resetToLiveWindow}
              className={`text-[11px] px-2 py-0.5 rounded border ${
                rangeMode === 'relative'
                  ? 'border-led-green/50 text-led-green bg-led-green/10'
                  : 'border-white/10 text-gray-400 bg-black/20'
              }`}
            >
              Live
            </button>
          </div>
        </div>
        <div className="mb-2 flex items-center gap-2 flex-wrap text-[10px]">
          <span className="text-gray-500 uppercase tracking-wider">custom range</span>
          <input
            type="datetime-local"
            value={customStartInput}
            onChange={(e) => setCustomStartInput(e.target.value)}
            className="px-2 py-1 rounded border border-white/15 bg-black/40 text-gray-300"
          />
          <span className="text-gray-500">to</span>
          <input
            type="datetime-local"
            value={customEndInput}
            onChange={(e) => setCustomEndInput(e.target.value)}
            className="px-2 py-1 rounded border border-white/15 bg-black/40 text-gray-300"
          />
          <button
            onClick={applyCustomRange}
            className={`text-[11px] px-2 py-1 rounded border ${
              rangeMode === 'custom'
                ? 'border-purple-400/60 text-purple-200 bg-purple-900/25'
                : 'border-white/15 text-gray-300 bg-black/30'
            }`}
          >
            Apply
          </button>
          {rangeError && <span className="text-led-red font-mono">{rangeError}</span>}
        </div>
        <div className="mb-1.5 flex items-center gap-2.5 text-[9px] text-gray-500 font-mono">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#ffb266' }} />
            alarm
          </span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px" style={{ background: '#3db86a' }} /> nominal</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px" style={{ background: '#ffaa00' }} /> warning</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px" style={{ background: '#ff2233' }} /> critical</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px" style={{ background: '#cc44ff' }} /> incident</span>
        </div>
        <div className="mb-2 flex items-center gap-2.5 text-[9px] text-gray-500 font-mono flex-wrap">
          <span className="text-gray-600 uppercase tracking-wider">type</span>
          {LEGEND_TYPE_ITEMS.map((item) => {
            const vis = getEventVisualStyle(item.category, item.severity);
            return (
              <span key={item.key} className="inline-flex items-center gap-1">
                <span
                  className="inline-block w-4 h-1 rounded-sm border"
                  style={{ background: vis.bg, borderColor: vis.border, boxShadow: `0 0 4px ${vis.glow}` }}
                />
                {item.label}
              </span>
            );
          })}
        </div>

        <div
          className="relative rounded-xl border border-white/10 bg-black/30 overflow-hidden"
          style={{ height: `${Math.max(180, 92 + laneIds.length * LANE_STEP_PX)}px` }}
          onMouseMove={(e) => {
            if (freezeCursor) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
            const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
            const yPx = e.clientY - rect.top;
            const laneIdx = Math.round((yPx - LANE_TOP_PX) / LANE_STEP_PX);
            const laneId = laneIds[Math.min(laneIds.length - 1, Math.max(0, laneIdx))] || null;
            // Update crosshair instantly via DOM — no React re-render needed
            if (crosshairLineRef.current) {
              crosshairLineRef.current.style.display = 'block';
              crosshairLineRef.current.style.left = `${x}%`;
            }
            // Throttle React state to rAF so popup + hover data update at ≤60fps
            pendingMouseRef.current = { x, yPct, laneId };
            if (!mouseRafRef.current) {
              mouseRafRef.current = requestAnimationFrame(() => {
                mouseRafRef.current = null;
                const p = pendingMouseRef.current;
                if (p) {
                  setMouseX(p.x);
                  setMouseY(p.yPct);
                  setMouseLaneId(p.laneId);
                }
              });
            }
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
            const yPct = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100));
            if (crosshairLineRef.current) {
              crosshairLineRef.current.style.display = 'block';
              crosshairLineRef.current.style.left = `${x}%`;
            }
            setMouseX(x);
            setMouseY(yPct);
            const yPx = e.clientY - rect.top;
            const laneIdx = Math.round((yPx - LANE_TOP_PX) / LANE_STEP_PX);
            const laneId = laneIds[Math.min(laneIds.length - 1, Math.max(0, laneIdx))] || null;
            setMouseLaneId(laneId);
            setFreezeCursor(true);
            if (laneId && typeof onSelectDecoder === 'function') {
              onSelectDecoder(laneId);
            }
          }}
          onMouseLeave={() => {
            if (!freezeCursor) {
              if (crosshairLineRef.current) crosshairLineRef.current.style.display = 'none';
              if (mouseRafRef.current) { cancelAnimationFrame(mouseRafRef.current); mouseRafRef.current = null; }
              pendingMouseRef.current = null;
              setMouseX(null);
              setMouseY(null);
              setMouseLaneId(null);
            }
          }}
        >
          <div className="absolute left-2 top-1.5 text-[9px] text-gray-500 font-mono">{toUtc(timeStart)}</div>
          <div className="absolute right-2 top-1.5 text-[9px] text-gray-500 font-mono">{toUtc(timeEnd)}</div>

          {/* Current UTC position line */}
          <div className="absolute top-0 bottom-0 border-l border-neon-cyan/70" style={{ left: '100%' }} />

          {/* Mouse crosshair line — position driven directly via DOM ref for zero-lag rendering */}
          <div
            ref={crosshairLineRef}
            className="absolute top-0 bottom-0 border-l border-white/50 pointer-events-none"
            style={{ display: 'none', left: '0%' }}
          />

          {laneIds.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
              Waiting for live runtime/ETR/TS events...
            </div>
          ) : (
            laneIds.map((id, laneIdx) => {
              const y = LANE_TOP_PX + laneIdx * LANE_STEP_PX;
              const laneEventAtPointer = lanePointerStatus.find((row) => row.id === id)?.event || null;
              const lineColor = laneColorForEvent(mouseX != null ? laneEventAtPointer : null);
              const laneBlocks = laneBlocksById[id] || [];
              return (
                <div key={id}>
                  <div
                    className="absolute left-0 right-0 overflow-hidden"
                    style={{
                      top: `${y - (LANE_LINE_THICKNESS_PX / 2)}px`,
                      height: `${LANE_LINE_THICKNESS_PX}px`,
                      right: '46px', // leave room for status label
                      zIndex: 1,
                    }}
                  >
                    <LaneCanvas
                      gradient={laneLineById[id] || `linear-gradient(90deg, ${lineColor} 0%, ${lineColor} 100%)`}
                      height={LANE_LINE_THICKNESS_PX}
                    />
                  </div>
                  <div
                    className="absolute left-2 -translate-y-1/2 inline-flex items-center gap-1 max-w-[340px] text-[11px] font-mono px-1.5 rounded"
                    style={{
                      top: `${y}px`,
                      color: C.text,
                      background: '#07090df0',
                      border: '1px solid rgba(255,255,255,0.10)',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                      zIndex: 4,
                    }}
                    title={id}
                  >
                    <span
                      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm"
                      aria-hidden="true"
                      style={{
                        width: '26px',
                        height: '18px',
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0a0a0a',
                        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03)',
                      }}
                    >
                      {laneThumbnailById[id] ? (
                        <img
                          src={laneThumbnailById[id]}
                          alt=""
                          className="w-full h-full"
                          style={{ objectFit: 'cover', objectPosition: 'center' }}
                          loading="lazy"
                        />
                      ) : (
                        <span className="inline-block w-[3px] h-[3px] rounded-full" style={{ background: '#2f3a4d' }} />
                      )}
                    </span>
                    <span className="truncate">{id}</span>
                    {laneRecentStartById[id] && (
                      <span
                        className="ml-1.5 inline-flex items-center rounded border border-emerald-400/40 bg-emerald-500/15 px-1 py-0 text-[9px] uppercase tracking-wide text-emerald-300"
                        title="Started recently"
                      >
                        new
                      </span>
                    )}
                  </div>
                  {laneBlocks.length > 0 && (
                    <div
                      className="absolute left-0 right-0 overflow-hidden"
                      style={{
                        top: `${y - 3}px`,
                        height: '6px',
                        zIndex: 2,
                      }}
                    >
                      {laneBlocks.map((blk) => (
                        <div
                          key={blk.key}
                          className="absolute h-full rounded-sm border"
                          style={{
                            left: `${blk.leftPct}%`,
                            width: `${blk.widthPct}%`,
                            background: blk.bg,
                            borderColor: blk.border,
                            boxShadow: `0 0 5px ${blk.glow}`,
                          }}
                          title={blk.title}
                        />
                      ))}
                    </div>
                  )}
                  {/* Right-edge status label — broadcast operator quick-read */}
                  {(() => {
                    const st = laneStatusById[id];
                    if (!st) return null;
                    const cfg = st === 'los'
                      ? { label: 'LOS',  color: '#ff2233', bg: 'rgba(255,34,51,0.12)',  border: 'rgba(255,34,51,0.35)' }
                      : st === 'critical'
                        ? { label: 'CRIT', color: '#ff2233', bg: 'rgba(255,34,51,0.12)',  border: 'rgba(255,34,51,0.35)' }
                        : st === 'warning'
                          ? { label: 'WARN', color: '#ffaa00', bg: 'rgba(255,170,0,0.12)', border: 'rgba(255,170,0,0.35)' }
                          : { label: 'OK',   color: '#3db86a', bg: 'rgba(61,184,106,0.12)', border: 'rgba(61,184,106,0.32)' };
                    return (
                      <div
                        className="absolute -translate-y-1/2"
                        style={{
                          top: `${y}px`,
                          right: '4px',
                          zIndex: 5,
                          fontFamily: "'Courier New',monospace",
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          color: cfg.color,
                          background: cfg.bg,
                          border: `1px solid ${cfg.border}`,
                          borderRadius: 2,
                          padding: '1px 5px',
                          background: '#070b14ee',
                          pointerEvents: 'none',
                          userSelect: 'none',
                        }}
                      >
                        {cfg.label}
                      </div>
                    );
                  })()}
                </div>
              );
            })
          )}

          {/* Pointer popup with lane-specific error context */}
          {mouseX != null && selectedLaneId && (
            <div
              className="absolute z-20 w-[360px] max-w-[92%] rounded-lg border border-white/15 bg-black/90 backdrop-blur-md p-2.5 text-[11px]"
              style={{
                left: popupPos ? popupPos.left : `clamp(8px, calc(${mouseX}% + 12px), calc(100% - 368px))`,
                top: popupPos ? popupPos.top : '28px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-gray-200">{selectedLaneId}</div>
                <div className="font-mono text-gray-500">{pointerUtc ? toUtc(pointerUtc) : '-'}</div>
              </div>
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Events At Pointer (±{pointerMatchWindowMs}ms)
                </div>
                {selectedLaneExactEvents.length === 0 ? (
                  <div className="text-gray-500">
                    {selectedLaneNearestEvent
                      ? `No exact event at pointer. Showing nearest event at ${toUtc(selectedLaneNearestEvent.ts)}.`
                      : 'No event exactly at selected pointer time.'}
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-auto">
                    {selectedLaneExactEvents.map((e) => (
                      <div
                        key={e.key}
                        className={`rounded border px-2 py-1 ${
                          e.severity === 'critical'
                            ? 'border-led-red/25 bg-led-red/10'
                            : e.severity === 'warning'
                              ? 'border-led-amber/25 bg-led-amber/10'
                              : 'border-white/15 bg-black/30'
                        }`}
                      >
                        <div className={`${e.severity === 'critical' ? 'text-led-red' : e.severity === 'warning' ? 'text-led-amber' : 'text-gray-300'} font-mono`}>{e.title}</div>
                        <div className="text-gray-400 flex gap-2">
                          <span>{toUtc(e.ts)}</span>
                          <span className="text-gray-600">{pointerUtc != null ? `${Math.max(0, (pointerUtc - e.ts) / 1000).toFixed(2)}s` : '0.00s'}</span>
                        </div>
                        <div className="text-gray-500 truncate">{e.description || '-'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Pointer UTC</div>
            <div className="font-mono text-gray-300">
              {pointerUtc == null ? '-' : toUtc(pointerUtc)}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Selected Event</div>
            <div className="font-mono text-gray-300">{selectedEvent ? selectedEvent.title : 'Move mouse over a lane'}</div>
            <div className="text-gray-500 mt-0.5">{selectedEvent ? selectedEvent.description : '-'}</div>
            <div className="text-gray-500 mt-0.5">{selectedEvent ? toUtc(selectedEvent.ts) : '-'}</div>
            {selectedEvent?.evidence?.etr?.priorityLabel && (
              <div className="text-gray-500 mt-0.5">
                DVB ETR 290: {selectedEvent.evidence.etr.priorityLabel}
              </div>
            )}
            {selectedEvent?.evidence?.etr?.checkLabel && (
              <div className="text-gray-500 mt-0.5">
                Check: {selectedEvent.evidence.etr.checkLabel}
                {selectedEvent.evidence.etr.checkKey ? ` (${selectedEvent.evidence.etr.checkKey})` : ''}
              </div>
            )}
            {Array.isArray(selectedEvent?.evidence?.etr?.activeChecks) && selectedEvent.evidence.etr.activeChecks.length > 0 && (
              <div className="text-gray-500 mt-0.5">
                Active checks: {selectedEvent.evidence.etr.activeChecks.map((c) => c.checkLabel).join(', ')}
              </div>
            )}
            {selectedEvent?.evidence?.bitrateSource && (
              <div className="text-gray-500 mt-0.5">Bitrate source: {selectedEvent.evidence.bitrateSource}</div>
            )}
            {selectedEvent?.evidence?.siCompliance && (
              <div className="text-gray-500 mt-0.5">
                SI: NIT {String(selectedEvent.evidence.siCompliance.nit)} · SDT {String(selectedEvent.evidence.siCompliance.sdt)} · EITp/f {String(selectedEvent.evidence.siCompliance.eitPf)} · TDT {String(selectedEvent.evidence.siCompliance.tdt)}
              </div>
            )}
            {selectedEvent?.evidence?.arrival && (
              <div className="text-gray-500 mt-0.5">
                Arrival: jitter {selectedEvent.evidence.arrival.jitterMs ?? '-'} ms · loss {selectedEvent.evidence.arrival.packetLossPct ?? '-'}%
              </div>
            )}
            {selectedEvent?.evidence?.health && (
              <div className="text-gray-500 mt-0.5">
                Health: {selectedEvent.evidence.health.score ?? '-'} / 100 · {selectedEvent.evidence.health.severity || '-'}
              </div>
            )}
            {selectedEvent?.evidence?.timestampDiscontinuity && (
              <div className="text-gray-500 mt-0.5">
                Timestamp discontinuities: {selectedEvent.evidence.timestampDiscontinuity.count ?? 0}
              </div>
            )}
            {selectedEvent?.evidence?.continuityCounterErrors && (
              <div className="text-gray-500 mt-0.5">
                CC errors: {selectedEvent.evidence.continuityCounterErrors.count ?? 0}
              </div>
            )}
            {selectedEvent?.evidence?.dolbyE && (
              <div className="text-gray-500 mt-0.5">
                Dolby E: detected {String(Boolean(selectedEvent.evidence.dolbyE.detected))} · decoded {String(Boolean(selectedEvent.evidence.dolbyE.decoded))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Lane Status At Pointer</div>
          {lanePointerStatus.length === 0 ? (
            <div className="text-gray-500">No active lanes in selected window.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {lanePointerStatus.map((row) => (
                <div key={row.id} className="rounded border border-white/10 bg-black/30 px-2 py-1.5">
                  <div className="font-mono text-gray-300">{row.id}</div>
                  <div className="text-gray-500">
                    {row.event ? `${row.event.title} @ ${toUtc(row.event.ts)}` : 'No event'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">IAT / Jitter Forensics</div>
          {laneIds.length === 0 ? (
            <div className="text-gray-500">No lanes in selected window.</div>
          ) : (
            <div className="space-y-3">
              {laneIds.map((id) => {
                const lane = forensicByLane[id];
                const latest = lane?.latest?.evidence?.arrival || null;
                const latestIat = latest?.iatMs || {};
                const latestDiag = lane?.latest?.evidence?.probeDiagnostics?.tsduck || null;
                const tsduckMissing = typeof latestDiag?.error === 'string' && latestDiag.error.includes('ENOENT');
                const hasForensicMetrics = Boolean(latest) || (lane?.iatMin?.length || lane?.iatAvg?.length || lane?.iatP95?.length || lane?.jitter?.length || lane?.loss?.length);
                return (
                  <div key={`forensic-${id}`} className="rounded border border-white/10 bg-black/30 p-2">
                    <div className="font-mono text-gray-300 mb-2">{id}</div>
                    {(() => {
                      const cm = lane?.latest?.evidence?.probeDiagnostics?.iatSniffer?.captureMethod;
                      if (!cm) return null;
                      const isNic = cm === 'tshark' || cm === 'tcpdump';
                      return (
                        <span
                          className={`inline-block mb-1 text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            isNic
                              ? 'text-neon-cyan border-neon-cyan/30 bg-neon-cyan/10'
                              : 'text-led-amber border-led-amber/30 bg-led-amber/10'
                          }`}
                          title={isNic
                            ? `Packet capture via ${cm} - NIC-level IAT`
                            : 'IAT derived from stream analyser - install tshark or tcpdump for NIC-capture'}
                        >
                          {isNic ? `NIC-capture (${cm})` : 'analyser-derived'}
                        </span>
                      );
                    })()}
                    {!lane || lane.samples.length === 0 ? (
                      <div className="text-gray-500">No analyse samples yet for this lane.</div>
                    ) : !hasForensicMetrics ? (
                      <div className="text-gray-500">
                        Analyse samples received; advanced arrival telemetry is unavailable.
                        {tsduckMissing ? (
                          <span className="block mt-1 text-[10px]">
                            Optional `tsanalyze` tool is not installed on this host (fallback mode active).
                          </span>
                        ) : latestDiag?.error ? (
                          <span className="block mt-1 text-[10px]">
                            Probe diagnostics: {latestDiag.error}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
                        <div className="rounded border border-white/10 bg-black/20 p-1.5">
                          <div className="text-[10px] text-gray-500 uppercase">IAT Min (ms)</div>
                          <Sparkline data={lane.iatMin} width={120} height={24} color="#00ddff" {...sparkScale('iatMin')} />
                          <div className="font-mono text-gray-300 text-[11px]">{latestIat.min ?? '-'}</div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 p-1.5">
                          <div className="text-[10px] text-gray-500 uppercase">IAT Avg (ms)</div>
                          <Sparkline data={lane.iatAvg} width={120} height={24} color="#66ccff" {...sparkScale('iatAvg')} />
                          <div className="font-mono text-gray-300 text-[11px]">{latestIat.avg ?? '-'}</div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 p-1.5">
                          <div className="text-[10px] text-gray-500 uppercase">IAT P95 (ms)</div>
                          <Sparkline data={lane.iatP95} width={120} height={24} color="#cc88ff" {...sparkScale('iatP95')} />
                          <div className="font-mono text-gray-300 text-[11px]">{latestIat.p95 ?? '-'}</div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 p-1.5">
                          <div className="text-[10px] text-gray-500 uppercase">Jitter (ms)</div>
                          <Sparkline data={lane.jitter} width={120} height={24} color="#ffaa00" {...sparkScale('jitter')} />
                          <div className="font-mono text-gray-300 text-[11px]">{latest?.jitterMs ?? '-'}</div>
                        </div>
                        <div className="rounded border border-white/10 bg-black/20 p-1.5">
                          <div className="text-[10px] text-gray-500 uppercase">Packet Loss (%)</div>
                          <Sparkline data={lane.loss} width={120} height={24} color="#ff5566" {...sparkScale('loss')} />
                          <div className="font-mono text-gray-300 text-[11px]">{latest?.packetLossPct ?? '-'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </BentoCard>
    </div>
  );
}

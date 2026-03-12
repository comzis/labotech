import React, { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import Sparkline from './Sparkline';
import { getEvents } from '../api';
import { C } from './BroadcastUI';

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
const EVENT_BLOCK_DURATION_MS = {
  etr290_alarm: 14000,
  etr290_incident: 18000,
  etr290_incident_cleared: 6000,
  runtime_error: 15000,
  failover: 16000,
  analyse_result: 7000,
  etr290_status: 5000,
};
const EVENT_STYLE_BY_CATEGORY = {
  etr290_alarm: { alpha: 'ee', borderAlpha: 'cc', glowAlpha: '88' },
  etr290_incident: { alpha: 'dd', borderAlpha: 'bb', glowAlpha: '70' },
  etr290_incident_cleared: { alpha: '99', borderAlpha: '88', glowAlpha: '55' },
  runtime_error: { alpha: 'f2', borderAlpha: 'd6', glowAlpha: '99' },
  failover: { alpha: 'd0', borderAlpha: 'b4', glowAlpha: '66' },
  analyse_result: { alpha: 'b8', borderAlpha: '99', glowAlpha: '55' },
  etr290_status: { alpha: '94', borderAlpha: '82', glowAlpha: '44' },
};
const LEGEND_TYPE_ITEMS = [
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
    m.includes('connection refused') ||
    m.includes('input/output error') ||
    m.includes('server returned 404') ||
    m.includes('immediate exit requested')
  );
}

function normalizeLaneId(rawId) {
  const id = String(rawId || '').trim();
  if (!id) return 'unknown';
  // ETR monitor IDs are typically prefixed (etr-<decoder-id>) while analyser
  // events use plain decoder IDs. Normalize both into one visual lane.
  return id.replace(/^etr[-_:]/i, '') || id;
}

function toUtc(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function toEvent(msg) {
  if (!msg?.type) return null;
  const ts = msg.time ? new Date(msg.time).getTime() : Date.now();
  if (!Number.isFinite(ts)) return null;
  if (msg.type === 'etr290_alarm') {
    const laneId = normalizeLaneId(msg.id || 'etr');
    const etr = buildEtrMeta(msg);
    return {
      key: `${ts}-${msg.id || 'unknown'}-${msg.label || 'alarm'}`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_alarm',
      severity: etr.severity,
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
    return {
      key: `${ts}-${msg.id || 'unknown'}-status`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_status',
      severity: hasP1 ? 'critical' : hasP2 ? 'warning' : 'ok',
      title: hasP1 ? 'ETR 290 status: Priority 1 active' : hasP2 ? 'ETR 290 status: Priority 2 active' : 'ETR 290 status: nominal',
      description: activeChecks.length > 0
        ? `Active checks: ${activeChecks.map((c) => c.checkLabel).join(', ')}`
        : 'No active ETR 290 errors',
      evidence: {
        runtime: msg.runtime || null,
        etr: {
          priority: statusPriority,
          priorityLabel: etrPriorityLabel(statusPriority),
          activeChecks,
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
    const severity = healthSeverity === 'critical' || healthSeverity === 'warning'
      ? healthSeverity
      : (hasSiViolation ? 'warning' : 'ok');
    const healthScore = Number.isFinite(dvb?.health?.score) ? dvb.health.score : null;
    const title = severity === 'critical'
      ? 'TS Analysis (critical)'
      : severity === 'warning'
        ? 'TS Analysis (warning)'
        : 'TS Analysis (OK)';
    return {
      key: `${ts}-${msg.id || 'analyse'}-analyse`,
      ts,
      id: laneId,
      rawId: msg.id || 'analyse',
      category: 'analyse_result',
      severity,
      title,
      description: `${dvb.pidCount ?? 0} PID · ${dvb.serviceCount ?? 0} svc · ${(dvb.bitrateBps ? (dvb.bitrateBps / 1e6).toFixed(2) : '0.00')} Mbps${healthScore != null ? ` · health ${healthScore}/100` : ''}`,
      evidence: {
        bitrateSource: dvb.bitrateSource || null,
        bitrateMbps: dvb.bitrateBps ? Number((dvb.bitrateBps / 1e6).toFixed(3)) : null,
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
  if (msg.type === 'error') {
    const laneId = normalizeLaneId(msg.id || 'system');
    const isNoSignal = isExpectedNoSignalError(msg.message);
    return {
      key: `${ts}-${msg.id || 'system'}-error-${msg.message || ''}`,
      ts,
      id: laneId,
      rawId: msg.id || 'system',
      category: 'runtime_error',
      severity: isNoSignal ? 'warning' : 'critical',
      title: isNoSignal ? 'Input signal missing' : 'Engine error',
      description: msg.message || 'Unknown runtime error',
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
  return null;
}

function colorForSeverity(severity) {
  if (severity === 'critical') return '#ff6b6b';
  if (severity === 'warning') return '#ffe680';
  if (severity === 'ok') return '#00dd55';
  return '#00ddff';
}

function laneColorForEvent(event) {
  if (!event) return '#ffffff26';
  if (event.category === 'etr290_alarm') return '#ffb266aa';
  if (event.category === 'etr290_incident' || event.category === 'etr290_incident_cleared') return '#b784ffaa';
  if (event.severity === 'critical') return '#ff6b6baa';
  if (event.severity === 'warning') return '#ffe680aa';
  if (event.severity === 'ok') return '#00dd5566';
  return '#66ccff66';
}

function colorForLaneSeverity(severity) {
  if (severity === 'critical') return '#ff6b6b';
  if (severity === 'warning') return '#ffe680';
  if (severity === 'ok') return '#00dd55';
  return '#66ccff';
}

function buildLaneGradient(events, timeStart, windowMs) {
  if (!Array.isArray(events) || events.length === 0 || windowMs <= 0) {
    return 'linear-gradient(90deg, #00dd5530 0%, #00dd5530 100%)';
  }
  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  let currentSeverity = 'ok';
  for (const e of sorted) {
    if (e.ts <= timeStart) currentSeverity = e.severity || currentSeverity;
    else break;
  }
  const parts = [`${colorForLaneSeverity(currentSeverity)}66 0%`];
  for (const e of sorted) {
    if (e.ts < timeStart || e.ts > timeStart + windowMs) continue;
    const x = Math.min(100, Math.max(0, ((e.ts - timeStart) / windowMs) * 100));
    const nextSeverity = e.severity || currentSeverity;
    parts.push(`${colorForLaneSeverity(currentSeverity)}66 ${x}%`);
    parts.push(`${colorForLaneSeverity(nextSeverity)}66 ${x}%`);
    currentSeverity = nextSeverity;
  }
  parts.push(`${colorForLaneSeverity(currentSeverity)}66 100%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

function buildEventBlocks(events, timeStart, windowMs) {
  if (!Array.isArray(events) || events.length === 0 || windowMs <= 0) return [];
  const end = timeStart + windowMs;
  return events
    .filter((e) => e && e.ts != null)
    .map((e, idx) => {
      const startTs = Math.max(timeStart, e.ts);
      const baseDur = EVENT_BLOCK_DURATION_MS[e.category] || 6000;
      const severityFactor = e.severity === 'critical' ? 1.35 : e.severity === 'warning' ? 1.15 : 1.0;
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

function getEventVisualStyle(category, severity) {
  const style = EVENT_STYLE_BY_CATEGORY[category] || { alpha: 'cc', borderAlpha: 'aa', glowAlpha: '66' };
  let color = colorForSeverity(severity);
  if (category === 'etr290_alarm') color = '#ffb266';
  if (category === 'etr290_incident' || category === 'etr290_incident_cleared') color = '#b784ff';
  return {
    color,
    bg: `${color}${style.alpha}`,
    border: `${color}${style.borderAlpha}`,
    glow: `${color}${style.glowAlpha}`,
  };
}

function num(v, digits = 3) {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
}

export default function StreamViewPanel({ lastMessage, onSelectDecoder }) {
  const LANE_TOP_PX = 48;
  const LANE_STEP_PX = 34;
  const LANE_LINE_THICKNESS_PX = 8;
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

  useEffect(() => {
    const end = Date.now();
    const start = end - WINDOW_OPTIONS[1].value;
    setCustomStartInput(toDateTimeLocalValue(start));
    setCustomEndInput(toDateTimeLocalValue(end));
  }, []);

  const mergeTimelineEvents = (prev, incoming) => {
    const byKey = new Map(prev.map((e) => [e.key, e]));
    (incoming || []).forEach((e) => {
      if (!e) return;
      byKey.set(e.key, e);
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

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

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

  const laneIds = useMemo(() => {
    const ids = Array.from(new Set(timelineEvents.map((e) => e.id)));
    return ids.sort();
  }, [timelineEvents]);

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
    return laneIds.map((id) => {
      const laneEvents = laneMap[id] || [];
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
      return { id, event: best };
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
      .filter((e) => Math.abs(e.ts - pointerUtc) <= pointerMatchWindowMs)
      .sort((a, b) => Math.abs(a.ts - pointerUtc) - Math.abs(b.ts - pointerUtc))
      .slice(0, 5);
  }, [selectedLaneId, pointerUtc, laneMap, pointerMatchWindowMs]);
  const selectedLaneEvent = selectedLaneExactEvents[0] || null;
  const selectedEvent = selectedLaneEvent;

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
      out[id] = buildLaneGradient(laneMap[id] || [], timeStart, effectiveWindowMs);
    }
    return out;
  }, [laneIds, laneMap, timeStart, effectiveWindowMs]);

  const laneBlocksById = useMemo(() => {
    const out = {};
    for (const id of laneIds) {
      out[id] = buildEventBlocks(laneMap[id] || [], timeStart, effectiveWindowMs);
    }
    return out;
  }, [laneIds, laneMap, timeStart, effectiveWindowMs]);

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
    setRangeMode('relative');
    setRangeError('');
  };

  return (
    <div style={{ fontFamily: "'Courier New',monospace", color: C.text, display: 'grid', gap: 16 }}>
      <BentoCard icon={Activity} title="Stream View">
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
                  ? 'border-amber-500/50 text-amber-300 bg-amber-900/20'
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
                  ? 'border-green-500/50 text-green-300 bg-green-900/20'
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
          {rangeError && <span className="text-red-300">{rangeError}</span>}
        </div>
        <div className="mb-1.5 flex items-center gap-2.5 text-[9px] text-gray-500 font-mono">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#ffb266' }} />
            alarm
          </span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px bg-green-500" /> nominal</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px" style={{ background: '#ffe680' }} /> warning</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px" style={{ background: '#ff6b6b' }} /> critical</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px" style={{ background: '#b784ff' }} /> incident</span>
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
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const yPct = ((e.clientY - rect.top) / rect.height) * 100;
            setMouseX(Math.min(100, Math.max(0, x)));
            setMouseY(Math.min(100, Math.max(0, yPct)));
            const yPx = e.clientY - rect.top;
            const laneIdx = Math.round((yPx - LANE_TOP_PX) / LANE_STEP_PX);
            setMouseLaneId(laneIds[Math.min(laneIds.length - 1, Math.max(0, laneIdx))] || null);
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const yPct = ((e.clientY - rect.top) / rect.height) * 100;
            setMouseX(Math.min(100, Math.max(0, x)));
            setMouseY(Math.min(100, Math.max(0, yPct)));
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

          {/* Mouse crosshair line */}
          {mouseX != null && (
            <div className="absolute top-0 bottom-0 border-l border-white/50 pointer-events-none" style={{ left: `${mouseX}%` }} />
          )}

          {laneIds.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
              Waiting for live runtime/ETR/TS events...
            </div>
          ) : (
            laneIds.map((id, laneIdx) => {
              const y = LANE_TOP_PX + laneIdx * LANE_STEP_PX;
              const laneEventAtPointer = lanePointerStatus.find((row) => row.id === id)?.event || null;
              const lineColor = laneColorForEvent(mouseX != null ? laneEventAtPointer : null);
              const laneAlerts = (laneMap[id] || []).filter((e) => e.severity === 'warning' || e.severity === 'critical');
              return (
                <div key={id}>
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      top: `${y - (LANE_LINE_THICKNESS_PX / 2)}px`,
                      height: `${LANE_LINE_THICKNESS_PX}px`,
                      background: laneLineById[id] || lineColor,
                    }}
                  />
                  <div
                    className="absolute left-2 -translate-y-1/2 text-[11px] text-gray-300 font-mono max-w-[260px] truncate px-1 rounded"
                    style={{ top: `${y}px`, background: 'rgba(0,0,0,0.32)' }}
                    title={id}
                  >
                    {id}
                  </div>
                  {laneAlerts.length > 0 && (
                    <div
                      className="absolute left-0 right-0 overflow-hidden"
                      style={{
                        top: `${y - 3}px`,
                        height: '6px',
                      }}
                    >
                      {(laneBlocksById[id] || []).map((blk) => (
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
              <div className="mt-1 text-gray-400">
                {selectedLaneEvent ? `${selectedLaneEvent.title} @ ${toUtc(selectedLaneEvent.ts)}` : 'No event at pointer'}
              </div>
              <div className="mt-2 border-t border-white/10 pt-2">
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Events At Pointer (±{pointerMatchWindowMs}ms)
                </div>
                {selectedLaneExactEvents.length === 0 ? (
                  <div className="text-gray-500">No event exactly at selected pointer time.</div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-auto">
                    {selectedLaneExactEvents.map((e) => (
                      <div
                        key={e.key}
                        className={`rounded border px-2 py-1 ${
                          e.severity === 'critical'
                            ? 'border-red-500/25 bg-red-900/15'
                            : e.severity === 'warning'
                              ? 'border-amber-500/25 bg-amber-900/15'
                              : 'border-white/15 bg-black/30'
                        }`}
                      >
                        <div className={`${e.severity === 'critical' ? 'text-red-300' : e.severity === 'warning' ? 'text-amber-300' : 'text-gray-300'} font-mono`}>{e.title}</div>
                        <div className="text-gray-400">{toUtc(e.ts)}</div>
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
                              : 'text-amber-400 border-amber-500/30 bg-amber-900/20'
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
                        Analyse samples received, but arrival telemetry is unavailable.
                        {latestDiag ? (
                          <span className="block mt-1 text-[10px]">
                            tsduck attempted: {String(latestDiag.attempted)} · available: {String(latestDiag.available)} · ok: {String(latestDiag.ok)}
                            {latestDiag.error ? ` · error: ${latestDiag.error}` : ''}
                          </span>
                        ) : (
                          <span className="block mt-1 text-[10px]">No probe diagnostics in sample payload.</span>
                        )}
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

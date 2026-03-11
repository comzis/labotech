import React, { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import Sparkline from './Sparkline';
import { getEvents } from '../api';

const WINDOW_OPTIONS = [
  { value: 5 * 60 * 1000, label: '5m' },
  { value: 15 * 60 * 1000, label: '15m' },
  { value: 60 * 60 * 1000, label: '1h' },
];

const P1_KEYS = ['ts_sync', 'sync_byte', 'pat_error', 'cc_error', 'pmt_error', 'pid_error'];
const P2_KEYS = ['transport_error', 'crc_error', 'pcr_disc', 'pcr_acc', 'pcr_rep', 'pts_error', 'cat_error'];
const MAX_EVENTS = 1500;

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
    return {
      key: `${ts}-${msg.id || 'unknown'}-${msg.label || 'alarm'}`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_alarm',
      severity: msg.priority === 'p1' ? 'critical' : msg.priority === 'p2' ? 'warning' : 'info',
      title: `${(msg.priority || 'p3').toUpperCase()} ${msg.label || 'Alarm'}`,
      description: msg.message || '',
    };
  }
  if (msg.type === 'etr290_status') {
    const laneId = normalizeLaneId(msg.id || 'etr');
    const status = msg.status || {};
    const hasP1 = P1_KEYS.some((k) => status[k] === 'error');
    const hasP2 = P2_KEYS.some((k) => status[k] === 'error');
    return {
      key: `${ts}-${msg.id || 'unknown'}-status`,
      ts,
      id: laneId,
      rawId: msg.id || 'etr',
      category: 'etr290_status',
      severity: hasP1 ? 'critical' : hasP2 ? 'warning' : 'ok',
      title: hasP1 ? 'ETR Status (P1)' : hasP2 ? 'ETR Status (P2)' : 'ETR Status (OK)',
      description: hasP1 ? 'Priority 1 errors detected' : hasP2 ? 'Priority 2 errors detected' : 'No active ETR errors',
      evidence: {
        runtime: msg.runtime || null,
      },
    };
  }
  if (msg.type === 'analyse_result') {
    const laneId = normalizeLaneId(msg.id || 'analyse');
    const dvb = msg.dvb || {};
    const si = dvb.si || {};
    const compliance = si.compliance || {};
    const hasSiViolation = ['nit', 'sdt', 'eitPf', 'tdt'].some((k) => compliance[k] === false);
    const severity = hasSiViolation ? 'warning' : 'ok';
    return {
      key: `${ts}-${msg.id || 'analyse'}-analyse`,
      ts,
      id: laneId,
      rawId: msg.id || 'analyse',
      category: 'analyse_result',
      severity,
      title: hasSiViolation ? 'TS Analysis (SI warning)' : 'TS Analysis (OK)',
      description: `${dvb.pidCount ?? 0} PID · ${dvb.serviceCount ?? 0} svc · ${(dvb.bitrateBps ? (dvb.bitrateBps / 1e6).toFixed(2) : '0.00')} Mbps`,
      evidence: {
        bitrateSource: dvb.bitrateSource || null,
        bitrateMbps: dvb.bitrateBps ? Number((dvb.bitrateBps / 1e6).toFixed(3)) : null,
        pidCount: dvb.pidCount ?? null,
        serviceCount: dvb.serviceCount ?? null,
        siIntervalsSec: si.intervalsSec || null,
        siCompliance: compliance || null,
        arrival: dvb.arrival || null,
        probeDiagnostics: dvb.probeDiagnostics || null,
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
  if (severity === 'critical') return '#ff2233';
  if (severity === 'warning') return '#ffaa00';
  if (severity === 'ok') return '#00dd55';
  return '#00ddff';
}

function laneColorForEvent(event) {
  if (!event) return '#ffffff26';
  if (event.severity === 'critical') return '#ff2233aa';
  if (event.severity === 'warning') return '#ffaa00aa';
  if (event.severity === 'ok') return '#00dd5566';
  return '#66ccff66';
}

function colorForLaneSeverity(severity) {
  if (severity === 'critical') return '#ff2233';
  if (severity === 'warning') return '#ffaa00';
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
  const [mouseLaneId, setMouseLaneId] = useState(null);
  const [freezeCursor, setFreezeCursor] = useState(false);
  const [scaleMode, setScaleMode] = useState('normalized');

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

  const timeEnd = nowMs;
  const timeStart = timeEnd - windowMs;
  const visibleEvents = useMemo(
    () => events.filter((e) => e.ts >= timeStart && e.ts <= timeEnd),
    [events, timeStart, timeEnd]
  );

  const timelineEvents = useMemo(() => {
    if (windowMs <= 0) return [];
    return visibleEvents.map((e) => ({
      ...e,
      xPct: Math.min(100, Math.max(0, ((e.ts - timeStart) / windowMs) * 100)),
    }));
  }, [visibleEvents, timeStart, windowMs]);

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

  const pointerUtc = mouseX == null ? null : (timeStart + (windowMs * mouseX) / 100);

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
  const selectedLaneEvent = selectedLaneId
    ? lanePointerStatus.find((row) => row.id === selectedLaneId)?.event || null
    : null;

  const selectedEvent = selectedLaneEvent;

  const lanePointerErrors = useMemo(() => {
    if (!selectedLaneId || pointerUtc == null) return [];
    const halfWindowMs = 30 * 1000; // show nearby context around pointer
    return (laneMap[selectedLaneId] || [])
      .filter((e) => e.severity === 'warning' || e.severity === 'critical')
      .filter((e) => Math.abs(e.ts - pointerUtc) <= halfWindowMs)
      .sort((a, b) => Math.abs(a.ts - pointerUtc) - Math.abs(b.ts - pointerUtc))
      .slice(0, 5);
  }, [selectedLaneId, pointerUtc, laneMap]);

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
      out[id] = buildLaneGradient(laneMap[id] || [], timeStart, windowMs);
    }
    return out;
  }, [laneIds, laneMap, timeStart, windowMs]);

  return (
    <div className="space-y-6 font-sans">
      <BentoCard icon={Activity} title="Stream View">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="text-[11px] text-gray-400">Live horizontal UTC timeline by monitor/analyser lane</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setWindowMs(opt.value)}
                className={`text-[11px] px-2 py-0.5 rounded border ${
                  windowMs === opt.value
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
          </div>
        </div>
        <div className="mb-1.5 flex items-center gap-2.5 text-[9px] text-gray-500 font-mono">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
            alarm
          </span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px bg-green-500" /> nominal</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px bg-amber-500" /> major</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-px bg-red-500" /> critical</span>
        </div>

        <div
          className="relative rounded-xl border border-white/10 bg-black/30 overflow-hidden"
          style={{ height: `${Math.max(180, 92 + laneIds.length * LANE_STEP_PX)}px` }}
          onMouseMove={(e) => {
            if (freezeCursor) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            setMouseX(Math.min(100, Math.max(0, x)));
            const y = e.clientY - rect.top;
            const laneIdx = Math.round((y - LANE_TOP_PX) / LANE_STEP_PX);
            setMouseLaneId(laneIds[Math.min(laneIds.length - 1, Math.max(0, laneIdx))] || null);
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            setMouseX(Math.min(100, Math.max(0, x)));
            const y = e.clientY - rect.top;
            const laneIdx = Math.round((y - LANE_TOP_PX) / LANE_STEP_PX);
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
                  {laneAlerts.map((e) => (
                    <div
                      key={e.key}
                      className="absolute -translate-x-1/2 -translate-y-1/2 border rounded-full"
                      style={{
                        left: `${e.xPct}%`,
                        top: `${y}px`,
                        width: e.category === 'runtime_error' ? '8px' : '10px',
                        height: e.category === 'runtime_error' ? '8px' : '10px',
                        background: colorForSeverity(e.severity),
                        borderColor: `${colorForSeverity(e.severity)}77`,
                        boxShadow: `0 0 8px ${colorForSeverity(e.severity)}88`,
                      }}
                      title={`${toUtc(e.ts)} - ${e.title}`}
                    />
                  ))}
                </div>
              );
            })
          )}

          {/* Pointer popup with lane-specific error context */}
          {mouseX != null && selectedLaneId && (
            <div
              className="absolute z-20 w-[360px] max-w-[92%] rounded-lg border border-white/15 bg-black/90 backdrop-blur-md p-2.5 text-[11px]"
              style={{
                left: `clamp(8px, calc(${mouseX}% + 12px), calc(100% - 368px))`,
                top: '28px',
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
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Nearby Alerts (±30s)</div>
                {lanePointerErrors.length === 0 ? (
                  <div className="text-gray-500">No warning/critical events near pointer time.</div>
                ) : (
                  <div className="space-y-1.5 max-h-36 overflow-auto">
                    {lanePointerErrors.map((e) => (
                      <div key={e.key} className="rounded border border-red-500/25 bg-red-900/15 px-2 py-1">
                        <div className="text-red-300 font-mono">{e.title}</div>
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

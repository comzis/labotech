import React, { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import BentoCard from './ui/BentoCard';
import Sparkline from './Sparkline';

const WINDOW_OPTIONS = [
  { value: 5 * 60 * 1000, label: '5m' },
  { value: 15 * 60 * 1000, label: '15m' },
  { value: 60 * 60 * 1000, label: '1h' },
];

const P1_KEYS = ['ts_sync', 'sync_byte', 'pat_error', 'cc_error', 'pmt_error', 'pid_error'];
const P2_KEYS = ['transport_error', 'crc_error', 'pcr_disc', 'pcr_acc', 'pcr_rep', 'pts_error', 'cat_error'];

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
    return {
      key: `${ts}-${msg.id || 'unknown'}-${msg.label || 'alarm'}`,
      ts,
      id: msg.id || 'etr',
      category: 'etr290_alarm',
      severity: msg.priority === 'p1' ? 'critical' : msg.priority === 'p2' ? 'warning' : 'info',
      title: `${(msg.priority || 'p3').toUpperCase()} ${msg.label || 'Alarm'}`,
      description: msg.message || '',
    };
  }
  if (msg.type === 'etr290_status') {
    const status = msg.status || {};
    const hasP1 = P1_KEYS.some((k) => status[k] === 'error');
    const hasP2 = P2_KEYS.some((k) => status[k] === 'error');
    return {
      key: `${ts}-${msg.id || 'unknown'}-status`,
      ts,
      id: msg.id || 'etr',
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
    const dvb = msg.dvb || {};
    const si = dvb.si || {};
    const compliance = si.compliance || {};
    const hasSiViolation = ['nit', 'sdt', 'eitPf', 'tdt'].some((k) => compliance[k] === false);
    const severity = hasSiViolation ? 'warning' : 'ok';
    return {
      key: `${ts}-${msg.id || 'analyse'}-analyse`,
      ts,
      id: msg.id || 'analyse',
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
      },
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

function num(v, digits = 3) {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(digits)) : null;
}

export default function StreamViewPanel({ lastMessage }) {
  const [windowMs, setWindowMs] = useState(WINDOW_OPTIONS[1].value);
  const [events, setEvents] = useState([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [mouseX, setMouseX] = useState(null);
  const [freezeCursor, setFreezeCursor] = useState(false);
  const [scaleMode, setScaleMode] = useState('normalized');

  useEffect(() => {
    if (!lastMessage) return;
    const event = toEvent(lastMessage);
    if (!event) return;
    setEvents((prev) => {
      const next = [...prev, event];
      return next.slice(-500);
    });
  }, [lastMessage]);

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

  const hovered = useMemo(() => {
    if (mouseX == null || timelineEvents.length === 0) return null;
    let best = null;
    let bestDist = Infinity;
    for (const e of timelineEvents) {
      const dist = Math.abs(e.xPct - mouseX);
      if (dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }, [mouseX, timelineEvents]);

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

  return (
    <div className="space-y-6 font-sans">
      <BentoCard icon={Activity} title="Stream View">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-xs text-gray-400">Live horizontal UTC timeline by monitor/analyser lane</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setWindowMs(opt.value)}
                className={`text-xs px-2.5 py-1 rounded border ${
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
              className={`text-xs px-2.5 py-1 rounded border ${
                scaleMode === 'absolute'
                  ? 'border-amber-500/50 text-amber-300 bg-amber-900/20'
                  : 'border-white/10 text-gray-400 bg-black/20'
              }`}
            >
              Scale: {scaleMode === 'absolute' ? 'Absolute' : 'Normalized'}
            </button>
            <button
              onClick={() => setFreezeCursor((v) => !v)}
              className={`text-xs px-2.5 py-1 rounded border ${
                freezeCursor
                  ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10'
                  : 'border-white/10 text-gray-400 bg-black/20'
              }`}
            >
              {freezeCursor ? 'Cursor Frozen' : 'Freeze Cursor'}
            </button>
          </div>
        </div>

        <div
          className="relative rounded-xl border border-white/10 bg-black/30 overflow-hidden"
          style={{ height: `${Math.max(180, 90 + laneIds.length * 34)}px` }}
          onMouseMove={(e) => {
            if (freezeCursor) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            setMouseX(Math.min(100, Math.max(0, x)));
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            setMouseX(Math.min(100, Math.max(0, x)));
            setFreezeCursor(true);
          }}
          onMouseLeave={() => {
            if (!freezeCursor) setMouseX(null);
          }}
        >
          <div className="absolute left-2 top-2 text-[10px] text-gray-500 font-mono">{toUtc(timeStart)}</div>
          <div className="absolute right-2 top-2 text-[10px] text-gray-500 font-mono">{toUtc(timeEnd)}</div>

          {/* Current UTC position line */}
          <div className="absolute top-0 bottom-0 border-l border-neon-cyan/70" style={{ left: '100%' }} />

          {/* Mouse crosshair line */}
          {mouseX != null && (
            <div className="absolute top-0 bottom-0 border-l border-white/50 pointer-events-none" style={{ left: `${mouseX}%` }} />
          )}

          {laneIds.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">
              Waiting for live ETR/TS analysis events...
            </div>
          ) : (
            laneIds.map((id, laneIdx) => {
              const y = 52 + laneIdx * 34;
              return (
                <div key={id}>
                  <div className="absolute left-0 right-0 h-px bg-white/15" style={{ top: `${y}px` }} />
                  <div className="absolute left-2 -translate-y-1/2 text-[10px] text-gray-500 font-mono" style={{ top: `${y}px` }}>
                    {id}
                  </div>
                  {(laneMap[id] || []).map((e) => (
                    <div
                      key={e.key}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border"
                      style={{
                        left: `${e.xPct}%`,
                        top: `${y}px`,
                        width: e.category === 'etr290_alarm' ? '10px' : '8px',
                        height: e.category === 'etr290_alarm' ? '10px' : '8px',
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
            <div className="font-mono text-gray-300">{hovered ? hovered.title : 'Move mouse over timeline'}</div>
            <div className="text-gray-500 mt-0.5">{hovered ? hovered.description : '-'}</div>
            <div className="text-gray-500 mt-0.5">{hovered ? toUtc(hovered.ts) : '-'}</div>
            {hovered?.evidence?.bitrateSource && (
              <div className="text-gray-500 mt-0.5">Bitrate source: {hovered.evidence.bitrateSource}</div>
            )}
            {hovered?.evidence?.siCompliance && (
              <div className="text-gray-500 mt-0.5">
                SI: NIT {String(hovered.evidence.siCompliance.nit)} · SDT {String(hovered.evidence.siCompliance.sdt)} · EITp/f {String(hovered.evidence.siCompliance.eitPf)} · TDT {String(hovered.evidence.siCompliance.tdt)}
              </div>
            )}
            {hovered?.evidence?.arrival && (
              <div className="text-gray-500 mt-0.5">
                Arrival: jitter {hovered.evidence.arrival.jitterMs ?? '-'} ms · loss {hovered.evidence.arrival.packetLossPct ?? '-'}%
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
                return (
                  <div key={`forensic-${id}`} className="rounded border border-white/10 bg-black/30 p-2">
                    <div className="font-mono text-gray-300 mb-2">{id}</div>
                    {!lane || lane.samples.length === 0 ? (
                      <div className="text-gray-500">No analyse samples yet for this lane.</div>
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

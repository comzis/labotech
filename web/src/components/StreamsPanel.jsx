import React, { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { toast } from 'sonner';
import useStreams from '../hooks/useStreams';
import { getEncapsulatorHealth, inspectEncapPortOffender, resolveEncapPortOffender, stopStream } from '../api';
import StatusDot from './StatusDot';
import MetricsTile from './MetricsTile';
import EncoderForm from './EncoderForm';
import { motion } from 'framer-motion';
import { C } from './BroadcastUI';

const THUMB_BASE = '/logs/thumbnails';
const EMBED_REFRESH_MS = parseInt(import.meta.env?.VITE_THUMB_INTERVAL_MS, 10) || 5000;
// Output mode pill — colour-coded for quick identification at a glance
const MODE_STYLE = {
  srt: 'bg-sky-900/60    text-sky-300    border-sky-700/40',
  udp: 'bg-orange-900/60 text-orange-300 border-orange-700/40',
  rtp: 'bg-violet-900/60 text-violet-300 border-violet-700/40',
};
const formatPidHex = (pid) => (pid == null ? 'N/A' : `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`);
const formatDisplayFps = (value) => {
  if (value === undefined || value === null) return '';
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return `${n.toFixed(2)}fps`;
  const s = String(value).trim();
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!frac) return '';
  const num = Number(frac[1]);
  const den = Number(frac[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return '';
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? `${fps.toFixed(2)}fps` : '';
};
const formatMbps = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${(n / 1000).toFixed(2)} Mbps`;
};
const PidRef = ({ pid }) => (
  pid == null ? <span style={{ color: C.muted }}>N/A</span> : (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{ color: C.text }}>{pid}</span>
      <span style={{ color: C.muted }}>{formatPidHex(pid)}</span>
    </span>
  )
);

export default function StreamsPanel({ lastMessage }) {
  const { streams, loading, error, refresh } = useStreams();
  const [encapHealth, setEncapHealth] = useState(null);       // last known good (never cleared on failure)
  const [encapStaleSince, setEncapStaleSince] = useState(null); // ms timestamp, set on first failure
  const [encapHealthError, setEncapHealthError] = useState(null);
  const [encapHealthLoading, setEncapHealthLoading] = useState(false);
  const [encapResolveBusy, setEncapResolveBusy] = useState(false);
  const [encapLastCheckMs, setEncapLastCheckMs] = useState(null);
  const encapFailCount = React.useRef(0);
  const encapStaleSinceRef = React.useRef(null); // same value as encapStaleSince but ref-stable for logic

  useEffect(() => {
    if (lastMessage?.type === 'stopped') refresh();
  }, [lastMessage, refresh]);

  const loadEncapHealth = useCallback(async ({ silent = false, forceError = false } = {}) => {
    if (!silent) setEncapHealthLoading(true);
    try {
      const h = await getEncapsulatorHealth();
      encapFailCount.current = 0;
      encapStaleSinceRef.current = null;
      setEncapHealth(h);
      setEncapStaleSince(null);
      setEncapHealthError(null);
      setEncapLastCheckMs(Date.now());
      return true;
    } catch (err) {
      encapFailCount.current += 1;
      const now = Date.now();
      if (!encapStaleSinceRef.current) encapStaleSinceRef.current = now;
      setEncapStaleSince(encapStaleSinceRef.current);
      setEncapLastCheckMs(now);
      // encapHealth is intentionally NOT cleared — keep the last known good
      // snapshot so operators see a stale card rather than a blank.
      const staleDurationMs = now - encapStaleSinceRef.current;
      const hadPriorHealth = !!encapHealth; // closure over current state
      const escalate = forceError
        || (hadPriorHealth ? staleDurationMs >= 45000 : encapFailCount.current >= 2);
      if (escalate) setEncapHealthError(err?.message || 'service unavailable');
      return false;
    } finally {
      if (!silent) setEncapHealthLoading(false);
    }
  }, [encapHealth]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      if (!mounted) return;
      await loadEncapHealth({ silent: true });
    };
    tick();
    const timer = setInterval(tick, 15000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [loadEncapHealth]);

  const handleStop = async (id) => {
    try {
      await stopStream(id);
    } catch (err) {
      if (!err.message.includes('404') && !err.message.toLowerCase().includes('not found')) {
        toast.error(`Failed to stop ${id}: ${err.message}`);
      }
    }
    refresh();
  };

  const resolveEncapPortConflict = async () => {
    if (encapResolveBusy) return;
    setEncapResolveBusy(true);
    try {
      const preview = await inspectEncapPortOffender(4100);
      const listeners = Array.isArray(preview?.listeners) ? preview.listeners : [];
      if (listeners.length === 0) {
        toast.message('No listener detected on 4100.');
        await loadEncapHealth({ forceError: true });
        return;
      }
      const summary = listeners.map((l) => {
        const pid = l?.pid != null ? `PID ${l.pid}` : 'PID unknown';
        const hint = l?.commandHint || 'unknown process';
        return `${pid} (${hint})`;
      }).join(', ');
      const ok = window.confirm(`Resolve port 4100 conflict?\nDetected: ${summary}\n\nThis sends SIGTERM to allowlisted offender processes.`);
      if (!ok) return;
      const result = await resolveEncapPortOffender(4100, true);
      const killedCount = Number(result?.killedCount || 0);
      const remainingCount = Number(result?.remainingCount || 0);
      if (killedCount > 0) {
        toast.success(`Sent SIGTERM to ${killedCount} process(es) on port 4100.`);
      } else {
        toast.warning('No process was killed (not allowlisted or already exited).');
      }
      if (remainingCount > 0) {
        toast.warning(`Port 4100 still has ${remainingCount} listener(s). Use host triage script if needed.`);
      }
      encapFailCount.current = 2;
      await loadEncapHealth({ forceError: true });
    } catch (err) {
      toast.error(`Resolve failed: ${err.message}`);
    } finally {
      setEncapResolveBusy(false);
    }
  };

  const running = streams.filter((s) => s.isRunning);
  const stopped = streams.filter((s) => !s.isRunning);

  const clearStopped = async () => {
    await Promise.all(stopped.map((s) => handleStop(s.id)));
  };

  const linkTone = (s) => {
    const status = s?.srtLink?.status;
    if (status === 'healthy') return 'text-green-300 border-green-700/40 bg-green-900/40';
    if (status === 'degraded') return 'text-yellow-300 border-yellow-700/40 bg-yellow-900/40';
    if (status === 'critical') return 'text-red-300 border-red-700/40 bg-red-900/40';
    return 'text-gray-400 border-gray-700/40 bg-gray-900/40';
  };

  return (
    <div className="broadcast-legacy" style={{ fontFamily: "'Courier New',monospace", color: C.text, display: 'grid', gap: 16 }}>
      <EncoderForm onStarted={refresh} />

      <section>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
            borderBottom: `1px solid ${C.border}`,
            paddingBottom: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} color={C.ok} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.05em' }}>SRT Encapsulator Operations</div>
              <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Haivision SRT Link Health and Throughput
              </div>
            </div>
          </div>

          {stopped.length > 0 ? (
            <button
              onClick={clearStopped}
              style={{
                border: `1px solid ${C.border}`,
                background: C.panel,
                color: C.muted,
                borderRadius: 2,
                padding: '6px 10px',
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Clear Stopped ({stopped.length})
            </button>
          ) : (
            <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Running {running.length} / Total {streams.length}
            </div>
          )}
        </div>

        {loading && <p className="text-gray-600 text-sm">Loading…</p>}
        {error && <p className="text-red-400  text-sm">{error}</p>}

        {/* Stale: had health, now unreachable within SLA — show last known data with amber border */}
        {encapHealth && encapStaleSince && !encapHealthError && (
          <div className="mb-3 rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] font-mono text-amber-200">
            SRT service: {encapHealth.status} · libsrt {encapHealth?.capabilities?.libsrt ? 'enabled' : 'missing'} · {encapHealth?.capabilities?.details || 'unknown'}
            {Number.isFinite(Number(encapHealth?.telemetry?.cpuPercent)) ? ` · CPU ${encapHealth.telemetry.cpuPercent}%` : ''}
            {' '}· <span className="text-amber-300/80">stale since {new Date(encapStaleSince).toLocaleTimeString()} — reconnecting</span>
          </div>
        )}

        {/* Reconnecting: never had health data, 1st failure — brief amber chip */}
        {!encapHealth && encapStaleSince && !encapHealthError && (
          <div className="mb-3 rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] font-mono text-amber-200">
            SRT sidecar reconnecting…
          </div>
        )}

        {/* Hard error: stale beyond SLA (45s) or never had health + 2+ failures */}
        {encapHealthError && (
          <div className="mb-3 rounded border border-red-700/40 bg-red-950/20 px-3 py-2 text-[11px] font-mono text-red-200">
            <div className="flex items-center justify-between gap-3">
              <span>
                SRT sidecar unreachable: {encapHealthError}
                {encapLastCheckMs ? ` · last check ${new Date(encapLastCheckMs).toLocaleTimeString()}` : ''}
              </span>
              <button
                onClick={() => { encapFailCount.current = 2; loadEncapHealth({ forceError: true }); }}
                disabled={encapHealthLoading}
                className="shrink-0 rounded border border-red-600/60 px-2 py-1 text-[10px] uppercase tracking-wide text-red-100 hover:bg-red-900/30 disabled:opacity-50"
              >
                {encapHealthLoading ? 'Retrying...' : 'Retry'}
              </button>
              <button
                onClick={resolveEncapPortConflict}
                disabled={encapResolveBusy}
                className="shrink-0 rounded border border-amber-500/70 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-100 hover:bg-amber-900/30 disabled:opacity-50"
                title="Detect and terminate allowlisted process listeners on 127.0.0.1:4100"
              >
                {encapResolveBusy ? 'Resolving...' : 'Resolve Port 4100'}
              </button>
            </div>
            <div className="mt-1 text-[10px] text-red-300/90">
              Diagnostics: check `labotech-encapsulator` container and `curl http://127.0.0.1:4100/health`.
            </div>
          </div>
        )}

        {/* Healthy: last known good, not stale */}
        {encapHealth && !encapStaleSince && (
          <div className="mb-3 rounded border border-emerald-700/40 bg-emerald-950/10 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {/* Service status LED + label */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  background: encapHealth.status === 'ok' ? 'radial-gradient(circle at 38% 32%, #fff6, #00e86a)' : '#ffaa00',
                  boxShadow: encapHealth.status === 'ok' ? '0 0 5px #00dd55, 0 0 9px rgba(0,221,85,0.45)' : '0 0 5px #ffaa00',
                }}
              />
              <span className="text-[9px] uppercase tracking-[0.1em] font-bold" style={{ color: '#4ade80' }}>
                SRT Encapsulator
              </span>
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.1em]"
                style={{
                  background: encapHealth.status === 'ok' ? 'rgba(0,220,100,0.12)' : 'rgba(255,170,0,0.12)',
                  color: encapHealth.status === 'ok' ? '#00f06f' : '#ffaa00',
                  border: `1px solid ${encapHealth.status === 'ok' ? 'rgba(0,220,100,0.3)' : 'rgba(255,170,0,0.3)'}`,
                }}
              >
                {encapHealth.status === 'ok' ? 'READY' : String(encapHealth.status).toUpperCase()}
              </span>
            </div>

            <span style={{ color: '#1e3a2e', fontSize: 8 }}>│</span>

            {/* libsrt chip */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[8px] uppercase tracking-[0.08em]" style={{ color: '#6b8f79' }}>libsrt</span>
              <span
                className="px-1 py-0.5 rounded text-[8px] font-bold uppercase"
                style={{
                  background: encapHealth?.capabilities?.libsrt ? 'rgba(0,200,90,0.10)' : 'rgba(255,60,60,0.10)',
                  color: encapHealth?.capabilities?.libsrt ? '#34d399' : '#f87171',
                  border: `1px solid ${encapHealth?.capabilities?.libsrt ? 'rgba(0,200,90,0.25)' : 'rgba(255,60,60,0.25)'}`,
                }}
              >
                {encapHealth?.capabilities?.libsrt ? 'OK' : 'MISSING'}
              </span>
            </div>

            {/* CPU chip */}
            {Number.isFinite(Number(encapHealth?.telemetry?.cpuPercent)) && (() => {
              const cpu = Number(encapHealth.telemetry.cpuPercent);
              const cpuColor = cpu >= 85 ? '#f87171' : cpu >= 65 ? '#fbbf24' : '#34d399';
              const cpuBg = cpu >= 85 ? 'rgba(248,113,113,0.10)' : cpu >= 65 ? 'rgba(251,191,36,0.10)' : 'rgba(52,211,153,0.10)';
              const cpuBorder = cpu >= 85 ? 'rgba(248,113,113,0.25)' : cpu >= 65 ? 'rgba(251,191,36,0.25)' : 'rgba(52,211,153,0.25)';
              return (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[8px] uppercase tracking-[0.08em]" style={{ color: '#6b8f79' }}>CPU</span>
                  <span className="px-1 py-0.5 rounded text-[8px] font-bold font-mono" style={{ background: cpuBg, color: cpuColor, border: `1px solid ${cpuBorder}` }}>
                    {cpu}%
                  </span>
                </div>
              );
            })()}

            {/* Guardrail chip */}
            {encapHealth?.guardrail?.enabled && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[8px] uppercase tracking-[0.08em]" style={{ color: '#6b8f79' }}>Guardrail</span>
                <span
                  className="px-1 py-0.5 rounded text-[8px] font-bold uppercase"
                  style={{
                    background: encapHealth.guardrail.warn ? 'rgba(251,191,36,0.10)' : 'rgba(52,211,153,0.10)',
                    color: encapHealth.guardrail.warn ? '#fbbf24' : '#34d399',
                    border: `1px solid ${encapHealth.guardrail.warn ? 'rgba(251,191,36,0.25)' : 'rgba(52,211,153,0.25)'}`,
                  }}
                >
                  {encapHealth.guardrail.warn ? 'WARN' : 'NORMAL'}
                </span>
              </div>
            )}

            {/* Cap chip */}
            {Number.isFinite(Number(encapHealth?.guardrail?.estimatedMaxStreams)) && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-[8px] uppercase tracking-[0.08em]" style={{ color: '#6b8f79' }}>Cap</span>
                <span className="px-1 py-0.5 rounded text-[8px] font-bold font-mono" style={{ background: 'rgba(56,189,248,0.08)', color: '#7dd3fc', border: '1px solid rgba(56,189,248,0.2)' }}>
                  {encapHealth.guardrail.estimatedMaxStreams} × {encapHealth?.guardrail?.streamMbpsBaseline || 22}Mbps
                </span>
              </div>
            )}

            {/* Details (protocol info) */}
            {encapHealth?.capabilities?.details && (
              <span className="text-[8px] font-mono ml-auto" style={{ color: '#4a6b5a' }}>
                {encapHealth.capabilities.details}
              </span>
            )}
          </div>
        )}
        {encapHealth?.guardrail?.warn && !encapHealth?.guardrail?.block && (
          <div className="mb-3 rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[11px] font-mono text-amber-200">
            Guardrail warning: {(encapHealth.guardrail.reasons || []).join(' | ') || 'approaching configured threshold'}.
            New channels may be blocked soon.
          </div>
        )}

        {!loading && streams.length === 0 && (
          <p className="text-gray-600 text-sm">No active encapsulation channels.</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {streams.map(s => {
            const mode = s.outputMode || 'srt';
            const dvb = s.dvb;
            return (
              <motion.div
                key={s.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`bg-midnight-glass backdrop-blur-xl rounded-2xl p-4 space-y-3 relative overflow-hidden group transition-shadow duration-500
                  ${s.isRunning
                    ? 'border border-transparent ring-1 ring-cyan-500/20 shadow-[0_0_32px_-6px_rgba(34,211,238,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                  }`}
              >
                {/* State accent strip — top edge colour coding */}
                <div className={`absolute top-0 left-0 right-0 h-[2px] rounded-t-2xl ${
                  s.isRunning
                    ? 'bg-gradient-to-r from-cyan-500/80 via-cyan-400/40 to-transparent'
                    : 'bg-gradient-to-r from-gray-700/50 to-transparent'
                }`} />
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                {/* Header row */}
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot status={s.isRunning ? 'live' : 'stopped'} pulse />
                    <span className="font-mono text-sm font-semibold truncate">{s.id}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                    {/* Output mode badge */}
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${MODE_STYLE[mode] || MODE_STYLE.srt}`}>
                      {mode}
                    </span>
                    {/* Engine badge — SLT = preferred low-overhead path */}
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${s.engine === 'srt-live-transmit' ? 'bg-emerald-900/50 text-emerald-300 border-emerald-700/40' : 'bg-slate-800/60 text-slate-400 border-slate-600/40'}`}>
                      {s.engine === 'srt-live-transmit' ? 'SLT' : 'FFmpeg'}
                    </span>
                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${linkTone(s)}`}>
                      Link {s?.srtLink?.status || 'unknown'}
                    </span>
                    {s.isRunning ? (
                      <button
                        onClick={() => handleStop(s.id)}
                        className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-2 py-1 rounded transition-colors"
                      >
                        Stop Channel
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStop(s.id)}
                        className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-400 px-2 py-1 rounded transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {/* DVB service identity */}
                {dvb?.serviceName && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Service:</span>
                    <span className="text-white font-semibold">{dvb.serviceName}</span>
                    {dvb.serviceProvider && <span className="text-gray-600">/ {dvb.serviceProvider}</span>}
                  </div>
                )}

                {/* Input source + detected streams */}
                <div className="text-xs text-gray-500 truncate">{s.input}</div>
                {s.inputStreams?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.inputStreams.map((st, i) => (
                      <span key={i} className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                        st.kind === 'video' ? 'bg-blue-900/40 text-blue-300 border-blue-700/40' : 'bg-green-900/40 text-green-300 border-green-700/40'
                      }`}>
                        {st.kind === 'video'
                          ? `${st.codec} ${st.width ? `${st.width}×${st.height}` : ''} ${formatDisplayFps(st.fps)}`.trim()
                          : `${st.codec} ${st.sampleRate ? `${st.sampleRate}Hz` : ''}`.trim()
                        }
                      </span>
                    ))}
                  </div>
                )}

                {/* Destination + PIDs */}
                <div className="flex items-center gap-2 text-xs text-gray-600 font-mono flex-wrap">
                  <span>→ {s.host}:{s.port}</span>
                  {dvb && (
                    <span className="text-gray-700">
                      SID {dvb.serviceId} · V:<PidRef pid={dvb.videoPid} /> · PMT:<PidRef pid={dvb.pmtPid} />
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-gray-500">
                  Input bitrate: {formatMbps(s.inputBitrate)
                    ? `${formatMbps(s.inputBitrate)}${s.inputBitrateSource ? ` (${s.inputBitrateSource})` : ''}`
                    : s.inputBitrateMeasuring
                      ? 'measuring...'
                      : s.isRunning
                        ? 'pending'
                        : '-'
                  } · Output bitrate: {formatMbps(s.lastStats?.bitrate)
                    ? formatMbps(s.lastStats?.bitrate)
                    : s.isRunning ? 'pending' : '-'}
                </div>
                {s.srtStats && (
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="rounded border border-cyan-700/30 bg-cyan-950/20 px-2 py-1 text-cyan-300">
                      RTT {Number.isFinite(Number(s.srtStats.rttMs)) ? `${s.srtStats.rttMs}ms` : '-'} · Loss {Number.isFinite(Number(s.srtStats.lossPercent)) ? `${s.srtStats.lossPercent}%` : '-'}
                    </div>
                    <div className="rounded border border-blue-700/30 bg-blue-950/20 px-2 py-1 text-blue-300">
                      Rate {Number.isFinite(Number(s.srtStats.rateMbps)) ? `${s.srtStats.rateMbps}Mbps` : '-'} · BW {Number.isFinite(Number(s.srtStats.bwMbps)) ? `${s.srtStats.bwMbps}Mbps` : '-'}
                    </div>
                  </div>
                )}

                {/* Audio pairs summary */}
                {s.audioPairs?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {s.audioPairs.map((p, i) => (
                      <span key={i} className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                        A{i} {p.codec} <PidRef pid={p.pid} />
                        {p.language ? ` [${p.language}]` : ''}
                      </span>
                    ))}
                  </div>
                )}

                {/* Encapsulation profile */}
                {s.encodeProfile && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-[10px] font-mono bg-purple-900/40 text-purple-300 px-1.5 py-0.5 rounded border border-purple-700/40">
                      {s.encodeProfile.videoCodec}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                      {s.encodeProfile.videoBitrate}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                      {s.encodeProfile.preset}
                    </span>
                    <span className="text-[10px] font-mono bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                      GOP {s.encodeProfile.gopSize}
                    </span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      s.encodeProfile.rateMode === 'cbr'
                        ? 'bg-amber-900/40 text-amber-300 border-amber-700/40'
                        : 'bg-gray-800 text-gray-400 border-gray-700'
                    }`}>
                      {(s.encodeProfile.rateMode || 'cbr').toUpperCase()}
                    </span>
                  </div>
                )}

                {s.isRunning && (
                  <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-3 items-start">
                    <MetricsTile
                      id={s.id}
                      stats={s.lastStats}
                      srtStats={s.srtStats}
                      inputBitrate={s.inputBitrate}
                      inputBitrateMeasuring={s.inputBitrateMeasuring}
                      lastMessage={lastMessage}
                    />
                    <ConfidenceEmbed stream={s} />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ConfidenceEmbed({ stream }) {
  const [imgError, setImgError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), EMBED_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // Retry thumbnail load each refresh tick.
    setImgError(false);
  }, [tick, stream.id]);
  const thumbUrl = `${THUMB_BASE}/${stream.id}.jpg?t=${tick}`;
  const outputMbps = formatMbps(stream?.lastStats?.bitrate);
  const inputBr = Number(stream?.inputBitrate);
  const inputMbps = formatMbps(inputBr);

  return (
    <div className="bg-black/20 border border-white/5 rounded-2xl p-3 space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">Confidence (Embedded)</div>
      <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/40 aspect-video">
        {imgError ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-600">No thumbnail</div>
        ) : (
          <img
            src={thumbUrl}
            alt={stream.id}
            onError={() => setImgError(true)}
            onLoad={() => setImgError(false)}
            className="w-full h-full object-contain"
          />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="rounded border border-white/10 bg-black/30 px-2 py-1">
          <span className="text-gray-500">Input</span>{' '}
          <span className={inputMbps ? 'text-emerald-300' : 'text-gray-600'}>{inputMbps || '-'}</span>
        </div>
        <div className="rounded border border-white/10 bg-black/30 px-2 py-1">
          <span className="text-gray-500">Output</span>{' '}
          <span className={outputMbps ? 'text-neon-cyan' : 'text-gray-600'}>{outputMbps || '-'}</span>
        </div>
      </div>
    </div>
  );
}

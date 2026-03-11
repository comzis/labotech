import React, { useEffect } from 'react';
import useETR290 from '../hooks/useETR290';
import StatusDot from './StatusDot';
import BentoCard from './ui/BentoCard';
import { Field } from './ui/MatrixField';
import { ShieldAlert, Activity } from 'lucide-react';
import { useState } from 'react';
import { probeUrl } from '../api';

const PRIORITY_META = {
  p1: { label: 'Priority 1', desc: 'Service not receivable', color: 'red',    border: 'border-red-500/30',    bg: 'bg-red-900/20',    text: 'text-red-400',    dot: 'bg-red-400'    },
  p2: { label: 'Priority 2', desc: 'Quality impaired',       color: 'amber',  border: 'border-amber-500/30',  bg: 'bg-amber-900/20',  text: 'text-amber-400',  dot: 'bg-amber-400'  },
  p3: { label: 'Priority 3', desc: 'Informational',          color: 'sky',    border: 'border-sky-500/30',    bg: 'bg-sky-900/20',    text: 'text-sky-400',    dot: 'bg-sky-400'    },
};

const ETR_CHECKS = {
  p1: [
    { id: 'ts_sync',   label: 'TS Sync Loss'   },
    { id: 'sync_byte', label: 'Sync Byte Error' },
    { id: 'pat_error', label: 'PAT Error'       },
    { id: 'cc_error',  label: 'CC Error'        },
    { id: 'pmt_error', label: 'PMT Error'       },
    { id: 'pid_error', label: 'PID Error'       },
  ],
  p2: [
    { id: 'transport_error', label: 'Transport Error'   },
    { id: 'crc_error',       label: 'CRC Error'         },
    { id: 'pcr_disc',        label: 'PCR Discontinuity' },
    { id: 'pcr_acc',         label: 'PCR Accuracy'      },
    { id: 'pcr_rep',         label: 'PCR Repetition'    },
    { id: 'pts_error',       label: 'PTS Error'         },
    { id: 'cat_error',       label: 'CAT Error'         },
  ],
  p3: [
    { id: 'nit_error', label: 'NIT Error'    },
    { id: 'sdt_error', label: 'SDT Error'    },
    { id: 'eit_error', label: 'EIT Error'    },
    { id: 'rst_error', label: 'RST Error'    },
    { id: 'tdt_error', label: 'TDT Error'    },
    { id: 'empty_buf', label: 'Empty Buffer' },
  ],
};

function TrafficLight({ ok }) {
  return (
    <div className="flex gap-1 items-center">
      <span className={`w-3 h-3 rounded-full ${ok ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-gray-700'}`} />
      <span className={`w-3 h-3 rounded-full ${!ok ? 'bg-red-500 shadow-[0_0_6px_#ef4444] animate-pulse' : 'bg-gray-700'}`} />
    </div>
  );
}

function CheckRow({ check, status, count }) {
  const ok = status !== 'error';
  return (
    <div className={`flex items-center justify-between py-1.5 px-3 rounded-lg mb-1 ${ok ? 'bg-white/[0.02]' : 'bg-red-900/20 border border-red-500/20'}`}>
      <div className="flex items-center gap-3">
        <TrafficLight ok={ok} />
        <span className={`text-xs font-mono ${ok ? 'text-gray-400' : 'text-red-300 font-semibold'}`}>
          {check.label}
        </span>
      </div>
      {count > 0 && (
        <span className="text-[10px] font-mono text-red-400 bg-red-900/40 px-1.5 py-0.5 rounded">
          {count}
        </span>
      )}
    </div>
  );
}

function PriorityBlock({ priorityKey, meta, checks, status, counts }) {
  const hasError = checks.some(c => status?.[c.id] === 'error');
  return (
    <div className={`rounded-2xl border p-4 ${hasError ? meta.border + ' ' + meta.bg : 'border-white/5 bg-midnight-glass'}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className={`text-xs font-bold uppercase tracking-widest ${hasError ? meta.text : 'text-gray-400'}`}>
            {meta.label}
          </span>
          <span className="text-[10px] text-gray-600 ml-2">{meta.desc}</span>
        </div>
        <div className={`w-2.5 h-2.5 rounded-full ${hasError ? meta.dot + ' animate-pulse shadow-lg' : 'bg-green-500'}`} />
      </div>
      <div>
        {checks.map(c => (
          <CheckRow
            key={c.id}
            check={c}
            status={status?.[c.id] || 'ok'}
            count={counts?.[c.id] || 0}
          />
        ))}
      </div>
    </div>
  );
}

function AlarmTable({ alarms }) {
  if (!alarms?.length) {
    return <p className="text-gray-600 text-xs text-center py-6">No alarms — stream nominal</p>;
  }
  return (
    <div className="overflow-auto max-h-64 rounded-xl border border-white/5">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="border-b border-white/5 text-gray-500 uppercase tracking-widest text-[10px]">
            <th className="text-left px-3 py-2 w-36">Time</th>
            <th className="text-left px-3 py-2 w-16">Pri</th>
            <th className="text-left px-3 py-2 w-32">Check</th>
            <th className="text-left px-3 py-2">Message</th>
          </tr>
        </thead>
        <tbody>
          {alarms.map((a, i) => {
            const meta = PRIORITY_META[a.priority];
            return (
              <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="px-3 py-1.5 text-gray-500">{new Date(a.time).toLocaleTimeString()}</td>
                <td className={`px-3 py-1.5 font-bold ${meta?.text || 'text-gray-400'}`}>
                  {a.priority?.toUpperCase()}
                </td>
                <td className="px-3 py-1.5 text-gray-300">{a.label}</td>
                <td className="px-3 py-1.5 text-gray-500 truncate max-w-xs">{a.message}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatUtc(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function AlarmTimeline({ alarms }) {
  if (!alarms?.length) {
    return <p className="text-gray-600 text-xs text-center py-4">No recent timeline events</p>;
  }
  const sorted = [...alarms]
    .filter((a) => a?.time)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return (
    <div className="max-h-64 overflow-auto rounded-xl border border-white/5 bg-black/20 p-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
        Live Timeline (UTC)
      </div>
      <div className="space-y-2">
        {sorted.map((alarm, idx) => {
          const pri = (alarm.priority || '-').toUpperCase();
          const priClass = pri === 'P1'
            ? 'text-red-300 border-red-500/30 bg-red-900/20'
            : pri === 'P2'
              ? 'text-amber-300 border-amber-500/30 bg-amber-900/20'
              : 'text-sky-300 border-sky-500/30 bg-sky-900/20';
          return (
            <div key={`${alarm.time}-${idx}`} className="relative pl-4">
              <span className="absolute left-0 top-2 h-2 w-2 rounded-full bg-neon-cyan/70" />
              <div className="absolute left-[3px] top-4 bottom-[-10px] w-px bg-white/10" />
              <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${priClass}`}>{pri}</span>
                  <span className="text-[10px] text-gray-500 font-mono">{formatUtc(alarm.time)}</span>
                </div>
                <div className="mt-1 text-xs text-gray-300 font-mono">{alarm.label || '-'}</div>
                <div className="text-[11px] text-gray-500">{alarm.message || '-'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PROBE_MODES = [
  { value: 'rtp', label: 'RTP',  desc: 'RTP/MPEG-TS' },
  { value: 'srt', label: 'SRT',  desc: 'Haivision SRT' },
  { value: 'udp', label: 'UDP',  desc: 'Legacy Multicast/Unicast' },
];
const DVB_REPROBE_MS = 8000;

function buildMonitorUrl({ mode, host, port, latency, passphrase, bindIp }) {
  if (!host || !port) return '';
  const local = (bindIp || '').trim();
  if (mode === 'udp') {
    const q = local ? `?localaddr=${encodeURIComponent(local)}` : '';
    return `udp://${host}:${port}${q}`;
  }
  if (mode === 'rtp') {
    const q = local ? `?localaddr=${encodeURIComponent(local)}` : '';
    return `rtp://${host}:${port}${q}`;
  }
  let url = `srt://${host}:${port}`;
  const params = [];
  if (latency)    params.push(`latency=${latency}`);
  if (passphrase) params.push(`passphrase=${passphrase}`);
  if (params.length) url += `?${params.join('&')}`;
  return url;
}

function collectPidRows(result) {
  if (!result) return [];
  const rows = [];
  (result.programs || []).forEach((program) => {
    (program.streams || []).forEach((stream) => {
      rows.push({
        programId: program.programId,
        programName: program.name || '-',
        pid: stream.pid,
        pidHex: stream.pidHex,
        codecType: stream.codecType || 'unknown',
        codecName: stream.codecName || '-',
        streamType: stream.streamType || '-',
        language: stream.language || '-',
        bitrate: stream.bitrate || 0,
      });
    });
  });
  (result.orphanStreams || []).forEach((stream) => {
    rows.push({
      programId: 'orphan',
      programName: 'Orphan',
      pid: stream.pid,
      pidHex: stream.pidHex,
      codecType: stream.codecType || 'unknown',
      codecName: stream.codecName || '-',
      streamType: stream.streamType || '-',
      language: stream.language || '-',
      bitrate: stream.bitrate || 0,
    });
  });
  const sorted = rows.sort((a, b) => (a.pid ?? 99999) - (b.pid ?? 99999));
  const totalBps = result?.dvb?.bitrateBps || 0;
  const knownBps = sorted.reduce((acc, row) => acc + (row.bitrate || 0), 0);
  const unresolved = Math.max(0, totalBps - knownBps);
  if (unresolved > 0) {
    const firstVideo = sorted.find((row) => row.codecType === 'video' && (!row.bitrate || row.bitrate <= 0));
    if (firstVideo) {
      firstVideo.bitrate = unresolved;
      firstVideo.bitrateEstimated = true;
    }
  }
  return sorted;
}

function formatPidDisplay(pid, pidHex) {
  if (pid == null && !pidHex) return '-';
  if (pid == null) return pidHex || '-';
  return pidHex ? `${pid} (${pidHex})` : String(pid);
}

export default function ETR290Panel({ lastMessage }) {
  const [probeMode, setProbeMode] = useState('rtp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [bindIp, setBindIp] = useState('');
  const [latency, setLatency] = useState('2000');
  const [passphrase, setPassphrase] = useState('');
  const [dvbByMonitorId, setDvbByMonitorId] = useState({});
  const [captureNic, setCaptureNic] = useState('');
  const { status, statusById, activeId, activeIds, error, start, stop, setActiveId, refreshActives, onWsMessage } = useETR290();

  useEffect(() => {
    if (lastMessage) onWsMessage(lastMessage);
  }, [lastMessage, onWsMessage]);

  useEffect(() => {
    refreshActives();
  }, [refreshActives]);

  useEffect(() => {
    if (!activeId) return undefined;
    const url = statusById?.[activeId]?.url;
    if (!url) return undefined;
    let cancelled = false;

    const refreshDvb = async () => {
      try {
        const dvb = await probeUrl(url);
        if (cancelled) return;
        setDvbByMonitorId(prev => {
          const current = prev[activeId];
          const currentResolved = collectPidRows(current).filter(r => r.pid != null).length;
          const nextResolved = collectPidRows(dvb).filter(r => r.pid != null).length;
          // Keep the stronger sample if it has more resolved PIDs.
          if (current && currentResolved > nextResolved) return prev;
          return { ...prev, [activeId]: dvb };
        });
      } catch (_) {}
    };

    refreshDvb();
    const timer = setInterval(refreshDvb, DVB_REPROBE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeId, statusById]);

  const builtUrl = buildMonitorUrl({ mode: probeMode, host, port, latency, passphrase, bindIp });

  const handleToggle = async (e) => {
    e.preventDefault();
    if (builtUrl) {
      const id = `etr290-${Date.now()}`;
      try {
        await start(id, builtUrl, captureNic || undefined);
        const dvb = await probeUrl(builtUrl);
        setDvbByMonitorId(prev => ({ ...prev, [id]: dvb }));
      } catch (_) {}
    }
  };

  const handleStopActive = async () => {
    if (!activeId) return;
    try {
      await stop(activeId);
      setDvbByMonitorId(prev => {
        const next = { ...prev };
        delete next[activeId];
        return next;
      });
    } catch (_) {}
  };

  const totalAlarms = status?.recentAlarms?.length || 0;
  const p1Error = ETR_CHECKS.p1.some(c => status?.status?.[c.id] === 'error');
  const p2Error = ETR_CHECKS.p2.some(c => status?.status?.[c.id] === 'error');
  const selectedDvb = activeId ? dvbByMonitorId[activeId]?.dvb : null;
  const selectedRows = activeId ? collectPidRows(dvbByMonitorId[activeId]) : [];
  const resolvedPidCount = selectedRows.filter(r => r.pid != null).length;
  const expectedPidCount = selectedDvb?.pidCount || 0;
  const unresolvedPidGap = expectedPidCount > 0 && resolvedPidCount < expectedPidCount;
  const videoBitrateMbps = selectedRows.filter(r => r.codecType === 'video').reduce((s, r) => s + (r.bitrate || 0), 0) / 1e6;
  const audioBitrateMbps = selectedRows.filter(r => r.codecType === 'audio').reduce((s, r) => s + (r.bitrate || 0), 0) / 1e6;
  const displayedBitrateMbps = (selectedDvb?.measuredBitrateBps ? selectedDvb.measuredBitrateBps / 1e6 : null)
    ?? (selectedDvb?.formatBitrateBps ? selectedDvb.formatBitrateBps / 1e6 : null)
    ?? (selectedDvb?.bitrateBps ? selectedDvb.bitrateBps / 1e6 : null);

  return (
    <div className="space-y-6">
      {/* Control */}
      <BentoCard icon={ShieldAlert} title="ETR 290 Monitor">
        <form onSubmit={handleToggle} className="space-y-4">

          {/* Protocol selector */}
          <div>
            <label className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pl-1 mb-1.5 block">Protocol</label>
            <div className="grid grid-cols-3 gap-2">
              {PROBE_MODES.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setProbeMode(m.value)}
                  className={`px-3 py-2.5 rounded-xl border text-center transition-all ${probeMode === m.value
                    ? 'bg-neon-cyan/20 border-neon-cyan/50 text-white ring-1 ring-neon-cyan/50'
                    : 'bg-black/30 border-white/10 text-gray-500 hover:border-white/20 hover:bg-black/40'
                  }`}
                >
                  <div className="text-xs font-bold">{m.label}</div>
                  <div className="text-[9px] opacity-60 mt-0.5 uppercase tracking-tighter">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Host + Port */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field
                label={probeMode === 'udp' || probeMode === 'rtp' ? 'Multicast / Unicast IP *' : 'Host *'}
                value={host}
                onChange={setHost}
                placeholder={probeMode === 'udp' || probeMode === 'rtp' ? '239.100.25.29' : '10.67.18.29'}
                required={!activeId}
              />
            </div>
            <Field label="Port *" value={port} onChange={setPort} type="number" placeholder="5000" required={!activeId} />
          </div>

          {/* SRT-only options */}
          {probeMode === 'srt' && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Latency (ms)" value={latency} onChange={setLatency} type="number" placeholder="2000" />
              <Field label="Passphrase" value={passphrase} onChange={setPassphrase} placeholder="Optional" />
            </div>
          )}
          {(probeMode === 'udp' || probeMode === 'rtp') && (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Input Bind IP (eno2 IP)" value={bindIp} onChange={setBindIp} placeholder="10.67.18.29 (optional)" />
              <Field
                label="Capture NIC (optional)"
                value={captureNic}
                onChange={setCaptureNic}
                placeholder="eno2 (default from config)"
              />
            </div>
          )}

          {/* URL preview */}
          {builtUrl && (
            <div className="flex items-center gap-2 text-[11px] font-mono text-gray-500 bg-black/30 px-3 py-2 rounded-lg border border-white/5">
              <span className="text-gray-600 shrink-0">URL:</span>
              <span className="text-neon-cyan/70 truncate">{builtUrl}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!builtUrl}
            className="px-6 py-2.5 rounded-xl font-bold text-sm transition-all bg-gradient-to-r from-neon-purple to-purple-600 text-white shadow-lg shadow-neon-purple/20 disabled:opacity-50"
          >
            Start Monitor
          </button>
          <button
            type="button"
            onClick={handleStopActive}
            disabled={!activeId}
            className="ml-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all bg-red-900/40 hover:bg-red-800/60 text-red-300 border border-red-500/30 disabled:opacity-50"
          >
            Stop Selected
          </button>
        </form>

        {activeIds.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {activeIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveId(id)}
                className={`text-xs px-2 py-1 rounded border ${activeId === id ? 'border-neon-cyan/50 text-neon-cyan bg-neon-cyan/10' : 'border-white/10 text-gray-400 bg-black/20'}`}
              >
                {id}
              </button>
            ))}
          </div>
        )}

        {activeId && (
          <div className="flex items-center gap-2 mt-3 text-xs text-neon-cyan font-mono animate-pulse">
            <StatusDot status="live" pulse />
            Monitoring: {status?.url || statusById?.[activeId]?.url || builtUrl}
          </div>
        )}
      {status?.diagnostics && (
        <div className="mt-2 text-[11px] text-gray-500 font-mono">
          Detector: {status.diagnostics.parser} · matched lines: {status.diagnostics.totalMatchedLines || 0}
          {status.diagnostics.lastMatchAt ? ` · last match: ${formatUtc(status.diagnostics.lastMatchAt)}` : ' · last match: none yet'}
        </div>
      )}
        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
      </BentoCard>

      {activeId && dvbByMonitorId[activeId]?.dvb && (
        <BentoCard icon={Activity} title="DVB Service Table">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Service Count</div>
              <div className="text-gray-200 font-mono mt-1">{String(dvbByMonitorId[activeId].dvb.serviceCount || 0)}</div>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">PID Count</div>
              <div className="text-gray-200 font-mono mt-1">{String(resolvedPidCount || expectedPidCount || 0)}</div>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Actual TS Bitrate</div>
              <div className="text-gray-200 font-mono mt-1">{displayedBitrateMbps != null ? `${displayedBitrateMbps.toFixed(3)} Mbps` : '-'}</div>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">PAT PID</div>
              <div className="text-gray-200 font-mono mt-1">{String(dvbByMonitorId[activeId].dvb.patPid ?? 0)}</div>
            </div>
          </div>
          {selectedDvb?.bitrateSource && (
            <div className="mt-1 text-[10px] text-gray-500">
              TS bitrate source: {selectedDvb.bitrateSource}
            </div>
          )}
          {unresolvedPidGap && (
            <div className="mt-1 text-[10px] text-amber-300">
              PID sample is partial ({resolvedPidCount}/{expectedPidCount} resolved). Background re-probe is running.
            </div>
          )}
          {(dvbByMonitorId[activeId].dvb.services || []).length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-2">SID</th>
                    <th className="text-left py-2">Service</th>
                    <th className="text-left py-2">Provider</th>
                    <th className="text-left py-2">PMT PID</th>
                    <th className="text-left py-2">PCR PID</th>
                  </tr>
                </thead>
                <tbody>
                  {(dvbByMonitorId[activeId].dvb.services || []).map((s, i) => (
                    <tr key={`${s.serviceId}-${i}`} className="border-b border-white/5">
                      <td className="py-2 text-gray-300">{s.serviceId}</td>
                      <td className="py-2 text-gray-300">{s.serviceName || '-'}</td>
                      <td className="py-2 text-gray-400">{s.serviceProvider || '-'}</td>
                      <td className="py-2 text-gray-300">{s.pmtPid ?? '-'}</td>
                      <td className="py-2 text-gray-300">{s.pcrPid ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4">
            <h3 className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold mb-2">
              TS PID Inventory
            </h3>
            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-2 px-2">Program</th>
                    <th className="text-left py-2 px-2">PID</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2">Codec</th>
                    <th className="text-left py-2 px-2">Stream Type</th>
                    <th className="text-left py-2 px-2">Lang</th>
                    <th className="text-left py-2 px-2">Bitrate</th>
                  </tr>
                </thead>
                <tbody>
                  {collectPidRows(dvbByMonitorId[activeId]).map((row, i) => (
                    <tr key={`${row.programId}-${row.pid}-${i}`} className="border-b border-white/5">
                      <td className="py-2 px-2 text-gray-300">{row.programId === 'orphan' ? 'Orphan' : `${row.programId}`}</td>
                      <td className="py-2 px-2 text-gray-300">{formatPidDisplay(row.pid, row.pidHex)}</td>
                      <td className="py-2 px-2 text-gray-300 uppercase">{row.codecType}</td>
                      <td className="py-2 px-2 text-gray-300">{row.codecName}</td>
                      <td className="py-2 px-2 text-gray-400">{row.streamType}</td>
                      <td className="py-2 px-2 text-gray-400">{row.language}</td>
                      <td className="py-2 px-2 text-gray-400">
                        {row.bitrate > 0
                          ? <>
                              {(row.bitrate / 1e6).toFixed(2)} Mbps
                              {row.bitrateEstimated && (
                                <span
                                  className="ml-1 text-[9px] text-amber-400 font-mono"
                                  title="Estimated: TS container bitrate minus sum of resolved PID bitrates"
                                >
                                  (est.)
                                </span>
                              )}
                            </>
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Video Bitrate</div>
              <div className="text-gray-200 font-mono mt-1">
                {`${videoBitrateMbps.toFixed(3)} Mbps`}
                {selectedRows.some(r => r.codecType === 'video' && r.bitrateEstimated) && (
                  <span
                    className="ml-1 text-[9px] text-amber-400 font-mono"
                    title="Video bitrate includes remainder allocation - not a per-PID measured value"
                  >
                    (est.)
                  </span>
                )}
              </div>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Audio Bitrate</div>
              <div className="text-gray-200 font-mono mt-1">{`${audioBitrateMbps.toFixed(3)} Mbps`}</div>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">FPS</div>
              <div className="text-gray-200 font-mono mt-1">{status?.runtime?.fps != null ? String(status.runtime.fps) : '-'}</div>
            </div>
            <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">Speed / Drops</div>
              <div className="text-gray-200 font-mono mt-1">
                {status?.runtime?.speed != null ? `${status.runtime.speed.toFixed(2)}x` : '-'} / {status?.runtime?.dropFrames ?? 0}
              </div>
            </div>
          </div>
        </BentoCard>
      )}

      {/* Overall status banner */}
      {status && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold ${
          p1Error
            ? 'bg-red-900/30 border-red-500/40 text-red-300'
            : p2Error
              ? 'bg-amber-900/30 border-amber-500/40 text-amber-300'
              : 'bg-green-900/20 border-green-500/30 text-green-400'
        }`}>
          <Activity className="w-4 h-4" />
          {p1Error ? 'CRITICAL — Priority 1 errors detected' : p2Error ? 'WARNING — Priority 2 errors' : 'NOMINAL — All checks passing'}
          {totalAlarms > 0 && <span className="ml-auto text-xs font-mono opacity-70">{totalAlarms} alarm{totalAlarms !== 1 ? 's' : ''}</span>}
        </div>
      )}

      {/* ETR 290 Priority Grid */}
      {status && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {Object.entries(ETR_CHECKS).map(([key, checks]) => (
            <PriorityBlock
              key={key}
              priorityKey={key}
              meta={PRIORITY_META[key]}
              checks={checks}
              status={status.status}
              counts={status.counts}
            />
          ))}
        </div>
      )}

      {/* Alarm Log */}
      {status && (
        <div>
          <h3 className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold mb-3">
            Alarm Log
          </h3>
          <AlarmTable alarms={status.recentAlarms} />
          <div className="mt-3">
            <AlarmTimeline alarms={status.recentAlarms} />
          </div>
        </div>
      )}
    </div>
  );
}
